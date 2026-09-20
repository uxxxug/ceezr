#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: مواردُ الرحلةِ معدودةٌ لا مُقدَّرةٌ — `ECO-004` (الزيادةُ الأولى)
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ المواردِ أو يُفرَّغَ تأكيدُه أو تُنسَخَ
 * سقوفُه أو تُرفَعَ بيدٍ — **قبلَ** أن يُشغَّلَ القياسُ. والقسمُ 17 يوجبُ أن يكونَ
 * لكلِّ رحلةٍ عددٌ معلومٌ من مواردِ القاعدةِ والطابورِ و`Redis` والنقلِ والتخزينِ؛
 * وهذا الحاجزُ يحرسُ **بقاءَ العدِّ** لا نتيجتَه: النتيجةُ تُقاسُ على بوّابةٍ
 * وقاعدةٍ وعميلِ `Redis` حقيقيَّةٍ.
 *
 * **الحالة:** `ECO-004` (الزيادةُ الأولى) — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `ECO-004` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَم من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-resource-usage-budget.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0153-resource-quantities-per-ride-are-counted-not-estimated.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الرحلةَ ضمنَ السقفِ**: ذاكَ قياسٌ على السِلكِ في
 *   `tests/integration/resource-usage-budget.test.ts`، ووجودُ هذا الحاجزِ **ليسَ**
 *   دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا يحسبُ فاتورةً**: السعرُ في فاتورةِ مزوّدِ سحابةٍ لا يملكُها
 *   المستودَعُ (`REQ-09` · `[!]`). فالمحروسُ **العددُ** وحدَه.
 * - **لا يقرأُ شبكةً ولا قاعدةً**: ساكنٌ عن قصدٍ.
 * - **لا يَدَّعي قياسَ النسخِ (Replication)**: `WAL`/`LSN` غيرُ مستقرٍّ في CI،
 *   فالزيادةُ الأولى لا تقيسُه — والحاجزُ لا يَدَّعيه.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  databaseBlockBudget,
  databaseRowBudget,
  JUDGE_RULE_NAMES,
  networkByteBudget,
  queueMessageBudget,
  RESOURCE_USAGE_TEST_FILE,
  RIDE_RESOURCE_PROFILE,
  redisCommandBudget,
  storageRowBudget,
} from "./lib/resource-usage-budget.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِه. */
const PACKAGE_FILE = "package.json";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.database-measured",
  "guard.queue-measured",
  "guard.queue-offers-measured",
  "guard.redis-instrumented",
  "guard.network-measured",
  "guard.storage-measured",
  "guard.assertion-intact",
  "guard.budget-sane",
  "guard.self-enforced",
] as const;

export type GuardRuleName = (typeof GUARD_RULE_NAMES)[number];

export interface Problem {
  readonly rule: GuardRuleName;
  readonly problem: string;
}

/**
 * مدخلاتُ التدقيقِ **محقونةٌ لا مقروءةٌ داخلَ المنطقِ**: سالبةٌ مبذورةٌ يجبُ أن
 * تُشغِّلَ هذا الحاجزَ عينَه لا نسخةً منه في ملفِّ اختبارٍ (`ح-7`).
 */
export interface AuditInputs {
  readonly measurementSource: string | null;
  readonly packageJson: string | null;
  readonly databaseRowsBudget: number;
  readonly databaseBlocksBudget: number;
  readonly queueMessagesBudget: number;
  readonly redisCommandsBudget: number;
  readonly networkBytesBudget: number;
  readonly storageRowsBudget: number;
  readonly judgeRuleCount: number;
  readonly profile: typeof RIDE_RESOURCE_PROFILE;
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** المدخلاتُ الحقيقيّةُ: القرصُ ومكتبةُ الحَكَمِ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    measurementSource: read(RESOURCE_USAGE_TEST_FILE),
    packageJson: read(PACKAGE_FILE),
    databaseRowsBudget: databaseRowBudget(),
    databaseBlocksBudget: databaseBlockBudget(),
    queueMessagesBudget: queueMessageBudget(),
    redisCommandsBudget: redisCommandBudget(),
    networkBytesBudget: networkByteBudget(),
    storageRowsBudget: storageRowBudget(),
    judgeRuleCount: JUDGE_RULE_NAMES.length,
    profile: RIDE_RESOURCE_PROFILE,
  };
}

export function auditResourceUsageBudget(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. السقوفُ والشكلُ عقلانيّانِ — حاجزٌ بلا رقمٍ صالحٍ لا يحجزُ.
  for (const [name, value] of [
    ["databaseRowsBudget", inputs.databaseRowsBudget],
    ["databaseBlocksBudget", inputs.databaseBlocksBudget],
    ["queueMessagesBudget", inputs.queueMessagesBudget],
    ["redisCommandsBudget", inputs.redisCommandsBudget],
    ["networkBytesBudget", inputs.networkBytesBudget],
    ["storageRowsBudget", inputs.storageRowsBudget],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      push("guard.budget-sane", `السقفُ «${name}» غيرُ صالحٍ: ${String(value)}`);
    }
  }
  if (inputs.judgeRuleCount === 0) {
    push("guard.budget-sane", "حكمٌ بلا قاعدةٍ واحدةٍ — لا شيءَ يُخالَفُ");
  }
  for (const [name, value] of [
    ["windowMs", inputs.profile.windowMs],
    ["heartbeatCount", inputs.profile.heartbeatCount],
    ["activeReadCount", inputs.profile.activeReadCount],
    ["inboundUpdateCount", inputs.profile.inboundUpdateCount],
    ["lifecycleTransitionCount", inputs.profile.lifecycleTransitionCount],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      push("guard.budget-sane", `شكلُ النافذةِ «${name}» بعددٍ غيرِ صالحٍ: ${String(value)}`);
    }
  }

  // ٢. ملفُّ القياسِ موجودٌ — وغيابُه يُنهي الفحصَ: ما بعدَه يُقاسُ فيه.
  const source = inputs.measurementSource;
  if (source === null) {
    push("guard.measurement-present", `ملفُّ قياسِ المواردِ غائبٌ: ${RESOURCE_USAGE_TEST_FILE}`);
    return problems;
  }

  // ٣. الحَكَمُ يُستورَدُ ولا يُعادُ بناؤُه في ملفِّ القياسِ.
  if (!/from\s+["'`][^"'`]*resource-usage-budget/.test(source)) {
    push(
      "guard.judge-imported",
      "ملفُّ القياسِ لا يستوردُ الحَكَمَ من `scripts/lib/resource-usage-budget.ts`",
    );
  }
  for (const symbol of ["judgeResourceUsage", "RIDE_RESOURCE_PROFILE"]) {
    if (!source.includes(symbol)) {
      push("guard.judge-imported", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٤. القاعدةُ مقيسةٌ: `pg_stat_database` يُقرأُ لا يُخمَّنُ.
  if (!/pg_stat_database/.test(source)) {
    push(
      "guard.database-measured",
      "ملفُّ القياسِ لا يقرأُ `pg_stat_database` — وحدّةُ القياسِ التي اختارها `DEC-18` شرطُ صدقِها",
    );
  }
  if (!/tup_returned|tup_fetched/.test(source)) {
    push(
      "guard.database-measured",
      "ملفُّ القياسِ لا يقرأُ `tup_returned` أو `tup_fetched` — الصفوفُ الممسوحةُ هيَ المقيسُ لا الزمنُ",
    );
  }

  // ٥. الطابورُ مقيسٌ: `notification_outbox` و`order_offers` يُعَدَّانِ.
  if (!/notification_outbox/.test(source)) {
    push(
      "guard.queue-measured",
      "ملفُّ القياسِ لا يعدُّ `notification_outbox` — ورسالةُ الطابورِ تكلفةُ نقلٍ مُؤجَّلةٌ",
    );
  }
  if (!/order_offers/.test(source)) {
    push(
      "guard.queue-offers-measured",
      "ملفُّ القياسِ لا يعدُّ `order_offers` — وعرضُ السائقِ رسالةُ طابورٍ مؤجَّلةٌ",
    );
  }

  // ٦. Redis مُحقونٌ ومعدودٌ: عميلٌ يَعُدُّ أوامرَه.
  if (!/redis|Redis/.test(source)) {
    push("guard.redis-instrumented", "ملفُّ القياسِ لا يذكرُ `Redis` — والأوامرُ معدودةٌ من عميلٍ مُحقونٍ");
  }

  // ٧. النقلُ الشبكيُّ مقيسٌ: بايتاتُ الردودِ والإطاراتِ.
  if (!/byteLength|content-length|Content-Length/.test(source)) {
    push(
      "guard.network-measured",
      "ملفُّ القياسِ لا يقيسُ طولَ الردودِ بالإِ بايت — والنقلُ الشبكيُّ مقيسٌ لا مُخمَّنٌ",
    );
  }

  // ٨. التخزينُ مقيسٌ: صفوفٌ مُدخَلةٌ تُعَدُّ.
  if (!/insert|INSERT|storageRowsInserted/.test(source)) {
    push("guard.storage-measured", "ملفُّ القياسِ لا يعدُّ الصفوفَ المُدخَلةَ — والتخزينُ منطقيٌّ لا فيزيائيٌّ");
  }

  // ٩. التأكيدُ لم يُفرَّغْ: قياسٌ لا يُحاكَمُ سجلٌّ لا حاجزٌ.
  if (!/expect\(\s*violations\s*\)\.toEqual\(\[\]\)/.test(source)) {
    push(
      "guard.assertion-intact",
      "ملفُّ القياسِ لا يوكِّدُ خلوَّ الحكمِ من المخالفاتِ (`expect(violations).toEqual([])`)",
    );
  }
  if (!source.includes("measured: true")) {
    push(
      "guard.assertion-intact",
      "حقائقُ القياسِ لا تُعلِنُ `measured: true` — وقياسٌ لم يُعلِنْ أنَّه جرى يُقرأُ صفراً",
    );
  }

  // ١٠. الحاجزُ يحرسُ نفسَه: حاجزٌ غيرُ موصولٍ في السلسلةِ وثيقةٌ لا بوّابةٌ.
  if (!inputs.packageJson?.includes("check-resource-usage-budget")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditResourceUsageBudget();

  if (problems.length > 0) {
    console.error("✗ عدُّ مواردِ الرحلةِ (`ECO-004`) مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        RESOURCE_USAGE_TEST_FILE +
        "` يعدُّ المواردَ على السِلكِ من حاويةٍ إنتاجيّةٍ، " +
        "ويستوردُ حَكَمَه وسقوفَه من مصادرِها الواحدةِ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ عدُّ مواردِ الرحلةِ محروسٌ (ECO-004 · الزيادةُ الأولى): ` +
      `قاعدةٌ ${databaseRowBudget()} صفّاً / ${databaseBlockBudget()} كتلةً · ` +
      `طابورٌ ${queueMessageBudget()} رسالةً · ` +
      `Redis ${redisCommandBudget()} أمراً · ` +
      `نقلٌ ${networkByteBudget()} بايتاً · ` +
      `تخزينٌ ${storageRowBudget()} صفّاً. ` +
      `${JUDGE_RULE_NAMES.length} قواعدَ حكمٍ · ${GUARD_RULE_NAMES.length} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ فاتورةٍ**: العددُ يُقاسُ على السِلكِ، والسعرُ في فاتورةِ مزوّدِ سحابةٍ (REQ-09).",
  );
}

if (import.meta.main) main();
