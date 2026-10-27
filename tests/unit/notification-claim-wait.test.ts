/**
 * الغرض: `LOAD-01` (CLAIM-WAIT، الملحق د): مراحلُ ما قبلَ التنفيذِ وما بعدَه لكلِّ استعلامٍ من استعلامَي الالتقاط،
 *   وعدُّ ما في الطيرانِ على تجمّعِ workerJobs، وتجميعُها في السطرِ والمحلِّل، وقاعدةُ §5.7.
 *   رصدٌ فقط: لا يغيّرُ الاستعلامَ ولا التوجيه، والاستعلامُ غيرُ المرصودِ يُعَدُّ ولا يُخمَّن.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { notificationClaimWaitLogFields } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  claimWaitOf,
  parseLog,
  passTotalsOf,
  WAIT_FIELDS,
} from "../../deploy/capacity-run/monitor/notice-decompose";
import {
  type ClaimWaitIn,
  type CorroborationIn,
  claimWaitValidityOf,
  preClassOf,
  q2RemovablePctOf,
  verdictOf,
  type WaveIn,
} from "../../deploy/capacity-run/monitor/notice-trace-verdict";
import {
  addClaimQueryDetail,
  type ClaimQueryDetail,
  emptyClaimInflightAggregate,
  emptyClaimQueryAggregate,
} from "../../packages/application/notification/deliver-notification.ts";
import {
  instrumentPoolSql,
  observeQuery,
} from "../../packages/infrastructure/notification/claim-split-probe.ts";

describe("observeQuery — مراحلُ postgres.js", () => {
  test("الخلوّ: state ثمّ active في الدورةِ نفسِها ⇒ غيرُ مُؤنبَب، ويُختَمُ resolve", () => {
    let t = 100;
    const q = { state: null as unknown, active: false as unknown, resolve: (x: unknown) => x };
    const o = observeQuery(q, () => t);
    t = 101;
    q.state = { pid: 1 };
    t = 101.5;
    q.active = true;
    t = 104;
    expect(q.resolve("r")).toBe("r");
    expect(o).toEqual({ tWrite: 101, tActive: 101.5, pipelined: false, tResolved: 104 });
    // القيمُ تمرُّ كما هي إلى الكائن.
    expect(q.state).toEqual({ pid: 1 });
    expect(q.active).toBe(true);
  });

  test("الأنبوب: active في دورةٍ لاحقة ⇒ مُؤنبَب، والختمُ الأوّلُ وحدَه يُحفظ", async () => {
    let t = 0;
    const q = { state: null as unknown, active: false as unknown, resolve: (x: unknown) => x };
    const o = observeQuery(q, () => t);
    t = 5;
    q.state = { pid: 1 };
    await Promise.resolve();
    await Promise.resolve();
    t = 9;
    q.active = true;
    t = 12;
    q.active = false;
    q.active = true;
    q.resolve(1);
    q.resolve(2);
    expect(o.tWrite).toBe(5);
    expect(o.tActive).toBe(9);
    expect(o.pipelined).toBe(true);
    expect(o.tResolved).toBe(12);
  });

  test("كائنٌ لا يمرُّ بالمراحل ⇒ كلُّها null (غيرُ مرصود)", () => {
    const o = observeQuery({}, () => 1);
    expect(o).toEqual({ tWrite: null, tActive: null, pipelined: null, tResolved: null });
  });
});

/** Query مزيّف: وعدٌ فيه executed وhandle، كما في postgres.js. */
function fakeQuery() {
  let settle: (ok: boolean) => void = () => {};
  const p = new Promise<number>((res, rej) => {
    settle = (ok) => (ok ? res(1) : rej(new Error("x")));
  }) as Promise<number> & { executed: boolean; handle: () => void };
  p.executed = false;
  p.handle = () => {};
  p.catch(() => undefined);
  return { q: p, settle };
}

describe("instrumentPoolSql — عدُّ ما في الطيران", () => {
  test("يُعَدُّ عندَ executed لا عندَ البناء، ويُنقَصُ بالنجاحِ والفشل، والمعاملةُ تُعَدُّ وحدَها", async () => {
    const made: ReturnType<typeof fakeQuery>[] = [];
    let endTx: () => void = () => {};
    const sql = Object.assign(
      () => {
        const f = fakeQuery();
        made.push(f);
        return f.q;
      },
      {
        unsafe: () => {
          const f = fakeQuery();
          made.push(f);
          return f.q;
        },
        begin: () =>
          new Promise<void>((r) => {
            endTx = r;
          }),
        other: 7,
      },
    );
    const { sql: px, counter } = instrumentPoolSql(sql);
    const a = px() as unknown as { executed: boolean };
    const b = px.unsafe() as unknown as { executed: boolean };
    expect(counter.read()).toEqual({ queries: 0, transactions: 0 });
    a.executed = true;
    a.executed = true;
    b.executed = true;
    expect(counter.read()).toEqual({ queries: 2, transactions: 0 });
    const tx = px.begin();
    expect(counter.read()).toEqual({ queries: 2, transactions: 1 });
    made[0]?.settle(true);
    made[1]?.settle(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(counter.read()).toEqual({ queries: 0, transactions: 1 });
    endTx();
    await tx;
    await Promise.resolve();
    expect(counter.read()).toEqual({ queries: 0, transactions: 0 });
    expect(px.other).toBe(7);
  });

  test("ما ليس Query (مقطعٌ أو قيمة) يمرُّ بلا لفّ", () => {
    const frag = { text: "x" };
    const { sql: px, counter } = instrumentPoolSql(() => frag);
    expect(px()).toBe(frag);
    expect(Object.getOwnPropertyDescriptor(frag, "executed")).toBeUndefined();
    expect(counter.read()).toEqual({ queries: 0, transactions: 0 });
  });
});

const detail = (over: Partial<ClaimQueryDetail>): ClaimQueryDetail => ({
  index: 1,
  preMs: 2,
  poolMs: 0.5,
  pipeMs: 1,
  serverMs: 1,
  postMs: 1.5,
  postWireMs: 1,
  contMs: 0.5,
  stamped: true,
  pipelined: true,
  skewed: false,
  inflight: { queries: 3, transactions: 2 },
  busyAtIssue: true,
  ...over,
});

describe("addClaimQueryDetail وحقولُ السطر", () => {
  test("المرصودُ وحدَه يدخلُ أجزاءَ pre/post، والكلُّ يدخلُ pre/server/post", () => {
    const agg = {
      q1: emptyClaimQueryAggregate(),
      q2: emptyClaimQueryAggregate(),
      inflight: emptyClaimInflightAggregate(),
    };
    addClaimQueryDetail(agg, detail({}));
    addClaimQueryDetail(
      agg,
      detail({ stamped: false, pipelined: false, preMs: 4, inflight: null, busyAtIssue: null }),
    );
    addClaimQueryDetail(
      agg,
      detail({
        index: 2,
        pipelined: false,
        skewed: true,
        inflight: { queries: 1, transactions: 0 },
        busyAtIssue: false,
      }),
    );
    expect(agg.q1).toEqual({
      n: 2,
      stamped: 1,
      pipelined: 1,
      skewed: 0,
      preMs: 6,
      stampedPreMs: 2,
      poolMs: 0.5,
      pipeMs: 1,
      serverMs: 2,
      postMs: 3,
      postWireMs: 1,
      contMs: 0.5,
    });
    expect(agg.q2.n).toBe(1);
    expect(agg.q2.skewed).toBe(1);
    expect(agg.q2.pipelined).toBe(0);
    expect(agg.inflight).toEqual({
      n: 2,
      queriesSum: 4,
      transactionsSum: 2,
      max: 5,
      busyAtIssue: 1,
    });
  });

  test("حقولُ السطرِ قائمةٌ مغلقةٌ بأعدادٍ صحيحة (µs)، وكلُّها يقرؤها المحلِّل", () => {
    const q = { ...emptyClaimQueryAggregate(), n: 2, stamped: 2, preMs: 1.2344, poolMs: 0.0004 };
    const f = notificationClaimWaitLogFields(
      {
        q1: q,
        q2: emptyClaimQueryAggregate(),
        inflight: { n: 2, queriesSum: 3, transactionsSum: 1, max: 4, busyAtIssue: 0 },
      },
      12.6,
    );
    expect(f.slice(0, 12)).toEqual([
      "claim_q1_n=2",
      "claim_q1_stamped=2",
      "claim_q1_piped=0",
      "claim_q1_skewed=0",
      "claim_q1_pre_us=1234",
      "claim_q1_spre_us=0",
      "claim_q1_pool_us=0",
      "claim_q1_pipe_us=0",
      "claim_q1_server_us=0",
      "claim_q1_post_us=0",
      "claim_q1_wire_us=0",
      "claim_q1_cont_us=0",
    ]);
    expect(f.slice(-6)).toEqual([
      "claim_infl_n=2",
      "claim_infl_q_sum=3",
      "claim_infl_tx_sum=1",
      "claim_infl_max=4",
      "claim_infl_busy=0",
      "claim_cal_drift_us=13",
    ]);
    expect(f.length).toBe(30);
    for (const x of f) expect(x).toMatch(/^[a-z0-9_]+=-?\d+$/);
    const names = f.map((x) => x.split("=")[0]);
    const known = new Set<string>([...WAIT_FIELDS, "claim_infl_max", "claim_cal_drift_us"]);
    for (const n of names) expect(known.has(n ?? "")).toBe(true);
  });
});

/** سطرُ `job.ran` كما يكتبه العامل. */
const passLine = (at: string, elapsed: number, detail: string) =>
  `x ${JSON.stringify({ event: "job.ran", job: "deliver-notifications", at, durationMs: elapsed, detail: `stop=budget elapsed_ms=${elapsed} ${detail}` })}`;

describe("المحلِّل: claimWait من حقولِ الشوط", () => {
  const q = (k: string, v: Record<string, number>) =>
    Object.entries(v)
      .map(([a, b]) => `claim_${k}_${a}=${b}`)
      .join(" ");
  const base = (drift: number, max: number) =>
    `claim_calls=100 claim_ms=1000 ${q("q1", { n: 100, stamped: 100, piped: 50, skewed: 0, pre_us: 300000, spre_us: 300000, pool_us: 60000, pipe_us: 180000, server_us: 100000, post_us: 100000, wire_us: 80000, cont_us: 20000 })} ${q("q2", { n: 100, stamped: 99, piped: 0, skewed: 1, pre_us: 200000, spre_us: 198000, pool_us: 20000, pipe_us: 0, server_us: 50000, post_us: 100000, wire_us: 90000, cont_us: 10000 })} claim_infl_n=200 claim_infl_q_sum=400 claim_infl_tx_sum=200 claim_infl_max=${max} claim_infl_busy=50 claim_cal_drift_us=${drift}`;

  test("يُجمَعُ بالجمعِ والأقصى، ويُشتَقُّ rest على المرصود", () => {
    const log = [
      passLine("2026-10-27T10:00:01.000Z", 1000, base(10, 5)),
      passLine("2026-10-27T10:00:03.000Z", 1000, base(300, 7)),
    ].join("\n");
    const { passes } = parseLog(log);
    expect(passes.length).toBe(2);
    expect(passes[0]?.fields?.claim_q1_pool_us).toBe(60000);
    const cw = passTotalsOf(passes).claimWait;
    expect(cw).not.toBeNull();
    if (cw === null) return;
    expect(cw.q1.perQueryMs).toEqual({
      pre: 3,
      pool: 0.6,
      pipe: 1.8,
      rest: 0.6,
      server: 1,
      post: 1,
      wire: 0.8,
      cont: 0.2,
    });
    // من زمنِ الالتقاطِ (2000ms): q1.pre = 600ms = 30%.
    expect(cw.q1.pctOfClaim.pre).toBe(30);
    expect(cw.q1.pctOfClaim.pipe).toBe(18);
    expect(cw.q1.pipelinedPctOfStamped).toBe(50);
    // q2: مرصودٌ 99 من 100 ⇒ أجزاءُ pre تُكبَّرُ بـ100/99.
    expect(cw.q2.perQueryMs.rest).toBe(1.8);
    expect(cw.q2.pctOfClaim.pool).toBe(2);
    expect(cw.q2.pctOfClaim.total).toBe(35);
    expect(cw.stampedPct).toBe(99.5);
    expect(cw.inflight).toEqual({
      n: 400,
      meanQueries: 2,
      meanTransactions: 1,
      max: 7,
      busyAtIssuePct: 25,
    });
    expect(cw.calDriftMaxUs).toBe(300);
  });

  test("بلا حقولِ CLAIM-WAIT ⇒ null (OFF أو سجلٌّ أقدم)", () => {
    expect(claimWaitOf({ claim_ms: 10 }, {})).toBeNull();
    const { passes } = parseLog(
      passLine("2026-10-27T10:00:01.000Z", 1000, "claim_calls=3 claim_ms=9"),
    );
    expect(passTotalsOf(passes).claimWait).toBeNull();
  });
});

const cwq = (
  perQueryMs: Record<string, number>,
  pctOfClaim: Record<string, number>,
  stamped = 100,
) => ({
  n: 100,
  stamped,
  pipelinedPctOfStamped: 0,
  skewed: 0,
  perQueryMs,
  pctOfClaim,
});
const cwOf = (
  over: Partial<ClaimWaitIn> & {
    pool?: number;
    pipe?: number;
    rest?: number;
    q2pre?: number;
    q2post?: number;
  },
): ClaimWaitIn => ({
  q1: cwq(
    { pool: over.pool ?? 0.1, pipe: over.pipe ?? 0.1, rest: over.rest ?? 0.1 },
    { pre: 20, post: 10 },
  ),
  q2: cwq(
    { pool: over.pool ?? 0.1, pipe: over.pipe ?? 0.1, rest: over.rest ?? 0.1 },
    { pre: over.q2pre ?? 15, post: over.q2post ?? 10 },
  ),
  stampedPct: over.stampedPct ?? 100,
  inflight: null,
  calDriftMaxUs: over.calDriftMaxUs ?? 50,
});
const coOf = (
  lock: number | null,
  wpr: number | null,
  actCov = 0.9,
  schedCov = 0.95,
): CorroborationIn => ({
  activity: { coverage: actCov, lockLikeShare: lock },
  sched: { coverage: schedCov, postgres: { waitPerRun: wpr } },
});
const split = { coveragePct: 100, queries: 200, skewed: 1 };

describe("§5.7 CLAIM_WAIT_RULE", () => {
  test("الصلاحيّة: كلُّ عتبةٍ تُسقِطُ الموجةَ بسببٍ مسمّى", () => {
    expect(claimWaitValidityOf(split, cwOf({}), coOf(0, 0))).toEqual([]);
    expect(claimWaitValidityOf(split, null, coOf(0, 0))).toEqual(["claim_wait_missing"]);
    expect(
      claimWaitValidityOf(
        { coveragePct: 89.9, queries: 100, skewed: 2 },
        cwOf({ stampedPct: 98.9, calDriftMaxUs: 1001 }),
        coOf(0, 0, 0.49, 0.79),
      ),
    ).toEqual([
      "claim_coverage_lt_90",
      "skewed_gt_1pct",
      "stamped_lt_99",
      "cal_drift_gt_1ms",
      "pg_activity_coverage_lt_50",
      "sched_coverage_lt_80",
    ]);
    expect(claimWaitValidityOf(split, cwOf({}), null)).toEqual(["corroboration_missing"]);
  });

  test("التصنيف: الأغلبُ ≥ 50% من pre المرصود، وrest يُسندُ بالمعالجِ ثمّ بالأقفال", () => {
    expect(preClassOf(cwOf({ pool: 1, pipe: 0.5, rest: 0.5 }), coOf(0, 0))).toBe("POOL_QUEUE");
    expect(preClassOf(cwOf({ pool: 0.2, pipe: 1, rest: 0.5 }), coOf(0, 0))).toBe("PIPELINE");
    expect(preClassOf(cwOf({ pool: 0.1, pipe: 0.1, rest: 1 }), coOf(0.9, 0.25))).toBe(
      "PRE_REST_CPU_WAIT",
    );
    expect(preClassOf(cwOf({ pool: 0.1, pipe: 0.1, rest: 1 }), coOf(0.25, 0.24))).toBe(
      "PRE_REST_LOCK_WAIT",
    );
    expect(preClassOf(cwOf({ pool: 0.1, pipe: 0.1, rest: 1 }), coOf(0.24, 0.24))).toBe(
      "PRE_REST_UNSEPARATED",
    );
    expect(preClassOf(cwOf({ pool: 0.4, pipe: 0.4, rest: 0.4 }), coOf(0, 0))).toBe("PRE_MIXED");
    expect(q2RemovablePctOf(cwOf({ q2pre: 12.5, q2post: 7.5 }))).toBe(20);
  });

  const wave = (
    slot: string,
    cw: ClaimWaitIn | null,
    co: CorroborationIn | null,
    arm: "ON" | "OFF" = "ON",
  ): WaveIn => ({
    slot,
    arm,
    valid: true,
    g1Pct: 99,
    riderOldestSec: 100,
    riderPending: 1,
    failedGates: [],
    decomposition: {
      validity: { ok: true, reasons: [] },
      attemptsSeen: 1,
      oldest20: { n: 1, groupsPct: { queue_wait: 90 } },
      drainPasses: {
        n: 1,
        idleShareBeforeAudit: 0,
        stopReasons: {},
        pass: {
          passesWithClaimMs: 1,
          pctOfPassElapsed: { claim: 80 },
          claimMeanMs: 9,
          claimSplit: { ...split, timed: 100, pctOfClaim: {}, perQueryMs: {} },
          claimWait: cw,
        },
      },
    },
    corroboration: co,
  });

  test("الحكمُ عبرَ الموجات: أغلبيّةٌ ≥ 2، والمبرّرُ q2 ≥ 20% في موجتين؛ وإلّا لا مرحلةَ ثانية", () => {
    const pipe = cwOf({ pool: 0.1, pipe: 1, rest: 0.2 });
    const v = verdictOf([
      wave("ON1", pipe, coOf(0, 0)),
      wave("ON2", pipe, coOf(0, 0)),
      wave("ON3", cwOf({ stampedPct: 50 }), coOf(0, 0)),
      wave("OFF1", null, coOf(0, 0), "OFF"),
    ]);
    expect(v.claimWait.decision).toBe("PIPELINE");
    expect(v.claimWait.waves.map((w) => w.class)).toEqual(["PIPELINE", "PIPELINE", "GAP"]);
    expect(v.claimWait.waves[2]?.reasons).toEqual(["stamped_lt_99"]);
    expect(v.claimWait.phase2).toMatchObject({ justified: true, wavesQ2RemovableGe20: 2 });

    const low = cwOf({ pool: 0.1, pipe: 1, rest: 0.2, q2pre: 10, q2post: 9.9 });
    const w2 = verdictOf([wave("ON1", low, coOf(0, 0)), wave("ON2", low, coOf(0, 0))]);
    expect(w2.claimWait.phase2.justified).toBe(false);

    const one = verdictOf([wave("ON1", pipe, coOf(0, 0)), wave("ON2", pipe, null)]);
    expect(one.claimWait.decision).toBe("MEASUREMENT_GAP");
    expect(one.claimWait.phase2.justified).toBe(false);

    const mixed = verdictOf([
      wave("ON1", pipe, coOf(0, 0)),
      wave("ON2", cwOf({ pool: 1, pipe: 0.1, rest: 0.1 }), coOf(0, 0)),
    ]);
    expect(mixed.claimWait.decision).toBe("INCONCLUSIVE");
  });
});
