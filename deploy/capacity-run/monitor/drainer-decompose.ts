#!/usr/bin/env bun
/**
 * LOAD-01M · الدورةُ الثالثة — تفكيكُ زمنِ مهامِ تحديثاتِ تيليجرامَ في الكنّاسِ (drainer) من الأدلّةِ الخامِ
 * وحدَها، مع فحصِ قابليّةِ المقارنةِ بينَ الموجاتِ (عتادُ المقعد). أداةُ قياسٍ لا تمسُّ سلوكَ المنتج.
 *
 * الاستعمال:
 *   bun deploy/capacity-run/monitor/drainer-decompose.ts <raw-dir> [<raw-dir> ...]
 *   (raw-dir = .../raw/<RUN>/ من عُدّةِ موجةٍ؛ الأوّلُ مرجعُ المقارنة)
 *
 * المدخلاتُ لكلِّ موجة (كلُّها مُجمَّعةٌ أصلًا في العُدّة؛ لا قياسَ جديدٌ في المقعد):
 *   load-trace.jsonl.gz   أثرُ `DISPATCH_TRACE_FILE` (k=job|sweep|pagg) — telegram-update-drainer.ts/load-trace.ts
 *   update-jobs.csv.gz    bot,update_id,created_ms,done_ms,status,attempts (بلا ترويسة)
 *   pgss-full.csv.gz      pg_stat_statements بعدَ الموجة (بترويسة)
 *   qual/preflight.json   مِجسّا الخمولِ قبلَ الموجة (speed_probe_median_ms · pg_probe_median_ms)
 *   ../../seat-env.txt    طرازُ المعالج (lscpu)
 *
 * المراحلُ لكلِّ مهمّة (مرتبطةٌ بـbot+update_id):
 *   queue  = claimedAt − created_ms     انتظارُ الطابورِ قبلَ الالتقاط
 *   lane   = startedAt − claimedAt      انتظارُ مسارِ المستخدمِ بعدَ الالتقاط
 *   exec   = endedAt − startedAt        المعالجةُ (effectCheck + prepare + record)
 *   gate   = gateWaitMs / gateHoldMs    انتظارُ مقعدِ gatewayRequest واحتجازُه داخلَ المعالجة
 *
 * قابليّةُ المقارنة: موجتانِ قابلتانِ للمقارنةِ إن تطابقَ طرازُ المعالج، أو كانَ مِجسّا الخمولِ كلاهما ضمنَ
 * ±10% من المرجع (قاعدةُ ×1.10 نفسُها في derive-validity.py). وإلّا فالفرقُ بينهما لا يُنسَبُ إلى الشيفرة.
 * ومعاملُ العتادِ تحتَ الحِمل = وسيطُ نسبةِ متوسّطِ زمنِ جُمَلٍ ضابطةٍ لم يمسَّها التغييرُ (≥1000 نداءٍ في كلِّ
 * موجة، لا تلمسُ telegram_update_jobs) إلى المرجع.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Summary {
  readonly n: number;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p99: number | null;
  readonly mean: number | null;
}

export function summarise(values: readonly number[]): Summary {
  if (values.length === 0) return { n: 0, p50: null, p90: null, p99: null, mean: null };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
  const r = (x: number): number => Math.round(x * 100) / 100;
  return {
    n: s.length,
    p50: r(at(0.5)),
    p90: r(at(0.9)),
    p99: r(at(0.99)),
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

export function median(values: readonly number[]): number | null {
  return summarise(values).p50;
}

/** محلّلُ CSV (RFC 4180): حقولٌ مقتبسةٌ تحوي فواصلَ وأسطرًا و"" مزدوجة. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface TraceJob {
  readonly bot: string;
  readonly updateId: number;
  readonly claimedAt: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly effectCheckMs?: number | null;
  readonly prepareMs?: number | null;
  readonly recordMs?: number | null;
  readonly kind?: string;
  readonly gateWaitMs?: number;
  readonly gateHoldMs?: number;
}

export interface TraceSweep {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly claimed: number;
  readonly claimTrips: number;
  readonly claimMs: number;
  readonly truncated: boolean;
}

export interface TracePathAgg {
  readonly path: string;
  readonly pool: string;
  readonly kind: string;
  readonly n: number;
  readonly runSumMs: number;
  readonly waitSumMs: number;
}

export interface Trace {
  readonly jobs: TraceJob[];
  readonly sweeps: TraceSweep[];
  readonly paths: TracePathAgg[];
}

export function parseTrace(jsonl: string): Trace {
  const jobs: TraceJob[] = [];
  const sweeps: TraceSweep[] = [];
  const paths: TracePathAgg[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (o.k === "job") jobs.push(o as unknown as TraceJob);
    else if (o.k === "sweep") sweeps.push(o as unknown as TraceSweep);
    else if (o.k === "pagg") paths.push(o as unknown as TracePathAgg);
  }
  return { jobs, sweeps, paths };
}

/** update-jobs.csv: bot,update_id,created_ms,done_ms,status,attempts — يُعيدُ created_ms بالمفتاح. */
export function parseCreated(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of parseCsv(csv)) {
    const created = Number(r[2]);
    if (r.length < 3 || !Number.isFinite(created)) continue;
    out.set(`${r[0]}:${r[1]}`, created);
  }
  return out;
}

export interface JobDecomposition {
  readonly matched: number;
  readonly unmatched: number;
  readonly queueMs: Summary;
  readonly laneMs: Summary;
  readonly execMs: Summary;
  readonly effectCheckMs: Summary;
  readonly prepareMs: Summary;
  readonly recordMs: Summary;
  readonly gateWaitMs: Summary;
  readonly gateHoldMs: Summary;
  /** حصّةُ الطابورِ من (الطابور + المسار + المعالجة) — متوسّطاتٌ. */
  readonly queueShareOfTotal: number | null;
}

export function decomposeJobs(
  trace: Trace,
  created: ReadonlyMap<string, number>,
  filter: (j: TraceJob) => boolean = () => true,
): JobDecomposition {
  const q: number[] = [];
  const lane: number[] = [];
  const exec: number[] = [];
  const eff: number[] = [];
  const prep: number[] = [];
  const rec: number[] = [];
  const gw: number[] = [];
  const gh: number[] = [];
  let unmatched = 0;
  for (const j of trace.jobs) {
    if (!filter(j)) continue;
    const c = created.get(`${j.bot}:${j.updateId}`);
    if (c === undefined) {
      unmatched += 1;
      continue;
    }
    q.push(j.claimedAt - c);
    lane.push(j.startedAt - j.claimedAt);
    exec.push(j.endedAt - j.startedAt);
    eff.push(j.effectCheckMs ?? 0);
    prep.push(j.prepareMs ?? 0);
    rec.push(j.recordMs ?? 0);
    if (j.gateWaitMs !== undefined) gw.push(j.gateWaitMs);
    if (j.gateHoldMs !== undefined) gh.push(j.gateHoldMs);
  }
  const mean = (a: number[]): number =>
    a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length;
  const tot = mean(q) + mean(lane) + mean(exec);
  return {
    matched: q.length,
    unmatched,
    queueMs: summarise(q),
    laneMs: summarise(lane),
    execMs: summarise(exec),
    effectCheckMs: summarise(eff),
    prepareMs: summarise(prep),
    recordMs: summarise(rec),
    gateWaitMs: summarise(gw),
    gateHoldMs: summarise(gh),
    queueShareOfTotal:
      q.length === 0 || tot === 0 ? null : Math.round((mean(q) / tot) * 1000) / 1000,
  };
}

export interface SweepDecomposition {
  readonly active: number;
  readonly truncatedShare: number | null;
  readonly claimedPerSweep: Summary;
  readonly sweepMs: Summary;
  readonly claimMsPerSweep: Summary;
  readonly claimMsPerTrip: Summary;
  /** مجموعُ زمنِ رحلاتِ الالتقاطِ ÷ مجموعِ زمنِ الأشواط (زمنُ الحائط). */
  readonly claimShareOfSweep: number | null;
  readonly gapBetweenSweepsMs: Summary;
}

export function decomposeSweeps(sweeps: readonly TraceSweep[]): SweepDecomposition {
  const act = sweeps.filter((s) => s.claimed > 0).sort((a, b) => a.startedAt - b.startedAt);
  const dur = act.map((s) => s.endedAt - s.startedAt);
  const busy = dur.reduce((a, b) => a + b, 0);
  const claimSum = act.reduce((a, s) => a + s.claimMs, 0);
  const gaps: number[] = [];
  for (let i = 1; i < act.length; i += 1)
    gaps.push((act[i] as TraceSweep).startedAt - (act[i - 1] as TraceSweep).endedAt);
  return {
    active: act.length,
    truncatedShare:
      act.length === 0
        ? null
        : Math.round((act.filter((s) => s.truncated).length / act.length) * 1000) / 1000,
    claimedPerSweep: summarise(act.map((s) => s.claimed)),
    sweepMs: summarise(dur),
    claimMsPerSweep: summarise(act.map((s) => s.claimMs)),
    claimMsPerTrip: summarise(
      act.filter((s) => s.claimTrips > 0).map((s) => s.claimMs / s.claimTrips),
    ),
    claimShareOfSweep: busy === 0 ? null : Math.round((claimSum / busy) * 1000) / 1000,
    gapBetweenSweepsMs: summarise(gaps),
  };
}

export interface PoolHold {
  readonly pool: string;
  readonly totalHoldS: number;
  readonly top: { path: string; kind: string; n: number; holdS: number; holdMsPerCall: number }[];
}

export function poolHold(
  paths: readonly TracePathAgg[],
  pool = "ceezr:gatewayRequest",
  topN = 8,
): PoolHold {
  const rows = paths.filter((p) => p.pool === pool);
  const total = rows.reduce((a, p) => a + p.runSumMs, 0);
  const top = [...rows]
    .sort((a, b) => b.runSumMs - a.runSumMs)
    .slice(0, topN)
    .map((p) => ({
      path: p.path,
      kind: p.kind,
      n: p.n,
      holdS: Math.round(p.runSumMs / 10) / 100,
      holdMsPerCall: p.n === 0 ? 0 : Math.round((p.runSumMs / p.n) * 100) / 100,
    }));
  return { pool, totalHoldS: Math.round(total / 10) / 100, top };
}

/** pg_stat_statements: الجملةُ المُطبَّعةُ ← {calls, totalMs}. */
export function parsePgss(csv: string): Map<string, { calls: number; totalMs: number }> {
  const rows = parseCsv(csv);
  const head = rows[0] ?? [];
  const ci = head.indexOf("calls");
  const ti = head.indexOf("total_ms");
  const qi = head.indexOf("query");
  const out = new Map<string, { calls: number; totalMs: number }>();
  if (ci < 0 || ti < 0 || qi < 0) return out;
  for (const r of rows.slice(1)) {
    const q = (r[qi] ?? "").split(/\s+/).join(" ").trim().slice(0, 160);
    const a = out.get(q) ?? { calls: 0, totalMs: 0 };
    a.calls += Number(r[ci]) || 0;
    a.totalMs += Number(r[ti]) || 0;
    out.set(q, a);
  }
  return out;
}

/** جملٌ يمسُّها تغييرُ الالتقاط/الطابورِ فلا تصلحُ ضابطًا. */
export const NON_CONTROL = [/telegram_update/i, /claim_and_enqueue/i];
export const CLAIM_SIG = /^select claim_telegram_update_jobs_for_bot\(/i;

export function controlStatements(
  pgss: readonly Map<string, { calls: number; totalMs: number }>[],
  minCalls = 1000,
  minMeanMs = 0.1,
): string[] {
  const [ref] = pgss;
  if (ref === undefined) return [];
  return [...ref.keys()].filter((q) => {
    if (NON_CONTROL.some((re) => re.test(q))) return false;
    return pgss.every((m) => {
      const v = m.get(q);
      return v !== undefined && v.calls >= minCalls && v.totalMs / v.calls >= minMeanMs;
    });
  });
}

/** وسيطُ نسبةِ متوسّطِ زمنِ الجملِ الضابطةِ (الموجة ÷ المرجع). */
export function hardwareFactor(
  ref: ReadonlyMap<string, { calls: number; totalMs: number }>,
  run: ReadonlyMap<string, { calls: number; totalMs: number }>,
  controls: readonly string[],
): number | null {
  const ratios: number[] = [];
  for (const q of controls) {
    const a = ref.get(q);
    const b = run.get(q);
    if (a === undefined || b === undefined || a.calls === 0 || b.calls === 0) continue;
    ratios.push(b.totalMs / b.calls / (a.totalMs / a.calls));
  }
  return median(ratios);
}

export function claimMean(
  pgss: ReadonlyMap<string, { calls: number; totalMs: number }>,
): number | null {
  let calls = 0;
  let total = 0;
  for (const [q, v] of pgss)
    if (CLAIM_SIG.test(q)) {
      calls += v.calls;
      total += v.totalMs;
    }
  return calls === 0 ? null : Math.round((total / calls) * 100) / 100;
}

export interface Seat {
  readonly cpuModel: string | null;
  readonly idleSpeedProbeMs: number | null;
  readonly idlePgProbeMs: number | null;
}

export function parseSeat(seatEnv: string | null, preflight: string | null): Seat {
  const model = seatEnv?.match(/^Model name:\s*(.+)$/m)?.[1]?.trim() ?? null;
  let sp: number | null = null;
  let pg: number | null = null;
  if (preflight !== null) {
    try {
      const o = JSON.parse(preflight) as Record<string, unknown>;
      sp = typeof o.speed_probe_median_ms === "number" ? o.speed_probe_median_ms : null;
      pg = typeof o.pg_probe_median_ms === "number" ? o.pg_probe_median_ms : null;
    } catch {
      /* يبقى null */
    }
  }
  return { cpuModel: model, idleSpeedProbeMs: sp, idlePgProbeMs: pg };
}

export type Comparability = "COMPARABLE" | "NOT_COMPARABLE" | "UNKNOWN";

/** قاعدةُ ×1.10 نفسُها في derive-validity.py، مطبَّقةً بينَ موجتينِ لا على المقعدِ نفسِه. */
export const PROBE_TOLERANCE = 0.1;

export function comparability(ref: Seat, run: Seat): { verdict: Comparability; reasons: string[] } {
  const reasons: string[] = [];
  if (ref.cpuModel !== null && run.cpuModel !== null && ref.cpuModel === run.cpuModel)
    return { verdict: "COMPARABLE", reasons: ["same cpu model"] };
  const probes: [string, number | null, number | null][] = [
    ["idle speed probe", ref.idleSpeedProbeMs, run.idleSpeedProbeMs],
    ["idle pg probe", ref.idlePgProbeMs, run.idlePgProbeMs],
  ];
  let known = 0;
  let ok = true;
  for (const [name, a, b] of probes) {
    if (a === null || b === null || a === 0) continue;
    known += 1;
    const ratio = b / a;
    if (Math.abs(ratio - 1) > PROBE_TOLERANCE) {
      ok = false;
      reasons.push(`${name} ratio ${ratio.toFixed(2)} outside ±${PROBE_TOLERANCE * 100}%`);
    }
  }
  if (ref.cpuModel !== run.cpuModel)
    reasons.push(`cpu ${run.cpuModel ?? "?"} ≠ ref ${ref.cpuModel ?? "?"}`);
  if (known === 0) return { verdict: "UNKNOWN", reasons: [...reasons, "no idle probes"] };
  return { verdict: ok ? "COMPARABLE" : "NOT_COMPARABLE", reasons };
}

const readMaybe = (p: string, gz = false): string | null => {
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  return gz ? new TextDecoder().decode(Bun.gunzipSync(buf)) : buf.toString("utf8");
};

export function analyseWave(raw: string) {
  const trace = parseTrace(readMaybe(join(raw, "load-trace.jsonl.gz"), true) ?? "");
  const created = parseCreated(readMaybe(join(raw, "update-jobs.csv.gz"), true) ?? "");
  const pgss = parsePgss(readMaybe(join(raw, "pgss-full.csv.gz"), true) ?? "");
  const seat = parseSeat(
    readMaybe(join(dirname(dirname(raw)), "seat-env.txt")) ?? readMaybe(join(raw, "seat-env.txt")),
    readMaybe(join(raw, "qual", "preflight.json")),
  );
  return {
    raw,
    seat,
    contactJobs: decomposeJobs(trace, created, (j) => j.bot === "driver" && j.kind === "contact"),
    allJobs: decomposeJobs(trace, created),
    sweeps: decomposeSweeps(trace.sweeps),
    pool: poolHold(trace.paths),
    pgss,
  };
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: drainer-decompose.ts <raw-dir> [<raw-dir> ...]");
    process.exit(2);
  }
  const waves = dirs.map(analyseWave);
  const controls = controlStatements(waves.map((w) => w.pgss));
  const ref = waves[0] as (typeof waves)[number];
  const out = waves.map((w) => {
    const hf = hardwareFactor(ref.pgss, w.pgss, controls);
    const cm = claimMean(w.pgss);
    const { pgss: _omit, ...rest } = w;
    return {
      ...rest,
      compareToRef: {
        ref: ref.raw,
        ...comparability(ref.seat, w.seat),
        controlStatements: controls.length,
        hardwareFactor: hf,
        claimMeanMs: cm,
        claimMeanHwNormalisedMs:
          cm === null || hf === null ? null : Math.round((cm / hf) * 100) / 100,
      },
    };
  });
  console.log(JSON.stringify(out, null, 1));
}
