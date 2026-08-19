/**
 * الغرض: مشغّلُ سيناريوهات العمل — يُنفّذ الفاعلين على المسار الحقيقي، ثمّ يحكم على
 *        النتيجة **من حالةِ العمل وقاعدةِ البيانات** لا من كود HTTP.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-scenarios.ts`، وأيُّ توسيعٍ للحمل في وحداتٍ لاحقة.
 * ملاحظات مستقبلية: عند زيادةِ الفاعلين إلى آلاف، يُضاف تحديدُ التزامن (نوافذ) هنا
 *                   لا في السيناريوهات — كي يبقى ما يُقاس واحداً.
 *
 * القاعدةُ الحاكمةُ لهذا الملف: HTTP 200 ليس دليلاً. الحكمُ `business_success` لا
 * يُبنى إلّا على توكيداتِ نتيجةِ العمل وحالةِ القاعدة والانتقالاتِ والثوابتِ
 * والحتميّةِ عند التكرار وانتفاءِ شروطِ الفشل المُعلَنة. وكودُ HTTP يُجمَع ويُعرَض
 * **معلوماتياً** فقط، ولا يدخل في الحكم أصلاً — لا كمُدخَلٍ ولا كمُرجِّح.
 */

import { BENCH_TELEGRAM_ID_MIN } from "../isolation.ts";
import type {
  ActorRun,
  CheckResult,
  MockDeclaration,
  ScenarioContext,
  ScenarioDefinition,
} from "./contract.ts";
import { validateScenario } from "./contract.ts";
import { HARNESS_MOCKS, type ScenarioEnv } from "./harness.ts";
import { sumMetric } from "./metrics-text.ts";

export interface LatencySummary {
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

/**
 * تلخيصٌ نقيّ. والمائويُّ بطريقةِ «أقرب رتبة» على قائمةٍ مرتّبة — لا استيفاء:
 * الاستيفاءُ يخترع قيمةً لم تُقَس، وفي عيّناتٍ صغيرةٍ (عشراتٍ) يكون اختراعُه أكبرَ
 * من الفرق الذي يُراد قياسُه.
 */
export function summarizeLatency(samplesMs: readonly number[]): LatencySummary {
  if (samplesMs.length === 0) {
    return { count: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const at = (quantile: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
    return sorted[Math.max(0, index)] ?? 0;
  };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    meanMs: total / sorted.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

export interface HttpSummary {
  readonly requests: number;
  readonly byStatus: Readonly<Record<string, number>>;
  /** تنبيهٌ مكتوبٌ في التقرير نفسه كي لا يُقرأ الرقمُ دليلاً. */
  readonly note: string;
}

export function summarizeHttp(actors: readonly ActorRun[]): HttpSummary {
  const byStatus: Record<string, number> = {};
  let requests = 0;
  for (const actor of actors) {
    for (const status of actor.httpStatuses) {
      requests += 1;
      const key = String(status);
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
  }
  return {
    requests,
    byStatus,
    note: "معلوماتيٌّ فقط. لا يدخل في الحكم: 200 يعني أنّ الويبهوك قُبِل، لا أنّ العمل تمّ.",
  };
}

export type Verdict = "business_success" | "business_failure";

export interface VerdictDecision {
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
}

/**
 * الحكم. مُدخلاتُه: التوكيداتُ التجارية، وشروطُ الفشل التي وقعت، وأخطاءُ الفاعلين.
 * ولا يستقبل HTTP إطلاقاً — والامتناعُ عن استقباله في التوقيع نفسه أقوى من
 * الامتناعِ عن استعماله في الجسم: الأوّلُ يمنعه المُصرِّف، والثاني يمنعه الانتباه.
 */
export function decideVerdict(
  checks: readonly CheckResult[],
  triggeredFailures: readonly string[],
  actorErrors: readonly string[],
): VerdictDecision {
  const reasons: string[] = [];

  if (checks.length === 0) {
    reasons.push("لا توكيداتَ تجارية — تشغيلٌ بلا حكمٍ ليس نجاحاً.");
  }
  for (const failed of checks.filter((entry) => !entry.passed)) {
    reasons.push(`توكيدٌ فاشل [${failed.kind}] ${failed.name}: ${failed.detail}`);
  }
  for (const failure of triggeredFailures) {
    reasons.push(`شرطُ فشلٍ مُعلَنٌ وقع: ${failure}`);
  }
  for (const error of actorErrors) {
    reasons.push(`فاعلٌ أخفق: ${error}`);
  }

  return {
    verdict: reasons.length === 0 ? "business_success" : "business_failure",
    reasons,
  };
}

/** يتحقّق أنّ كلَّ معرّفٍ استُخدم يملكه القياس — حرسٌ ضدّ إصابةِ هويّةٍ حقيقية. */
export function findUnownedTelegramIds(actors: readonly ActorRun[]): readonly number[] {
  const unowned: number[] = [];
  for (const actor of actors) {
    for (const id of actor.telegramIds) {
      if (id < BENCH_TELEGRAM_ID_MIN) unowned.push(id);
    }
  }
  return unowned;
}

export interface ScenarioReport {
  readonly scenarioId: string;
  readonly title: string;
  readonly service: string;
  readonly startedAt: string;
  readonly durationMs: number;
  /** ما هُيّئ فعلاً قبل التنفيذ — لا يُقرأ رقمٌ من التقرير بلا معرفتِه. */
  readonly arranged: readonly string[];
  readonly declaration: {
    readonly initialState: readonly string[];
    readonly userInputs: readonly string[];
    readonly steps: readonly string[];
    readonly expectedSystemResponse: readonly string[];
    readonly expectedBusinessOutcome: readonly string[];
    readonly proves: readonly string[];
    readonly doesNotProve: readonly string[];
    readonly mocks: readonly MockDeclaration[];
    readonly concurrency: {
      readonly count: number;
      readonly mode: string;
      readonly rationale: string;
    };
    readonly idempotency: string;
    readonly failureConditions: readonly { readonly code: string; readonly description: string }[];
  };
  readonly actors: {
    readonly planned: number;
    readonly completed: number;
    readonly failed: number;
    readonly latency: LatencySummary;
  };
  readonly checks: readonly CheckResult[];
  readonly triggeredFailures: readonly string[];
  readonly metricsDelta: Readonly<Record<string, number>>;
  readonly http: HttpSummary;
  readonly verdict: Verdict;
  readonly reasons: readonly string[];
  /** ما يقيسه هذا التشغيل فعلاً، وما لا يقيسه — §8 من الأمر الحاكم. */
  readonly measurementScope: {
    readonly measures: readonly string[];
    readonly doesNotMeasure: readonly string[];
  };
}

export interface RunOptions {
  /** يتقدّم على `concurrency.count` المُعلَن حين يُطلَب حملٌ أصغرُ أو أكبر. */
  readonly actors?: number;
  readonly onEvent?: (message: string) => void;
}

const gather = async (
  producers: readonly (() => Promise<readonly CheckResult[]>)[],
): Promise<CheckResult[]> => {
  const results: CheckResult[] = [];
  for (const producer of producers) results.push(...(await producer()));
  return results;
};

/**
 * يُشغّل سيناريو واحداً كاملاً على بيئةٍ مُهيّأة، ويعيد تقريراً مكتفياً بنفسه.
 *
 * الترتيبُ مقصود: إعادةُ الضبطِ أوّلاً (فلا يُقاس أثرُ سيناريو في سيناريو)، ثم
 * الشروطُ الابتدائيةُ **تُفحَص لا تُفترَض**، ثم التنفيذ، ثم التوكيدات بعد اكتمالِ
 * كلِّ الفاعلين — لأن توكيداً وسط التزاحم يقيس لحظةً عابرةً لا نتيجة.
 */
export async function runScenario(
  env: ScenarioEnv,
  definition: ScenarioDefinition,
  options: RunOptions = {},
): Promise<ScenarioReport> {
  const violations = validateScenario(definition);
  if (violations.length > 0) {
    throw new Error(
      `[bench/scenarios:CONTRACT] السيناريو «${definition.id}» ناقصُ الإعلان: ` +
        violations.map((violation) => `${violation.field} (${violation.reason})`).join("، "),
    );
  }

  const emit = options.onEvent ?? ((): void => {});
  const actorCount = options.actors ?? definition.concurrency.count;
  const startedAt = new Date();
  const runStart = Bun.nanoseconds();

  await env.resetOperational();

  /**
   * خطُّ الأساسِ للعدّادات، فالمقروءُ فرقٌ لا قيمةٌ مطلقة: السجلُّ واحدٌ لكلِّ البيئة،
   * فسيناريوٌ يقرأ المطلقةَ كان سيقرأ أثرَ من سبقه ويحسبُه أثرَه.
   */
  const baseline = new Map<string, number>();

  const context: ScenarioContext = {
    sql: env.sql,
    post: env.post,
    cityId: env.cityId,
    cityCode: env.cityCode,
    messagesTo: env.messagesTo,
    allMessages: env.allMessages,
    settingNumber: env.settingNumber,
    metricDelta: (name) =>
      sumMetric(env.metrics.registry.render(), name) - (baseline.get(name) ?? 0),
  };

  let arranged: readonly string[] = [];
  if (definition.arrange !== undefined) {
    emit(`[${definition.id}] تهيئةُ حالةِ البداية…`);
    arranged = await definition.arrange(context);
    /**
     * تُمحى رسائلُ التهيئة قبل التنفيذ: لو بقيت لصارت توكيداتُ «استجابةِ النظام»
     * تعدّ رسائلَ لم يُنتجها الفاعلون، فيُقاس أثرُ التهيئةِ ويُنسب إلى السيناريو.
     */
    env.clearMessages();
  }

  emit(`[${definition.id}] الشروطُ الابتدائية…`);
  const preconditionChecks = await definition.preconditions(context);
  const brokenPreconditions = preconditionChecks.filter((entry) => !entry.passed);
  const metricsBefore = env.metrics.registry.render();
  for (const name of definition.metrics) baseline.set(name, sumMetric(metricsBefore, name));

  const actors: ActorRun[] = [];

  if (brokenPreconditions.length === 0) {
    emit(`[${definition.id}] تشغيلُ ${actorCount} فاعلاً (${definition.concurrency.mode})…`);
    const runOne = async (index: number): Promise<ActorRun> => {
      const actorStart = Bun.nanoseconds();
      try {
        const produced = await definition.runActor(context, { index });
        return {
          ...produced,
          durationMs: (Bun.nanoseconds() - actorStart) / 1e6,
          error: null,
        };
      } catch (error) {
        return {
          index,
          telegramIds: [],
          produced: {},
          httpStatuses: [],
          durationMs: (Bun.nanoseconds() - actorStart) / 1e6,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    /**
     * الفاعلون يُطلَقون معاً في النمطين. والفرقُ بين `independent` و`contended` في
     * **البيانات** لا في طريقةِ الإطلاق: هناك كلُّ فاعلٍ على مورده فيُقاس الاحتمالُ
     * والسعة، وهنا كلُّهم على موردٍ واحدٍ فتُقاس الذرّيةُ وحلُّ التسابق.
     */
    const runs = await Promise.all(
      Array.from({ length: actorCount }, (_unused, index) => runOne(index)),
    );
    actors.push(...runs);
  } else {
    emit(`[${definition.id}] أُوقِف قبل التنفيذ: شروطٌ ابتدائيةٌ غيرُ محقّقة.`);
  }

  const unowned = findUnownedTelegramIds(actors);

  const businessChecks =
    brokenPreconditions.length > 0
      ? []
      : await gather([
          () => definition.systemResponse(context, actors),
          () => definition.businessOutcome(context, actors),
          () => definition.databaseState(context, actors),
          () => definition.transitions(context, actors),
          () => definition.invariants(context, actors),
          async () => {
            emit(`[${definition.id}] فحصُ الحتميّة عند التكرار…`);
            await definition.idempotency.replay(context, actors);
            return definition.idempotency.expectation(context, actors);
          },
        ]);

  const triggeredFailures: string[] = [];
  if (brokenPreconditions.length === 0) {
    for (const condition of definition.failureConditions) {
      const detected = await condition.detect(context, actors);
      if (detected !== null) triggeredFailures.push(`${condition.code}: ${detected}`);
    }
  }
  if (unowned.length > 0) {
    triggeredFailures.push(
      `BENCH_IDENTITY_ESCAPE: معرّفاتٌ لا يملكها القياس (< ${BENCH_TELEGRAM_ID_MIN}): ${unowned.join(", ")}`,
    );
  }

  const metricsAfter = env.metrics.registry.render();
  const metricsDelta: Record<string, number> = {};
  for (const name of definition.metrics) {
    metricsDelta[name] = sumMetric(metricsAfter, name) - sumMetric(metricsBefore, name);
  }

  const allChecks = [...preconditionChecks, ...businessChecks];
  const actorErrors = actors
    .filter((actor) => actor.error !== null)
    .map((actor) => `#${actor.index}: ${actor.error ?? ""}`);
  const decision = decideVerdict(allChecks, triggeredFailures, actorErrors);

  return {
    scenarioId: definition.id,
    title: definition.title,
    service: definition.service,
    startedAt: startedAt.toISOString(),
    durationMs: (Bun.nanoseconds() - runStart) / 1e6,
    arranged,
    declaration: {
      initialState: definition.initialState,
      userInputs: definition.userInputs,
      steps: definition.steps,
      expectedSystemResponse: definition.expectedSystemResponse,
      expectedBusinessOutcome: definition.expectedBusinessOutcome,
      proves: definition.proves,
      doesNotProve: definition.doesNotProve,
      mocks: [...HARNESS_MOCKS, ...definition.mocks],
      concurrency: {
        count: actorCount,
        mode: definition.concurrency.mode,
        rationale: definition.concurrency.rationale,
      },
      idempotency: definition.idempotency.description,
      failureConditions: definition.failureConditions.map((condition) => ({
        code: condition.code,
        description: condition.description,
      })),
    },
    actors: {
      planned: actorCount,
      completed: actors.filter((actor) => actor.error === null).length,
      failed: actors.filter((actor) => actor.error !== null).length,
      latency: summarizeLatency(
        actors.filter((actor) => actor.error === null).map((actor) => actor.durationMs),
      ),
    },
    checks: allChecks,
    triggeredFailures,
    metricsDelta,
    http: summarizeHttp(actors),
    verdict: decision.verdict,
    reasons: decision.reasons,
    measurementScope: {
      measures: [
        "سلوكَ العمل على المسار الحقيقي: HTTP → سرُّ الويبهوك → المُوجِّه → الحوار → الحالة → RPC → PostgreSQL.",
        "زمنَ رحلةِ الفاعل الكاملة داخل هذه العملية (لا زمنَ الشبكة ولا زمنَ تلغرام).",
        "فرقَ العدّادات المُعلَنة قبل التشغيل وبعده.",
      ],
      doesNotMeasure: [
        "التسليمَ الحقيقيَّ عبر تلغرام ولا حدودَه (الناقلُ مزدوج).",
        "سعةَ الإنتاج: قاعدةٌ محلّيةٌ على نفس المُضيف، وعاملٌ دوريٌّ مُطفأ، وحدُّ معدّلٍ مرفوع.",
        "زمنَ الشبكة بين العميل والخادم: الطلبُ يُمرَّر إلى `app.fetch` في العملية نفسها.",
      ],
    },
  };
}

/** تقريرٌ بشريٌّ مختصر — يُطبَع في الطرفية ويُحفَظ نصّاً مع الدليل. */
export function formatReport(report: ScenarioReport): string {
  const lines: string[] = [];
  const mark = (passed: boolean): string => (passed ? "✅" : "❌");

  lines.push(`── ${report.scenarioId} · ${report.title}`);
  lines.push(`   الخدمة: ${report.service} · المدّة: ${report.durationMs.toFixed(0)}ms`);
  for (const entry of report.arranged) lines.push(`   تهيئة: ${entry}`);
  lines.push(
    `   الفاعلون: ${report.actors.completed}/${report.actors.planned} أتمّوا` +
      ` · p50=${report.actors.latency.p50Ms.toFixed(1)}ms` +
      ` p95=${report.actors.latency.p95Ms.toFixed(1)}ms` +
      ` max=${report.actors.latency.maxMs.toFixed(1)}ms`,
  );
  lines.push("   التوكيدات:");
  for (const entry of report.checks) {
    lines.push(`     ${mark(entry.passed)} [${entry.kind}] ${entry.name} — ${entry.detail}`);
  }
  if (Object.keys(report.metricsDelta).length > 0) {
    lines.push("   فرقُ العدّادات:");
    for (const [name, delta] of Object.entries(report.metricsDelta)) {
      lines.push(`     ${name} +${delta}`);
    }
  }
  lines.push(
    `   HTTP (معلوماتيّ): ${report.http.requests} طلباً · ` +
      Object.entries(report.http.byStatus)
        .map(([status, count]) => `${status}×${count}`)
        .join(" "),
  );
  if (report.triggeredFailures.length > 0) {
    lines.push("   شروطُ فشلٍ وقعت:");
    for (const failure of report.triggeredFailures) lines.push(`     ⚠ ${failure}`);
  }
  lines.push(`   الحكم: ${report.verdict === "business_success" ? "✅ نجاحُ عمل" : "❌ إخفاقُ عمل"}`);
  for (const reason of report.reasons) lines.push(`     • ${reason}`);
  return lines.join("\n");
}
