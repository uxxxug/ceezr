#!/usr/bin/env bun
/**
 * # الحاجزُ الساكنُ: تذاكرُ الدعمِ لكلِّ رحلةٍ معدودةٌ لا مُقدَّرةٌ — `ECO-006` (الشقُّ المملوكُ للمستودَعِ)
 *
 * **الغرض:** أن يستحيلَ أن يُحذَفَ قياسُ تذاكرِ الدعمِ أو يُفرَّغَ تأكيدُه أو
 * تُنسَخَ سقوفُه أو تُرفَعَ بيدٍ — **قبلَ** أن يُشغَّلَ القياسُ. والقسمُ 17 يوجبُ
 * أن يكونَ لكلِّ رحلةٍ عددٌ معلومٌ من تذاكرِ الدعمِ؛ وهذا الحاجزُ يحرسُ
 * **بقاءَ العدِّ** لا نتيجتَه: النتيجةُ تُقاسُ على بوّابةٍ وقاعدةٍ حقيقيّةٍ.
 *
 * **الحالة:** `ECO-006` (الشقُّ المملوكُ للمستودَعِ) — مُنفَّذ · مُختبَر · مبرهَنُ السقوطِ (`ح-7`).
 *
 * **ينتمي إلى:** البند `ECO-006` · القسمُ 17 (اقتصادُ التشغيلِ).
 *
 * **يُستخدَم من:** سلسلةُ `bun run ci` · خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 *
 * **يحرسُه:** `tests/unit/check-support-volume-budget.test.ts` — سالبةٌ لكلِّ قاعدةٍ.
 *
 * **الحاكم:** `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md`
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُثبِتُ أنَّ الرحلةَ ضمنَ السقفِ**: ذاكَ قياسٌ على السِلكِ في
 *   `tests/integration/support-volume-budget.test.ts`، ووجودُ هذا الحاجزِ **ليسَ**
 *   دليلَ التزامٍ.
 * - **لا يعرفُ سعراً ولا يحسبُ فاتورةً**: السعرُ بيدِ المالكِ (`REQ-09` · `[!]`).
 *   فالمحروسُ **العددُ** وحدَه.
 * - **لا يقرأُ قاعدةً**: ساكنٌ عن قصدٍ.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  JUDGE_RULE_NAMES,
  SUPPORT_VOLUME_TEST_FILE,
  supportTicketBudget,
} from "./lib/support-volume-budget.ts";

/** سلسلةُ `ci` — منها يُقرأُ بقاءُ الحاجزِ نفسِه. */
const PACKAGE_FILE = "package.json";

/** أسماءُ قواعدِ الحاجزِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const GUARD_RULE_NAMES = [
  "guard.measurement-present",
  "guard.judge-imported",
  "guard.support-tickets-counted",
  "guard.types-source",
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
  readonly supportTicketsBudget: number;
  readonly judgeRuleCount: number;
}

/** قراءةُ ملفٍّ نصّاً، و`null` إن غابَ — الغيابُ حكمٌ لا استثناءٌ. */
function read(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** المدخلاتُ الحقيقيّةُ: القرصُ ومكتبةُ الحَكَمِ — الموضعُ الوحيدُ الذي يقرأُ. */
export function defaultInputs(): AuditInputs {
  return {
    measurementSource: read(SUPPORT_VOLUME_TEST_FILE),
    packageJson: read(PACKAGE_FILE),
    supportTicketsBudget: supportTicketBudget(),
    judgeRuleCount: JUDGE_RULE_NAMES.length,
  };
}

export function auditSupportVolumeBudget(overrides: Partial<AuditInputs> = {}): Problem[] {
  const inputs: AuditInputs = { ...defaultInputs(), ...overrides };
  const problems: Problem[] = [];
  const push = (rule: GuardRuleName, problem: string): void => {
    problems.push({ rule, problem });
  };

  // ١. السقفُ عقلانيٌّ — حاجزٌ بلا رقمٍ صالحٍ لا يحجزُ.
  if (!Number.isInteger(inputs.supportTicketsBudget) || inputs.supportTicketsBudget <= 0) {
    push(
      "guard.budget-sane",
      `السقفُ «supportTicketsBudget» غيرُ صالحٍ: ${String(inputs.supportTicketsBudget)}`,
    );
  }
  if (inputs.judgeRuleCount === 0) {
    push("guard.budget-sane", "حكمٌ بلا قاعدةٍ واحدةٍ — لا شيءَ يُخالَفُ");
  }

  // ٢. ملفُّ القياسِ موجودٌ — وغيابُه يُنهي الفحصَ: ما بعدَه يُقاسُ فيه.
  const source = inputs.measurementSource;
  if (source === null) {
    push("guard.measurement-present", `ملفُّ قياسِ تذاكرِ الدعمِ غائبٌ: ${SUPPORT_VOLUME_TEST_FILE}`);
    return problems;
  }

  // ٣. الحَكَمُ يُستورَدُ ولا يُعادُ بناؤُه في ملفِّ القياسِ.
  if (!/from\s+["'`][^"'`]*support-volume-budget/.test(source)) {
    push(
      "guard.judge-imported",
      "ملفُّ القياسِ لا يستوردُ الحَكَمَ من `scripts/lib/support-volume-budget.ts`",
    );
  }
  for (const symbol of ["judgeSupportVolume"]) {
    if (!source.includes(symbol)) {
      push("guard.judge-imported", `ملفُّ القياسِ لا يذكرُ \`${symbol}\``);
    }
  }

  // ٤. تذاكرُ الدعمِ معدودةٌ: `support_tickets` تُعَدُّ.
  if (!/support_tickets/.test(source)) {
    push(
      "guard.support-tickets-counted",
      "ملفُّ القياسِ لا يعدُّ `support_tickets` — وتذكرةُ الدعمِ تكلفةُ دعمٍ مؤجَّلةٌ",
    );
  }

  // ٥. الأصنافُ من المصدرِ الواحدِ: `SUPPORT_TICKET_TYPES` مُستورَدٌ لا منسوخٌ.
  if (!/SUPPORT_TICKET_TYPES/.test(source)) {
    push(
      "guard.types-source",
      "ملفُّ القياسِ لا يستوردُ `SUPPORT_TICKET_TYPES` — والأصنافُ من مصدرٍ واحدٍ",
    );
  }

  // ٦. التأكيدُ لم يُفرَّغْ: قياسٌ لا يُحاكَمُ سجلٌّ لا حاجزٌ.
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

  // ٧. الحاجزُ يحرسُ نفسَه: حاجزٌ غيرُ موصولٍ في السلسلةِ وثيقةٌ لا بوّابةٌ.
  if (!inputs.packageJson?.includes("check-support-volume-budget")) {
    push(
      "guard.self-enforced",
      "هذا الحاجزُ غيرُ موصولٍ في سلسلةِ `ci` من `package.json` — وحاجزٌ لا يُشغَّلُ وثيقةٌ",
    );
  }

  return problems;
}

function main(): void {
  const problems = auditSupportVolumeBudget();

  if (problems.length > 0) {
    console.error("✗ عدُّ تذاكرِ الدعمِ (`ECO-006`) مخروقٌ:\n");
    for (const problem of problems) {
      console.error(`  ــ [${problem.rule}] ${problem.problem}`);
    }
    console.error(
      "\nوالعلاجُ في الجِذرِ: يبقى القياسُ في `" +
        SUPPORT_VOLUME_TEST_FILE +
        "` يعدُّ تذاكرَ الدعمِ على السِلكِ من حاويةٍ إنتاجيّةٍ، " +
        "ويستوردُ حَكَمَه وسقوفَه من مصادرِها الواحدةِ. وإسكاتُ الحاجزِ ليسَ علاجاً.",
    );
    process.exit(1);
  }

  console.log(
    `✓ عدُّ تذاكرِ الدعمِ محروسٌ (ECO-006 · الشقُّ المملوكُ للمستودَعِ): ` +
      `سقفُ ${supportTicketBudget()} تذكرةً لكلِّ رحلةٍ. ` +
      `${JUDGE_RULE_NAMES.length} قواعدَ حكمٍ · ${GUARD_RULE_NAMES.length} قواعدَ حاجزٍ. ` +
      "وهذا **حِفظُ شرطٍ لا قياسُ فاتورةٍ**: العددُ يُقاسُ على السِلكِ، والسعرُ بيدِ المالكِ (REQ-09).",
  );
}

if (import.meta.main) main();
