/**
 * الغرض: قواعدُ عقدِ تجميعاتِ الإدارةِ المادّيّةِ — سبعُ قواعدَ تُقاسُ على **نصِّ**
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-admin-metric-snapshot-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: السّاقُ الثالثةُ من `F7-08` (النسخةُ التحليليّةُ) —
 *   حينَ تُبنى يُزادُ ههنا قيدُ «القراءةُ التحليليّةُ لا تضربُ الرئيسيّةَ»؛
 *   و`F4-06` حينَ يُفتَحُ بعدَ إغلاقِ `CAP-011`.
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لماذا حاجزٌ لهذا البندِ بعينِه
 *
 * لأنَّ عطبَ لوحةِ الإدارةِ **لا يُخفِقُ**: يُعرَضُ رقماً. فلو انقطعَ العاملُ
 * أسبوعاً لَبقيَت الشاشةُ تعملُ وتعرضُ أرقامَ الأسبوعِ الماضي بلا أنّةٍ، ولو
 * كُتِبَت نافذةُ الكاتبِ ٢٤ ونافذةُ القارئِ ١٢ لَبقيَت الشاشةُ **فارغةً
 * أبداً** بلا سطرِ خطأٍ واحدٍ، ولو صارَ «لا صفَّ لهذه المدينةِ» صفراً لَقُرِئَ
 * «لا نشاطَ» فيُتَّخَذُ قرارٌ على عَدَمٍ. وهذهِ ثلاثةُ أعطابٍ يمرُّ كلُّ واحدٍ
 * منها في `tsc` وفي المُدقِّقِ وفي كلِّ اختبارٍ لا يعرفُ أنَّه يجبُ أن يسألَ.
 *
 * ## القواعدُ السبعُ
 *
 *   ١. **لا رقمَ منشوراً بلا وَسْمِ صدقٍ**: `AdminOverviewReading` تحملُ `stamp`،
 *      و`OverviewData` تُعلِنُه **إلزاميّاً** لا `stamp?` — فالاختياريُّ يُنسى
 *      في أوّلِ مُنادٍ جديدٍ ولا يُخفِقُ المُصرِّفُ. وردُّ الواجهةِ البرمجيّةِ
 *      يحملُه كذلكَ، فما تراه العينُ في الصفحةِ يراه المُتكامِلُ في `JSON`.
 *   ٢. **النطاقُ لا يقرأُ ساعةً**: مِلفُّ النطاقِ بلا `new Date(` ولا
 *      `Date.now(` — الزمنُ **يُمرَّرُ إليه** فيُقاسُ حكمُه بلا انتظارٍ.
 *   ٣. **النافذةُ مصدرٌ واحدٌ**: نافذةُ القارئِ في البوابةِ تُسنَدُ من
 *      `ADMIN_METRIC_WINDOW_HOURS` لا من رقمٍ مكتوبٍ، وشوطُ العاملِ يُمرِّرُ
 *      الثابتَ عينَه. فافتراقُ الرقمَينِ لوحةٌ فارغةٌ بلا خطأٍ.
 *   ٤. **الجدولُ مُسجَّلٌ في القوائمِ المغلقةِ الأربعِ**: التقادُمُ والمحوُ
 *      وسجلُّ الحدودِ ووثيقةُ التدقيقِ. وغيابُ واحدةٍ جدولٌ بلا سياسةٍ.
 *   ٥. **الكادةُ في مكانٍ واحدٍ**: `refreshAdminMetrics` في `JOB_INTERVALS`،
 *      و**لا مفتاحَ إعداداتٍ للكادةِ** في المستودعِ — فالمُشغِّلُ يقرأُ
 *      `everySeconds` مرّةً عندَ البناءِ، ومفتاحٌ في القاعدةِ وعدٌ لا يُوفى.
 *   ٦. **لا اصطناعَ زمنٍ في المحوّلِ**: مخزنُ اللقطةِ بلا `new Date(` — حمولةٌ
 *      بلا `computed_at` **عطبٌ يُعلَنُ** لا فراغٌ يُرقَّعُ بساعةِ العمليّةِ.
 *   ٧. **السقوطُ الحيُّ مُعلَنٌ ومحروسٌ**: مسارُ المسحِ الحيِّ لا يُنادى إلّا
 *      خلفَ `admin_overview_live_fallback_enabled`، والإعدادُ مبذورٌ معطَّلاً.
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ
 *
 * - **لا يُثبِتُ صحّةَ رقمٍ**: يُثبِتُ غيابَ سبعِ كذباتٍ مُسمَّاةٍ. وصحّةُ
 *   العدَّاداتِ تُقاسُ على قاعدةٍ حقيقيّةٍ في
 *   `tests/integration/admin-metric-snapshots.test.ts`.
 * - **لا يقيسُ عددَ الاستعلاماتِ**: ذاكَ مقيسٌ بقاعدةٍ مُزيَّفةٍ تُسجِّلُ نصَّ
 *   كلِّ استعلامٍ في `tests/unit/admin-overview-reading.test.ts`.
 * - **لا يقرأُ دلالةَ الشِّفرةِ**: مسحٌ لفظيٌّ على نصٍّ. فمن أرادَ الاحتيالَ
 *   عليه قدرَ، ومن أرادَ الصدقَ لم يُخطئْ سهواً — وذاكَ غرضُه.
 */

/** المِلفّاتُ المقروءةُ — مكتوبةً لا مُكتشَفةً، فزيادةُ مِلفٍّ تُزادُ ههنا. */
export const DOMAIN_FILE = "packages/domain/admin/metric-snapshot.ts";
export const STORE_FILE = "packages/infrastructure/admin/metric-snapshot-store.ts";
export const QUERIES_FILE = "apps/gateway/src/admin/queries.ts";
export const OVERVIEW_FILE = "apps/admin-dashboard/src/pages/overview.ts";
export const ADMIN_API_FILE = "apps/gateway/src/routes/admin-api.ts";
export const CONTAINER_FILE = "apps/workers/src/container.ts";
export const JOB_FILE = "apps/workers/src/jobs/refresh-admin-metrics.ts";
export const RETENTION_FILE = "packages/shared/config/retention-policy.ts";
export const ERASURE_FILE = "packages/shared/config/erasure-policy.ts";
export const BOUNDARY_REGISTRY_FILE = "scripts/lib/wasla-boundary-registry.ts";
export const BOUNDARY_AUDIT_FILE = "docs/wasla/boundary-audit.md";
export const SNAPSHOT_MIGRATION_FILE =
  "supabase/migrations/20260916140000_f7_08_admin_metric_snapshots.sql";

/** اسمُ الجدولِ ومفاتيحُ إعداداتِه واسمُ الشوطِ — تُكتَبُ مرّةً وتُقرأُ في القواعدِ. */
export const TABLE_NAME = "admin_metric_snapshots";
export const WINDOW_CONSTANT = "ADMIN_METRIC_WINDOW_HOURS";
export const JOB_INTERVAL_KEY = "refreshAdminMetrics";
export const FALLBACK_SETTING_KEY = "admin_overview_live_fallback_enabled";
export const STALE_SETTING_KEY = "admin_metrics_stale_after_seconds";

/**
 * مفاتيحُ كادةٍ محظورةٌ: كلُّ صيغةٍ رأيناها تُقترَحُ لِتُقرأَ الكادةُ من
 * القاعدةِ. والحظرُ **بالاسمِ** لا بنمطٍ فضفاضٍ كي لا يُصادَ مفتاحٌ مشروعٌ.
 */
export const FORBIDDEN_CADENCE_KEYS: readonly string[] = [
  "admin_metrics_refresh_seconds",
  "admin_metrics_refresh_interval",
  "admin_metrics_cadence_seconds",
  "admin_metric_snapshots_refresh_seconds",
];

/** مِلفّاتُ المستودَعِ المعروضةُ على الحَكَمِ: مسارٌ ← نصٌّ. */
export type AdminMetricContractInput = {
  readonly files: Readonly<Record<string, string>>;
  /** كلُّ مسارٍ مقروءٍ في المستودَعِ للقاعدةِ ٥ — لا مِلفّاتُ الحكمِ وحدَها. */
  readonly repositoryTexts: Readonly<Record<string, string>>;
};

function fileOf(input: AdminMetricContractInput, path: string): string | undefined {
  return input.files[path];
}

/**
 * يحكمُ ولا يقرأُ قرصاً ولا يطبعُ ولا يُخرِجُ — كي تُزرَعَ لكلِّ قاعدةٍ حالةٌ
 * سالبةٌ في اختبارِ وحدةٍ (`ح-7`: حاجزٌ بلا حالةٍ سالبةٍ لا يُحسَبُ مفروضاً).
 */
export function adminMetricSnapshotProblems(input: AdminMetricContractInput): readonly string[] {
  const problems: string[] = [];

  const required = [
    DOMAIN_FILE,
    STORE_FILE,
    QUERIES_FILE,
    OVERVIEW_FILE,
    ADMIN_API_FILE,
    CONTAINER_FILE,
    JOB_FILE,
    RETENTION_FILE,
    ERASURE_FILE,
    BOUNDARY_REGISTRY_FILE,
    BOUNDARY_AUDIT_FILE,
    SNAPSHOT_MIGRATION_FILE,
  ];
  for (const path of required) {
    if (fileOf(input, path) === undefined) {
      problems.push(`${path}: مِلفٌّ غائبٌ — والقواعدُ تُحيلُ إليه، فغيابُه يُسقِطُ الإنفاذَ لا قاعدةً.`);
    }
  }

  const domain = fileOf(input, DOMAIN_FILE) ?? "";
  const store = fileOf(input, STORE_FILE) ?? "";
  const queries = fileOf(input, QUERIES_FILE) ?? "";
  const overview = fileOf(input, OVERVIEW_FILE) ?? "";
  const adminApi = fileOf(input, ADMIN_API_FILE) ?? "";
  const container = fileOf(input, CONTAINER_FILE) ?? "";
  const job = fileOf(input, JOB_FILE) ?? "";

  // ــ القاعدةُ ١: لا رقمَ منشوراً بلا وَسْمِ صدقٍ ــ
  if (!/interface\s+AdminOverviewReading[\s\S]{0,400}?\bstamp\s*:/.test(queries)) {
    problems.push(
      `${QUERIES_FILE}: \`AdminOverviewReading\` بلا حقلِ \`stamp\` — رقمٌ يُنشَرُ بلا عمرِه، ` +
        `وهوَ عينُ ما وُلِدَ \`CAP-011\` لِيَمنعَه.`,
    );
  }
  if (/\bstamp\?\s*:/.test(overview)) {
    problems.push(
      `${OVERVIEW_FILE}: \`stamp\` **اختياريٌّ** — والاختياريُّ يُنسى في أوّلِ مُنادٍ جديدٍ ولا ` +
        `يُخفِقُ المُصرِّفُ. يُعلَنُ إلزاميّاً كي يَحكُمَ \`tsc\` لا القارئُ.`,
    );
  }
  if (!/\bstamp\s*:\s*MetricTruthStamp/.test(overview)) {
    problems.push(
      `${OVERVIEW_FILE}: لا حقلَ \`stamp: MetricTruthStamp\` — فالصفحةُ تعرضُ أرقاماً لا يُعرَفُ عمرُها.`,
    );
  }
  if (!/\bmetrics\s*:\s*reading\.stamp/.test(adminApi)) {
    problems.push(
      `${ADMIN_API_FILE}: ردُّ \`JSON\` لا يحملُ \`metrics: reading.stamp\` — فما تراه العينُ في ` +
        `الصفحةِ لا يراه المُتكامِلُ، وهذا وسمٌ نصفُه أسوأُ من عدمِه.`,
    );
  }

  // ــ القاعدةُ ٢: النطاقُ لا يقرأُ ساعةً ــ
  for (const clock of ["new Date(", "Date.now("]) {
    if (domain.includes(clock)) {
      problems.push(
        `${DOMAIN_FILE}: يقرأُ الساعةَ بـ\`${clock}\` — والنطاقُ يُمرَّرُ إليه الزمنُ كي يُقاسَ ` +
          `حكمُه بلا انتظارٍ ولا تقلُّبٍ.`,
      );
    }
  }

  // ــ القاعدةُ ٣: النافذةُ مصدرٌ واحدٌ ــ
  const windowAssignment = queries.match(/DAY_WINDOW_HOURS\s*(?::\s*number\s*)?=\s*([^;\n]+)/);
  if (windowAssignment === null) {
    problems.push(`${QUERIES_FILE}: لا إسنادَ لـ\`DAY_WINDOW_HOURS\` — لا يُقرأُ مصدرُ النافذةِ.`);
  } else if (!windowAssignment[1]?.includes(WINDOW_CONSTANT)) {
    problems.push(
      `${QUERIES_FILE}: \`DAY_WINDOW_HOURS\` لا تُسنَدُ من \`${WINDOW_CONSTANT}\` بل من ` +
        `\`${(windowAssignment[1] ?? "").trim()}\` — وافتراقُ نافذةِ الكاتبِ عن نافذةِ القارئِ ` +
        `لوحةٌ **فارغةٌ أبداً** بلا سطرِ خطأٍ واحدٍ.`,
    );
  }
  if (!container.includes(WINDOW_CONSTANT)) {
    problems.push(
      `${CONTAINER_FILE}: شوطُ التحديثِ لا يُمرِّرُ \`${WINDOW_CONSTANT}\` — فالكاتبُ يكتبُ نافذةً ` +
        `لا يقرأُها القارئُ.`,
    );
  }

  // ــ القاعدةُ ٤: الجدولُ مُسجَّلٌ في القوائمِ المغلقةِ الأربعِ ــ
  const registries: readonly [string, string][] = [
    [RETENTION_FILE, "سياسةُ التقادُمِ"],
    [ERASURE_FILE, "سياسةُ المحوِ"],
    [BOUNDARY_REGISTRY_FILE, "سجلُّ حدودِ `wasla`"],
    [BOUNDARY_AUDIT_FILE, "وثيقةُ تدقيقِ الحدودِ"],
  ];
  for (const [path, label] of registries) {
    if (!(fileOf(input, path) ?? "").includes(TABLE_NAME)) {
      problems.push(
        `${path}: ${label} لا تذكرُ \`${TABLE_NAME}\` — جدولٌ بلا سياسةٍ يبقى بلا سياسةٍ حتّى ` +
          `يُسألَ عنه في تدقيقٍ.`,
      );
    }
  }

  // ــ القاعدةُ ٥: الكادةُ في مكانٍ واحدٍ ــ
  if (!new RegExp(`${JOB_INTERVAL_KEY}\\s*:\\s*\\d+`).test(container)) {
    problems.push(
      `${CONTAINER_FILE}: لا \`${JOB_INTERVAL_KEY}\` في \`JOB_INTERVALS\` — شوطٌ بلا كادةٍ ` +
        `مُعلَنةٍ لا يُقرأُ زمنُه في مكانٍ واحدٍ.`,
    );
  }
  for (const [path, text] of Object.entries(input.repositoryTexts)) {
    for (const key of FORBIDDEN_CADENCE_KEYS) {
      if (text.includes(key)) {
        problems.push(
          `${path}: مفتاحُ كادةٍ \`${key}\` — والمُشغِّلُ يقرأُ \`everySeconds\` **مرّةً** عندَ ` +
            `بناءِ الحاضنةِ، فمفتاحٌ في القاعدةِ وعدٌ مكتوبٌ لا يُوفى. الكادةُ في ` +
            `\`JOB_INTERVALS\` وحدَها.`,
        );
      }
    }
  }

  // ــ القاعدةُ ٦: لا اصطناعَ زمنٍ في المحوّلِ ــ
  if (store.includes("new Date(")) {
    problems.push(
      `${STORE_FILE}: يصطنعُ زمناً بـ\`new Date(\` — وحمولةٌ بلا \`computed_at\` **عطبٌ يُعلَنُ** ` +
        `لا فراغٌ يُرقَّعُ بساعةِ العمليّةِ، وإلّا نُشِرَ عمرٌ كاذبٌ.`,
    );
  }
  if (!job.includes("refreshMetricSnapshots")) {
    problems.push(`${JOB_FILE}: لا يُنادي \`refreshMetricSnapshots\` — شوطٌ لا يفعلُ ما يُسمّى به.`);
  }

  // ــ القاعدةُ ٧: السقوطُ الحيُّ مُعلَنٌ ومحروسٌ ــ
  if (!queries.includes(FALLBACK_SETTING_KEY)) {
    problems.push(
      `${QUERIES_FILE}: مسارُ المسحِ الحيِّ بلا حارسٍ \`${FALLBACK_SETTING_KEY}\` — وسقوطٌ صامتٌ ` +
        `إلى المسحِ الثقيلِ يُعيدُ عينَ الحملِ الذي وُلِدَ \`CAP-011\` لِيَنزِعَه.`,
    );
  }
  if (!queries.includes(STALE_SETTING_KEY)) {
    problems.push(
      `${QUERIES_FILE}: لا عتبةَ تقادُمٍ \`${STALE_SETTING_KEY}\` — ورقمٌ قديمٌ بلا عتبةٍ يُقرأُ حاضراً.`,
    );
  }
  const migration = fileOf(input, SNAPSHOT_MIGRATION_FILE) ?? "";
  if (!migration.includes(FALLBACK_SETTING_KEY) || !migration.includes(STALE_SETTING_KEY)) {
    problems.push(
      `${SNAPSHOT_MIGRATION_FILE}: لا تبذُرُ مفتاحَي الصدقِ (\`${STALE_SETTING_KEY}\` و` +
        `\`${FALLBACK_SETTING_KEY}\`) — وإعدادٌ غائبٌ يُقرأُ عتبةَ صفرٍ أو إذناً بلا قرارٍ.`,
    );
  }

  return problems;
}
