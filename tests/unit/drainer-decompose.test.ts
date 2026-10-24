import { describe, expect, test } from "bun:test";
import {
  AB_RULE,
  type AbSlot,
  abVerdict,
  claimMean,
  comparability,
  controlStatements,
  decomposeJobs,
  decomposeSweeps,
  hardwareFactor,
  pairedComparability,
  parseCreated,
  parseCsv,
  parseG1,
  parsePgss,
  parseSeat,
  parseSlotArgs,
  parseTrace,
  parseValid,
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

  test("pairedComparability: الطرازُ نفسُه لا يكفي — المِجسّانِ ضمنَ ±10% أيضًا، والغيابُ UNKNOWN", () => {
    const ref = { cpuModel: "EPYC 7763", idleSpeedProbeMs: 340, idlePgProbeMs: 370 };
    expect(pairedComparability(ref, { ...ref, idleSpeedProbeMs: 360 }).verdict).toBe("COMPARABLE");
    expect(pairedComparability(ref, { ...ref, idlePgProbeMs: 420 }).verdict).toBe("NOT_COMPARABLE");
    expect(pairedComparability(ref, { ...ref, cpuModel: "Xeon 8370C" }).verdict).toBe(
      "NOT_COMPARABLE",
    );
    expect(pairedComparability(ref, { ...ref, idlePgProbeMs: null }).verdict).toBe("UNKNOWN");
    expect(pairedComparability(ref, { ...ref, cpuModel: null }).verdict).toBe("UNKNOWN");
  });

  test("parseG1 وparseValid يقرآنِ صيغتَي المقعدِ ويرجعانِ null عندَ الغياب", () => {
    const wr = JSON.stringify({ gates: [{ id: "G1", value: "35.64% (4349/12203)" }] });
    expect(parseG1(wr)).toEqual({ ok: 4349, total: 12203, pct: 35.64 });
    expect(parseG1(JSON.stringify({ gates: [{ id: "G2", value: "1 (1/1)" }] }))).toBeNull();
    expect(parseG1(null)).toBeNull();
    expect(parseG1("{")).toBeNull();
    expect(parseValid('{"is_valid": true}')).toBe(true);
    expect(parseValid('{"is_valid": false}')).toBe(false);
    expect(parseValid("{}")).toBeNull();
    expect(parseValid(null)).toBeNull();
  });

  test("parseSlotArgs: تكرارُ الخانةِ ⇒ الأخيرةُ معتمَدة والسابقةُ مُستبدَلة، والصيغةُ الخاطئةُ ترمي", () => {
    const s = parseSlotArgs(["A1:/a", "B1:/b", "B1:/b-r", "A2:/c"]);
    expect(s.map((x) => [x.arm, x.pair, x.dir, x.superseded])).toEqual([
      ["A", 1, "/a", false],
      ["B", 1, "/b", true],
      ["B", 1, "/b-r", false],
      ["A", 2, "/c", false],
    ]);
    expect(() => parseSlotArgs(["C1:/x"])).toThrow();
  });

  describe("abVerdict — قاعدةُ القرارِ المسجَّلةُ مسبقًا", () => {
    const g = (pct: number) => ({ ok: Math.round(pct * 100), total: 10000, pct });
    const slots = (pairs: [number, number][], over: Partial<AbSlot>[] = []): AbSlot[] =>
      pairs.flatMap(([a, b], i) => [
        {
          arm: "A" as const,
          pair: i + 1,
          valid: true,
          comparable: "COMPARABLE" as const,
          g1: g(a),
          ...over[2 * i],
        },
        {
          arm: "B" as const,
          pair: i + 1,
          valid: true,
          comparable: "COMPARABLE" as const,
          g1: g(b),
          ...over[2 * i + 1],
        },
      ]);

    test("الثوابتُ كما سُجِّلت", () => {
      expect(AB_RULE).toEqual({ minPairs: 3, effectPp: 5, nullPp: 2 });
    });

    test("B_BETTER يتطلّبُ متوسّطًا ≥ 5 **و**كلَّ زوجٍ موجبًا", () => {
      const v = abVerdict(
        slots([
          [40, 47],
          [41, 46],
          [39, 45],
          [40, 46],
        ]),
      );
      expect(v.decision).toBe("B_BETTER");
      expect(v.meanDPp).toBe(6);
      expect(v.armG1.A.n).toBe(4);
      // متوسّطٌ كبيرٌ وزوجٌ واحدٌ سالب ⇒ ليس تحسّنًا
      expect(
        abVerdict(
          slots([
            [40, 55],
            [41, 52],
            [39, 50],
            [40, 39],
          ]),
        ).decision,
      ).toBe("UNRESOLVED");
    });

    test("B_WORSE متناظر، وNO_DETECTABLE_EFFECT عندَ |Δ| < 2، وما بينهما UNRESOLVED", () => {
      expect(
        abVerdict(
          slots([
            [40, 34],
            [41, 35],
            [39, 33],
          ]),
        ).decision,
      ).toBe("B_WORSE");
      expect(
        abVerdict(
          slots([
            [40, 41],
            [41, 40],
            [39, 40],
          ]),
        ).decision,
      ).toBe("NO_DETECTABLE_EFFECT");
      expect(
        abVerdict(
          slots([
            [40, 43],
            [41, 44],
            [39, 42],
          ]),
        ).decision,
      ).toBe("UNRESOLVED");
    });

    test("الموجةُ غيرُ الصالحةِ أو غيرُ القابلةِ للمقارنةِ تُسقِطُ زوجَها، وأقلُّ من 3 أزواجٍ ⇒ NO_VERDICT", () => {
      const v = abVerdict(
        slots(
          [
            [40, 50],
            [41, 50],
            [39, 50],
            [40, 50],
          ],
          [{}, { valid: false }, { comparable: "NOT_COMPARABLE" }, {}, {}, {}, {}, {}],
        ),
      );
      expect(v.decision).toBe("NO_VERDICT");
      expect(v.pairs.map((p) => p.pair)).toEqual([3, 4]);
      expect(v.excluded.map((e) => e.pair)).toEqual([1, 2]);
      expect(v.excluded[0]?.reason).toContain("B1 validity=false");
      expect(v.excluded[1]?.reason).toContain("A2 NOT_COMPARABLE");
      // موجةٌ بلا حكمِ صلاحيةٍ (null) لا تُحتسبُ صالحة
      expect(
        abVerdict(
          slots(
            [
              [40, 50],
              [41, 50],
              [39, 50],
            ],
            [{ valid: null }],
          ),
        ).pairs.length,
      ).toBe(2);
    });
  });
});
