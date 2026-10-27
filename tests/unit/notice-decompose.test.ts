/**
 * LOAD-01 — أداةُ تفكيكِ عمرِ الإشعاراتِ المعلّقة (`deploy/capacity-run/monitor/notice-decompose.ts`).
 * يثبّتُ: مجموعُ المقاطعِ = العمر، وتصنيفُ الطابور/المحدّد/المعالجة/الإقرار، واستبعادُ `sending`
 * من عدِّ المعلّق، وأسبابَ «فجوةِ القياس»، وأنّ القراءةَ لا تقبلُ إلّا معرّفاتٍ عشوائيّةً وأحداثًا مُعقَّمة.
 */
import { describe, expect, test } from "bun:test";
import {
  type Attempt,
  auditOf,
  decompose,
  groupsOf,
  parseLog,
  parseRows,
  type Row,
  SEGMENTS,
  timelineOf,
} from "../../deploy/capacity-run/monitor/notice-decompose";

const ID = "11111111-2222-4333-8444-555555555555";
const ID2 = "11111111-2222-4333-8444-666666666666";
const row = (createdMs = 0, id = ID): Row => ({
  id,
  kind: "rider_trip_notice",
  event: "MATCHED",
  createdMs,
});
const att = (p: Partial<Attempt> & { startedAtMs: number }): Attempt => ({
  deliveryId: ID,
  durationMs: 100,
  laneWaitMs: null,
  outcome: "telegram",
  retryAfterMs: null,
  metered: true,
  acquireMs: 0,
  chatWaitMs: 0,
  globalWaitMs: 0,
  congestionScope: null,
  apiMs: 0,
  throttleWaitMs: 0,
  retryWaitMs: 0,
  ...p,
});
const sum = (b: Record<string, number>) => SEGMENTS.reduce((n, s) => n + (b[s] ?? 0), 0);

describe("timelineOf", () => {
  test("صفٌّ لم يُلتقَطْ قطّ ⇒ كلُّ عمرِه انتظارُ طابور", () => {
    const t = timelineOf(row(0), [], 120_000);
    expect(t.pendingAtT).toBe(true);
    expect(t.ageMs).toBe(120_000);
    expect(t.breakdown.queue_unclaimed).toBe(120_000);
    expect(groupsOf(t.breakdown).queue_wait).toBe(120_000);
  });

  test("إشارةُ التطبيقِ ثمّ طابور ⇒ app_ack_wait بقدرِ المهلةِ والباقي طابور", () => {
    const t = timelineOf(
      row(0),
      [att({ startedAtMs: 1_000, durationMs: 50, outcome: "signal_wait", retryAfterMs: 3_000 })],
      10_000,
    );
    expect(t.breakdown.queue_unclaimed).toBe(1_000 + (10_000 - 4_050));
    expect(t.breakdown.app_ack_wait).toBe(3_000);
    expect(t.breakdown.processing).toBe(50);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });

  test("إعادةُ ازدحامٍ ⇒ limiter_requeue ثمّ نطاقُ الدلوِ محسوب", () => {
    const t = timelineOf(
      row(0),
      [
        att({
          startedAtMs: 0,
          durationMs: 10,
          outcome: "congestion",
          retryAfterMs: 1_000,
          congestionScope: "global",
          acquireMs: 4,
        }),
        att({ startedAtMs: 1_010, durationMs: 300, apiMs: 200, chatWaitMs: 50 }),
      ],
      5_000,
    );
    expect(t.pendingAtT).toBe(false);
    expect(t.terminalOutcome).toBe("telegram");
    expect(t.ageMs).toBe(1_310);
    expect(t.breakdown.limiter_requeue).toBe(1_000);
    expect(t.breakdown.limiter_inline).toBe(50);
    expect(t.breakdown.telegram_api).toBe(200);
    expect(t.breakdown.limiter_acquire).toBe(4);
    expect(t.breakdown.processing).toBe(6 + 50);
    expect(t.congestionScopes).toEqual({ chat: 0, global: 1 });
    expect(groupsOf(t.breakdown).telegram_limiter).toBe(1_050);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });

  test("انتظارُ المسارِ يُقتطعُ من انتظارِ الطابورِ السابقِ للبدء", () => {
    const t = timelineOf(row(0), [att({ startedAtMs: 5_000, laneWaitMs: 2_000 })], 9_000);
    expect(t.breakdown.lane_wait).toBe(2_000);
    expect(t.breakdown.queue_unclaimed).toBe(3_000);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });

  test("محاولةٌ جاريةٌ عندَ T ⇒ in_flight وsendingAtT", () => {
    const t = timelineOf(row(0), [att({ startedAtMs: 8_000, durationMs: 5_000 })], 10_000);
    expect(t.sendingAtT).toBe(true);
    expect(t.pendingAtT).toBe(true);
    expect(t.breakdown.in_flight).toBe(2_000);
    expect(sum(t.breakdown)).toBe(10_000);
  });

  test("فشلٌ عابرٌ ⇒ retry_gap غيرُ مُفكَّك؛ ومحاولةٌ بعدَ T لا تُحتسب", () => {
    const t = timelineOf(
      row(0),
      [att({ startedAtMs: 100, outcome: "retry" }), att({ startedAtMs: 20_000 })],
      10_000,
    );
    expect(t.attempts).toBe(1);
    expect(t.breakdown.retry_gap).toBe(10_000 - 200);
    expect(groupsOf(t.breakdown).unattributed).toBe(9_800);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });

  test("429 والإعاداتُ داخلَ المحاولة ⇒ telegram_backoff", () => {
    const t = timelineOf(
      row(0),
      [
        att({
          startedAtMs: 0,
          durationMs: 3_000,
          apiMs: 400,
          throttleWaitMs: 2_000,
          retryWaitMs: 500,
        }),
      ],
      9_000,
    );
    expect(t.breakdown.telegram_backoff).toBe(2_500);
    expect(t.breakdown.processing).toBe(100);
  });
});

describe("timelineOf: الطابورُ بعدَ إعادةِ المحدّد", () => {
  test("الالتقاطُ بعدَ الموعدِ بـ4ث ⇒ 1000 limiter_requeue و4000 queue_after_limiter لا queue_unclaimed", () => {
    const t = timelineOf(
      row(0),
      [
        att({
          startedAtMs: 2_000,
          durationMs: 10,
          outcome: "congestion",
          retryAfterMs: 1_000,
          congestionScope: "global",
        }),
        att({ startedAtMs: 7_010, durationMs: 90, apiMs: 80 }),
      ],
      60_000,
    );
    expect(t.breakdown.queue_unclaimed).toBe(2_000);
    expect(t.breakdown.limiter_requeue).toBe(1_000);
    expect(t.breakdown.queue_after_limiter).toBe(4_000);
    expect(groupsOf(t.breakdown).queue_wait).toBe(2_000);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });
});

describe("timelineOf: الحسمُ خارجَ العامل (miniapp_ack بـSQL مباشر)", () => {
  const settled = (settledMs: number): Row => ({ ...row(0), settledMs, settledVia: "miniapp_ack" });

  test("حُسِمَ قبلَ T بلا محاولةٍ نهائيّة ⇒ مُنتهٍ external يُقطعُ خطُّه عندَ الحسم", () => {
    const t = timelineOf(
      settled(2_500),
      [att({ startedAtMs: 1_000, durationMs: 50, outcome: "signal_wait", retryAfterMs: 3_000 })],
      120_000,
    );
    expect(t.pendingAtT).toBe(false);
    expect(t.terminalOutcome).toBe("external");
    expect(t.settledVia).toBe("miniapp_ack");
    expect(t.terminalAtMs).toBe(2_500);
    expect(t.ageMs).toBe(2_500);
    expect(t.breakdown.app_ack_wait).toBe(1_450);
    expect(sum(t.breakdown)).toBe(t.ageMs);
  });

  test("محاولةٌ نهائيّةٌ في الأثرِ تتقدّمُ على وقتِ القاعدة؛ والحسمُ بعدَ T لا يُحتسب", () => {
    const viaTrace = timelineOf(
      settled(5_000),
      [att({ startedAtMs: 1_000, durationMs: 100 })],
      120_000,
    );
    expect(viaTrace.terminalOutcome).toBe("telegram");
    expect(viaTrace.terminalAtMs).toBe(1_100);
    const later = timelineOf(settled(200_000), [], 120_000);
    expect(later.pendingAtT).toBe(true);
    expect(later.ageMs).toBe(120_000);
  });

  test("decompose: المحسومُ خارجيًّا خارجَ المعلّقِ ويُعدُّ external:<قناة>", () => {
    const { summary } = decompose({
      kind: "rider_trip_notice",
      auditAtMs: 130_000,
      passes: [],
      rows: [settled(4_000), row(10_000, ID2)],
      attempts: [
        att({ startedAtMs: 1_000, durationMs: 50, outcome: "signal_wait", retryAfterMs: 3_000 }),
      ],
      auditPending: 1,
      auditOldestPendingSec: 120,
    });
    expect(summary.pendingAtAudit).toBe(1);
    expect(summary.reconstructedOldestPendingSec).toBe(120);
    expect(summary.delivered.byOutcome).toEqual({ "external:miniapp_ack": 1 });
    expect(summary.validity.reasons).not.toContain("pending_count_mismatch");
  });
});

describe("decompose", () => {
  const base = {
    kind: "rider_trip_notice",
    auditAtMs: 130_000,
    passes: [],
  } as const;

  test("صالحٌ حينَ يطابقُ أقدمُ عمرٍ ومعدُّ المعلّقِ اللقطة؛ و`sending` خارجَ العدّ", () => {
    const rows = [row(0, ID), row(10_000, ID2)];
    const attempts = [
      att({
        deliveryId: ID,
        startedAtMs: 50_000,
        durationMs: 10,
        outcome: "congestion",
        retryAfterMs: 1_000,
        congestionScope: "chat",
      }),
      att({ deliveryId: ID2, startedAtMs: 129_000, durationMs: 5_000 }),
    ];
    const { summary } = decompose({
      ...base,
      rows,
      attempts,
      auditPending: 1,
      auditOldestPendingSec: 130,
    });
    expect(summary.pendingAtAudit).toBe(1);
    expect(summary.sendingAtAudit).toBe(1);
    expect(summary.reconstructedOldestPendingSec).toBe(130);
    expect(summary.validity).toEqual({ ok: true, reasons: [] });
    expect(summary.oldest?.groupsMs.telegram_limiter).toBe(1_000);
    expect(summary.oldest?.groupsMs.queue_wait).toBe(50_000);
    expect(summary.oldest?.groupsMs.queue_after_limiter).toBe(130_000 - 51_010);
    expect(summary.pendingAll.congestionScopes).toEqual({ chat: 1, global: 0 });
  });

  test("أسبابُ فجوةِ القياس: لا أثر، وعدمُ تطابقِ الأقدمِ والعدّ، ومحاولاتٌ بلا عدّاد", () => {
    const none = decompose({
      ...base,
      rows: [row(0)],
      attempts: [],
      auditPending: 50,
      auditOldestPendingSec: 100,
    }).summary;
    expect(none.validity.ok).toBe(false);
    expect(none.validity.reasons).toEqual([
      "no_attempt_trace",
      "oldest_mismatch",
      "pending_count_mismatch",
    ]);
    const unm = decompose({
      ...base,
      rows: [row(0)],
      attempts: [
        att({ startedAtMs: 0, outcome: "signal_wait", retryAfterMs: 3_000, metered: false }),
      ],
      auditPending: 1,
      auditOldestPendingSec: 130,
    }).summary;
    expect(unm.validity.reasons).toEqual(["unmetered_attempts"]);
    const miss = decompose({
      ...base,
      rows: [],
      attempts: [],
      auditPending: 0,
      auditOldestPendingSec: 12,
    }).summary;
    expect(miss.validity.reasons).toContain("oldest_missing");
  });

  test("المُسلَّمُ يُحسبُ زمنَ تسليمِه وبحسبِ مآله", () => {
    const { summary } = decompose({
      ...base,
      rows: [row(0)],
      attempts: [att({ startedAtMs: 2_000, durationMs: 500, outcome: "board" })],
      auditPending: 0,
      auditOldestPendingSec: null,
    });
    expect(summary.delivered.n).toBe(1);
    expect(summary.delivered.latencyMs.max).toBe(2_500);
    expect(summary.delivered.byOutcome).toEqual({ board: 1 });
    expect(summary.validity.ok).toBe(true);
  });
});

describe("القراءة", () => {
  test("parseLog: أسطرُ المحاولةِ والأشواطِ وأحداثُ الراكب؛ ويُهمَلُ معرّفٌ غيرُ عشوائيّ", () => {
    const log = [
      `gw | {"at":"2026-10-27T00:00:01.000Z","service":"gateway","event":"notification.attempt","delivery_id":"${ID}","kind":"rider_trip_notice","outcome":"congestion","started_at_ms":1000,"duration_ms":7,"lane_wait_ms":3,"retry_after_ms":1000,"metered":1,"congestion_scope":"global","acquire_ms":2}`,
      `{"event":"notification.attempt","delivery_id":"+966500000000","outcome":"telegram","started_at_ms":1}`,
      `{"at":"2026-10-27T00:00:10.000Z","event":"job.ran","job":"deliver-notifications","durationMs":8000,"detail":"stop=budget claimed=10"}`,
      `{"event":"rider_trip_notice.telegram_fallback","reason":"ack_timeout"}`,
      `{"event":"rider_trip_notice.telegram_fallback","reason":"Not Valid!"}`,
      "not json notification.attempt {",
    ].join("\n");
    const r = parseLog(log);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({
      deliveryId: ID,
      outcome: "congestion",
      laneWaitMs: 3,
      metered: true,
      congestionScope: "global",
      acquireMs: 2,
    });
    expect(r.passes).toEqual([
      {
        startMs: Date.parse("2026-10-27T00:00:02.000Z"),
        endMs: Date.parse("2026-10-27T00:00:10.000Z"),
        stop: "budget",
      },
    ]);
    expect(r.riderEvents).toEqual({
      "rider_trip_notice.telegram_fallback:ack_timeout": 1,
      "rider_trip_notice.telegram_fallback": 1,
    });
  });

  test("parseRows: يتطلّبُ الترويسة، ويُسقطُ غيرَ العشوائيِّ ويعقّمُ الحدث", () => {
    const rows = parseRows(
      `id,kind,event,created_ms\n${ID},rider_trip_notice,MATCHED,5\nbad,rider_trip_notice,MATCHED,6\n${ID2},rider_trip_notice,hello world,7\n`,
    );
    expect(rows).toEqual([
      {
        id: ID,
        kind: "rider_trip_notice",
        event: "MATCHED",
        createdMs: 5,
        settledMs: null,
        settledVia: null,
      },
      {
        id: ID2,
        kind: "rider_trip_notice",
        event: null,
        createdMs: 7,
        settledMs: null,
        settledVia: null,
      },
    ]);
    expect(() => parseRows("id,kind\n")).toThrow();
  });

  test("parseRows: settled_ms/settled_via اختياريّان ويُعقَّمُ الرمز", () => {
    const rows = parseRows(
      `id,kind,event,created_ms,settled_ms,settled_via\n${ID},rider_trip_notice,MATCHED,5,900,miniapp_ack\n${ID2},rider_trip_notice,MATCHED,7,,\n`,
    );
    expect(rows[0]?.settledMs).toBe(900);
    expect(rows[0]?.settledVia).toBe("miniapp_ack");
    expect(rows[1]?.settledMs).toBeNull();
    expect(rows[1]?.settledVia).toBeNull();
    const bad = parseRows(
      `id,kind,event,created_ms,settled_ms,settled_via\n${ID},k,E,5,9,Chat 123\n`,
    );
    expect(bad[0]?.settledVia).toBeNull();
  });

  test("auditOf: يفضّلُ pendingAgeByKind ويرجعُ إلى byKind", () => {
    const a = auditOf(
      JSON.stringify({
        snapshot: {
          at: "2026-10-27T00:00:00.000Z",
          outbox: {
            byKind: { rider_trip_notice: { pending: 9 } },
            pendingAgeByKind: { rider_trip_notice: { pending: 7, oldestPendingSec: 121 } },
          },
        },
      }),
      "rider_trip_notice",
    );
    expect(a).toEqual({
      atMs: Date.parse("2026-10-27T00:00:00.000Z"),
      pending: 7,
      oldestPendingSec: 121,
    });
    const b = auditOf(
      JSON.stringify({
        snapshot: { at: "2026-10-27T00:00:00.000Z", outbox: { byKind: { x: { pending: 3 } } } },
      }),
      "x",
    );
    expect(b.pending).toBe(3);
    expect(b.oldestPendingSec).toBeNull();
  });
});
