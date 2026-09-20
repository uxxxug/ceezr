#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: حسّاسيّةُ شكلِ التكلفةِ عندَ ١٠x من الحجمِ — `ECO-008` (الشقُّ المملوكُ للمستودَعِ)
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ الحسّاسيّةِ أو يُفرَّغَ تأكيدُهُ أو تُنسَخَ
 * سقوفُه الحجميّةُ أو يُكتبَ سقفٌ يدويٌّ أرخى أو تتحوَّلَ النافذةُ إلى تزامنٍ يُدَّعى
 * حملاً — **قبلَ** أن يُشغَّلَ القياسُ. والقسمُ 17 يسألُ في `ECO-008` ماذا يحدثُ
 * للتكلفةِ عندَ 10x من الحملِ؛ وهذا الحاجزُ يحرسُ **بقاءَ سؤالِ الشكلِ مجاباً
 * بعددٍ** لا نتيجتَه: النتيجةُ تُقاسُ على بوّابةٍ وقاعدةٍ حقيقيّةٍ.
 *
 * **الحالة:** `ECO-008` (الشقُّ المملوكُ للمستودَعِ) — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `ECO-008` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَم من:** سلسلةُ `bun run ci` · خطواتٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-cost-sensitivity.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0156-cost-shape-sensitivity-at-10x-volume-is-measured-not-assumed.md`
 *
 * **ما لا يفعلهُ هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الشكلَ خطّيٌّ**: ذاكَ قياسٌ على السِلكِ في
 *   `tests/integration/cost-sensitivity.test.ts`، ووجودُ هذا الحاجزِ **ليسَ** دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا يحسبُ فاتورةً ولا يدَّعي قياسَ سعةٍ أو حملٍ**: السعرُ في
 *   فاتورةِ مزوّدِ سحابةٍ لا يملكُها المستودَعُ (`REQ-09` · `[!]`)، والسعةُ عملُ
 *   مختبرِ النشرِ (`DEC-17`).
 * - **لا يقرأُ شبكةً ولا قاعدةً**: ساكنٌ عن قصدٍ.
 * - **لا يُعدِّلُ سقوفَ `ECO-004` ولا ينسخُها**: يتحقَّقُ أنَّها تُستورَدُ من
 *   مصدرِها الواحدِ فحسبُ.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  COST_SENSITIVITY_TEST_FILE,
  JUDGE_RULE_NAMES,
  RIDE_BUDGET_MODULE,
  SENSITIVITY_VOLUME_MULTIPLIER,
  volumeBudgets,
} from "./lib/cost-sensitivity.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِهِ. */
const PACKAGE_FILE = "package.json";

/** الحَكَمُ النقيُّ — مصدرُ السقوفِ الحجميّةِ المُشتقّةِ. */
const JUDGE_FILE = "scripts/lib/cost-sensitivity.ts";

/** سقوفُ الرحلةِ الواحدةِ — المصدرُ الواحدُ الذي يُستورَدُ ولا يُنسَخُ. */
const RIDE_BUDGET_FILE = "scripts/lib/resource-usage-budget.ts";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةً لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.budgets-single-sourced",
  "guard.volume-measured",
  "guard.sequential-only",
  "guard.database-measured",
  "guard.queue-measured",
  "guard.queue-offers-measured",
  "guard.redis-instrumented",
  "guard.network-measured",
  "guard.storage-measured",
  "guard.assertion-intact",
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
  readonly judgeSource: string | null;
  readonly rideBudgetSource: string | null;
  readonly packageJson: string | null;
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** المدخلاتُ الحقيقيّةُ: القرصُ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    measurementSource: read(COST_SENSITIVITY_TEST_FILE),
    judgeSource: read(JUDGE_FILE),
    rideBudgetSource: read(RIDE_BUDGET_FILE),
    packageJson: read(PACKAGE_FILE),
  };
}

export function auditCostSensitivity(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. ملفُّ القياسِ موجودٌ — وغيابُهُ يُنهي الفحصَ: ما بعدَهُ يُقاسُ فيهِ.
  const source = inputs.measurementSource;
  if (source === null) {
    push("guard.measurement-present", `ملفُّ قياسِ الحسّاسيّةِ غائبٌ: ${COST_SENSITIVITY_TEST_FILE}`);
    return problems;
  }

  // ٢. الحَكَمُ يُستورَدُ ولا يُعادُ بناؤُه في ملفِّ القياسِ — والسقوفُ الحجميّةُ منهُ.
  if (!/from\s+["'`][^"'`]*cost-sensitivity/.test(source)) {
    push("guard.judge-imported", "ملفُّ القياسِ لا يستوردُ الحَكَمَ من `scripts/lib/cost-sensitivity.ts`");
  }
  for (const symbol of ["judgeCostSensitivity", "volumeBudgets", "SENSITIVITY_VOLUME_MULTIPLIER"]) {
    if (!source.includes(symbol)) {
      push("guard.judge-imported", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٣. مصدرُ السقوفِ واحدٌ: الحَكَمُ النقيُّ يستوردُ سقوفَ الرحلةِ من `ECO-004`
  //    لا يعيدُ كتابتَها — ومن نسخَ رقمَ سقفٍ رقماً كسرَ وحدةَ مصدرِ الحقيقةِ.
  const judge = inputs.judgeSource;
  if (judge === null) {
    push("guard.budgets-single-sourced", `الحَكَمُ النقيُّ غائبٌ: ${JUDGE_FILE}`);
  } else {
    if (
      !judge.includes(`from "./${RIDE_BUDGET_MODULE}"`) &&
      !judge.includes(`from './${RIDE_BUDGET_MODULE}'`)
    ) {
      push(
        "guard.budgets-single-sourced",
        "الحَكَمُ النقيُّ لا يستوردُ سقوفَ الرحلةِ الواحدةِ من `scripts/lib/resource-usage-budget.ts` — والنسخُ يُنشئُ مصدرَ حقيقةٍ ثانياً",
      );
    }
    for (const fn of [
      "databaseRowBudget",
      "databaseBlockBudget",
      "queueMessageBudget",
      "redisCommandBudget",
      "networkByteBudget",
      "storageRowBudget",
    ]) {
      if (!judge.includes(fn)) {
        push("guard.budgets-single-sourced", `الحَكَمُ النقيُّ لا يشتقُّ سقفَهُ من \`${fn}\``);
      }
    }
  }
  const rideBudget = inputs.rideBudgetSource;
  if (rideBudget === null) {
    push("guard.budgets-single-sourced", `مصدرُ سقوفِ الرحلةِ غائبٌ: ${RIDE_BUDGET_FILE}`);
  }
  // السقوفُ الحجميّةُ الفعليّةُ — للطباعةِ والتحقُّقِ العقلانيِّ لا للحكمِ.
  const budgets = volumeBudgets();
  for (const [name, value] of Object.entries(budgets)) {
    if (!Number.isInteger(value) || value <= 0) {
      push("guard.budgets-single-sourced", `السقفُ الحجميُّ «${name}» غيرُ صالحٍ: ${String(value)}`);
    }
  }

  // ٤. الحجمُ المُعلَنُ يُقاسُ لا يُفترَضُ: التوكيدُ على عددِ الرحلاتِ بالمُضاعِفِ
  //    المُستورَدِ — ومن حذفَهُ قاسَ رحلةً واحدةً وادَّعى حسّاسيّةَ عشرٍ.
  if (!/rideCount[^;\n]*\.toBe\(/.test(source)) {
    push(
      "guard.volume-measured",
      "ملفُّ القياسِ لا يوكِّدُ عددَ رحلاتِ النافذةِ (`expect(facts.rideCount).toBe(...)`‎) — والنافذةُ بلا حجمِها المُعلَنِ قياسٌ ناقصٌ",
    );
  }
  if (!source.includes("rideCount")) {
    push("guard.volume-measured", "ملفُّ القياسِ لا يذكرُ `rideCount` — الحجمُ جزءٌ من القياسِ لا خلفيّتُهُ");
  }

  // ٥. النافذةُ متتابعةٌ لا متزامنةٌ: من شغَّلَ الرحلاتِ معاً قاسَ تزامناً لا حسّاسيّةَ
  //    حجمٍ، وادَّعى حملاً هوَ من عملِ مُشغِّلِ الاختبارِ لا من عملِ النظامِ.
  if (/Promise\.all|Promise\.allSettled/.test(source)) {
    push(
      "guard.sequential-only",
      "ملفُّ القياسِ يشغِّلُ الرحلاتِ بنداءاتٍ متزامنةٍ (`Promise.all`) — والمُعلَنُ رحلاتٌ متتابعةٌ، فالتزامنُ ادّعاءُ حملٍ بلا قياسِ حملٍ",
    );
  }

  // ٦. القاعدةُ مقيسةٌ: `pg_stat_database` يُقرأُ لا يُخمَّنُ — وحدّةُ `DEC-18`.
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

  // ٧. الطابورُ مقيسٌ: `notification_outbox` و`order_offers` يُعَدَّانِ.
  if (!/notification_outbox/.test(source)) {
    push(
      "guard.queue-measured",
      "ملفُّ القياسِ لا يعدُّ `notification_outbox` — ورسالةُ الطابورِ تكلفةُ نقلٍ مُؤجَّلةٌ",
    );
  }
  if (!/order_offers/.test(source)) {
    push(
      "guard.queue-offers-measured",
      "ملفُّ القياسِ لا يعدُّ `order_offers` — وعرضُ السائقِ رسالةُ طابورٍ مُؤجَّلةٌ",
    );
  }

  // ٨. Redis مُحقونٌ ومعدودٌ: عميلٌ يَعُدُّ أوامرَه.
  if (!/redis|Redis/.test(source)) {
    push("guard.redis-instrumented", "ملفُّ القياسِ لا يذكرُ `Redis` — والأوامرُ معدودةٌ من عميلٍ مُحقونٍ");
  }

  // ٩. النقلُ الشبكيُّ مقيسٌ: بايتاتُ الردودِ.
  if (!/byteLength|content-length|Content-Length/.test(source)) {
    push(
      "guard.network-measured",
      "ملفُّ القياسِ لا يقيسُ طولَ الردودِ بالبايت — والنقلُ الشبكيُّ مقيسٌ لا مُخمَّنٌ",
    );
  }

  // ١٠. التخزينُ مقيسٌ: صفوفٌ مُدخَلةٌ تُعَدُّ.
  if (!/insert|INSERT|storageRowsInserted/.test(source)) {
    push("guard.storage-measured", "ملفُّ القياسِ لا يعدُّ الصفوفَ المُدخَلةَ — والتخزينُ منطقيٌّ لا فيزيائيٌّ");
  }

  // ١١. التأكيدُ لم يُفرَّغْ: قياسٌ لا يُحاكَمُ سجلٌّ لا حاجزٌ.
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

  // ١٢. الحاجزُ يحرسُ نفسَه: حاجزٌ غيرُ موصولٍ في السلسلةِ وثيقةٌ لا بوّابةٌ.
  if (!inputs.packageJson?.includes("check-cost-sensitivity")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditCostSensitivity();

  if (problems.length > 0) {
    console.error("✗ حسّاسيّةُ شكلِ التكلفةِ عندَ ١٠x (`ECO-008`) مخروقةٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        COST_SENSITIVITY_TEST_FILE +
        "` يُديرُ عشرَ رحلاتٍ متتابعةٍ في حاويةٍ واحدةٍ ويستوردُ سقوفَه الحجميّةَ من مصدرِها الواحدِ. " +
        "وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  const budgets = volumeBudgets();
  console.log(
    `✓ حسّاسيّةُ شكلِ التكلفةِ عندَ ${String(SENSITIVITY_VOLUME_MULTIPLIER)}x محروسةٌ (ECO-008 · الشقُّ المملوكُ للمستودَعِ): ` +
      `قاعدةٌ ${String(budgets.databaseRows)} صفّاً / ${String(budgets.databaseBlocks)} كتلةً · ` +
      `طابورٌ ${String(budgets.queueMessages)} رسالةً · ` +
      `Redis ${String(budgets.redisCommands)} أمراً · ` +
      `نقلٌ ${String(budgets.networkBytes)} بايتاً · ` +
      `تخزينٌ ${String(budgets.storageRows)} صفّاً. ` +
      `${JUDGE_RULE_NAMES.length} قواعدَ حكمٍ · ${GUARD_RULE_NAMES.length} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ فاتورةٍ ولا ادّعاءُ سعةٍ**: الشكلُ يُقاسُ على السِلكِ، والسعرُ في فاتورةِ مزوّدِ سحابةٍ (REQ-09)، " +
      "والسعةُ عملُ مختبرِ النشرِ (DEC-17).",
  );
}

if (import.meta.main) main();
