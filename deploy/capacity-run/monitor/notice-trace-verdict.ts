#!/usr/bin/env bun
/**
 * LOAD01-NOTICE-TRACE — حكمُ الموجةِ التشخيصيّةِ بالقواعدِ المسجَّلةِ مسبقًا
 * (`docs/evidence/capacity/LOAD01-NOTICE-TRACE-20261027/PROTOCOL-load01-notice-trace.md` §5).
 * تشخيصٌ لا قبول: لا يمسُّ LOAD-01 = FAIL ولا LOAD-01M = NOT_MET.
 *
 * الاستعمال: bun notice-trace-verdict.ts <out.json> SLOT:ARM:VALIDITY:DIR …   (ARM = ON|OFF)
 * يقرأُ من كلِّ DIR: base-wave.json (G1 والبوابات)، db-audit-post.json (أقدمُ rider_trip_notice)،
 * notice-decompose.json (لموجاتِ ON).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface WaveIn {
  readonly slot: string;
  readonly arm: "ON" | "OFF";
  /** صلاحيّةُ المقعدِ (b33m valid + MIXED_OK) كما قرّرَها السكربت. */
  readonly valid: boolean;
  readonly g1Pct: number | null;
  readonly riderOldestSec: number | null;
  readonly riderPending: number | null;
  readonly failedGates: readonly string[];
  readonly decomposition: {
    readonly validity: { readonly ok: boolean; readonly reasons: readonly string[] };
    readonly attemptsSeen: number;
    readonly oldest20: { readonly n: number; readonly groupsPct: Record<string, number | null> };
    /** §5.5 (ملحق ب): تفكيكُ زمنِ أشواطِ التصريف — يُقرأُ لكلِّ الموجات (سطرُ الشوطِ لا يتبعُ ذراعَ الأثر). */
    readonly drainPasses?: {
      readonly n: number;
      readonly idleShareBeforeAudit: number | null;
      readonly stopReasons: Record<string, number>;
      readonly pass?: {
        readonly passesWithClaimMs: number;
        readonly pctOfPassElapsed: Record<string, number | null>;
        readonly claimMeanMs: number | null;
        readonly claimSplit?: {
          readonly timed: number;
          readonly coveragePct: number | null;
          readonly queries: number;
          readonly skewed: number;
          readonly pctOfClaim: Record<string, number | null>;
          readonly perQueryMs: Record<string, number | null>;
        } | null;
        readonly claimWait?: ClaimWaitIn | null;
        readonly loop?: {
          readonly passes: number;
          readonly delayMeanUs: number;
          readonly delayP99Us: number;
          readonly delayMaxUs: number;
          readonly eluPct: number | null;
        } | null;
      };
    };
  } | null;
  /** الملحق د: مطابقةُ عيّناتِ الخادمِ بنوافذِ الأشواط (claim-wait.json). */
  readonly corroboration?: CorroborationIn | null;
}

export interface ClaimWaitQueryIn {
  readonly n: number;
  readonly stamped: number;
  readonly pipelinedPctOfStamped: number | null;
  readonly skewed: number;
  readonly perQueryMs: Record<string, number | null>;
  readonly pctOfClaim: Record<string, number | null>;
}

export interface ClaimWaitIn {
  readonly q1: ClaimWaitQueryIn;
  readonly q2: ClaimWaitQueryIn;
  readonly stampedPct: number | null;
  readonly inflight: {
    readonly n: number;
    readonly meanQueries: number;
    readonly meanTransactions: number;
    readonly max: number;
    readonly busyAtIssuePct: number;
  } | null;
  readonly calDriftMaxUs: number | null;
}

export interface CorroborationIn {
  readonly activity: {
    readonly coverage: number | null;
    readonly lockLikeShare: number | null;
  } | null;
  readonly sched: {
    readonly coverage: number | null;
    readonly postgres: { readonly waitPerRun: number | null } | null;
  } | null;
}

export type PreClass =
  | "POOL_QUEUE"
  | "PIPELINE"
  | "PRE_REST_CPU_WAIT"
  | "PRE_REST_LOCK_WAIT"
  | "PRE_REST_UNSEPARATED"
  | "PRE_MIXED"
  | "GAP";

/**
 * §5.7 CLAIM_WAIT_RULE (الملحق د، مسجَّلٌ قبلَ موجتِه). صلاحيّةُ القياسِ في الموجة، وإلّا GAP مع السبب:
 * تغطيةُ نداءاتِ الالتقاط ≥ 90%، والاستعلاماتُ بساعتينِ غيرِ متّسقتين ≤ 1%، والمرصودُ ≥ 99% من الاستعلامات،
 * وأقصى انحرافِ معايرةٍ بينَ شوطين ≤ 1000µs، ونبضاتُ pg_stat_activity ≥ 50% من المتوقَّع (10/ث)،
 * وعيّناتُ الجدولة ≥ 80% من الثواني.
 * ثمّ يُصنَّفُ زمنُ ما قبلَ التنفيذِ (pre المرصود للاستعلامين معًا) بحصّةِ كلِّ جزءٍ منه:
 * pool ≥ 50% ⇒ POOL_QUEUE، pipe ≥ 50% ⇒ PIPELINE، rest ≥ 50% ⇒ PRE_REST_*، وإلّا PRE_MIXED.
 * وrest يُسندُ بالخادم: انتظارُ طابورِ المعالجِ لـpostgres / تشغيلُه ≥ 0.25 ⇒ CPU_WAIT، وإلّا حصّةُ عيّناتِ
 * workerJobs النشطةِ المنتظرةِ Lock/LWLock/IO/IPC/BufferPin ≥ 0.25 ⇒ LOCK_WAIT، وإلّا UNSEPARATED.
 */
export function claimWaitValidityOf(
  split:
    | { readonly coveragePct: number | null; readonly queries: number; readonly skewed: number }
    | null
    | undefined,
  cw: ClaimWaitIn | null | undefined,
  co: CorroborationIn | null | undefined,
): string[] {
  const r: string[] = [];
  if (cw === null || cw === undefined) return ["claim_wait_missing"];
  if (split === null || split === undefined || split.coveragePct === null || split.coveragePct < 90)
    r.push("claim_coverage_lt_90");
  if (
    split !== null &&
    split !== undefined &&
    split.queries > 0 &&
    split.skewed / split.queries > 0.01
  )
    r.push("skewed_gt_1pct");
  if (cw.stampedPct === null || cw.stampedPct < 99) r.push("stamped_lt_99");
  if (cw.calDriftMaxUs === null || cw.calDriftMaxUs > 1000) r.push("cal_drift_gt_1ms");
  if (co === null || co === undefined) r.push("corroboration_missing");
  else {
    if (co.activity === null || co.activity.coverage === null || co.activity.coverage < 0.5)
      r.push("pg_activity_coverage_lt_50");
    if (co.sched === null || co.sched.coverage === null || co.sched.coverage < 0.8)
      r.push("sched_coverage_lt_80");
  }
  return r;
}

/** مجموعُ ms لجزءٍ من pre على المرصود للاستعلامين (متوسّطٌ × عددُ المرصود). */
function preSum(cw: ClaimWaitIn, part: string): number {
  const one = (q: ClaimWaitQueryIn) => (q.perQueryMs[part] ?? 0) * q.stamped;
  return one(cw.q1) + one(cw.q2);
}

export function preClassOf(cw: ClaimWaitIn, co: CorroborationIn | null | undefined): PreClass {
  const pool = preSum(cw, "pool");
  const pipe = preSum(cw, "pipe");
  const rest = preSum(cw, "rest");
  const total = pool + pipe + rest;
  if (!(total > 0)) return "PRE_MIXED";
  if (pool / total >= 0.5) return "POOL_QUEUE";
  if (pipe / total >= 0.5) return "PIPELINE";
  if (rest / total >= 0.5) {
    const wpr = co?.sched?.postgres?.waitPerRun ?? null;
    if (wpr !== null && wpr >= 0.25) return "PRE_REST_CPU_WAIT";
    const lock = co?.activity?.lockLikeShare ?? null;
    if (lock !== null && lock >= 0.25) return "PRE_REST_LOCK_WAIT";
    return "PRE_REST_UNSEPARATED";
  }
  return "PRE_MIXED";
}

/**
 * §5.7 مبرّرُ المرحلةِ الثانية (مسجَّلٌ قبلَ موجتِه): ما يُزيلُه دمجُ الاستعلامين هو ما قبلَ التنفيذِ وما بعدَه
 * للاستعلامِ الثاني (تبقى كلفتُه على الخادم). المبرّرُ قائمٌ إن بلغَ (q2.pre + q2.post) ≥ 20% من زمنِ الالتقاط
 * في موجتَي ON صالحتينِ على الأقلّ، ولم يكن حكمُ القياسِ MEASUREMENT_GAP.
 */
export function q2RemovablePctOf(cw: ClaimWaitIn): number | null {
  const pre = cw.q2.pctOfClaim.pre;
  const post = cw.q2.pctOfClaim.post;
  return pre === null || pre === undefined || post === null || post === undefined
    ? null
    : Math.round(10 * (pre + post)) / 10;
}

export type ClaimSplitClass =
  | "POOL_PIPELINE"
  | "SERVER"
  | "EVENT_LOOP"
  | "POST_OTHER"
  | "MIXED_CLAIM"
  | "GAP";

type SplitIn = NonNullable<
  NonNullable<NonNullable<WaveIn["decomposition"]>["drainPasses"]>["pass"]
>;

/**
 * §5.6 CLAIM_SPLIT_RULE (الملحق ج، مسجَّلٌ قبلَ موجتِه). الحصصُ من زمنِ الالتقاطِ الجداريّ:
 * - GAP: لا تفكيك، أو تغطيةٌ < 90% من النداءات، أو أكثرُ من 1% من الاستعلاماتِ بساعتينِ غيرِ متّسقتين.
 * - pre ≥ 50 ⇒ POOL_PIPELINE: انتظارُ اتّصالٍ أو أنبوبٍ خلفَ استعلاماتٍ أخرى، أو انتظارُ الخادمِ لـCPU.
 * - server ≥ 50 ⇒ SERVER.
 * - post ≥ 50 ⇒ EVENT_LOOP إن بلغَ متوسّطُ تأخّرِ الحلقةِ خلالَ الأشواطِ ≥ 50% من متوسّطِ post لكلِّ
 *   استعلام، وإلّا POST_OTHER.
 * - وإلّا MIXED_CLAIM.
 */
export function claimSplitClassOf(pass: SplitIn | undefined): ClaimSplitClass {
  const cs = pass?.claimSplit;
  if (cs === undefined || cs === null) return "GAP";
  if (cs.coveragePct === null || cs.coveragePct < 90) return "GAP";
  if (cs.queries > 0 && cs.skewed / cs.queries > 0.01) return "GAP";
  const pre = cs.pctOfClaim.pre ?? 0;
  const server = cs.pctOfClaim.server ?? 0;
  const post = cs.pctOfClaim.post ?? 0;
  if (pre >= 50) return "POOL_PIPELINE";
  if (server >= 50) return "SERVER";
  if (post >= 50) {
    const perPost = cs.perQueryMs.post ?? null;
    const loopMs =
      pass?.loop === undefined || pass.loop === null ? null : pass.loop.delayMeanUs / 1000;
    return perPost !== null && perPost > 0 && loopMs !== null && loopMs >= 0.5 * perPost
      ? "EVENT_LOOP"
      : "POST_OTHER";
  }
  return "MIXED_CLAIM";
}

export type DrainClass = "CLAIM_SERIAL" | "CITY_CAP" | "LANES" | "MIXED_DRAIN" | "GAP";

/**
 * §5.5 DRAIN_RULE (ملحق ب، مسجَّلٌ قبلَ موجتِه): أين يذهبُ زمنُ الشوط؟ الحصصُ من `elapsed_ms`:
 * الالتقاطُ المتسلسلُ ≥ 50 ⇒ CLAIM_SERIAL؛ انتظارُ ما في الطيرانِ بعدَ التقاطٍ فارغٍ/مشبَعٍ ≥ 50 ⇒ CITY_CAP؛
 * انتظارُ تحرّرِ مسارٍ ≥ 50 ⇒ LANES؛ وإلّا MIXED_DRAIN. بلا حقولِ الشوطِ ⇒ GAP.
 */
export function drainClassOf(pct: Record<string, number | null> | undefined): DrainClass {
  if (pct === undefined || pct.claim === null || pct.claim === undefined) return "GAP";
  if (pct.claim >= 50) return "CLAIM_SERIAL";
  if ((pct.saturated_wait ?? 0) >= 50) return "CITY_CAP";
  if ((pct.lane_full_wait ?? 0) >= 50) return "LANES";
  return "MIXED_DRAIN";
}

export type WaveClass =
  | "LIMITER"
  | "QUEUE"
  | "PROCESSING"
  | "APP_ACK"
  | "BOTH_LIMITER_QUEUE"
  | "MIXED"
  | "GAP";

export interface WaveShares {
  readonly limiter: number;
  readonly queue: number;
  readonly processing: number;
  readonly appAck: number;
  readonly unattributed: number;
}

const g = (p: Record<string, number | null>, k: string) => p[k] ?? 0;

/** §5.3: الحصصُ من أقدمِ عشرين معلَّقًا — المحدّدُ مباشرًا ومُستحثًّا، والطابور، والمعالجة، والإقرار. */
export function sharesOf(groupsPct: Record<string, number | null>): WaveShares {
  return {
    limiter: g(groupsPct, "telegram_limiter") + g(groupsPct, "queue_after_limiter"),
    queue: g(groupsPct, "queue_wait"),
    processing: g(groupsPct, "outbox_processing") + g(groupsPct, "telegram_api"),
    appAck: g(groupsPct, "app_ack_wait"),
    unattributed: g(groupsPct, "unattributed"),
  };
}

export function classOf(s: WaveShares): WaveClass {
  if (s.unattributed > 10) return "GAP";
  if (s.limiter >= 50) return "LIMITER";
  if (s.queue >= 50) return "QUEUE";
  if (s.processing >= 50) return "PROCESSING";
  if (s.appAck >= 50) return "APP_ACK";
  if (s.limiter >= 25 && s.queue >= 25) return "BOTH_LIMITER_QUEUE";
  return "MIXED";
}

const mean = (xs: readonly number[]) =>
  xs.length === 0 ? null : Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100;

export function verdictOf(waves: readonly WaveIn[]) {
  const on = waves.filter((w) => w.arm === "ON" && w.valid);
  const off = waves.filter((w) => w.arm === "OFF" && w.valid);
  // §5.1 TRACE_RULE
  const traced = on.map((w) => {
    const d = w.decomposition;
    const ok = d !== null && d.attemptsSeen > 0 && d.validity.ok && d.oldest20.n > 0;
    const shares = ok && d !== null ? sharesOf(d.oldest20.groupsPct) : null;
    return {
      slot: w.slot,
      traceOk: ok,
      reasons: d === null ? ["notice_decompose_missing"] : d.validity.reasons,
      riderOldestSec: w.riderOldestSec,
      shares,
      class: shares === null ? ("GAP" as WaveClass) : classOf(shares),
    };
  });
  // §5.2 OVERHEAD_RULE
  const nums = (xs: readonly (number | null)[]) => xs.filter((x): x is number => x !== null);
  const p7On = mean(nums(on.map((w) => w.riderOldestSec)));
  const p7Off = mean(nums(off.map((w) => w.riderOldestSec)));
  const g1On = mean(nums(on.map((w) => w.g1Pct)));
  const g1Off = mean(nums(off.map((w) => w.g1Pct)));
  const dP7 = p7On !== null && p7Off !== null ? Math.round(100 * (p7On - p7Off)) / 100 : null;
  const dG1 = g1On !== null && g1Off !== null ? Math.round(100 * (g1On - g1Off)) / 100 : null;
  const overhead =
    on.length < 2 || off.length < 2 || dP7 === null || dG1 === null
      ? "INSUFFICIENT"
      : Math.abs(dP7) <= 10 && dG1 >= -3
        ? "OVERHEAD_OK"
        : "OVERHEAD_HIGH";
  // §5.4 REPRO_RULE (وصفيّ): هل ظهرَ فشلُ G4/P7 بشرطِ الذراعِ B؟
  const exceeded = waves.filter((w) => w.valid && (w.riderOldestSec ?? 0) > 120).map((w) => w.slot);
  // §5.3 ATTRIBUTION_RULE
  const good = traced.filter((t) => t.traceOk && t.class !== "GAP");
  const counts: Record<string, number> = {};
  for (const t of good) counts[t.class] = (counts[t.class] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const attribution =
    good.length < 2
      ? "MEASUREMENT_GAP"
      : top !== undefined && top[1] >= 2 && top[1] > good.length / 2
        ? top[0]
        : "INCONCLUSIVE";
  // §5.5 DRAIN_RULE — كلُّ موجةٍ صالحةٍ فيها حقولُ الشوط (ON وOFF).
  const drainWaves = waves
    .filter((w) => w.valid)
    .map((w) => {
      const dp = w.decomposition?.drainPasses;
      const measured = (dp?.pass?.passesWithClaimMs ?? 0) > 0;
      return {
        slot: w.slot,
        measured,
        class: measured ? drainClassOf(dp?.pass?.pctOfPassElapsed) : ("GAP" as DrainClass),
        pctOfPassElapsed: dp?.pass?.pctOfPassElapsed ?? null,
        claimMeanMs: dp?.pass?.claimMeanMs ?? null,
        idleShareBeforeAudit: dp?.idleShareBeforeAudit ?? null,
        budgetStops: dp?.stopReasons?.budget ?? null,
        passes: dp?.n ?? null,
      };
    });
  const dGood = drainWaves.filter((d) => d.measured && d.class !== "GAP");
  const dCounts: Record<string, number> = {};
  for (const d of dGood) dCounts[d.class] = (dCounts[d.class] ?? 0) + 1;
  const dTop = Object.entries(dCounts).sort((a, b) => b[1] - a[1])[0];
  const drain =
    dGood.length < 2
      ? "MEASUREMENT_GAP"
      : dTop !== undefined && dTop[1] >= 2 && dTop[1] > dGood.length / 2
        ? dTop[0]
        : "INCONCLUSIVE";
  // §5.6 CLAIM_SPLIT_RULE — الموجاتُ الصالحةُ التي فيها تفكيكٌ (ذراعُ ON).
  const splitWaves = waves
    .filter((w) => w.valid && (w.decomposition?.drainPasses?.pass?.claimSplit ?? null) !== null)
    .map((w) => {
      const pass = w.decomposition?.drainPasses?.pass;
      return {
        slot: w.slot,
        class: claimSplitClassOf(pass),
        coveragePct: pass?.claimSplit?.coveragePct ?? null,
        pctOfClaim: pass?.claimSplit?.pctOfClaim ?? null,
        perQueryMs: pass?.claimSplit?.perQueryMs ?? null,
        loop: pass?.loop ?? null,
      };
    });
  const sGood = splitWaves.filter((x) => x.class !== "GAP");
  const sCounts: Record<string, number> = {};
  for (const x of sGood) sCounts[x.class] = (sCounts[x.class] ?? 0) + 1;
  const sTop = Object.entries(sCounts).sort((a, b) => b[1] - a[1])[0];
  const splitDecision =
    sGood.length < 2
      ? "MEASUREMENT_GAP"
      : sTop !== undefined && sTop[1] >= 2 && sTop[1] > sGood.length / 2
        ? sTop[0]
        : "INCONCLUSIVE";
  // §5.7 CLAIM_WAIT_RULE — موجاتُ ON الصالحةُ التي فيها CLAIM-WAIT.
  const waitWaves = on
    .filter((w) => (w.decomposition?.drainPasses?.pass?.claimWait ?? null) !== null)
    .map((w) => {
      const pass = w.decomposition?.drainPasses?.pass;
      const cw = pass?.claimWait ?? null;
      const co = w.corroboration ?? null;
      const reasons = claimWaitValidityOf(pass?.claimSplit, cw, co);
      return {
        slot: w.slot,
        reasons,
        class: reasons.length > 0 || cw === null ? ("GAP" as PreClass) : preClassOf(cw, co),
        q2RemovablePct: cw === null ? null : q2RemovablePctOf(cw),
        preMsSum:
          cw === null
            ? null
            : {
                pool: Math.round(preSum(cw, "pool")),
                pipe: Math.round(preSum(cw, "pipe")),
                rest: Math.round(preSum(cw, "rest")),
              },
        claimWait: cw,
        corroboration: co,
      };
    });
  const wGood = waitWaves.filter((x) => x.class !== "GAP");
  const wCounts: Record<string, number> = {};
  for (const x of wGood) wCounts[x.class] = (wCounts[x.class] ?? 0) + 1;
  const wTop = Object.entries(wCounts).sort((a, b) => b[1] - a[1])[0];
  const waitDecision =
    wGood.length < 2
      ? "MEASUREMENT_GAP"
      : wTop !== undefined && wTop[1] >= 2 && wTop[1] > wGood.length / 2
        ? wTop[0]
        : "INCONCLUSIVE";
  const q2Hits = wGood.filter((x) => (x.q2RemovablePct ?? 0) >= 20).length;
  const phase2Justified = waitDecision !== "MEASUREMENT_GAP" && q2Hits >= 2;
  return {
    rule: "PROTOCOL-load01-notice-trace §5",
    claimWait: {
      decision: waitDecision,
      classCounts: wCounts,
      phase2: {
        justified: phase2Justified,
        wavesQ2RemovableGe20: q2Hits,
        rule: "§5.7: q2.pre+q2.post ≥ 20% في ≥ 2 موجتَي ON صالحتين",
      },
      waves: waitWaves,
    },
    claimSplit: { decision: splitDecision, classCounts: sCounts, waves: splitWaves },
    drain: { decision: drain, classCounts: dCounts, waves: drainWaves },
    validOn: on.length,
    validOff: off.length,
    trace: traced,
    overhead: {
      decision: overhead,
      p7OnMeanSec: p7On,
      p7OffMeanSec: p7Off,
      dP7Sec: dP7,
      g1OnMean: g1On,
      g1OffMean: g1Off,
      dG1Pp: dG1,
    },
    repro: { wavesOver120s: exceeded, reproduced: exceeded.length > 0 },
    attribution: {
      decision: attribution,
      classCounts: counts,
      meanShares:
        good.length === 0
          ? null
          : (Object.fromEntries(
              (["limiter", "queue", "processing", "appAck", "unattributed"] as const).map((k) => [
                k,
                mean(good.map((t) => (t.shares as WaveShares)[k])),
              ]),
            ) as Record<keyof WaveShares, number | null>),
      perturbed: overhead !== "OVERHEAD_OK",
    },
    acceptance: "NONE — diagnostic only; LOAD-01 = FAIL, LOAD-01M = NOT_MET",
  };
}

function readJson(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function waveFromDir(slot: string, arm: "ON" | "OFF", valid: boolean, dir: string): WaveIn {
  const base = readJson(join(dir, "base-wave.json")) as {
    g1?: { pct?: number };
    failedGates?: string[];
  } | null;
  const audit = readJson(join(dir, "db-audit-post.json")) as {
    snapshot?: {
      outbox?: {
        pendingAgeByKind?: Record<string, { pending?: number; oldestPendingSec?: number | null }>;
      };
    };
  } | null;
  const r = audit?.snapshot?.outbox?.pendingAgeByKind?.rider_trip_notice;
  // OFF يُقرأُ أيضًا لـ§5.5 (حقولُ الشوط)؛ §5.1/§5.3 تقتصرُ على ON في verdictOf.
  const d = readJson(join(dir, "notice-decompose.json")) as WaveIn["decomposition"];
  return {
    slot,
    arm,
    valid,
    g1Pct: typeof base?.g1?.pct === "number" ? base.g1.pct : null,
    riderOldestSec: typeof r?.oldestPendingSec === "number" ? r.oldestPendingSec : null,
    riderPending: typeof r?.pending === "number" ? r.pending : null,
    failedGates: base?.failedGates ?? [],
    decomposition: d,
    corroboration: readJson(join(dir, "claim-wait.json")) as CorroborationIn | null,
  };
}

if (import.meta.main) {
  const [out, ...specs] = process.argv.slice(2);
  if (!out || specs.length === 0) {
    console.error("usage: notice-trace-verdict.ts <out.json> SLOT:ON|OFF:VALID|INVALID:DIR …");
    process.exit(2);
  }
  const waves = specs.map((s) => {
    const [slot, arm, v, ...rest] = s.split(":");
    return waveFromDir(slot ?? "?", arm === "ON" ? "ON" : "OFF", v === "VALID", rest.join(":"));
  });
  const verdict = { waves, ...verdictOf(waves) };
  writeFileSync(out, `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(
    `NOTICE_TRACE_VERDICT attribution=${verdict.attribution.decision} drain=${verdict.drain.decision} claim_split=${verdict.claimSplit.decision} claim_wait=${verdict.claimWait.decision} phase2=${verdict.claimWait.phase2.justified} overhead=${verdict.overhead.decision} repro=${verdict.repro.reproduced} validOn=${verdict.validOn} validOff=${verdict.validOff}`,
  );
}
