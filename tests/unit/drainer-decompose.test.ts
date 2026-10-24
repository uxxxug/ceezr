import { describe, expect, test } from "bun:test";
import {
  claimMean,
  comparability,
  controlStatements,
  decomposeJobs,
  decomposeSweeps,
  hardwareFactor,
  parseCreated,
  parseCsv,
  parsePgss,
  parseSeat,
  parseTrace,
  poolHold,
  summarise,
} from "../../deploy/capacity-run/monitor/drainer-decompose.ts";

describe("drainer-decompose — أداةُ قياسِ الدورةِ الثالثة", () => {
  test("parseCsv يحتملُ الحقولَ المقتبسةَ ذاتَ الفواصلِ والأسطرِ والاقتباسِ المزدوج", () => {
    const rows = parseCsv(
      'calls,total_ms,query\n2,4.5,"select a, b\nfrom t where x = ""y"""\n1,1,q2\n',
    );
    expect(rows).toEqual([
      ["calls", "total_ms", "query"],
      ["2", "4.5", 'select a, b\nfrom t where x = "y"'],
      ["1", "1", "q2"],
    ]);
  });

  test("summarise: المئيناتُ والمتوسّطُ، وفارغٌ ⇒ null", () => {
    expect(summarise([])).toEqual({ n: 0, p50: null, p90: null, p99: null, mean: null });
    const s = summarise([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.n).toBe(10);
    expect(s.p50).toBe(6);
    expect(s.mean).toBe(5.5);
  });

  test("decomposeJobs يفصلُ الطابورَ عن المسارِ عن المعالجة بمفتاحِ bot+update_id", () => {
    const trace = parseTrace(
      [
        JSON.stringify({
          k: "job",
          bot: "driver",
          updateId: 1,
          claimedAt: 1100,
          startedAt: 1150,
          endedAt: 1450,
          effectCheckMs: 50,
          prepareMs: 200,
          recordMs: 50,
          kind: "contact",
          gateWaitMs: 280,
          gateHoldMs: 6,
        }),
        JSON.stringify({
          k: "job",
          bot: "driver",
          updateId: 2,
          claimedAt: 3000,
          startedAt: 3000,
          endedAt: 3100,
          kind: "text",
        }),
        JSON.stringify({
          k: "job",
          bot: "driver",
          updateId: 99,
          claimedAt: 1,
          startedAt: 1,
          endedAt: 2,
          kind: "contact",
        }),
        "not json",
      ].join("\n"),
    );
    const created = parseCreated("driver,1,1000,1450,done,1\ndriver,2,2000,3100,done,1\n");
    const d = decomposeJobs(trace, created, (j) => j.kind === "contact");
    expect(d.matched).toBe(1);
    expect(d.unmatched).toBe(1);
    expect(d.queueMs.p50).toBe(100);
    expect(d.laneMs.p50).toBe(50);
    expect(d.execMs.p50).toBe(300);
    expect(d.prepareMs.p50).toBe(200);
    expect(d.gateWaitMs.p50).toBe(280);
    expect(d.queueShareOfTotal).toBeCloseTo(100 / 450, 3);
    expect(decomposeJobs(trace, created).matched).toBe(2);
  });

  test("decomposeSweeps: الأشواطُ الفارغةُ مستبعدة، وحصّةُ الالتقاطِ من زمنِ الحائط", () => {
    const d = decomposeSweeps([
      { startedAt: 0, endedAt: 1000, claimed: 100, claimTrips: 10, claimMs: 900, truncated: true },
      {
        startedAt: 1000,
        endedAt: 2000,
        claimed: 100,
        claimTrips: 20,
        claimMs: 1000,
        truncated: true,
      },
      { startedAt: 2500, endedAt: 2510, claimed: 0, claimTrips: 2, claimMs: 5, truncated: false },
    ]);
    expect(d.active).toBe(2);
    expect(d.truncatedShare).toBe(1);
    expect(d.claimShareOfSweep).toBe(0.95);
    expect(d.claimMsPerTrip.mean).toBe(70);
    expect(d.gapBetweenSweepsMs.p50).toBe(0);
  });

  test("poolHold يجمعُ احتجازَ مجمّعٍ واحدٍ ويرتّبُ المساراتِ تنازليًّا", () => {
    const p = poolHold([
      {
        path: "a",
        pool: "ceezr:gatewayRequest",
        kind: "query",
        n: 10,
        runSumMs: 1000,
        waitSumMs: 0,
      },
      {
        path: "b",
        pool: "ceezr:gatewayRequest",
        kind: "query",
        n: 4,
        runSumMs: 3000,
        waitSumMs: 0,
      },
      { path: "c", pool: "ceezr:other", kind: "query", n: 1, runSumMs: 9000, waitSumMs: 0 },
    ]);
    expect(p.totalHoldS).toBe(4);
    expect(p.top.map((t) => t.path)).toEqual(["b", "a"]);
    expect(p.top[0]?.holdMsPerCall).toBe(750);
  });

  test("معاملُ العتاد: جملٌ ضابطةٌ فقط، وجملُ الطابورِ والالتقاطِ مستبعدة", () => {
    const head = "calls,total_ms,mean_ms,stddev_ms,max_ms,rows,query\n";
    const ref = parsePgss(
      `${head}2000,2000,1,0,1,1,select open_offer_round($1)\n2000,4000,2,0,2,1,select x from riders\n2000,3580,1.79,0,9,1,"select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result"\n2000,1400,0.7,0,1,1,select claim_and_enqueue_telegram_update($1)\n`,
    );
    const run = parsePgss(
      `${head}1500,2250,1.5,0,1,1,select open_offer_round($1)\n1500,4500,3,0,2,1,select x from riders\n1500,6000,4,0,9,1,"select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result"\n1500,9000,6,0,1,1,select claim_and_enqueue_telegram_update($1)\n`,
    );
    const ctrl = controlStatements([ref, run]);
    expect(ctrl.sort()).toEqual(["select open_offer_round($1)", "select x from riders"]);
    expect(hardwareFactor(ref, run, ctrl)).toBe(1.5);
    expect(claimMean(ref)).toBe(1.79);
    expect(claimMean(run)).toBe(4);
  });

  test("قابليّةُ المقارنة: الطرازُ نفسُه، أو المِجسّانِ ضمنَ ±10%، وإلّا NOT_COMPARABLE", () => {
    const fast = parseSeat(
      "Model name: AMD EPYC 9V45 96-Core Processor\n",
      '{"speed_probe_median_ms":256.9,"pg_probe_median_ms":219}',
    );
    const fast2 = parseSeat(
      "Model name: Intel(R) Xeon(R) 6973P-C\n",
      '{"speed_probe_median_ms":265.3,"pg_probe_median_ms":210.7}',
    );
    const slow = parseSeat(
      "Model name: AMD EPYC 7763 64-Core Processor\n",
      '{"speed_probe_median_ms":339.7,"pg_probe_median_ms":374.6}',
    );
    expect(fast.cpuModel).toBe("AMD EPYC 9V45 96-Core Processor");
    expect(comparability(fast, fast2).verdict).toBe("COMPARABLE");
    const bad = comparability(fast, slow);
    expect(bad.verdict).toBe("NOT_COMPARABLE");
    expect(bad.reasons.join(" ")).toContain("idle pg probe");
    expect(comparability(slow, slow).verdict).toBe("COMPARABLE");
    expect(comparability(parseSeat(null, null), parseSeat("Model name: X\n", null)).verdict).toBe(
      "UNKNOWN",
    );
  });
});
