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
  } | null;
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
  return {
    rule: "PROTOCOL-load01-notice-trace §5",
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
  const d =
    arm === "ON" ? (readJson(join(dir, "notice-decompose.json")) as WaveIn["decomposition"]) : null;
  return {
    slot,
    arm,
    valid,
    g1Pct: typeof base?.g1?.pct === "number" ? base.g1.pct : null,
    riderOldestSec: typeof r?.oldestPendingSec === "number" ? r.oldestPendingSec : null,
    riderPending: typeof r?.pending === "number" ? r.pending : null,
    failedGates: base?.failedGates ?? [],
    decomposition: d,
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
    `NOTICE_TRACE_VERDICT attribution=${verdict.attribution.decision} overhead=${verdict.overhead.decision} repro=${verdict.repro.reproduced} validOn=${verdict.validOn} validOff=${verdict.validOff}`,
  );
}
