/**
 * الغرض: LOAD-01M (الدورةُ الرابعة) — أداةُ الخطِّ الزمنيِّ لكلِّ وظيفة (monitor/job-timeline.ts):
 *   الربطُ والأطوار، والفصلُ بالنوع، والتأخّرُ والمهل، ومؤشّرُ Jain، وإشغالُ مجمّعِ gatewayRequest،
 *   وفحصُ المولّدِ المختلط، وقاعدةُ اتّجاهِ الآليّةِ المسجَّلةُ مسبقًا. أداةُ قياسٍ لا سلوكَ منتج.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  buildTimelines,
  fairness,
  GATEWAY_REQUEST_SEATS,
  jain,
  kindReport,
  MECH_RULE,
  MIXED_RULE,
  mechanismPairs,
  mixedValidity,
  parseJobs,
  parseMixed,
  parseTrace,
  poolWait,
  type WaveTimeline,
} from "../../deploy/capacity-run/monitor/job-timeline.ts";

const csv = [
  "driver,1,1000,9000,done,1,contact",
  "driver,2,1000,30000,done,1,command",
  "driver,3,2000,,pending,0,message",
  "driver,4,1000,5000,done,2",
].join("\n");

const trace = [
  {
    k: "job",
    bot: "driver",
    updateId: 1,
    kind: "contact",
    claimedAt: 3000,
    startedAt: 3100,
    endedAt: 3500,
    ok: true,
    gateWaitMs: 50,
    claimTripMs: 4.5,
    claimBatch: 2,
  },
  {
    k: "job",
    bot: "driver",
    updateId: 2,
    kind: "command",
    claimedAt: 26000,
    startedAt: 26000,
    endedAt: 26400,
    ok: true,
  },
  {
    k: "job",
    bot: "driver",
    updateId: 4,
    kind: "message",
    claimedAt: 1500,
    startedAt: 1500,
    endedAt: 1600,
    ok: false,
  },
  {
    k: "job",
    bot: "driver",
    updateId: 4,
    kind: "message",
    claimedAt: 4000,
    startedAt: 4000,
    endedAt: 4200,
    ok: true,
  },
  {
    k: "reply",
    bot: "driver",
    updateId: 1,
    path: "pool",
    submittedAt: 3500,
    startedAt: 3600,
    endedAt: 3900,
    sent: 1,
    total: 1,
    outcome: "done",
    error: false,
  },
  {
    k: "reply",
    bot: "driver",
    updateId: 2,
    path: "overflow",
    submittedAt: 26400,
    startedAt: null,
    endedAt: null,
    sent: 0,
    total: 1,
    outcome: null,
    error: false,
  },
  {
    k: "reply",
    bot: "driver",
    updateId: 2,
    path: "background",
    submittedAt: 28000,
    startedAt: 28000,
    endedAt: 28500,
    sent: 1,
    total: 1,
    outcome: "done",
    error: false,
  },
  {
    k: "db",
    at: 10000,
    pool: "ceezr:gatewayRequest",
    kind: "query",
    n: 10,
    waitSumMs: 100,
    runSumMs: 20000,
  },
  {
    k: "db",
    at: 15000,
    pool: "ceezr:gatewayRequest",
    kind: "query",
    n: 10,
    waitSumMs: 300,
    runSumMs: 25000,
  },
  { k: "db", at: 15000, pool: "other", kind: "query", n: 99, waitSumMs: 9, runSumMs: 9 },
  {
    k: "pdb",
    at: 15000,
    path: "drainer:job:driver:contact",
    pool: "ceezr:gatewayRequest",
    kind: "query",
    n: 5,
    waitSumMs: 100,
    runSumMs: 10,
    waitP95Ms: 30,
  },
  {
    k: "pdb",
    at: 15000,
    path: "http:POST /v1/x",
    pool: "ceezr:gatewayRequest",
    kind: "query",
    n: 5,
    waitSumMs: 300,
    runSumMs: 10,
    waitP95Ms: 80,
  },
  "not json",
]
  .map((o) => (typeof o === "string" ? o : JSON.stringify(o)))
  .join("\n");

describe("job-timeline — الخطُّ الزمنيُّ لكلِّ وظيفة", () => {
  const rows = parseJobs(csv);
  const t = parseTrace(trace);
  const tl = buildTimelines(rows, t);

  test("العمودُ السابعُ اختياريّ، وdone الفارغُ null", () => {
    expect(rows).toHaveLength(4);
    expect(rows[2]?.doneMs).toBeNull();
    expect(rows[3]?.kind).toBeNull();
    expect(t.jobs).toHaveLength(4);
    expect(t.replies).toHaveLength(3);
  });

  test("الأطوار: queue/claim/lane/exec/finish/sendWait/send/reply", () => {
    const c = tl[0];
    expect(c).toMatchObject({
      kind: "contact",
      queueMs: 2000,
      claimMs: 4.5,
      laneMs: 100,
      execMs: 400,
      gateWaitMs: 50,
      finishMs: 2500,
      sendWaitMs: 100,
      sendMs: 300,
      replyMs: 2900,
      replyPath: "pool",
      overflowed: false,
    });
    // الامتلاءُ ثمّ الخلفيّ: لا sendWait (لم يبدأ فوريًّا)، والوصولُ من الخلفيّ.
    expect(tl[1]).toMatchObject({
      overflowed: true,
      sendWaitMs: null,
      replyPath: "background",
      replyMs: 27500,
    });
    // لم يُلتقَط: أطوارٌ null، والنوعُ من CSV.
    expect(tl[2]).toMatchObject({ kind: "message", queueMs: null, execMs: null });
    // المحاولةُ الناجحةُ هي المعتمَدة، والنوعُ من الأثرِ حينَ يغيبُ من CSV.
    expect(tl[3]).toMatchObject({ kind: "message", queueMs: 3000, attempts: 2 });
  });

  test("التأخّرُ على المهلةِ المرجعيّة: المتأخّرُ المختومُ + غيرُ المختوم", () => {
    const r = kindReport("all", tl, 2600);
    expect(r.n).toBe(4);
    expect(r.notDone).toBe(1);
    // finish: 2500 (لا) · 25400 (نعم) · null-pending (غيرُ مختوم) · 3200 (نعم)
    expect(r.late.lateFinish).toBe(3);
    expect(r.late.lateFinishPct).toBe(75);
    expect(r.untraced).toBe(1);
    expect(r.overflowed).toBe(1);
    expect(r.replyPaths).toEqual({ pool: 1, background: 1 });
    expect(r.maxQueueMs).toBe(25000);
  });

  test("Jain: 1 للتساوي، و1/n لأقصى تفاوت، وnull لأقلَّ من عنصرين", () => {
    expect(jain([5, 5, 5])).toBe(1);
    expect(jain([1, 0, 0, 0])).toBe(0.25);
    expect(jain([7])).toBeNull();
    expect(jain([0, 0])).toBe(1);
  });

  test("العدالة: الأنواعُ التي بلغَت minN وحدَها، ونسبةُ الوسيطِ إلى العامّ", () => {
    const reports = ["contact", "message"].map((k) =>
      kindReport(
        k,
        tl.filter((x) => x.kind === k),
      ),
    );
    const f = fairness(reports, kindReport("all", tl), 1);
    expect(f.kindsCounted).toEqual(["contact", "message"]);
    expect(f.jainQueueMean).not.toBeNull();
    expect(fairness(reports, kindReport("all", tl), 30).jainQueueMean).toBeNull();
  });

  test("مجمّعُ gatewayRequest: الإشغالُ على المقاعدِ المحميّة، ونصيبُ الكنّاسِ من الانتظار", () => {
    const p = poolWait(t);
    expect(p.seats).toBe(GATEWAY_REQUEST_SEATS);
    expect(GATEWAY_REQUEST_SEATS).toBe(5);
    expect(p.windows).toBe(2);
    expect(p.windowMs).toBe(5000);
    // 20000/(5000·5)=0.8 ، 25000/(5000·5)=1.0
    expect(p.occupancy.p50).toBe(1);
    expect(p.saturatedWindows).toBe(1);
    expect(p.totalWaitS).toBe(0.4);
    expect(p.drainerWaitShare).toBe(0.25);
    expect(p.byPath[0]?.path).toBe("http:POST /v1/x");
  });

  test("المولّدُ المختلط: المخطَّطُ والمرسَلُ و2xx والتأخّرُ عن الجدول", () => {
    const m = parseMixed(
      [
        { k: "plan", n: 3 },
        { k: "sent", kind: "command", plannedAt: 0, sentAt: 5, status: 200 },
        { k: "sent", kind: "message", plannedAt: 50, sentAt: 60, status: 429 },
        { k: "skipped", kind: "message" },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n"),
    );
    expect(m).toMatchObject({
      planned: 3,
      sent: 2,
      ok2xx: 1,
      skipped: 1,
      byKind: { command: 1, message: 1 },
    });
    expect(parseMixed(null)).toBeNull();
  });

  test("قاعدةُ الآليّة: ≥3 أزواجٍ متّفقة ووسيطٌ خارجَ [0.9، 1.1]", () => {
    expect(MECH_RULE.minAgree).toBe(3);
    const w = (x: number) => ({ x }) as unknown as WaveTimeline;
    const pick = (v: WaveTimeline) => (v as unknown as { x: number }).x;
    const lower = mechanismPairs(
      [
        { a: w(10), b: w(5) },
        { a: w(10), b: w(6) },
        { a: w(10), b: w(7) },
        { a: w(10), b: w(12) },
      ],
      pick,
    );
    expect(lower.direction).toBe("B_LOWER");
    const mixed = mechanismPairs(
      [
        { a: w(10), b: w(5) },
        { a: w(10), b: w(15) },
        { a: w(10), b: w(9.5) },
        { a: w(10), b: w(12) },
      ],
      pick,
    );
    expect(mixed.direction).toBe("UNDECIDED");
    const near = mechanismPairs(
      [
        { a: w(10), b: w(9.5) },
        { a: w(10), b: w(9.6) },
        { a: w(10), b: w(9.7) },
      ],
      pick,
    );
    expect(near.direction).toBe("UNDECIDED");
  });

  test("صلاحيّةُ الحِملِ المختلط: الكلُّ مُرسَلٌ، و2xx ≥ 99%، وp99 التأخّرِ ≤ 1000ms", () => {
    expect(MIXED_RULE).toEqual({ minOkShare: 0.99, maxLagP99Ms: 1000 });
    const lines = (n: number, lag: number, bad = 0) =>
      [
        { k: "plan", n },
        ...Array.from({ length: n }, (_, i) => ({
          k: "sent",
          kind: "command",
          plannedAt: i,
          sentAt: i + lag,
          status: i < bad ? 0 : 200,
        })),
      ]
        .map((o) => JSON.stringify(o))
        .join("\n");
    expect(mixedValidity(parseMixed(lines(200, 5))).valid).toBe(true);
    expect(mixedValidity(parseMixed(lines(200, 1500))).valid).toBe(false);
    expect(mixedValidity(parseMixed(lines(200, 5, 3))).reasons[0]).toContain("2xx");
    const skipped = `${lines(3, 5)}\n${JSON.stringify({ k: "skipped", kind: "message" })}`;
    expect(mixedValidity(parseMixed(skipped.replace('"n":3', '"n":4'))).valid).toBe(false);
    expect(mixedValidity(null).valid).toBe(false);
  });
});
