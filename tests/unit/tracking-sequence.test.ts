/**
 * الغرض: `BUG-009` — الوجهُ الوحدويُّ من إثباتِ `ADR 0053`.
 *
 *   وهو مقصورٌ على ما **يجوز** أن يُقاس بلا قاعدةٍ:
 *     (١) قرارُ النشرِ في التطبيقِ: لا `location_updated` عن إصلاحةٍ مرفوضةٍ.
 *     (٢) سلوكُ المستهلكِ: المكرَّرُ والمتراجعُ لا يُحرّكانِ العرضَ، والفجوةُ لا
 *         تُعالَج بإعادةِ بثٍّ.
 *     (٣) امتناعاتٌ بنيويّةٌ تُقاس بقراءةِ الشيفرةِ نفسِها: لا عدّادَ في الذاكرةِ
 *         في مسارِ الإنتاجِ، ولا عدّادَ عالميٌّ، ولا رقمٌ مشتقٌّ من طابعٍ زمنيٍّ.
 *
 *   **وما لا يجوز أن يُقاس هنا** — الذرّيّةُ والديمومةُ — مقيسٌ في
 *   `tests/integration/tracking-sequence.test.ts` على PostgreSQL حقيقيٍّ، كما
 *   شرطَ `ADR 0053` §٨ للحالتَينِ ١ و٧. ومزدوجُ الذاكرةِ هنا يُقلّد الحكمَ ولا
 *   يشهد عليه.
 *
 * الحالة: مُختبَر — يُشغَّل في كل CI بلا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على `live-tracking.ts` أو
 *   `customer-live-relay.ts` أو على أنواعِ `TrackingEvent`.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createCustomerLiveRelay } from "../../packages/application/tracking/customer-live-relay.ts";
import {
  createLiveTracking,
  type StoredFix,
} from "../../packages/application/tracking/live-tracking.ts";
import type { WatchedTripStatus } from "../../packages/domain/tracking/visibility.ts";
import {
  createMemoryTrackingSessionStore,
  type SessionAdvanceOutcome,
} from "../../packages/tracking/session-store.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const DRIVER = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION = "44444444-4444-4444-8444-444444444444";
const CITY = "55555555-5555-4555-8555-555555555555";

const fixAt = (recordedAtMs: number): StoredFix => ({
  driverId: DRIVER,
  cityId: CITY,
  latitude: 21.5471,
  longitude: 39.1751,
  recordedAtMs,
  accuracyMeters: 8,
  verdict: "ACCEPT",
  findings: [],
});

interface ChannelCall {
  readonly op: "start" | "update" | "stop";
  readonly lat: number | null;
}

function captureChannel() {
  const calls: ChannelCall[] = [];
  let next = 0;
  return {
    calls,
    channel: {
      start: async (_chatId: string, position: { lat: number; lng: number }) => {
        calls.push({ op: "start", lat: position.lat });
        next += 1;
        return `msg-${next}`;
      },
      update: async (
        _chatId: string,
        _messageId: string,
        position: { lat: number; lng: number },
      ) => {
        calls.push({ op: "update", lat: position.lat });
        return true;
      },
      stop: async () => {
        calls.push({ op: "stop", lat: null });
        return true;
      },
    },
  };
}

describe("قرارُ النشرِ يتبع حكمَ الكاتبِ — BUG-009 / ADR 0053 §٣-أ/٧", () => {
  /**
   * مستودعٌ يقبل ما شاءَ ويردّ ما شاءَ، ويُعلن ماذا نادى النادي. وهو أضيقُ من
   * مزدوجِ الذاكرةِ عن قصدٍ: المقاسُ هنا **تفريعُ التطبيقِ على الحكمِ** لا محاكاةُ
   * القاعدةِ.
   */
  const verdictStore = (verdicts: readonly SessionAdvanceOutcome["kind"][]) => {
    let index = 0;
    let issued = 1;
    /** لا جلسةَ قبلَ أوّلِ `open` — وإلّا لَما نُشِرَ `session_started` أبداً. */
    let opened = false;
    const advances: number[] = [];
    const record = () => ({
      sessionId: SESSION,
      sequence: issued,
      facts: {
        driverId: DRIVER,
        tripId: null,
        startedAtMs: 0,
        lastFixAtMs: null,
        endedAtMs: null,
        endReason: null,
      },
    });
    const store = {
      openSessionOf: async () => (opened ? record() : null),
      open: async () => {
        opened = true;
        return record();
      },
      attachTrip: async () => null,
      advance: async (_driverId: string, lastFixAtMs: number): Promise<SessionAdvanceOutcome> => {
        advances.push(lastFixAtMs);
        const verdict = verdicts[index] ?? "accepted";
        index += 1;
        const facts = {
          driverId: DRIVER,
          tripId: null,
          startedAtMs: 0,
          lastFixAtMs,
          endedAtMs: null,
          endReason: null,
        };
        if (verdict === "no_session") return { kind: "no_session" };
        if (verdict === "stale") {
          return { kind: "stale", record: { sessionId: SESSION, sequence: issued, facts } };
        }
        issued += 1;
        return { kind: "accepted", record: { sessionId: SESSION, sequence: issued, facts } };
      },
      close: async () => null,
      closeByTrip: async () => [],
    };
    return { store, advances, issuedNow: () => issued };
  };

  const buildLive = (verdicts: readonly SessionAdvanceOutcome["kind"][], nowMs: number) => {
    const events: TrackingEvent[] = [];
    const backing = verdictStore(verdicts);
    const live = createLiveTracking({
      sessions: backing.store,
      publisher: {
        publish: async (event) => {
          events.push(event);
        },
      },
      trips: { activeTripOf: async () => null },
      duty: { isOnDuty: async () => true },
      clock: { now: () => new Date(nowMs) },
    });
    return { live, events, ...backing };
  };

  it("إصلاحةٌ رُدَّت لا يُنشَر عنها location_updated ألبتّة", async () => {
    /**
     * §٨/٣ — وهذا هو جوهرُ العيبِ الذي أُغلِق: كان النشرُ يقع لأنَّ الكتابةَ
     * «لم ترمِ»، لا لأنَّها **قبِلت**. فصار الشرطُ حكماً معلَناً من الكاتبِ.
     */
    const { live, events } = buildLive(["stale"], 10_000_000);

    /**
     * والطابعُ هنا **ليس** أقدمَ من بدءِ الجلسةِ عن قصدٍ: القِدَمُ عن البدءِ يردُّه
     * المجالُ قبلَ أن يبلغَ الكاتبَ، فيقيس الاختبارُ حاجزاً آخرَ. فالمقاسُ أنَّ
     * **حكمَ الكاتبِ وحدَه** كافٍ لمنعِ النشرِ حتّى إذا أجازَ المجالُ الإصلاحةَ.
     */
    await live.onFix(fixAt(10_000_000));

    expect(events.map((event) => event.type)).toEqual(["session_started"]);
  });

  it("لا جلسةَ ⇒ لا حدثَ موقعٍ، ولا رقمَ يُخترَع", async () => {
    const { live, events } = buildLive(["no_session"], 10_000_000);
    await live.onFix(fixAt(10_000_000));
    expect(events.some((event) => event.type === "location_updated")).toBe(false);
  });

  it("الرَّدُّ لا يستهلك رقماً: الإصلاحةُ التاليةُ تأخذ ما كان للمردودِ", async () => {
    /** §٨/٩ — رقمٌ يُستهلَك على مردودٍ فجوةٌ مصطنعةٌ تُرسل المستهلكَ إلى لقطةٍ عبثاً. */
    const { live, events } = buildLive(["accepted", "stale", "accepted"], 10_000_000);

    await live.onFix(fixAt(10_000_000));
    await live.onFix(fixAt(9_000_000));
    await live.onFix(fixAt(10_001_000));

    const positions = events.filter((event) => event.type === "location_updated");
    expect(positions.length).toBe(2);
    expect(positions.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("كلُّ حدثٍ يحمل sessionId ورقمَه — لا حدثَ بلا قناةٍ", async () => {
    /** §٣-أ/٦ — والعقدُ يُلزِم ذلك بالأنواعِ، وهذا يقيس أنَّ القيمَ من الكاتبِ. */
    const sessions = createMemoryTrackingSessionStore();
    const events: TrackingEvent[] = [];
    const live = createLiveTracking({
      sessions,
      publisher: {
        publish: async (event) => {
          events.push(event);
        },
      },
      trips: { activeTripOf: async () => null },
      duty: { isOnDuty: async () => true },
      clock: { now: () => new Date(10_000_000) },
    });

    await live.onFix(fixAt(10_000_000));
    await live.onDutyEnded(DRIVER);

    expect(events.length).toBeGreaterThanOrEqual(3);
    const channels = new Set(events.map((event) => event.sessionId));
    expect(channels.size).toBe(1);
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    // ولا رقمَ يساوي طابعاً زمنيًّا: الأرقامُ رتبيّةٌ من الواحدِ (§٣-أ/٣).
    expect(Math.max(...sequences)).toBeLessThan(10);
  });
});

describe("المستهلكُ يكتفي بـlastAppliedSeq — BUG-009 / ADR 0053 §٣-ب", () => {
  const target = {
    tripId: TRIP,
    riderId: "66666666-6666-4666-8666-666666666666",
    riderTelegramId: "555",
    driverId: DRIVER,
    riderLanguage: "ar",
    status: "matched" as WatchedTripStatus,
    liveMessageId: null as string | null,
  };

  const buildRelay = (nowMsRef: { value: number }) => {
    const captured = captureChannel();
    const relay = createCustomerLiveRelay({
      channel: captured.channel,
      customers: {
        resolve: async () => target,
        claimLiveMessageId: async () => true,
        clearLiveMessageId: async () => undefined,
      },
      clock: { now: () => new Date(nowMsRef.value) },
      livePeriodSeconds: 3600,
    });
    return { relay, calls: captured.calls };
  };

  const position = (sequence: number, lat: number, sessionId = SESSION): TrackingEvent => ({
    type: "location_updated",
    driverId: DRIVER,
    cityId: CITY,
    tripId: TRIP,
    sessionId,
    sequence,
    position: { lat, lng: 39.1751 },
    timestamp: new Date(0),
  });

  it("المكرَّرُ — نفسُ (sessionId, sequence) — غيرُ ضارٍّ ولا يُحرّك الدبّوسَ", async () => {
    /** §٨/٤ — والمكرَّرُ يقع فعلاً: إعادةُ تسليمِ ويبهوكٍ من تلغرام واقعةٌ لا فرضٌ. */
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);

    await relay.handle(position(2, 21.5471));
    expect(calls.map((call) => call.op)).toEqual(["start"]);

    now.value += 60_000;
    await relay.handle(position(2, 21.5471));

    expect(calls.map((call) => call.op)).toEqual(["start"]);
  });

  it("رقمٌ أقدمُ لا يُرجع الموضعَ المعروضَ إلى الوراءِ", async () => {
    /** §٨/٢ — وهذا ما يراه الراكبُ: دبّوسٌ يقفز إلى الخلفِ ثمَّ يعود. */
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);

    await relay.handle(position(2, 21.5471));
    now.value += 60_000;
    await relay.handle(position(3, 21.56));
    now.value += 60_000;
    await relay.handle(position(2, 21.4));

    expect(calls.map((call) => call.op)).toEqual(["start", "update"]);
    expect(calls.at(-1)?.lat).toBe(21.56);
  });

  it("فجوةٌ في الأرقامِ تُطبَّق ولا تُعالَج بإعادةِ بثٍّ", async () => {
    /**
     * §٨/٨ و§٣-ب. وهذا المستهلكُ عرضُه **أحدثُ قيمةٍ** لا حالةٌ مُراكَمةٌ، والحدثُ
     * يحمل الإحداثيّةَ كاملةً — فالفجوةُ لا تُفقده شيئاً يحتاج إلى تعويضٍ. ولا
     * يوجد في النظامِ ما يُعيد بثَّ ماضٍ: لا مخزنَ أحداثٍ ولا تابعَ إعادةٍ.
     * والمحاذاةُ الموثوقةُ لمن يحتاجها من لقطةِ HTTP لا من المُرحِّلِ.
     */
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);

    await relay.handle(position(2, 21.5471));
    now.value += 60_000;
    await relay.handle(position(9, 21.56));

    expect(calls.map((call) => call.op)).toEqual(["start", "update"]);
    expect("replay" in relay).toBe(false);
  });

  it("رقمٌ من جلسةٍ أخرى لا يُقارَن بعدّادِ هذه الجلسةِ", async () => {
    /**
     * §٣-أ/٢ — الأرقامُ لكلِّ جلسةٍ وحدَها. وسائقٌ أعادَ الدخولَ يبدأ جلسةً جديدةً
     * أرقامُها صغيرةٌ، فمقارنتُها بعدّادِ جلسةٍ ماضيةٍ تُسقط كلَّ نبضاتِه.
     */
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);

    await relay.handle(position(7, 21.5471));
    now.value += 60_000;
    await relay.handle(position(2, 21.56, OTHER_SESSION));

    expect(calls.map((call) => call.op)).toEqual(["start", "update"]);
    expect(calls.at(-1)?.lat).toBe(21.56);
  });
});

describe("امتناعاتٌ بنيويّةٌ — BUG-009 / ADR 0053 §٣-أ/٣ و٤", () => {
  /**
   * هذه الثلاثةُ لا تُقاس بسلوكٍ: شيفرةٌ تُضيف عدّاداً في الذاكرةِ **تنجح** في كلِّ
   * اختبارِ سلوكٍ داخلَ عمليةٍ واحدةٍ، ولا تُخفق إلَّا في الإنتاجِ عندَ ثانيةِ
   * نسخةٍ أو إعادةِ تشغيلٍ. فالمقاسُ نصُّ المصدرِ — وهو أسلوبٌ قائمٌ في المستودعِ
   * (`scripts/check-*.ts`) لا بدعةٌ هنا.
   */
  const read = (path: string) => readFileSync(path, "utf8");

  const APPLICATION = "packages/application/tracking/live-tracking.ts";
  const REPOSITORY = "packages/infrastructure/tracking/session-repository.ts";
  const MIGRATION = "supabase/migrations/20260902000000_tracking_session_sequence.sql";

  it("لا عدّادَ في ذاكرةِ العمليةِ في مسارِ الإنتاجِ", async () => {
    const source = read(APPLICATION);
    // لا متغيّرَ يُصعَّد في التطبيقِ، ولا حسابَ رقمٍ منه.
    expect(/\bsequence\s*(\+=|\+\+|=\s*sequence\s*\+)/.test(source)).toBe(false);
    expect(/\blet\s+\w*[Ss]equence/.test(source)).toBe(false);
    // والرقمُ لا يُقرأ إلَّا من سجلٍّ أعادَه الكاتبُ.
    expect(source.includes("record.sequence") || source.includes(".sequence")).toBe(true);
  });

  it("الرقمُ لا يُشتقُّ من طابعٍ زمنيٍّ ولا من ساعةٍ", async () => {
    /** §٣-أ/٣ — و`recordedAtMs` يبقى وصفاً زمنيًّا لا رتبةً. */
    for (const path of [APPLICATION, REPOSITORY]) {
      const source = read(path);
      expect(/sequence[^\n]*recordedAtMs/.test(source)).toBe(false);
      expect(/sequence[^\n]*Date\.now\(\)/.test(source)).toBe(false);
      expect(/sequence[^\n]*message\.date/.test(source)).toBe(false);
    }
  });

  it("العدّادُ في الصفِّ لا في تسلسلٍ عالميٍّ، والزيادةُ في جملةِ التقدُّمِ نفسِها", async () => {
    /** §٣-أ/١ و٨ — ولا `create sequence` في الهجرةِ، فالعمودُ في صفِّ الجلسةِ. */
    const migration = read(MIGRATION);
    expect(/create\s+sequence/i.test(migration)).toBe(false);
    expect(migration.includes("last_sequence")).toBe(true);

    const repository = read(REPOSITORY);
    // الزيادةُ داخلَ `update` لا في JS، والقبولُ يُعاد من نفسِ الجملةِ.
    expect(/last_sequence\s*=\s*[\w.]*last_sequence\s*\+\s*1/.test(repository)).toBe(true);
    expect(repository.includes("returning")).toBe(true);
    expect(/Math\.max/.test(repository)).toBe(false);
  });
});
