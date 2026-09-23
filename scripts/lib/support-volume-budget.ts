/**
 * الغرض: **حَكَمٌ نقيٌّ** لعددِ **تذاكرِ الدعمِ النظاميّةِ** التي يُنشِئُها مسارُ
 *   رحلةٍ واحدةٍ (`ECO-006` — شقُّ قياسٍ أوّليٌّ مملوكٌ للمستودَعِ): يأخذُ حقائقَ
 *   مقيسةً على السِلكِ ويحكمُ عليها بقواعدَ لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`).
 *
 * الحالة: منفَّذ فعلياً — `ECO-006` (شقُّ قياسٍ أوّليٌّ، لا المؤشِّرُ الاقتصاديُّ الكاملُ).
 * ينتمي إلى: scripts/lib
 * يُستخدَم من: `tests/integration/support-volume-budget.test.ts` (القياسُ) ·
 *   `scripts/check-support-volume-budget.ts` (الحاجزُ) ·
 *   `tests/unit/support-volume-budget.test.ts` (سوالبُ الحَكَمِ)
 * يحكمُه: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md`
 *   كما صحَّحَه `docs/adr/0180-eco-006-measures-system-tickets-only-not-support-rate.md`
 *
 * ## ثلاثةُ مقاديرَ منفصلةٍ — ولا يُستنبَطُ أحدُها من الآخرِ (ADR 0180)
 *
 * «تكلفةُ الدعمِ لكلِّ ١٠٠٠ رحلةٍ» حاصلُ ثلاثةِ مقاديرَ، وهذا الملفُّ يقيسُ الأوّلَ وحدَه:
 *
 * ١) **التذاكرُ النظاميّةُ التي يُنشِئُها مسارُ الرحلةِ** (بلا فعلِ مستخدمٍ) —
 *    **مقيسٌ ههنا** على مسارٍ محدَّدٍ مُعلَنٍ.
 * ٢) **معدَّلُ التذاكرِ التي يفتحُها المستخدمونَ لكلِّ ١٠٠٠ رحلةٍ** — **غيرُ مقيسٍ**:
 *    سلوكُ مستخدمينَ لا سلوكُ شيفرةٍ، ولا يُقرأُ إلّا من تشغيلٍ ميدانيٍّ.
 * ٣) **سعرُ تذكرةِ الدعمِ** — **خارجيٌّ** لا يملكُه المستودَعُ، ولا قرارَ مالكٍ
 *    موثَّقٌ يُحدِّدُه بعدُ. (وليسَ `REQ-09`: ذاكَ حسابُ مزوّدِ الخرائطِ لـ`ECO-002`.)
 *
 * فصفرٌ في (١) **لا يعني** صفراً في (٢)، ولا يُقرأُ «معدَّلُ دعمٍ = صفر».
 *
 * ## المسارُ المقيسُ — كما هوَ لا كما يُتمنّى
 *
 * اقتباسٌ وإنشاءٌ عبرَ البوّابةِ ← عرضٌ `pending` يُزرَعُ صفّاً (لا تُقاسُ جولةُ
 * الإرسالِ) ← `claim_ride` ← `driver_mark_arrived` ← `driver_start_ride` ← نبضاتٌ
 * وقراءاتٌ ← `driver_complete_ride`. **ولا يُشغَّلُ التقييمُ** (الانتقالُ الخامسُ
 * المُعلَنُ في `RIDE_RESOURCE_PROFILE`)، ولا الإلغاءُ ولا التصعيدُ ولا النزاعُ.
 * والانتقالاتُ **تُعَدُّ من `audit_log`** للطلبِ نفسِه، لا تُنسَخُ من الثابتِ.
 */

/** ملفُّ القياسِ الوحيدُ الذي يعدُّ تذاكرَ الدعمِ على السِلكِ — يقرؤُه الحاجزُ. */
export const SUPPORT_VOLUME_TEST_FILE = "tests/integration/support-volume-budget.test.ts";

/**
 * أفعالُ `audit_log` التي تُعَدُّ انتقالاتِ حالةٍ في المسارِ المقيسِ — كلٌّ منها
 * تكتبُه دالّةُ النظامِ نفسُها في معاملتِها (`claim_ride` · `start_ride` · `complete_ride`).
 * و`order.driver_arrived` حدثٌ لا انتقالُ حالةٍ (يكتبُ `arrived_at` ولا يُغيّرُ `status`).
 */
export const MEASURED_TRANSITION_ACTIONS = [
  "order.claimed",
  "order.started",
  "order.completed",
] as const;

/**
 * سقفُ التذاكرِ النظاميّةِ لكلِّ رحلةٍ — مشتقٌّ من شكلِ النافذةِ: انتقالٌ واحدٌ
 * لا يُولِّدُ أكثرَ من تذكرةٍ. سقفٌ سخيٌّ يحرسُ من نموٍّ غيرِ مُبرَّرٍ، لا نسبةٌ اقتصاديّةٌ.
 */
export function supportTicketBudget(
  profile: { readonly lifecycleTransitionCount: number } = {
    lifecycleTransitionCount: 5,
  },
): number {
  return profile.lifecycleTransitionCount;
}

/** حقائقُ المسارِ كما تُقاسُ على السِلكِ — **تُنقَلُ كما هيَ** بلا تطهيرٍ ولا اشتقاقٍ. */
export interface SupportVolumeFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرَأُ «صفرَ تذاكرَ». */
  readonly measured: boolean;
  /** التذاكرُ النظاميّةُ المنسوبةُ إلى الرحلةِ وطرفَيها: فرقُ ما بعدُ ناقصَ ما قبلُ، خاماً. */
  readonly supportTicketsCreated: number;
  /** انتقالاتُ الحالةِ المعدودةُ من `audit_log` للطلبِ — لا من الثابتِ المُعلَنِ. */
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
  "transitions.observed",
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
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ في
 * **المسارِ المقيسِ** — **ولا تعني** أنَّ معدَّلَ الدعمِ صفرٌ ولا أنَّ التكلفةَ محسوبةٌ.
 */
export function judgeSupportVolume(inputs: JudgeInputs): readonly SupportVolumeViolation[] {
  const violations: SupportVolumeViolation[] = [];
  const { facts, profile } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا صفرُ تذاكرَ.",
    });
  }

  // ٢) عددٌ غيرُ صحيحٍ أو سالبٌ شذوذٌ يُكشَفُ ههنا — والقياسُ لا يُطهِّرُه قبلَ الوصولِ.
  for (const [name, value] of [
    ["supportTicketsCreated", facts.supportTicketsCreated],
    ["lifecycleTransitions", facts.lifecycleTransitions],
  ] as const) {
    if (!isCount(value)) {
      violations.push({
        rule: "counts.sane",
        detail: `«${name}» ليسَ عدداً صحيحاً غيرَ سالبٍ: ${String(value)}.`,
      });
    }
  }

  // ٣) التذاكرُ النظاميّةُ ضمنَ السقفِ.
  if (facts.supportTicketsCreated > inputs.supportTicketsBudget) {
    violations.push({
      rule: "tickets.within-budget",
      detail: `${facts.supportTicketsCreated} تذكرةَ دعمٍ نظاميّةً يتجاوزُ السقفَ ${inputs.supportTicketsBudget}.`,
    });
  }

  // ٤) السقفُ مُشتَقٌّ لا مكتوبٌ.
  const derivedBudget = supportTicketBudget(profile);
  if (inputs.supportTicketsBudget !== derivedBudget) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ التذاكرِ ${inputs.supportTicketsBudget} لا يُطابِقُ المُشتَقَّ ${derivedBudget}.`,
    });
  }

  // ٥) الانتقالاتُ رُصِدَت فعلاً: مسارٌ بلا انتقالٍ مرصودٍ لم يُشغَّلْ، ومسارٌ يرصدُ
  //    أكثرَ مِمّا تسمحُ به آلةُ الحالاتِ المُعلَنةُ عطبٌ في العدِّ أو في الآلةِ.
  if (
    isCount(facts.lifecycleTransitions) &&
    (facts.lifecycleTransitions < 1 ||
      facts.lifecycleTransitions > profile.lifecycleTransitionCount)
  ) {
    violations.push({
      rule: "transitions.observed",
      detail: `انتقالاتٌ مرصودةٌ ${facts.lifecycleTransitions} خارجَ [1, ${profile.lifecycleTransitionCount}].`,
    });
  }

  return violations;
}

/** وصفُ مخالفةٍ سطراً واحداً — للحاجزِ وللدليلِ. */
export function describeSupportVolumeViolation(violation: SupportVolumeViolation): string {
  return `${violation.rule}: ${violation.detail}`;
}

/**
 * وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**.
 */
export function summarizeSupportVolume(facts: SupportVolumeFacts): string {
  return (
    `تذاكرُ الدعمِ النظاميّةُ في المسارِ المقيسِ: ${facts.supportTicketsCreated} من سقفِ ${supportTicketBudget()} · ` +
    `انتقالاتٌ مرصودةٌ من audit_log: ${facts.lifecycleTransitions}. ` +
    "ولا يُدَّعى معدَّلُ دعمٍ من المستخدمينَ ولا تكلفةٌ: الأوّلُ غيرُ مقيسٍ، والسعرُ خارجيٌّ بلا قرارِ مالكٍ موثَّقٍ."
  );
}
