#!/usr/bin/env bun
/**
 * الغرض: مُشغِّلُ التحقّقِ الموزَّع (وحدة 2-6) — يُقلع عنقوداً متعدّدَ العمليات لكلِّ
 *        سيناريو، يُعيد سيناريوهاتِ وحدة 2-5 كما هي عبرَه، يشغّل السيناريوهاتِ التي
 *        لا معنى لها إلّا موزَّعةً، ثم يحكم ويحفظُ الدليل.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: مرحلةُ Rate-Controlled Capacity Discovery (بعدَ هذه الوحدة).
 * ملاحظات مستقبلية: عندَ رفعِ عددِ البوّاباتِ فوقَ اثنتين يكفي `--gateways`؛ ولا يُبنى
 *   حكمٌ جديدٌ هنا — الحكمُ كلُّه في `bench/scenarios/runner.ts` عن قصد.
 *
 * الاستخدام:
 *   BENCH_DATABASE_URL=postgres://… bun bench/run-distributed.ts [--scenario id] [--actors N] [--list]
 *
 * ولماذا عنقودٌ جديدٌ لكلِّ سيناريو؟ لأنّ أحدَها يقتل بوّابةً قسراً. وإعادةُ استخدامِ
 * عنقودٍ نصفِ ميّتٍ في السيناريو التالي كانت ستُنتج نتائجَ صحيحةً لسببٍ غيرِ الذي
 * يظنّه القارئ — وهذا أسوأُ من الفشلِ الصريح.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { contendedAcceptScenario } from "./scenarios/catalog/contended-accept.ts";
import { driverOnboardingScenario } from "./scenarios/catalog/driver-onboarding.ts";
import { rideDispatchScenario } from "./scenarios/catalog/ride-dispatch.ts";
import type { ScenarioDefinition } from "./scenarios/contract.ts";
import { formatReport, runScenario, type ScenarioReport } from "./scenarios/runner.ts";
import { type Cluster, startCluster } from "./topology/cluster.ts";
import { type ProbeReport, probeSharedSessionStore } from "./topology/probes.ts";
import { createCrossProcessReplayScenario } from "./topology/scenarios/cross-process-replay.ts";
import { createGatewayDeathScenario } from "./topology/scenarios/gateway-death.ts";
import { runWorkerDuel } from "./topology/worker-duel.ts";

interface DistributedScenario {
  readonly id: string;
  readonly title: string;
  /** مصنعٌ لأنّ بعضَ السيناريوهاتِ تحتاج العنقودَ نفسَه (توجيهٌ صريحٌ أو قتلُ عملية). */
  readonly build: (cluster: Cluster) => ScenarioDefinition;
  /** هل أُعيدَ من وحدة 2-5 كما هو بلا تعديلِ حرفٍ واحد؟ يُسجَّل في الدليل. */
  readonly reusedFromUnit5: boolean;
}

const SCENARIOS: readonly DistributedScenario[] = [
  {
    id: driverOnboardingScenario.id,
    title: driverOnboardingScenario.title,
    build: () => driverOnboardingScenario,
    reusedFromUnit5: true,
  },
  {
    id: rideDispatchScenario.id,
    title: rideDispatchScenario.title,
    build: () => rideDispatchScenario,
    reusedFromUnit5: true,
  },
  {
    id: contendedAcceptScenario.id,
    title: contendedAcceptScenario.title,
    build: () => contendedAcceptScenario,
    reusedFromUnit5: true,
  },
  {
    id: "cross-process-replay",
    title: "إعادةُ نفسِ التحديثِ إلى عمليةٍ أخرى",
    build: createCrossProcessReplayScenario,
    reusedFromUnit5: false,
  },
  {
    id: "gateway-death-midflight",
    title: "موتُ بوّابةٍ قسراً وسطَ المسار",
    build: createGatewayDeathScenario,
    reusedFromUnit5: false,
  },
];

interface CliOptions {
  readonly scenarioId: string | null;
  readonly actors: number | null;
  readonly list: boolean;
  readonly gateways: number;
  readonly evidenceDir: string;
  readonly probes: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let scenarioId: string | null = null;
  let actors: number | null = null;
  let list = false;
  let gateways = 2;
  let evidenceDir = "docs/evidence";
  let probes = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--list") list = true;
    else if (arg === "--no-probes") probes = false;
    else if (arg === "--scenario" && next !== undefined) {
      scenarioId = next;
      index += 1;
    } else if (arg === "--actors" && next !== undefined) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`--actors يجب أن يكون عدداً موجباً، ووصل: ${next}`);
      }
      actors = parsed;
      index += 1;
    } else if (arg === "--gateways" && next !== undefined) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 2) {
        throw new Error(
          `--gateways يجب أن يكون اثنتين أو أكثر — عمليةٌ واحدةٌ ليست توزيعاً. ووصل: ${next}`,
        );
      }
      gateways = parsed;
      index += 1;
    } else if (arg === "--evidence-dir" && next !== undefined) {
      evidenceDir = next;
      index += 1;
    } else if (arg?.startsWith("--") === true) {
      throw new Error(`وسيطٌ غيرُ معروف: ${arg}`);
    }
  }

  return { scenarioId, actors, list, gateways, evidenceDir, probes };
}

/** طابعٌ باليومِ على عُرفِ أدلّةِ المستودع؛ وتشغيلٌ ثانٍ في اليومِ يكتب فوق الأوّل عن قصد. */
function stamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * مبعدةُ منافذَ لكلِّ سيناريو: عنقودٌ أُقلِع وأُوقِف يترك منافذَه في `TIME_WAIT`،
 * فإعادةُ استخدامِ نفسِ المنفذِ فوراً تُفشل الإقلاعَ لسببٍ لا علاقةَ له بالمقيس.
 */
const PORT_BASE = 4501;
const PORT_STRIDE = 10;

function formatProbe(probe: ProbeReport): string {
  const lines: string[] = [`── ${probe.id} · ${probe.title}`];
  for (const line of probe.topology) lines.push(`   طبولوجيا: ${line}`);
  for (const note of probe.notes) lines.push(`   ملاحظة: ${note}`);
  lines.push("   التوكيدات:");
  for (const result of probe.checks) {
    lines.push(
      `     ${result.passed ? "✅" : "❌"} [${result.kind}] ${result.name} — ${result.detail}`,
    );
  }
  const failed = probe.checks.filter((result) => !result.passed).length;
  lines.push(`   الحكم: ${failed === 0 ? "✅ نجاحُ عمل" : `❌ ${failed} توكيداً فاشلاً`}`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    for (const scenario of SCENARIOS) {
      process.stdout.write(
        `${scenario.id}\t${scenario.reusedFromUnit5 ? "مُعادٌ من 2-5" : "موزَّعٌ جديد"}\t${scenario.title}\n`,
      );
    }
    process.stdout.write("probe:shared-session-negative-control\tضبطٌ سالب\tمخزنُ الجلساتِ المشترك\n");
    process.stdout.write("probe:worker-duel\tازدواجُ عاملين\tالقفلُ الاستشاريُّ عبرَ عمليتين\n");
    return 0;
  }

  const selected =
    options.scenarioId === null
      ? SCENARIOS
      : SCENARIOS.filter((scenario) => scenario.id === options.scenarioId);

  if (selected.length === 0) {
    process.stderr.write(
      `لا سيناريو بالمعرّف «${String(options.scenarioId)}». المتاح: ${SCENARIOS.map((s) => s.id).join(", ")}\n`,
    );
    return 2;
  }

  const reports: ScenarioReport[] = [];
  /**
   * توزيعُ الضغطاتِ على النسخِ يُحفَظ مع كلِّ سيناريو: بلا هذا الجدولِ يبقى ادّعاءُ
   * «المتنافسون موزَّعون على عملياتٍ مختلفة» كلاماً — والقارئُ لا يستطيع التحقّق.
   */
  const routings: Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>> = {};
  const probeReports: ProbeReport[] = [];
  const runStamp = stamp();

  for (const [index, scenario] of selected.entries()) {
    const cluster = await startCluster({
      gateways: options.gateways,
      sessionStore: "redis",
      basePort: PORT_BASE + index * PORT_STRIDE,
    });
    try {
      const report = await runScenario(cluster, scenario.build(cluster), {
        ...(options.actors === null ? {} : { actors: options.actors }),
        onEvent: (message) => process.stdout.write(`${message}\n`),
      });
      reports.push(report);
      routings[scenario.id] = cluster.routing();
      process.stdout.write(`\n${formatReport(report)}\n`);
      process.stdout.write(
        `   توزيعُ الطلباتِ على النسخ: ${JSON.stringify(routings[scenario.id])}\n`,
      );
    } finally {
      await cluster.stop();
    }
  }

  if (options.probes && options.scenarioId === null) {
    const sessionProbe = await probeSharedSessionStore();
    probeReports.push(sessionProbe);
    process.stdout.write(`\n${formatProbe(sessionProbe)}\n`);

    const duel = await runWorkerDuel();
    const duelProbe: ProbeReport = {
      id: "worker-duel",
      title: "عاملان في عمليتين على نفسِ المهامّ: القفلُ الاستشاريُّ في القاعدة",
      checks: duel.checks,
      topology: duel.topology,
      notes: duel.raw,
    };
    probeReports.push(duelProbe);
    process.stdout.write(`\n${formatProbe(duelProbe)}\n`);
  }

  await mkdir(options.evidenceDir, { recursive: true });
  const jsonPath = `${options.evidenceDir}/phase2-unit6-${runStamp}-distributed.json`;
  const textPath = `${options.evidenceDir}/phase2-unit6-${runStamp}-distributed.txt`;

  const scenarioFailures = reports.filter((report) => report.verdict === "business_failure");
  const probeFailures = probeReports.filter((probe) =>
    probe.checks.some((result) => !result.passed),
  );

  const envelope = {
    unit: "2-6",
    runStartedAt: reports[0]?.startedAt ?? new Date().toISOString(),
    gateways: options.gateways,
    scenarios: reports.length,
    businessFailures: scenarioFailures.length,
    probes: probeReports.length,
    probeFailures: probeFailures.length,
    /**
     * تصنيفُ الرقم (§10): مقيسٌ على عنقودٍ محلّيٍّ متعدّدِ العمليات، بمزدوجِ Redis
     * وبمُرسِلِ تلغرام مزدوج. لا شيءَ هنا «مُثبَتٌ في الإنتاج»، ولا شيءَ هنا قياسُ سعة.
     */
    classification:
      "measured (local multi-process cluster: real HTTP + real postgres + redis shim + mocked telegram sender; NOT capacity, NOT production)",
    reusedFromUnit5: selected.filter((scenario) => scenario.reusedFromUnit5).map((s) => s.id),
    routings,
    reports,
    probeReports,
  };
  await writeFile(jsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(
    textPath,
    `${[
      ...reports.map(
        (report) =>
          `${formatReport(report)}\n   توزيعُ الطلباتِ على النسخ: ${JSON.stringify(routings[report.scenarioId] ?? {})}`,
      ),
      ...probeReports.map(formatProbe),
    ].join("\n\n")}\n`,
    "utf8",
  );

  process.stdout.write(`\nالدليل: ${jsonPath}\n        ${textPath}\n`);
  const totalFailures = scenarioFailures.length + probeFailures.length;
  process.stdout.write(
    totalFailures === 0
      ? `الحكم: ${reports.length} سيناريو و${probeReports.length} فحصاً — كلُّها business_success\n`
      : `الحكم: ${totalFailures} فشلاً — ${[...scenarioFailures.map((r) => r.scenarioId), ...probeFailures.map((p) => p.id)].join(", ")}\n`,
  );

  return totalFailures === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
