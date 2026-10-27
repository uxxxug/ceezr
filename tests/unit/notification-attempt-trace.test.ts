/**
 * الغرض: LOAD-01 (تفكيكُ P7/G4) — أثرُ كلِّ محاولةِ تسليمٍ لصفٍّ مُلتقَط.
 *   - سجلُّ المحاولةِ من طبقةِ التطبيق (`onAttempt`): المآلُ والتأخيرُ المتعمَّدُ ورقمُ المحاولة؛
 *   - عدّادُ المُرسِلِ المرِن في سياقِ المحاولة: انتظارُ الدلوِ والازدحامُ ونداءُ تيليجرامَ و429؛
 *   - إعداداتُ البيئةِ وحقولُ السطرِ (قائمةٌ مغلقةٌ بلا محادثةٍ ولا نصّ).
 *   والمُطفأُ لا يقيسُ شيئًا: لا ساعةَ ولا عدّاد.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  notificationAttemptLogFields,
  notificationAttemptTraceFromEnv,
  traceCoversKind,
} from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  deliverNotification,
  deliverNotificationsConcurrently,
  type HandlerOutcome,
  type NotificationAttemptRecord,
  type NotificationOutboxPort,
  type OutboxDelivery,
} from "../../packages/application/notification/deliver-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  currentAttemptMeter,
  emptyDeliveryAttemptMeter,
  runWithDeliveryAttemptMeter,
} from "../../packages/infrastructure/notification/delivery-attempt-meter.ts";
import type { OutboundRateBucket } from "../../packages/infrastructure/notification/outbound-rate-bucket.ts";
import {
  createMemoryDeadLetterSink,
  OutboundCongestionError,
  withOutboundResilience,
} from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const ID = "11111111-2222-4333-8444-555555555555";

function delivery(over: Partial<OutboxDelivery> = {}): OutboxDelivery {
  return {
    deliveryId: ID,
    kind: "rider_trip_notice",
    cityId: "c" as never,
    claimToken: "tok",
    attempts: 2,
    maxAttempts: 5,
    signalWaitCount: 1,
    batchLimit: 8,
    requestId: null,
    payload: { event: "MATCHED", chat_id: 987654321, text: "سرّيّ" },
    ...over,
  };
}

function port(
  d: OutboxDelivery | null,
  finishOutcome: "delivered" | "dead" | "retried" = "delivered",
) {
  const calls: string[] = [];
  let served = false;
  const p: NotificationOutboxPort = {
    claim: async () => {
      if (served || d === null) return ok({ delivery: null });
      served = true;
      return ok({ delivery: d });
    },
    finish: async () => {
      calls.push("finish");
      return ok({ ok: finishOutcome === "delivered", outcome: finishOutcome });
    },
    abandon: async () => {
      calls.push("abandon");
      return ok(true);
    },
    undeliverable: async () => {
      calls.push("undeliverable");
      return ok(true);
    },
    finishViaBoard: async () => {
      calls.push("board");
      return ok({ ok: true, outcome: "delivered" });
    },
    requeueSignalWait: async () => {
      calls.push("signal");
      return ok({ ok: true, outcome: null });
    },
    requeue: async () => {
      calls.push("requeue");
      return ok(true);
    },
  };
  return { p, calls };
}

async function attemptWith(
  handled: Result<HandlerOutcome, PortFailureError> | (() => Promise<never>),
  finishOutcome: "delivered" | "dead" | "retried" = "delivered",
  d: OutboxDelivery = delivery(),
) {
  const records: NotificationAttemptRecord[] = [];
  const { p, calls } = port(d, finishOutcome);
  let t = 1_000;
  const r = await deliverNotification({
    outbox: p,
    handlers: {
      rider_trip_notice: typeof handled === "function" ? handled : async () => handled,
    },
    onAttempt: (rec) => records.push(rec),
    wallClockMs: () => {
      t += 40;
      return t;
    },
  }).catch((e: unknown) => e);
  return { r, records, calls };
}

const plain = (o: Partial<HandlerOutcome>): Result<HandlerOutcome, PortFailureError> =>
  ok({ abandon: false, messageId: null, failure: null, ...o });

describe("LOAD-01: سجلُّ محاولةِ التسليم (طبقةُ التطبيق)", () => {
  test("إرسالٌ عبرَ تيليجرام: المآلُ والتوقيتُ ورقمُ المحاولةِ والحدثُ الآمن", async () => {
    const { records } = await attemptWith(plain({ messageId: "m1" }));
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r).toEqual({
      deliveryId: ID,
      kind: "rider_trip_notice",
      event: "MATCHED",
      attempt: 2,
      signalWaits: 1,
      startedAtMs: 1_040,
      durationMs: 40,
      laneWaitMs: null,
      outcome: "telegram",
      retryAfterMs: null,
      failure: null,
    });
    // لا محادثةَ ولا نصَّ في السجلّ.
    expect(JSON.stringify(r)).not.toContain("987654321");
    expect(JSON.stringify(r)).not.toContain("سرّيّ");
  });

  test("التسليمُ عبرَ التطبيق، وانتظارُ الإقرارِ بتأخيرِه المتعمَّد", async () => {
    const board = await attemptWith(plain({ deliveredViaBoard: true }));
    expect(board.records[0]?.outcome).toBe("board");
    expect(board.calls).toEqual(["board"]);
    const wait = await attemptWith(plain({ signalWait: { retryAfterMs: 3_000 } }));
    expect(wait.records[0]?.outcome).toBe("signal_wait");
    expect(wait.records[0]?.retryAfterMs).toBe(3_000);
    expect(wait.calls).toEqual(["signal"]);
  });

  test("ازدحامُ المحدِّد: إعادةٌ بعدَ 1000ms ورمزُ الفشل", async () => {
    const { records, calls } = await attemptWith(plain({ failure: "OutboundCongestionError" }));
    expect(calls).toEqual(["requeue"]);
    expect(records[0]?.outcome).toBe("congestion");
    expect(records[0]?.retryAfterMs).toBe(1_000);
    expect(records[0]?.failure).toBe("OutboundCongestionError");
  });

  test("فشلٌ يُعادُ لاحقًا، وفشلٌ يُميتُ الصفّ، وبلا رسالةٍ ولا فشل", async () => {
    const retry = await attemptWith(plain({ failure: "TELEGRAM_TRANSIENT" }), "retried");
    expect(retry.records[0]?.outcome).toBe("retry");
    expect(retry.records[0]?.failure).toBe("TELEGRAM_TRANSIENT");
    const dead = await attemptWith(plain({ failure: "TELEGRAM_PERMANENT" }), "dead");
    expect(dead.records[0]?.outcome).toBe("dead");
    const none = await attemptWith(plain({}), "retried");
    expect(none.records[0]?.outcome).toBe("no_message");
  });

  test("التخلّي وتعذّرُ التسليمِ يُسمَّيانِ ولا يُحسبانِ إرسالًا", async () => {
    const ab = await attemptWith(plain({ abandon: true, failure: "stale" }));
    expect(ab.records[0]?.outcome).toBe("abandon");
    const un = await attemptWith(plain({ undeliverable: true }));
    expect(un.records[0]?.outcome).toBe("undeliverable");
  });

  test("فشلُ المنفذِ أو رميُ المعالجِ ⇒ `error` والسجلُّ يُكتَبُ مع ذلك", async () => {
    const pf = await attemptWith(err(new PortFailureError("rpc", "db down")));
    expect(pf.records[0]?.outcome).toBe("error");
    const thrown = await attemptWith(async () => {
      throw new Error("boom");
    });
    expect(thrown.r).toBeInstanceOf(Error);
    expect(thrown.records[0]?.outcome).toBe("error");
  });

  test("نصُّ فشلٍ حرٌّ لا يدخلُ السجلّ، وحدثٌ غيرُ رمزيٍّ يُسقَط", async () => {
    const { records } = await attemptWith(
      plain({ failure: "تعذّرَ الإرسالُ إلى 987654321: blocked" }),
      "retried",
      delivery({ payload: { event: "matched; drop table" } }),
    );
    expect(records[0]?.failure).toBe("other");
    expect(records[0]?.event).toBeNull();
  });

  test("رميُ `onAttempt` لا يُسقِطُ التسليم", async () => {
    const { p } = port(delivery());
    const r = await deliverNotification({
      outbox: p,
      handlers: { rider_trip_notice: async () => plain({ messageId: "m" }) },
      onAttempt: () => {
        throw new Error("sink down");
      },
    });
    expect(r.ok && r.value.delivered).toBe(true);
  });

  test("المُطفأُ لا يقرأُ ساعةً ولا يكتبُ سجلًّا", async () => {
    const { p } = port(delivery());
    let reads = 0;
    const r = await deliverNotification({
      outbox: p,
      handlers: { rider_trip_notice: async () => plain({ messageId: "m" }) },
      wallClockMs: () => {
        reads += 1;
        return 0;
      },
    });
    expect(r.ok && r.value.delivered).toBe(true);
    expect(reads).toBe(0);
  });

  test("الشوطُ المتزامنُ يُمرِّرُ انتظارَ المسار", async () => {
    const records: NotificationAttemptRecord[] = [];
    const rows = [
      delivery({ deliveryId: "a", payload: { order_id: "o1" } }),
      delivery({ deliveryId: "b", payload: { order_id: "o1" } }),
    ];
    const queue = [...rows];
    const { p } = port(null);
    const r = await deliverNotificationsConcurrently(
      {
        outbox: { ...p, claim: async () => ok({ delivery: queue.shift() ?? null }) },
        handlers: {
          rider_trip_notice: async () => {
            await new Promise((res) => setTimeout(res, 15));
            return plain({ messageId: "m" });
          },
        },
        onAttempt: (rec) => records.push(rec),
      },
      { lanes: 4, budgetMs: 2_000, maxClaims: 10 },
    );
    expect(r.ok).toBe(true);
    expect(records).toHaveLength(2);
    // الصفُّ الثاني على مسارِ الطلبِ نفسِه انتظرَ الأوّلَ (≈15ms).
    const b = records.find((x) => x.deliveryId === "b");
    expect(b?.laneWaitMs ?? 0).toBeGreaterThanOrEqual(10);
    expect(records.every((x) => x.laneWaitMs !== null)).toBe(true);
  });
});

// ——— عدّادُ المُرسِل ———

function stub(send: TelegramSender["sendMessage"]): TelegramSender {
  return { sendMessage: send, sendPhoto: async () => null, sendLocation: async () => "l" };
}

function sender(bucket: OutboundRateBucket, send: TelegramSender["sendMessage"]) {
  let mono = 0;
  const sleeps: number[] = [];
  const s = withOutboundResilience(stub(send), {
    bucket: {
      acquire: async (...a) => {
        mono += 2; // سؤالُ الدلوِ يكلّفُ 2ms
        return bucket.acquire(...a);
      },
    },
    deadLetter: createMemoryDeadLetterSink(),
    sleep: async (ms) => {
      sleeps.push(ms);
      mono += ms;
    },
    random: () => 0,
    monotonicMs: () => mono,
  });
  return { s, sleeps, advance: (ms: number) => (mono += ms) };
}

describe("LOAD-01: عدّادُ المحاولةِ في المُرسِلِ المرِن", () => {
  test("انتظارُ الدلوِ العالميِّ ونداءُ تيليجرامَ يُجمَعانِ في عدّادِ المحاولة", async () => {
    let n = 0;
    const bucket: OutboundRateBucket = {
      acquire: async (scope) =>
        scope === "global" && n++ < 2
          ? { granted: false, waitMs: 40 }
          : { granted: true, waitMs: 0 },
    };
    const h = sender(bucket, async () => {
      h.advance(25);
      return "m";
    });
    const meter = emptyDeliveryAttemptMeter();
    const id = await runWithDeliveryAttemptMeter(meter, () =>
      h.s.sendMessage("1", "x", undefined, { priority: "critical", congestion: "abort" }),
    );
    expect(id).toBe("m");
    expect(meter.globalWaits).toBe(2);
    expect(meter.globalWaitMs).toBe(80);
    expect(meter.chatWaits).toBe(0);
    expect(meter.acquireCalls).toBe(6); // (chat + global) × 3
    expect(meter.acquireMs).toBe(12);
    expect(meter.apiCalls).toBe(1);
    expect(meter.apiMs).toBe(25);
    expect(meter.congestionAborts).toBe(0);
  });

  test("رفضُ الانتظارِ (`abort`) يُسجَّلُ بنطاقِه ومهلتِه ولا نداءَ لتيليجرام", async () => {
    const bucket: OutboundRateBucket = {
      acquire: async (scope) =>
        scope === "chat" ? { granted: false, waitMs: 900 } : { granted: true, waitMs: 0 },
    };
    let sent = 0;
    const h = sender(bucket, async () => {
      sent += 1;
      return "m";
    });
    const meter = emptyDeliveryAttemptMeter();
    await expect(
      runWithDeliveryAttemptMeter(meter, () =>
        h.s.sendMessage("1", "x", undefined, { priority: "critical", congestion: "abort" }),
      ),
    ).rejects.toBeInstanceOf(OutboundCongestionError);
    expect(sent).toBe(0);
    expect(meter.congestionAborts).toBe(1);
    expect(meter.congestionScope).toBe("chat");
    expect(meter.congestionRetryAfterMs).toBe(900);
    expect(meter.apiCalls).toBe(0);
  });

  test("429 ثمّ نجاح: نومُ الاحترامِ خارجَ زمنِ النداء", async () => {
    let calls = 0;
    const open: OutboundRateBucket = { acquire: async () => ({ granted: true, waitMs: 0 }) };
    const h = sender(open, async () => {
      calls += 1;
      h.advance(10);
      if (calls === 1) throw { error_code: 429, parameters: { retry_after: 1 } };
      return "m";
    });
    const meter = emptyDeliveryAttemptMeter();
    await runWithDeliveryAttemptMeter(meter, () =>
      h.s.sendMessage("1", "x", undefined, { priority: "critical" }),
    );
    expect(meter.throttled).toBe(1);
    expect(meter.throttleWaitMs).toBe(1_000);
    expect(meter.apiCalls).toBe(2);
    expect(meter.apiMs).toBe(20);
  });

  test("خارجَ محاولةٍ مقيسةٍ لا عدّادَ ولا أثر", async () => {
    const open: OutboundRateBucket = { acquire: async () => ({ granted: true, waitMs: 0 }) };
    const h = sender(open, async () => "m");
    expect(currentAttemptMeter()).toBeUndefined();
    expect(await h.s.sendMessage("1", "x", undefined)).toBe("m");
    expect(currentAttemptMeter()).toBeUndefined();
  });
});

describe("LOAD-01: إعداداتُ الأثرِ وحقولُ السطر", () => {
  test("مُطفأٌ افتراضيًّا، ويُحصَرُ في الأنواعِ المسمّاة، والقيمُ الفاسدةُ تُعلَن", () => {
    expect(notificationAttemptTraceFromEnv({})).toEqual({
      enabled: false,
      kinds: null,
      invalid: [],
    });
    const on = notificationAttemptTraceFromEnv({
      NOTIFICATION_ATTEMPT_TRACE: "1",
      NOTIFICATION_ATTEMPT_TRACE_KINDS: "rider_trip_notice, offer",
    });
    expect(on.enabled).toBe(true);
    expect(traceCoversKind(on, "rider_trip_notice")).toBe(true);
    expect(traceCoversKind(on, "broadcast_recipient")).toBe(false);
    const bad = notificationAttemptTraceFromEnv({
      NOTIFICATION_ATTEMPT_TRACE: "yes",
      NOTIFICATION_ATTEMPT_TRACE_KINDS: "Bad Kind",
    });
    expect(bad.enabled).toBe(false);
    expect(bad.invalid.sort()).toEqual([
      "NOTIFICATION_ATTEMPT_TRACE",
      "NOTIFICATION_ATTEMPT_TRACE_KINDS",
    ]);
    expect(
      traceCoversKind(notificationAttemptTraceFromEnv({ NOTIFICATION_ATTEMPT_TRACE: "1" }), "x"),
    ).toBe(true);
  });

  test("حقولُ `notification.attempt` قائمةٌ مغلقة", () => {
    const record: NotificationAttemptRecord = {
      deliveryId: ID,
      kind: "rider_trip_notice",
      event: "MATCHED",
      attempt: 1,
      signalWaits: 0,
      startedAtMs: 1,
      durationMs: 2.4,
      laneWaitMs: 0.6,
      outcome: "telegram",
      retryAfterMs: null,
      failure: null,
    };
    const fields = notificationAttemptLogFields(record, {
      ...emptyDeliveryAttemptMeter(),
      apiMs: 3.7,
    });
    expect(Object.keys(fields).sort()).toEqual(
      [
        "acquire_calls",
        "acquire_ms",
        "api_calls",
        "api_ms",
        "attempt",
        "chat_wait_ms",
        "chat_waits",
        "congestion_aborts",
        "congestion_retry_after_ms",
        "congestion_scope",
        "delivery_id",
        "duration_ms",
        "failure",
        "global_wait_ms",
        "global_waits",
        "kind",
        "lane_wait_ms",
        "metered",
        "notice_event",
        "outcome",
        "retries",
        "retry_after_ms",
        "retry_wait_ms",
        "signal_waits",
        "started_at_ms",
        "throttle_wait_ms",
        "throttled",
      ].sort(),
    );
    expect(fields.api_ms).toBe(4);
    expect(fields.duration_ms).toBe(2);
    expect(fields.metered).toBe(1);
    expect(notificationAttemptLogFields(record, undefined).metered).toBe(0);
  });
});

describe("LOAD-01: التركيبُ كما في العامل (عدّادٌ حولَ المحاولةِ ومقروءٌ في `onAttempt`)", () => {
  test("ازدحامُ الدلوِ العالميِّ ⇒ مآلُ `congestion` ونطاقُ `global` في السطرِ نفسِه", async () => {
    const bucket: OutboundRateBucket = {
      acquire: async (scope) =>
        scope === "global" ? { granted: false, waitMs: 700 } : { granted: true, waitMs: 0 },
    };
    const h = sender(bucket, async () => "m");
    const lines: Record<string, string | number | null>[] = [];
    const { p, calls } = port(delivery());
    const r = await deliverNotification({
      outbox: p,
      handlers: {
        rider_trip_notice: async () => {
          try {
            const id = await h.s.sendMessage("1", "x", undefined, {
              priority: "critical",
              congestion: "abort",
            });
            return plain({ messageId: id });
          } catch (e) {
            return plain({ failure: e instanceof Error ? e.name : "unknown" });
          }
        },
      },
      withDeliveryCorrelation: (_d, run) =>
        runWithDeliveryAttemptMeter(emptyDeliveryAttemptMeter(), run),
      onAttempt: (rec) => lines.push(notificationAttemptLogFields(rec, currentAttemptMeter())),
    });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["requeue"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      outcome: "congestion",
      retry_after_ms: 1_000,
      metered: 1,
      congestion_aborts: 1,
      congestion_scope: "global",
      congestion_retry_after_ms: 700,
      api_calls: 0,
    });
  });
});
