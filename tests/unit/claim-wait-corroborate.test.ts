/**
 * الغرض: `LOAD-01` (CLAIM-WAIT، الملحق د): مطابقةُ عيّناتِ pg_stat_activity والجدولةِ بنوافذِ أشواطِ التصريف،
 *   وعدُّ التغطيةِ بنبضاتِ `__tick__`، وكلفةُ أداةِ أخذِ العيّنات.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  activityOf,
  corroborate,
  inside,
  mergeWindows,
  parseActivity,
  parseSched,
  samplerCostOf,
  schedOf,
} from "../../deploy/capacity-run/monitor/claim-wait-corroborate";

describe("النوافذ", () => {
  test("الدمجُ والبحث", () => {
    const ws = mergeWindows([
      { s: 50, e: 60 },
      { s: 0, e: 10 },
      { s: 5, e: 20 },
      { s: 30, e: 30 },
    ]);
    expect(ws).toEqual([
      { s: 0, e: 20 },
      { s: 50, e: 60 },
    ]);
    expect(inside(ws, 20)).toBe(true);
    expect(inside(ws, 21)).toBe(false);
    expect(inside(ws, 55)).toBe(true);
  });
});

const ACT = [
  "SET",
  "1000,__tick__,,,,f,0",
  "1000,ceezr:workerJobs,active,,,t,2",
  "1000,ceezr:workerJobs,active,LWLock,WALWrite,f,1",
  "1000,ceezr:workerJobs,idle,Client,ClientRead,f,2",
  "1000,ceezr:gatewayRequest,active,,,f,3",
  "1100,__tick__,,,,f,0",
  "1100,ceezr:workerJobs,active,Lock,transactionid,t,1",
  "5000,__tick__,,,,f,0",
  "5000,ceezr:workerJobs,active,,,t,5",
  "bad,row",
].join("\n");

describe("pg_stat_activity", () => {
  test("داخلَ النوافذِ وحدَها، والنبضةُ تُعَدُّ ولو خلت، والحصصُ من workerJobs النشطة", () => {
    const rows = parseActivity(ACT);
    expect(rows.length).toBe(9);
    const a = activityOf(rows, [{ s: 900, e: 1200 }]);
    expect(a.ticks).toBe(2);
    expect(a.expectedTicks).toBe(3);
    expect(a.coverage).toBe(0.667);
    expect(a.workerJobsActiveMean).toBe(2);
    expect(a.workerJobsClaimActiveMean).toBe(1.5);
    expect(a.allActiveMean).toBe(3.5);
    expect(a.workerJobsActiveByWaitType).toEqual({ CPU_or_runnable: 2, LWLock: 1, Lock: 1 });
    expect(a.lockLikeShare).toBe(0.5);
    expect(a.workerJobsStateSamples).toEqual({ active: 4, idle: 2 });
  });
});

const SCHED = [
  JSON.stringify({ k: "meta", t: 0, ncpu: 4 }),
  JSON.stringify({
    k: "sched",
    t: 2000,
    psi_some_pct: 10,
    postgres: { run_pct_1core: 100, runq_wait_pct_1core: 20 },
    gateway: { run_pct_1core: 50, runq_wait_pct_1core: 5 },
  }),
  JSON.stringify({
    k: "sched",
    t: 3000,
    psi_some_pct: 30,
    postgres: { run_pct_1core: 300, runq_wait_pct_1core: 100 },
  }),
  JSON.stringify({
    k: "sched",
    t: 9000,
    psi_some_pct: 99,
    postgres: { run_pct_1core: 1, runq_wait_pct_1core: 99 },
  }),
].join("\n");

describe("الجدولة والكلفة", () => {
  test("الثانيةُ تُعَدُّ بمنتصفِها، وwaitPerRun = مجموعُ الانتظارِ / مجموعُ التشغيل", () => {
    const s = schedOf(parseSched(SCHED), [{ s: 1000, e: 3000 }]);
    expect(s.samples).toBe(2);
    expect(s.expectedSamples).toBe(2);
    expect(s.coverage).toBe(1);
    expect(s.postgres).toEqual({ runPct1Core: 200, runqWaitPct1Core: 60, waitPerRun: 0.3 });
    expect(s.gateway).toEqual({ runPct1Core: 25, runqWaitPct1Core: 2.5, waitPerRun: 0.1 });
    expect(s.psiSomePct).toBe(20);
  });

  test("كلفةُ الأداةِ من pg_by_app", () => {
    const res = [
      JSON.stringify({
        postgres: { cpu_pct: 100 },
        pg_by_app: { "claimwait-sampler": 2, "ceezr:workerJobs": 40 },
      }),
      JSON.stringify({ postgres: { cpu_pct: 200 }, pg_by_app: { "ceezr:workerJobs": 60 } }),
    ].join("\n");
    expect(samplerCostOf(res, "claimwait-sampler")).toEqual({
      samples: 2,
      samplerCpuPct1Core: 1,
      workerJobsCpuPct1Core: 50,
      postgresCpuPct1Core: 150,
    });
  });

  test("corroborate يقرأُ النصَّ والمضغوط، ويسمّي الغائب", () => {
    const d = mkdtempSync(join(tmpdir(), "cw-"));
    writeFileSync(
      join(d, "drain-passes.jsonl"),
      `${JSON.stringify({ s: 900, e: 1200 })}\n${JSON.stringify({ s: 1500, e: 3000 })}\n`,
    );
    writeFileSync(join(d, "pg-activity.csv.gz"), gzipSync(Buffer.from(ACT)));
    writeFileSync(join(d, "sched-samples.jsonl"), SCHED);
    const c = corroborate(d);
    expect(c.inputs).toEqual({
      drainPasses: true,
      pgActivity: true,
      sched: true,
      resources: false,
    });
    expect(c.passes).toBe(2);
    expect(c.windowSec).toBe(1.8);
    expect(c.activity?.ticks).toBe(2);
    expect(c.sched?.samples).toBe(2);
    expect(c.samplerCost).toBeNull();
  });
});
