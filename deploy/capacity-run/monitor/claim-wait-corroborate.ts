#!/usr/bin/env bun
/**
 * LOAD01-NOTICE-TRACE · الملحق د (CLAIM-WAIT): يطابقُ عيّناتِ الخادمِ المتزامنةَ مع نوافذِ أشواطِ التصريف.
 * والمطابقةُ بساعةِ النظامِ نفسِها، فالعاملُ وPostgreSQL على المضيفِ نفسِه (netns لا يغيّرُ الساعة).
 *
 * المدخلات (نصٌّ أو `.gz`):
 * - `drain-passes.jsonl`: نوافذُ الأشواطِ من `notice-decompose.ts`، وكلُّ سطرٍ `{s, e}` بالـms.
 * - `pg-activity.csv`: عيّناتُ `pg_stat_activity` كلَّ 100ms، وأعمدتُها
 *   `ms,app,state,wait_event_type,wait_event,is_claim,count`. وصفُّ `__tick__` يُكتَبُ في كلِّ نبضة، فتُعَدُّ
 *   النبضةُ حتّى لو خلت من الخلفيّات.
 * - `sched-samples.jsonl`: عيّنةٌ كلَّ ثانيةٍ من schedstat لكلِّ صنف (`run_pct_1core`، `runq_wait_pct_1core`) مع PSI.
 * - `resources.jsonl` (اختياريّ): CPU لكلِّ تطبيقٍ داخلَ PostgreSQL كلَّ 5 ثوانٍ، وتُقاسُ به كلفةُ أداةِ أخذِ العيّنات.
 *
 * حدودُ التفسير:
 * - العيّنةُ لقطةٌ لحظيّة. 10 نبضاتٍ في الثانيةِ تقدّرُ حصّةَ الزمن ولا ترى ما هو أقصرُ من 100ms منفردًا.
 * - خلوُّ `wait_event` معَ `active` معناه أنّ الخلفيّةَ على المعالجِ أو تنتظرُه في طابورِ النظام؛ ولا يميّزُ
 *   PostgreSQL بينهما. ولهذا يُقرأُ انتظارُ المعالجِ من schedstat.
 * - schedstat بدقّةِ ثانية، فهو يصفُ الشوطَ كلَّه لا استعلامًا بعينه.
 *
 * الاستعمال: bun claim-wait-corroborate.ts <dir> <out.json>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export interface Window {
  readonly s: number;
  readonly e: number;
}

export interface ActivityRow {
  readonly ms: number;
  readonly app: string;
  readonly state: string;
  readonly wet: string;
  readonly we: string;
  readonly isClaim: boolean;
  readonly n: number;
}

export interface SchedRow {
  readonly t: number;
  readonly psi: number | null;
  readonly cls: Readonly<Record<string, { run: number; wait: number }>>;
}

/** يدمجُ النوافذَ المتداخلةَ ويرتّبُها. */
export function mergeWindows(ws: readonly Window[]): Window[] {
  const sorted = ws.filter((w) => Number.isFinite(w.s) && w.e > w.s).sort((a, b) => a.s - b.s);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out.at(-1);
    if (last !== undefined && w.s <= last.e)
      out[out.length - 1] = { s: last.s, e: Math.max(last.e, w.e) };
    else out.push({ ...w });
  }
  return out;
}

export function inside(ws: readonly Window[], t: number): boolean {
  let lo = 0;
  let hi = ws.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const w = ws[m] as Window;
    if (t < w.s) hi = m - 1;
    else if (t > w.e) lo = m + 1;
    else return true;
  }
  return false;
}

export function parseActivity(text: string): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const line of text.split("\n")) {
    const c = line.split(",");
    if (c.length !== 7 || !/^\d+$/.test(c[0] ?? "")) continue;
    out.push({
      ms: Number(c[0]),
      app: c[1] ?? "",
      state: c[2] ?? "",
      wet: c[3] ?? "",
      we: c[4] ?? "",
      isClaim: c[5] === "t",
      n: Number(c[6]),
    });
  }
  return out;
}

export function parseSched(text: string): SchedRow[] {
  const out: SchedRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (r.k !== "sched" || typeof r.t !== "number") continue;
    const cls: Record<string, { run: number; wait: number }> = {};
    for (const k of ["postgres", "gateway", "generator", "other_seat"]) {
      const v = r[k] as { run_pct_1core?: number; runq_wait_pct_1core?: number } | undefined;
      if (v !== undefined) cls[k] = { run: v.run_pct_1core ?? 0, wait: v.runq_wait_pct_1core ?? 0 };
    }
    out.push({ t: r.t, psi: typeof r.psi_some_pct === "number" ? r.psi_some_pct : null, cls });
  }
  return out;
}

const LOCKLIKE = new Set(["Lock", "LWLock", "IO", "IPC", "BufferPin"]);
const r1 = (x: number) => Math.round(10 * x) / 10;
const r3 = (x: number) => Math.round(1000 * x) / 1000;

export function activityOf(rows: readonly ActivityRow[], ws: readonly Window[], hz = 10) {
  const ticks = new Set<number>();
  let wjActive = 0;
  let wjClaimActive = 0;
  let allActive = 0;
  const wjByWait: Record<string, number> = {};
  const wjStates: Record<string, number> = {};
  for (const r of rows) {
    if (!inside(ws, r.ms)) continue;
    if (r.app === "__tick__") {
      ticks.add(r.ms);
      continue;
    }
    if (r.state === "active") allActive += r.n;
    if (r.app !== "ceezr:workerJobs") continue;
    wjStates[r.state || "?"] = (wjStates[r.state || "?"] ?? 0) + r.n;
    if (r.state !== "active") continue;
    wjActive += r.n;
    if (r.isClaim) wjClaimActive += r.n;
    const k = r.wet === "" ? "CPU_or_runnable" : r.wet;
    wjByWait[k] = (wjByWait[k] ?? 0) + r.n;
  }
  const seconds = ws.reduce((a, w) => a + (w.e - w.s), 0) / 1000;
  const expected = Math.round(seconds * hz);
  const lockLike = Object.entries(wjByWait)
    .filter(([k]) => LOCKLIKE.has(k))
    .reduce((a, [, v]) => a + v, 0);
  const n = ticks.size;
  return {
    ticks: n,
    expectedTicks: expected,
    coverage: expected > 0 ? r3(n / expected) : null,
    /** متوسّطُ خلفيّاتِ workerJobs النشطةِ في النبضة (من 5)، ومنها ما ينفّذُ الالتقاط. */
    workerJobsActiveMean: n > 0 ? r3(wjActive / n) : null,
    workerJobsClaimActiveMean: n > 0 ? r3(wjClaimActive / n) : null,
    allActiveMean: n > 0 ? r3(allActive / n) : null,
    workerJobsStateSamples: wjStates,
    workerJobsActiveByWaitType: wjByWait,
    /** حصّةُ عيّناتِ workerJobs النشطةِ المنتظرةِ قفلًا أو قرصًا أو تزامنًا داخليًّا (Lock/LWLock/IO/IPC/BufferPin). */
    lockLikeShare: wjActive > 0 ? r3(lockLike / wjActive) : null,
  };
}

export function schedOf(rows: readonly SchedRow[], ws: readonly Window[]) {
  // عيّنةُ الجدولةِ تصفُ الثانيةَ المنتهيةَ عند t، فتُعَدُّ إن وقعَ منتصفُها داخلَ نافذة.
  const sel = rows.filter((r) => inside(ws, r.t - 500));
  const seconds = ws.reduce((a, w) => a + (w.e - w.s), 0) / 1000;
  const sum = (k: string, f: "run" | "wait") => sel.reduce((a, r) => a + (r.cls[k]?.[f] ?? 0), 0);
  const cls = (k: string) => {
    const run = sum(k, "run");
    const wait = sum(k, "wait");
    return sel.length === 0
      ? null
      : {
          runPct1Core: r1(run / sel.length),
          runqWaitPct1Core: r1(wait / sel.length),
          /** انتظارُ طابورِ المعالجِ لكلِّ وحدةِ تشغيل: 0.25 = ربعُ زمنِ التشغيلِ إضافيٌّ انتظارًا. */
          waitPerRun: run > 0 ? r3(wait / run) : null,
        };
  };
  const psis = sel.map((r) => r.psi).filter((x): x is number => x !== null);
  return {
    samples: sel.length,
    expectedSamples: Math.round(seconds),
    coverage: seconds >= 1 ? r3(sel.length / Math.round(seconds)) : null,
    postgres: cls("postgres"),
    gateway: cls("gateway"),
    psiSomePct: psis.length === 0 ? null : r1(psis.reduce((a, b) => a + b, 0) / psis.length),
  };
}

/** كلفةُ أداةِ العيّناتِ داخلَ PostgreSQL (CPU% لنواةٍ واحدة) ونسبتُها إلى workerJobs، من resources.jsonl. */
export function samplerCostOf(text: string, app: string) {
  let n = 0;
  let own = 0;
  let wj = 0;
  let pg = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as {
        pg_by_app?: Record<string, number>;
        postgres?: { cpu_pct?: number };
      };
      if (r.pg_by_app === undefined) continue;
      n += 1;
      own += r.pg_by_app[app] ?? 0;
      wj += r.pg_by_app["ceezr:workerJobs"] ?? 0;
      pg += r.postgres?.cpu_pct ?? 0;
    } catch {}
  }
  return n === 0
    ? null
    : {
        samples: n,
        samplerCpuPct1Core: r1(own / n),
        workerJobsCpuPct1Core: r1(wj / n),
        postgresCpuPct1Core: r1(pg / n),
      };
}

function readMaybeGz(dir: string, name: string): string | null {
  const p = join(dir, name);
  if (existsSync(p)) return readFileSync(p, "utf8");
  if (existsSync(`${p}.gz`)) return gunzipSync(readFileSync(`${p}.gz`)).toString("utf8");
  return null;
}

export const SAMPLER_APP = "claimwait-sampler";

export function corroborate(dir: string) {
  const passesTxt = readMaybeGz(dir, "drain-passes.jsonl");
  const actTxt = readMaybeGz(dir, "pg-activity.csv");
  const schedTxt = readMaybeGz(dir, "sched-samples.jsonl");
  const resTxt = readMaybeGz(dir, "resources.jsonl");
  const passes: Window[] = [];
  for (const l of (passesTxt ?? "").split("\n")) {
    if (l.trim() === "") continue;
    try {
      const r = JSON.parse(l) as { s?: number; e?: number };
      if (typeof r.s === "number" && typeof r.e === "number") passes.push({ s: r.s, e: r.e });
    } catch {}
  }
  const ws = mergeWindows(passes);
  return {
    inputs: {
      drainPasses: passesTxt !== null,
      pgActivity: actTxt !== null,
      sched: schedTxt !== null,
      resources: resTxt !== null,
    },
    passes: passes.length,
    windowSec: r1(ws.reduce((a, w) => a + (w.e - w.s), 0) / 1000),
    activity: actTxt === null ? null : activityOf(parseActivity(actTxt), ws),
    sched: schedTxt === null ? null : schedOf(parseSched(schedTxt), ws),
    samplerCost: resTxt === null ? null : samplerCostOf(resTxt, SAMPLER_APP),
  };
}

if (import.meta.main) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error("usage: claim-wait-corroborate.ts <dir> <out.json>");
    process.exit(2);
  }
  const c = corroborate(dir);
  writeFileSync(out, `${JSON.stringify(c, null, 2)}\n`);
  console.log(
    `CLAIM_WAIT_CORROBORATE passes=${c.passes} window_s=${c.windowSec} act_cov=${c.activity?.coverage ?? "-"} wj_active=${c.activity?.workerJobsActiveMean ?? "-"} lock_like=${c.activity?.lockLikeShare ?? "-"} sched_cov=${c.sched?.coverage ?? "-"} pg_wait_per_run=${c.sched?.postgres?.waitPerRun ?? "-"} sampler_cpu=${c.samplerCost?.samplerCpuPct1Core ?? "-"}`,
  );
}
