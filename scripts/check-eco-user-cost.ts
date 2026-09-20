#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: مقاماتُ التكلفةِ لكلِّ مستخدمٍ نشطٍ شهريّاً ولكلِّ رحلةٍ — `ECO-001`
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ المقاماتِ (المستخدمونَ النشطونَ والرحلاتُ)
 * أو يُفرَّغَ تأكيدُه أو تُنسَخَ كميّاتُه — **قبلَ** أن يُشغَّلَ القياسُ. والقسمُ 17
 * يوجبُ أن يكونَ لكلِّ مستخدمٍ نشطٍ شهريّاً ولكلِّ رحلةٍ تكلفةُ بنيةٍ معلومةٌ؛ وهذا
 * الحاجزُ يحرسُ **بقاءَ الحسابِ** لا نتيجتَه: النتيجةُ تُقاسُ على بوّابةٍ وقاعدةٍ
 * حقيقيّةٍ.
 *
 * **الحالة:** `ECO-001` (الزيادةُ الأولى) — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البندُ `ECO-001` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَم من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-eco-user-cost.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0154-eco-001-first-increment-active-user-and-ride-denominators.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ التكلفةَ محسوبةٌ**: ذاكَ قياسٌ على السِلكِ في
 *   `tests/integration/eco-user-cost.test.ts`، ووجودُ هذا الحاجزِ **ليسَ** دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا يحسبُ فاتورةً**: السعرُ في فاتورةِ مزوّدِ سحابةٍ لا يملكُها
 *   المستودَعُ (`REQ-09` · `[!]`). فالمحروسُ **المقاماتُ والكميّاتُ** وحدَها.
 * - **لا يقرأُ شبكةً ولا قاعدةً**: ساكنٌ عن قصدٍ.
 * - **لا يخترعُ سقفاً لِعددِ الرحلاتِ لكلِّ مستخدمٍ**: ذاك قرارُ منتجٍ/اقتصادٍ غيرُ موجودٍ
 *   في الخارطةِ.
 */

import { existsSync, readFileSync } from "node:fs";
import { ECO_USER_COST_TEST_FILE, JUDGE_RULE_NAMES } from "./lib/eco-user-cost.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِه. */
const PACKAGE_FILE = "package.json";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.window-injected",
  "guard.riders-counted",
  "guard.drivers-counted",
  "guard.drivers-from-offers",
  "guard.orders-separated",
  "guard.no-now-in-measurement",
  "guard.prices-optional",
  "guard.blocked-when-missing",
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
}

/**
 * يُدقِّقُ أنَّ قياسَ مقاماتِ التكلفةِ (المستخدمونَ النشطونَ والرحلاتُ) وحاسبةَ
 * التكلفةِ المحقونةِ باقيانِ ولم يُفرَّغْ تأكيدُهما.
 *
 * يعملُ كحاجزٍ ساكنٍ: يقرأُ مصدرَ ملفِّ القياسِ و`package.json` فقط، ولا يُشغِّلُ
 * الشيفرةَ ولا يصلُ قاعدةً.
 */
export function auditEcoUserCost(inputs: AuditInputs): Problem[] {
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  const source = inputs.measurementSource;

  // ١. ملفُّ القياسِ موجودٌ.
  if (source === null) {
    push(
      "guard.measurement-present",
      `ملفُّ القياسِ \`${ECO_USER_COST_TEST_FILE}\` غيرُ موجودٍ — والقياسُ شرطُ صدقِ التكلفةِ`,
    );
    return problems;
  }

  // ٢. الحَكَمُ مُستوردٌ في ملفِّ القياسِ.
  if (!/from.*eco-user-cost/.test(source)) {
    push(
      "guard.judge-imported",
      "ملفُّ القياسِ لا يستوردُ `scripts/lib/eco-user-cost.ts` — والحسابُ النقيُّ شرطُ صدقِ النِسبِ",
    );
  }

  // ٣. النافذةُ `[from, to)` محقونةٌ — لا `now()`.
  if (!/from.*Date|to.*Date|WINDOW_FROM|WINDOW_TO|window.*from|window.*to/.test(source)) {
    push(
      "guard.window-injected",
      "ملفُّ القياسِ لا يحقنُ نافذةَ `[from, to)` — و`now()` في المنطقِ يُكسرُ قابليةَ الإعادة",
    );
  }

  // ٤. الراكبونَ النشطونَ معدودونَ من `orders.rider_id`.
  if (!/rider_id/.test(source)) {
    push(
      "guard.riders-counted",
      "ملفُّ القياسِ لا يعدُّ الراكبينَ من `orders.rider_id` — والمقامُ نشطٌ لا مُسجَّلٌ",
    );
  }

  // ٥. السائقونَ النشطونَ معدودونَ كاتحادٍ على `users.id` — لا جمعَ عدّين.
  if (!/users/.test(source) || !/assigned_driver_id/.test(source)) {
    push(
      "guard.drivers-counted",
      "ملفُّ القياسِ لا يعدُّ السائقينَ كاتحادٍ على `users.id` من `assigned_driver_id` و`order_offers` — والعدُّ المنفصلُ قد يُضاعِفُ السائقَ نفسَه",
    );
  }

  // ٦. السائقونَ من `order_offers.driver_id` أيضاً — فالعرضُ استهلاكُ مواردَ دونَ إسنادٍ.
  if (!/order_offers/.test(source) || !/driver_id/.test(source)) {
    push(
      "guard.drivers-from-offers",
      "ملفُّ القياسِ لا يعدُّ السائقينَ من `order_offers.driver_id` — والسائقُ يستهلكُ رسائلَ دونَ أن يُسنَدَ إليهِ الطلبُ",
    );
  }

  // ٧. الطلباتُ المُنشأةُ والمُكمَّلةُ منفصلتانِ.
  if (!/ordersCreated|orders_created|created_at/.test(source)) {
    push(
      "guard.orders-separated",
      "ملفُّ القياسِ لا يفصلُ الطلباتِ المُنشأةَ عن المُكمَّلةِ — والمعنى يختلفُ فلا يُسمَّى أحدُهما «الحقيقةَ الكاملةَ»",
    );
  }

  // ٨. لا `now()` في منطقِ القياسِ.
  if (/now\(\)/.test(source)) {
    push(
      "guard.no-now-in-measurement",
      "ملفُّ القياسِ يستعملُ `now()` — والنافذةُ يجبُ أن تكونَ محقونةً `[from, to)` لا متحرّكةً",
    );
  }

  // ٩. الأسعارُ اختياريّةٌ — لا وهميّةٌ.
  if (!/UnitPrices|prices|price/.test(source)) {
    push(
      "guard.prices-optional",
      "ملفُّ القياسِ لا يذكرُ الأسعارَ كمدخلاتٍ اختياريّةٍ — والسعرُ محقونٌ أو غائبٌ لا مُقدَّرٌ",
    );
  }

  // ١٠. التكلفةُ محجوبةٌ عندَ غيابِ السعرِ.
  if (!/blocked|REQ-09/.test(source)) {
    push(
      "guard.blocked-when-missing",
      "ملفُّ القياسِ لا يُنشِرُ حالةَ `blocked` عندَ غيابِ السعرِ — والغيابُ حالةٌ صريحةٌ لا صفرٌ",
    );
  }

  // ١١. الحاجزُ يحرسُ نفسَه.
  if (!inputs.packageJson?.includes("check-eco-user-cost")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const measurementSource = existsSync(ECO_USER_COST_TEST_FILE)
    ? readFileSync(ECO_USER_COST_TEST_FILE, "utf-8")
    : null;
  const packageJson = existsSync(PACKAGE_FILE) ? readFileSync(PACKAGE_FILE, "utf-8") : null;

  const problems = auditEcoUserCost({ measurementSource, packageJson });

  if (problems.length > 0) {
    console.error("✗ مقاماتُ التكلفةِ (`ECO-001`) مخروقةٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        ECO_USER_COST_TEST_FILE +
        "` يعدُّ المقاماتِ على قاعدةٍ حقيقيّةٍ، " +
        "ويستوردُ حَكَمَه من `scripts/lib/eco-user-cost.ts`. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ مقاماتُ التكلفةِ محروسةٌ (ECO-001 · الزيادةُ الأولى): ` +
      `${JUDGE_RULE_NAMES.length} قواعدَ حكمٍ · ${GUARD_RULE_NAMES.length} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا حسابُ فاتورةٍ**: المقاماتُ تُقاسُ على السِلكِ، والسعرُ في فاتورةِ مزوّدِ سحابةٍ (REQ-09).",
  );
}

if (import.meta.main) main();
