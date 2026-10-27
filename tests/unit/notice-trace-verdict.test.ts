/** LOAD01-NOTICE-TRACE — قواعدُ الحكمِ المسجَّلةُ مسبقًا (§5) كما تُطبَّقُ حرفيًّا. */
import { describe, expect, test } from "bun:test";
import {
  claimSplitClassOf,
  classOf,
  drainClassOf,
  sharesOf,
  verdictOf,
  type WaveIn,
} from "../../deploy/capacity-run/monitor/notice-trace-verdict";

const dec = (pct: Record<string, number>, ok = true) => ({
  validity: { ok, reasons: ok ? [] : ["oldest_mismatch"] },
  attemptsSeen: 100,
  oldest20: { n: 20, groupsPct: pct },
});
const w = (p: Partial<WaveIn> & Pick<WaveIn, "slot" | "arm">): WaveIn => ({
  valid: true,
  g1Pct: 54,
  riderOldestSec: 125,
  riderPending: 4_000,
  failedGates: ["G4", "P7"],
  decomposition: null,
  ...p,
});
const LIM = {
  telegram_limiter: 30,
  queue_after_limiter: 30,
  queue_wait: 30,
  outbox_processing: 5,
  telegram_api: 5,
  app_ack_wait: 0,
  unattributed: 0,
};
const QUE = {
  telegram_limiter: 5,
  queue_after_limiter: 5,
  queue_wait: 80,
  outbox_processing: 5,
  telegram_api: 5,
  app_ack_wait: 0,
  unattributed: 0,
};

describe("classOf/sharesOf", () => {
  test("المحدّدُ = مباشرٌ + طابورٌ مستحَثّ", () => {
    expect(sharesOf(LIM).limiter).toBe(60);
    expect(classOf(sharesOf(LIM))).toBe("LIMITER");
    expect(classOf(sharesOf(QUE))).toBe("QUEUE");
  });
  test("غيرُ المنسوبِ > 10% ⇒ GAP؛ و25/25 ⇒ BOTH", () => {
    expect(classOf({ limiter: 40, queue: 40, processing: 0, appAck: 0, unattributed: 11 })).toBe(
      "GAP",
    );
    expect(classOf({ limiter: 40, queue: 40, processing: 10, appAck: 10, unattributed: 0 })).toBe(
      "BOTH_LIMITER_QUEUE",
    );
    expect(classOf({ limiter: 20, queue: 40, processing: 20, appAck: 20, unattributed: 0 })).toBe(
      "MIXED",
    );
  });
});

describe("verdictOf", () => {
  test("أغلبيّةٌ ≥2 من الصالحة ⇒ قرار؛ والكلفةُ ضمنَ الحدّين ⇒ OVERHEAD_OK", () => {
    const v = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: dec(LIM), riderOldestSec: 128 }),
      w({ slot: "OFF1", arm: "OFF", riderOldestSec: 122 }),
      w({ slot: "OFF2", arm: "OFF", riderOldestSec: 124, g1Pct: 55 }),
      w({ slot: "ON2", arm: "ON", decomposition: dec(LIM), riderOldestSec: 126 }),
      w({ slot: "ON3", arm: "ON", decomposition: dec(QUE), riderOldestSec: 127 }),
      w({ slot: "OFF3", arm: "OFF", riderOldestSec: 121 }),
    ]);
    expect(v.attribution.decision).toBe("LIMITER");
    expect(v.overhead.decision).toBe("OVERHEAD_OK");
    expect(v.repro.reproduced).toBe(true);
    expect(v.attribution.perturbed).toBe(false);
  });
  test("أثرٌ غيرُ صالحٍ في موجتين ⇒ MEASUREMENT_GAP؛ وفرقُ P7 > 10ث ⇒ OVERHEAD_HIGH", () => {
    const v = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: dec(LIM, false), riderOldestSec: 140 }),
      w({ slot: "ON2", arm: "ON", decomposition: null, riderOldestSec: 140 }),
      w({ slot: "ON3", arm: "ON", decomposition: dec(LIM), riderOldestSec: 140 }),
      w({ slot: "OFF1", arm: "OFF", riderOldestSec: 120 }),
      w({ slot: "OFF2", arm: "OFF", riderOldestSec: 120 }),
    ]);
    expect(v.attribution.decision).toBe("MEASUREMENT_GAP");
    expect(v.overhead.decision).toBe("OVERHEAD_HIGH");
    expect(v.trace[1]?.reasons).toEqual(["notice_decompose_missing"]);
  });
  test("تعادلٌ بلا أغلبيّة ⇒ INCONCLUSIVE؛ وغيرُ الصالحِ لا يُعدّ", () => {
    const v = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: dec(LIM) }),
      w({ slot: "ON2", arm: "ON", decomposition: dec(QUE) }),
      w({ slot: "ON3", arm: "ON", decomposition: dec(QUE), valid: false }),
      w({ slot: "OFF1", arm: "OFF" }),
    ]);
    expect(v.validOn).toBe(2);
    expect(v.attribution.decision).toBe("INCONCLUSIVE");
    expect(v.overhead.decision).toBe("INSUFFICIENT");
  });
});

describe("§5.5 DRAIN_RULE (ملحق ب)", () => {
  const pass = (claim: number | null, sat = 0, lane = 0) => ({
    ...dec({ queue_wait: 90, telegram_limiter: 10 }),
    drainPasses: {
      n: 20,
      idleShareBeforeAudit: 0.22,
      stopReasons: { budget: 19, empty: 1 },
      pass: {
        passesWithClaimMs: claim === null ? 0 : 20,
        pctOfPassElapsed: {
          claim,
          saturated_wait: sat,
          lane_full_wait: lane,
          congestion_sleep: 0,
        },
        claimMeanMs: claim === null ? null : 4,
      },
    },
  });
  test("الصنفُ بعتبةِ 50 على حصّةِ زمنِ الشوط", () => {
    expect(drainClassOf({ claim: 62, saturated_wait: 10, lane_full_wait: 5 })).toBe("CLAIM_SERIAL");
    expect(drainClassOf({ claim: 20, saturated_wait: 55, lane_full_wait: 5 })).toBe("CITY_CAP");
    expect(drainClassOf({ claim: 20, saturated_wait: 5, lane_full_wait: 60 })).toBe("LANES");
    expect(drainClassOf({ claim: 30, saturated_wait: 30, lane_full_wait: 30 })).toBe("MIXED_DRAIN");
    expect(drainClassOf({ claim: null })).toBe("GAP");
    expect(drainClassOf(undefined)).toBe("GAP");
  });
  test("القرار: أغلبيّةٌ ≥2 وأكثرُ من النصف عبرَ ON وOFF؛ وبلا حقولٍ ⇒ MEASUREMENT_GAP", () => {
    const v = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: pass(60) }),
      w({ slot: "OFF1", arm: "OFF", decomposition: pass(70) }),
      w({ slot: "ON2", arm: "ON", decomposition: pass(20, 60) }),
    ]);
    expect(v.drain.decision).toBe("CLAIM_SERIAL");
    expect(v.drain.classCounts).toEqual({ CLAIM_SERIAL: 2, CITY_CAP: 1 });
    const gap = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: pass(null) }),
      w({ slot: "OFF1", arm: "OFF", decomposition: null }),
    ]);
    expect(gap.drain.decision).toBe("MEASUREMENT_GAP");
  });
});

describe("§5.6 CLAIM_SPLIT_RULE (ملحق ج)", () => {
  type Pct = { pre: number; server: number; post: number };
  const split = (
    pct: Pct,
    o: { coverage?: number; skewed?: number; postMs?: number; loopUs?: number | null } = {},
  ) => ({
    passesWithClaimMs: 20,
    pctOfPassElapsed: { claim: 80 },
    claimMeanMs: 10,
    claimSplit: {
      timed: 1000,
      coveragePct: o.coverage ?? 100,
      queries: 1900,
      skewed: o.skewed ?? 0,
      pctOfClaim: { ...pct, adapter_other: 100 - pct.pre - pct.server - pct.post },
      perQueryMs: { pre: 1, server: 1, post: o.postMs ?? 4 },
    },
    loop:
      o.loopUs === null
        ? null
        : {
            passes: 20,
            delayMeanUs: o.loopUs ?? 3000,
            delayP99Us: 9000,
            delayMaxUs: 20000,
            eluPct: 90,
          },
  });
  test("الأصناف: العتبةُ 50 من زمنِ الالتقاط، وpost يُنسَبُ للحلقةِ بشرطِ تأخّرِها", () => {
    expect(claimSplitClassOf(split({ pre: 60, server: 20, post: 15 }))).toBe("POOL_PIPELINE");
    expect(claimSplitClassOf(split({ pre: 20, server: 55, post: 20 }))).toBe("SERVER");
    expect(claimSplitClassOf(split({ pre: 10, server: 20, post: 65 }))).toBe("EVENT_LOOP");
    expect(claimSplitClassOf(split({ pre: 10, server: 20, post: 65 }, { loopUs: 1000 }))).toBe(
      "POST_OTHER",
    );
    expect(claimSplitClassOf(split({ pre: 10, server: 20, post: 65 }, { loopUs: null }))).toBe(
      "POST_OTHER",
    );
    expect(claimSplitClassOf(split({ pre: 35, server: 30, post: 30 }))).toBe("MIXED_CLAIM");
    expect(claimSplitClassOf(split({ pre: 60, server: 20, post: 15 }, { coverage: 80 }))).toBe(
      "GAP",
    );
    expect(claimSplitClassOf(split({ pre: 60, server: 20, post: 15 }, { skewed: 40 }))).toBe("GAP");
    expect(claimSplitClassOf(undefined)).toBe("GAP");
  });
  test("القرار: أغلبيّةٌ ≥2 وأكثرُ من النصف؛ وأقلُّ من موجتينِ صالحتين ⇒ MEASUREMENT_GAP", () => {
    const d = (p: ReturnType<typeof split>) => ({
      ...dec({ queue_wait: 90, telegram_limiter: 10 }),
      drainPasses: { n: 20, idleShareBeforeAudit: 0.3, stopReasons: {}, pass: p },
    });
    const v = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: d(split({ pre: 60, server: 20, post: 15 })) }),
      w({ slot: "ON2", arm: "ON", decomposition: d(split({ pre: 70, server: 10, post: 15 })) }),
      w({ slot: "ON3", arm: "ON", decomposition: d(split({ pre: 20, server: 60, post: 15 })) }),
      w({ slot: "OFF1", arm: "OFF", decomposition: dec({ queue_wait: 90 }) }),
    ]);
    expect(v.claimSplit.decision).toBe("POOL_PIPELINE");
    expect(v.claimSplit.classCounts).toEqual({ POOL_PIPELINE: 2, SERVER: 1 });
    expect(v.claimSplit.waves.map((x) => x.slot)).toEqual(["ON1", "ON2", "ON3"]);
    const tie = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: d(split({ pre: 60, server: 20, post: 15 })) }),
      w({ slot: "ON2", arm: "ON", decomposition: d(split({ pre: 20, server: 60, post: 15 })) }),
    ]);
    expect(tie.claimSplit.decision).toBe("INCONCLUSIVE");
    const gap = verdictOf([
      w({ slot: "ON1", arm: "ON", decomposition: d(split({ pre: 60, server: 20, post: 15 })) }),
    ]);
    expect(gap.claimSplit.decision).toBe("MEASUREMENT_GAP");
  });
});
