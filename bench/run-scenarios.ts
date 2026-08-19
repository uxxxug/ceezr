#!/usr/bin/env bun
/**
 * الغرض: مُشغِّلُ سيناريوهاتِ العمل من سطرِ الأوامر — يُنفّذ، ويحكم، ويحفظُ الدليل.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: CI عند إتاحةِ قاعدةِ قياس، ووحداتُ الحملِ التالية.
 * ملاحظات مستقبلية: عند تعدّدِ المدن يُضاف `--city`، وعند الحملِ الكبير تُضاف نوافذُ
 *                   إطلاقٍ في `runner.ts` لا هنا.
 *
 * الاستخدام:
 *   BENCH_DATABASE_URL=postgres://… bun bench/run-scenarios.ts [--scenario id] [--actors N] [--list]
 *
 * ورمزُ الخروج معنويٌّ لا تجميليّ: أيُّ `business_failure` يُخرِج ١ — لأن المقصودَ
 * أن يوقفَ هذا المُشغّلُ بناءً يكسر نتيجةَ عمل، لا أن يطبع تقريراً جميلاً يُقرأ
 * بعد أن تصير الحالةُ خطأً في الإنتاج.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { contendedAcceptScenario } from "./scenarios/catalog/contended-accept.ts";
import { driverOnboardingScenario } from "./scenarios/catalog/driver-onboarding.ts";
import { rideDispatchScenario } from "./scenarios/catalog/ride-dispatch.ts";
import type { ScenarioDefinition } from "./scenarios/contract.ts";
import { createScenarioEnv } from "./scenarios/harness.ts";
import { formatReport, runScenario, type ScenarioReport } from "./scenarios/runner.ts";

const CATALOG: readonly ScenarioDefinition[] = [
  driverOnboardingScenario,
  rideDispatchScenario,
  contendedAcceptScenario,
];

interface CliOptions {
  readonly scenarioId: string | null;
  readonly actors: number | null;
  readonly list: boolean;
  readonly evidenceDir: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let scenarioId: string | null = null;
  let actors: number | null = null;
  let list = false;
  let evidenceDir = "docs/evidence";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--list") list = true;
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
    } else if (arg === "--evidence-dir" && next !== undefined) {
      evidenceDir = next;
      index += 1;
    } else if (arg?.startsWith("--") === true) {
      throw new Error(`وسيطٌ غيرُ معروف: ${arg}`);
    }
  }

  return { scenarioId, actors, list, evidenceDir };
}

/**
 * طابعٌ باليومِ لا بالثانية — على عُرفِ أدلّةِ المستودع (`phase2-unit4-20260819-…`).
 *
 * وتشغيلٌ ثانٍ في اليومِ نفسِه يكتب فوق الأوّل عن قصد: الدليلُ المحفوظُ في Git
 * يجب أن يكون **آخرَ** حالةٍ صحيحة، لا كومةَ تشغيلاتٍ يختار القارئُ منها ما يشاء.
 */
function stamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    for (const scenario of CATALOG) {
      process.stdout.write(
        `${scenario.id}\t${scenario.concurrency.count} فاعلاً (${scenario.concurrency.mode})\t${scenario.title}\n`,
      );
    }
    return 0;
  }

  const selected =
    options.scenarioId === null
      ? CATALOG
      : CATALOG.filter((scenario) => scenario.id === options.scenarioId);

  if (selected.length === 0) {
    process.stderr.write(
      `لا سيناريو بالمعرّف «${String(options.scenarioId)}». المتاح: ${CATALOG.map((s) => s.id).join(", ")}\n`,
    );
    return 2;
  }

  const env = await createScenarioEnv();
  const reports: ScenarioReport[] = [];
  const runStamp = stamp();

  try {
    for (const scenario of selected) {
      const report = await runScenario(env, scenario, {
        ...(options.actors === null ? {} : { actors: options.actors }),
        onEvent: (message) => process.stdout.write(`${message}\n`),
      });
      reports.push(report);
      process.stdout.write(`\n${formatReport(report)}\n`);
    }
  } finally {
    /**
     * الإغلاقُ في `finally`: سيناريوٌ يفشل في وسطه لا يجوز أن يترك اتصالاتٍ مفتوحةً
     * وخادماً يستمع — التشغيلُ التالي كان سيفشل بـ«too many clients» فيُقرأ العطبُ
     * على أنه عطبُ قاعدةٍ لا عطبُ إغلاق.
     */
    await env.close();
  }

  await mkdir(options.evidenceDir, { recursive: true });
  const jsonPath = `${options.evidenceDir}/phase2-unit5-${runStamp}-scenarios.json`;
  const textPath = `${options.evidenceDir}/phase2-unit5-${runStamp}-scenarios.txt`;

  const failures = reports.filter((report) => report.verdict === "business_failure");
  const envelope = {
    unit: "2-5",
    runStartedAt: reports[0]?.startedAt ?? new Date().toISOString(),
    scenarios: reports.length,
    businessFailures: failures.length,
    /** تصنيفُ الرقم (§10): مقيسٌ على قاعدةٍ محلّية، لا مُثبَتٌ في الإنتاج. */
    classification: "measured (local postgres, single process, mocked telegram sender)",
    reports,
  };
  await writeFile(jsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(textPath, `${reports.map(formatReport).join("\n\n")}\n`, "utf8");

  process.stdout.write(`\nالدليل: ${jsonPath}\n        ${textPath}\n`);
  process.stdout.write(
    failures.length === 0
      ? `الحكم: كلُّ السيناريوهات (${reports.length}) business_success\n`
      : `الحكم: ${failures.length} من ${reports.length} business_failure — ${failures.map((report) => report.scenarioId).join(", ")}\n`,
  );

  return failures.length === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
