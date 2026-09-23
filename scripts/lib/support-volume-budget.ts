/**
 * الغرض: **حَكَمٌ نقيٌّ** لميزانِ تذاكرِ الدعمِ لكلِّ رحلةٍ
 *   (`ECO-006` — الشقُّ المملوكُ للمستودَعِ): يعدُّ تذاكرَ الدعمِ المُنشَأةَ
 *   في دورةِ حياةِ رحلةٍ واحدةٍ على السِلكِ، ويشتقُّ سقفَها من شكلِ النافذةِ
 *   المُعلَنِ لا من رقمٍ مكتوبٍ، ويحكمُ على حقائقَ مقيسةٍ بقواعدَ لكلِّ
 *   واحدةٍ سالبةٌ مبذورةٌ.
 *
 * الحالة: منفَّذ فعلياً — `ECO-006` (محرّكُ الكمِّ وحدَه — الشقُّ المملوكُ للمستودَعِ).
 * ينتمي إلى: scripts/lib
 * يُستخدَم من: `tests/integration/support-volume-budget.test.ts` (القياسُ) ·
 *   `scripts/check-support-volume-budget.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md`
 *
 * ## لماذا حَكَمٌ نقيٌّ منفصلٌ
 *
 * الرقمُ الاقتصاديُّ حاصلُ ضربِ **عددٍ** في **سعرٍ**. وسعرُ تذكرةِ الدعمِ
 * (تكلفةُ موظّفِ الدعمِ لكلِّ تذكرةٍ) **لا يملكُه المستودَعُ**: التسعيرُ بيدِ
 * المالكِ (`REQ-09` · `[!]`). **والعددُ** سلوكُ شيفرةٍ يُقاسُ ههنا.
 *
 * ## ما يقيسُه هذا المُحرِّكُ
 *
 * تذاكرُ الدعمِ المُنشَأةُ في دورةِ حياةِ رحلةٍ واحدةٍ على السِلكِ. والتذكرةُ
 * تُنشَأُ بنداءِ `open_support_ticket` من طرفٍ (راكبٍ أو سائقٍ) — فالعدُّ هنا
 * يُثبِتُ أنَّ دورةَ الحياةِ نفسَها لا تُنشِئُ تذاكرَ بلا فعلِ مستخدمٍ، وأنَّ
 * كلَّ تذكرةٍ تُنشَأُ تحملُ أصنافَها المُعلَنةَ في `SUPPORT_TICKET_TYPES`.
 *
 * ## ما لا يقيسُه هذا المُحرِّكُ عن قصدٍ — ويُعلَنُ في الدليلِ
 *
 * - **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ موظّفِ دعمٍ لا يملكُها
 *   المستودَعُ. فالمقيسُ **العددُ**، ومن ضربَه في سعرٍ حقيقيٍّ حصلَ على الفاتورةَ.
 * - **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: شكلُ النافذةِ مُعلَنٌ بسببِه لا
 *   مقيسٌ من نشرٍ حيٍّ (`ADR 0099`).
 * - **لا يُقاسُ معدَّلُ التذاكرِ في الإنتاجِ**: ذاكَ قراءةٌ من لوحةٍ ميدانيّةٍ،
 *   لا قياسُ شيفرةٍ.
 */

/** ملفُّ القياسِ الوحيدُ الذي يعدُّ تذاكرَ الدعمِ على السِلكِ — يقرؤُه الحاجزُ. */
export const SUPPORT_VOLUME_TEST_FILE = "tests/integration/support-volume-budget.test.ts";

/**
 * سقفُ تذاكرِ الدعمِ لكلِّ رحلةٍ — مشتقٌّ من شكلِ النافذةِ: كلُّ انتقالٍ في
 * دورةِ الحياةِ قد يُولِّدُ تذكرةَ دعمٍ واحدةً على الأكثر (نزاعٌ · مفقوداتٌ ·
 * سلوكٌ). والسقفُ يحرسُ من نموٍّ غيرِ مُبرَّرٍ.
 */
export function supportTicketBudget(
  profile: { readonly lifecycleTransitionCount: number } = {
    lifecycleTransitionCount: 5,
  },
): number {
  return profile.lifecycleTransitionCount;
}

/** حقائقُ تذاكرِ الدعمِ كما تُقاسُ على السِلكِ — بلا تقديرٍ ولا اشتقاقٍ. */
export interface SupportVolumeFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرَأُ «صفرَ تذاكرَ». */
  readonly measured: boolean;
  /** تذاكرُ الدعمِ المُنشَأةُ في دورةِ الحياةِ. */
  readonly supportTicketsCreated: number;
  /** عددُ الانتقالاتِ في دورةِ الحياةِ. */
  readonly lifecycleTransitions: number;
}

/** مخالفةٌ واحدةٌ: اسمُ قاعدةٍ وتفصيلُها. */
export interface SupportVolumeViolation {
  readonly rule: string;
  readonly detail: string;
}

/** أسماءُ قواعدِ الحَكَمِ — لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "facts.measured",
  "counts.sane",
  "tickets.within-budget",
  "budget.derived",
  "transitions.matched",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

/** مدخلاتُ الحُكمِ — كلُّها محقونةٌ، ولا ساعةَ ولا قرصَ. */
export interface JudgeInputs {
  readonly facts: SupportVolumeFacts;
  readonly profile: { readonly lifecycleTransitionCount: number };
  readonly supportTicketsBudget: number;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ،
 * **ولا تعني أنَّ التكلفةَ محسوبةٌ**.
 */
export function judgeSupportVolume(inputs: JudgeInputs): readonly SupportVolumeViolation[] {
  const violations: SupportVolumeViolation[] = [];
  const { facts, profile } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ. والأخضرُ الفارغُ أخطرُ من الأحمرِ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا صفرُ تذاكرَ.",
    });
  }

  // ٢) أعدادٌ غيرُ صحيحةٍ أو سالبةٌ تُبطِلُ كلَّ ما بعدَها.
  if (!isCount(facts.supportTicketsCreated)) {
    violations.push({
      rule: "counts.sane",
      detail: `«supportTicketsCreated» ليسَ عدداً صحيحاً غيرَ سالبٍ: ${String(facts.supportTicketsCreated)}.`,
    });
  }

  // ٣) التذاكرُ ضمنَ السقفِ.
  if (facts.supportTicketsCreated > inputs.supportTicketsBudget) {
    violations.push({
      rule: "tickets.within-budget",
      detail: `${facts.supportTicketsCreated} تذكرةَ دعمٍ يتجاوزُ السقفَ ${inputs.supportTicketsBudget}.`,
    });
  }

  // ٤) السقفُ مُشتَقٌّ لا مكتوبٌ: من كتبَهُ رقماً أكبرَ سقطَ.
  const derivedBudget = supportTicketBudget(profile);
  if (inputs.supportTicketsBudget !== derivedBudget) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ التذاكرِ ${inputs.supportTicketsBudget} لا يُطابِقُ المُشتَقَّ ${derivedBudget}.`,
    });
  }

  // ٥) انتقالاتُ الحياةِ في الحقائقِ تطابقُ الشكلَ المُعلَنَ.
  if (facts.lifecycleTransitions !== profile.lifecycleTransitionCount) {
    violations.push({
      rule: "transitions.matched",
      detail: `انتقالاتُ الحياةِ في الحقائقِ ${facts.lifecycleTransitions} لا تُطابِقُ المُعلَنةَ ${profile.lifecycleTransitionCount}.`,
    });
  }

  return violations;
}

/** وصفُ مخالفةٍ سطراً واحداً — للحاجزِ وللدليلِ. */
export function describeSupportVolumeViolation(violation: SupportVolumeViolation): string {
  return `${violation.rule}: ${violation.detail}`;
}

/**
 * وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**: العددُ ليسَ تكلفةً.
 */
export function summarizeSupportVolume(facts: SupportVolumeFacts): string {
  return (
    `تذاكرُ الدعمِ: ${facts.supportTicketsCreated} من سقفِ ${supportTicketBudget()} · ` +
    `انتقالاتُ الحياةِ: ${facts.lifecycleTransitions}. ` +
    "ولا يُدَّعى أنَّ هذا تكلفةٌ: العددُ مقيسٌ والسعرُ بيدِ المالكِ (REQ-09)."
  );
}
