/**
 * الغرض: **حَكَمٌ نقيٌّ** لميزانِ رسائلِ تيليجرام في رحلةٍ واحدةٍ (`ECO-003` —
 *   الشقُّ المملوكُ للمستودَعِ): يحملُ شكلَ الرحلةِ المُعلَنَ، ويشتقُّ سقفَ الرسائلِ
 *   من ذلكَ الشكلِ **لا رقماً مكتوباً**، ويفصلُ **رسائلَ الدفعِ** عن **ردودِ
 *   الحوارِ**، ويحكمُ على حقائقَ مقيسةٍ بقواعدَ لكلِّ واحدةٍ سالبةٌ مبذورةٌ.
 *
 * الحالة: منفّذ فعلياً — `ECO-003` (مُحرِّكُ الكمِّ وحدَه).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `tests/integration/telegram-message-budget.test.ts` (القياسُ) ·
 *   `scripts/check-telegram-message-budget.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0152-telegram-messages-per-ride-are-counted-not-estimated.md`
 *
 * ## لماذا حَكَمٌ نقيٌّ منفصلٌ
 *
 * الرقمُ الاقتصاديُّ حاصلُ ضربِ **عددٍ** في **سعرٍ**. وسعرُ البثِّ المدفوعِ
 * (0.1 نجمةٍ للرسالةِ فوقَ الحدِّ) **لا يملكُه المستودَعُ**: تمكينُه قرارُ مالكٍ
 * محجوزٌ بـ`DEC-04` (`[!]`)، **والعددُ** سلوكُ شيفرةٍ يُقاسُ ههنا. فيُبنى
 * المُحرِّكُ الكمِّيُّ كاملاً، ويبقى الرمزُ `[ ]` حتّى يُدخِلَ المالكُ السعرَ.
 *
 * ## القسمةُ التي تحملُ الدعوى: دفعٌ مقابلَ ردٍّ
 *
 * ليسَ كلُّ ما يخرجُ إلى تيليجرام سواءً في الخطرِ. **رسالةُ الدفعِ** تُرسَلُ إلى
 * طرفٍ **لم يطلبْها** — تنشأُ عن حدثٍ في رحلةٍ لا عن تحديثٍ أرسلَه هو. وهذه
 * وحدَها هيَ التي:
 *
 * ١) **تتوسَّعُ**: بثُّ عرضٍ على `N` سائقاً مؤهَّلاً يُنتِجُ `N` رسالةً من حدثٍ
 *    واحدٍ، فهيَ التي تصطدمُ بحدِّ `TG-001` (≈30 رسالةً في الثانيةِ للبوتِ)
 *    وتستدعي البثَّ المدفوعَ.
 * ٢) **لا سقفَ طبيعيَّ لها**: عددُها بيدِ الشيفرةِ لا بيدِ المستخدمِ.
 *
 * أمّا **ردُّ الحوارِ** فمشدودٌ إلى تحديثٍ واردٍ بعينِه: لا يُرسَلُ إلّا لمن
 * كتبَ، ولا يتوسَّعُ، وعددُه محكومٌ بعددِ ما كتبَهُ صاحبُه. فجمعُ الصنفَينِ في
 * رقمٍ واحدٍ يُخفي الخطرَ الحقيقيَّ خلفَ ضجيجِ الحوارِ — والقسمةُ ههنا هيَ
 * صدقُ القياسِ لا تجميلُه.
 *
 * ## ما لا يفعلُه
 *
 * - لا يُشغِّلُ قياساً ولا يقرأُ ملفّاً — ذاكَ عملُ الحاجزِ واختبارِ التكاملِ.
 * - **لا سعرَ ههنا ألبتّةَ ولا نجمةَ**: لا يُحوِّلُ عدداً إلى مالٍ، ولا يزعمُ
 *   أنَّ البثَّ المدفوعَ مُفعَّلٌ أو غيرُ مُفعَّلٍ — ذاكَ `DEC-04`.
 * - لا يُدَّعي أنَّ شكلَ الرحلةِ سلوكُ مستخدمينَ: مُعلَنٌ بسببِه (`ADR 0099`).
 * - لا يحكمُ على **صوابِ** تصنيفِ نوعٍ حرجاً: ذاكَ حكمُ منتَجٍ، وحاجزُ
 *   `scripts/check-notification-classification.ts` يفرضُ اتّساقَه لا صوابَه.
 */

/** ملفُّ القياسِ الوحيدُ الذي يعدُّ الرسائلَ على السِلكِ — يقرؤُه الحاجزُ. */
export const TELEGRAM_MESSAGES_TEST_FILE = "tests/integration/telegram-message-budget.test.ts";

/**
 * مصدرُ الحقيقةِ لتصنيفِ الأنواعِ حرجاً. وهذا القياسُ يسندُ ظهرَه إليه: قاعدةُ
 * «رسالةُ الدفعِ تُحسَبُ» تفترضُ قائمةً مغلقةً مُعلَنةً لأنواعِ ما يُدفَعُ.
 */
export const NOTIFICATION_KINDS_FILE = "packages/shared/config/notification-kinds.ts";

/** حاجزُ اتّساقِ تصنيفِ الإشعاراتِ (`F6-05` / `TG-002`). */
export const NOTIFICATION_CLASSIFICATION_GUARD_FILE =
  "scripts/check-notification-classification.ts";

/**
 * حدُّ تيليجرام المُعلَنُ في `TG-001`: ≈30 رسالةً في الثانيةِ للبوتِ الواحدِ،
 * وما فوقَه هوَ مَوضِعُ البثِّ المدفوعِ. **ليسَ سعراً**: عددٌ في الثانيةِ.
 */
export const TELEGRAM_FREE_RATE_PER_SECOND = 30;

/**
 * شكلُ الرحلةِ المقيسةِ — **مُعلَنٌ بسببِه لا مقيسٌ من نشرٍ حيٍّ** (`ADR 0099`).
 */
export interface RideMessageProfile {
  /**
   * عددُ السائقينَ المؤهَّلينَ الذينَ يُبَثُّ عليهِم العرضُ في الدورةِ الواحدةِ.
   * وواحدٌ أدنى شكلٍ تُقاسُ فيه الرحلةُ كلُّها، **والقاعدةُ تنمو بهِ خطّيّاً**:
   * فمن أرادَ فاتورةَ مدينةٍ ضربَ نصيبَ البثِّ في سائقيها لا في هذا الرقمِ.
   */
  readonly offeredDriverCount: number;
  /**
   * دوراتُ البثِّ في الرحلةِ. ودورةٌ واحدةٌ = لا توسيعَ دائرةٍ ولا إعادةَ بثٍّ،
   * وهوَ المسارُ السعيدُ؛ وكلُّ دورةٍ زائدةٍ تُضاعِفُ نصيبَ البثِّ لا غيرَه.
   */
  readonly broadcastRoundCount: number;
  /**
   * انتقالاتُ دورةِ الحياةِ التي **تُخطِرُ الطرفَ المقابلَ** بلا طلبٍ منه:
   * `matched` (قُبِلَ طلبُك) · `started` (انطلقَ سائقُك) · `completed` (وصلتَ).
   * وثلاثةٌ هيَ ما تفرضُه آلةُ الحالاتِ اليومَ، لا رقمٌ مُختارٌ.
   */
  readonly crossPartyTransitionCount: number;
  /**
   * طلباتُ التقييمِ التي تُدفَعُ إلى طرفٍ لم يطلبْها. والسائقُ يُنهي الرحلةَ
   * بيدِه فطلبُه ردُّ حوارٍ؛ **والراكبُ لا يفعلُ شيئاً** فطلبُه دفعٌ — فواحدٌ.
   */
  readonly pushedRatingPromptCount: number;
  /**
   * أقصى دفقةِ ردٍّ مسموحةٍ لتحديثٍ واردٍ واحدٍ. وثلاثٌ هيَ أطولُ دفقةٍ يفرضُها
   * المنتَجُ اليومَ: نصٌّ + بطاقةُ رحلةٍ + دبّوسُ موقعٍ (المرحلةُ ١٢). ورفعُها
   * تليينٌ للحاجزِ، ولذا لها سقفُها المُعلَنُ في `maxAllowedReplyBurst`.
   */
  readonly maxReplyBurst: number;
}

/** شكلُ الرحلةِ المُعلَنُ الذي يُقاسُ عليهِ. */
export const RIDE_MESSAGE_PROFILE: RideMessageProfile = {
  offeredDriverCount: 1,
  broadcastRoundCount: 1,
  crossPartyTransitionCount: 3,
  pushedRatingPromptCount: 1,
  maxReplyBurst: 3,
};

/**
 * سقفُ **رسائلِ الدفعِ** لكلِّ رحلةٍ — **مُشتَقٌّ من الشكلِ لا مكتوبٌ رقماً**.
 *
 * والدعوى التي يحرسُها هذا السقفُ بعينِها: **فاتورةُ تيليجرام تنمو بالبثِّ على
 * السائقينَ لا بعددِ رسائلِ الحوارِ**. فمن جعلَ نبضةً أو تحديثَ موقعٍ يدفعُ
 * رسالةً إلى الطرفِ المقابلِ رأى الرقمَ يتجاوزُ السقفَ فوراً.
 */
export function pushMessageBudget(profile: RideMessageProfile = RIDE_MESSAGE_PROFILE): number {
  return (
    profile.offeredDriverCount * profile.broadcastRoundCount +
    profile.crossPartyTransitionCount +
    profile.pushedRatingPromptCount
  );
}

/**
 * سقفُ **ردودِ الحوارِ** مُشتَقٌّ من عددِ التحديثاتِ الواردةِ فعلاً في الرحلةِ:
 * ردٌّ بلا تحديثٍ ليسَ ردّاً بل دفعاً، فالسقفُ دالّةُ الوارِدِ لا ثابتٌ.
 */
export function replyMessageBudget(
  inboundUpdateCount: number,
  profile: RideMessageProfile = RIDE_MESSAGE_PROFILE,
): number {
  return inboundUpdateCount * profile.maxReplyBurst;
}

/** سقفُ الرحلةِ كلِّها: دفعٌ + ردٌّ، كلاهُما مُشتَقٌّ. */
export function rideMessageBudget(
  inboundUpdateCount: number,
  profile: RideMessageProfile = RIDE_MESSAGE_PROFILE,
): number {
  return pushMessageBudget(profile) + replyMessageBudget(inboundUpdateCount, profile);
}

/**
 * سقفُ ما يُسمَحُ لدفقةِ الردِّ أن تبلغَه — حاجزٌ على تليينِ الحاجزِ نفسِه.
 *
 * ولِمَ ثلاثٌ: نصٌّ وبطاقةٌ ودبّوسٌ. ولو صارَ الحدُّ يُشتَقُّ من أكبرِ دفقةٍ
 * مقيسةٍ لصارَ كلُّ إغراقٍ جديدٍ مقبولاً باسمِ «الميزانِ» — وهذا عينُ ما يمنعُه.
 */
export function maxAllowedReplyBurst(): number {
  return 3;
}

/** رسالةٌ واحدةٌ كما تُقاسُ على السِلكِ، مُسنَدةً إلى سببِها. */
export interface MeasuredMessage {
  /** الطرفُ المُخاطَبُ: `driver` أو `rider`. */
  readonly party: string;
  /**
   * التحديثُ الواردُ الذي كانَ يُعالَجُ حينَ خرجَت الرسالةُ، ومَن أرسلَه.
   * `null` يعني أنَّها خرجَت خارجَ معالجةِ أيِّ تحديثٍ (تفريغُ صندوقِ الصادرِ).
   */
  readonly duringUpdateFrom: string | null;
  /** تسلسلُ التحديثِ الواردِ في الرحلةِ — يُمَيِّزُ دفقةً عن دفقةٍ. */
  readonly updateIndex: number | null;
  /** سببُ الرسالةِ المُعلَنُ في القياسِ: انتقالٌ أو بثٌّ أو طلبُ تقييمٍ أو ردٌّ. */
  readonly cause: string;
}

/** أسبابُ الدفعِ المسموحةُ — قائمةٌ مغلقةٌ، وما خرجَ عنها مخالفةٌ. */
export const PUSH_CAUSES = ["offer.broadcast", "lifecycle.transition", "rating.prompt"] as const;

/** حقائقُ الرسائلِ كما تُقاسُ على السِلكِ — بلا تقديرٍ ولا اشتقاقٍ. */
export interface TelegramMessageFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرأُ «صفرَ رسائلَ». */
  readonly measured: boolean;
  /** عددُ التحديثاتِ الواردةِ في نافذةِ القياسِ. */
  readonly inboundUpdateCount: number;
  /** كلُّ رسالةٍ خرجَت في النافذةِ، مُسنَدةً. */
  readonly messages: readonly MeasuredMessage[];
  /** مجموعُ ما خرجَ إلى بوتِ السائقِ. */
  readonly driverMessageCount: number;
  /** مجموعُ ما خرجَ إلى بوتِ الراكبِ. */
  readonly riderMessageCount: number;
  /** أنواعُ الإشعاراتِ المُعلَنةُ `critical` كما تُقرأُ من مصدرِها الواحدِ. */
  readonly criticalKindCount: number;
}

/** مخالفةٌ واحدةٌ: اسمُ قاعدةٍ وتفصيلُها. */
export interface TelegramMessageViolation {
  readonly rule: string;
  readonly detail: string;
}

/** أسماءُ قواعدِ الحَكَمِ — لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "facts.measured",
  "counts.sane",
  "parties.consistent",
  "push.cause-declared",
  "push.unsolicited-only",
  "push.within-budget",
  "reply.attributed",
  "reply.burst-bounded",
  "ride.within-budget",
  "budget.derived",
  "rate-limit.headroom",
  "kinds.single-source",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

/** مدخلاتُ الحُكمِ — كلُّها محقونةٌ، ولا ساعةَ ولا قرصَ. */
export interface JudgeInputs {
  readonly facts: TelegramMessageFacts;
  readonly profile: RideMessageProfile;
  /** سقفُ الدفعِ المُستعمَلُ فعلاً — يُقارَنُ بالمُشتَقِّ فلا يُنسَخُ رقماً. */
  readonly budget: number;
  /** عددُ الأنواعِ المُعلَنةِ `critical` في `notification-kinds.ts` — مصدرٌ واحدٌ. */
  readonly declaredCriticalKindCount: number;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** رسائلُ الدفعِ: ما سببُه في القائمةِ المغلقةِ. */
export function pushMessages(messages: readonly MeasuredMessage[]): readonly MeasuredMessage[] {
  return messages.filter((m) => PUSH_CAUSES.some((cause) => cause === m.cause));
}

/** ردودُ الحوارِ: ما ليسَ دفعاً. */
export function replyMessages(messages: readonly MeasuredMessage[]): readonly MeasuredMessage[] {
  return messages.filter((m) => !PUSH_CAUSES.some((cause) => cause === m.cause));
}

/**
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ،
 * **ولا تعني أنَّ التكلفةَ محسوبةٌ**.
 */
export function judgeTelegramMessages(inputs: JudgeInputs): readonly TelegramMessageViolation[] {
  const violations: TelegramMessageViolation[] = [];
  const { facts, profile, budget, declaredCriticalKindCount } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ. والأخضرُ الفارغُ أخطرُ من الأحمرِ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا صفرُ رسائلَ.",
    });
  } else if (facts.messages.length === 0 || facts.inboundUpdateCount === 0) {
    violations.push({
      rule: "facts.measured",
      detail: `قياسٌ بلا مادّةٍ: رسائلُ=${facts.messages.length} · تحديثاتٌ=${facts.inboundUpdateCount}.`,
    });
  }

  // ٢) أعدادٌ غيرُ صحيحةٍ أو سالبةٌ تُبطِلُ كلَّ ما بعدَها.
  for (const [name, value] of [
    ["inboundUpdateCount", facts.inboundUpdateCount],
    ["driverMessageCount", facts.driverMessageCount],
    ["riderMessageCount", facts.riderMessageCount],
    ["criticalKindCount", facts.criticalKindCount],
  ] as const) {
    if (!isCount(value)) {
      violations.push({
        rule: "counts.sane",
        detail: `«${name}» ليسَ عدداً صحيحاً غيرَ سالبٍ: ${String(value)}.`,
      });
    }
  }

  // ٣) مجموعُ الطرفَينِ هوَ سجلُّ الرسائلِ نفسُه: عدّادٌ يُخالِفُ السجلَّ معطوبٌ.
  const fromLog = {
    driver: facts.messages.filter((m) => m.party === "driver").length,
    rider: facts.messages.filter((m) => m.party === "rider").length,
  };
  if (
    fromLog.driver !== facts.driverMessageCount ||
    fromLog.rider !== facts.riderMessageCount ||
    fromLog.driver + fromLog.rider !== facts.messages.length
  ) {
    violations.push({
      rule: "parties.consistent",
      detail: `العدّاداتُ (سائقٌ ${facts.driverMessageCount} · راكبٌ ${facts.riderMessageCount}) تُخالِفُ السجلَّ (سائقٌ ${fromLog.driver} · راكبٌ ${fromLog.rider} · كلٌّ ${facts.messages.length}) — الطرفُ المُخاطَبُ غيرُ مُسنَدٍ.`,
    });
  }

  const pushed = pushMessages(facts.messages);
  const replies = replyMessages(facts.messages);

  // ٤) سببُ كلِّ رسالةٍ مُعلَنٌ: سببٌ فارغٌ يجعلُ القسمةَ بينَ الدفعِ والردِّ وهماً.
  for (const message of facts.messages) {
    if (message.cause === "") {
      violations.push({
        rule: "push.cause-declared",
        detail: `رسالةٌ إلى «${message.party}» بلا سببٍ مُعلَنٍ — وما لا سببَ له لا يُصنَّفُ دفعاً ولا ردّاً.`,
      });
    }
  }

  // ٥) القاعدةُ الحاكمةُ: رسالةُ الدفعِ لا تخرجُ إلى مَن أرسلَ التحديثَ نفسَه —
  //    وإلّا فهيَ ردُّ حوارٍ صُنِّفَ دفعاً، فيُضخَّمُ الخطرُ ويُفسَدُ القياسُ.
  for (const message of pushed) {
    if (message.duringUpdateFrom !== null && message.duringUpdateFrom === message.party) {
      violations.push({
        rule: "push.unsolicited-only",
        detail: `رسالةُ دفعٍ سببُها «${message.cause}» خرجَت إلى «${message.party}» أثناءَ معالجةِ تحديثٍ منه هوَ — فهيَ ردُّ حوارٍ لا دفعٌ.`,
      });
    }
  }

  // ٦) سقفُ الدفعِ.
  if (pushed.length > budget) {
    violations.push({
      rule: "push.within-budget",
      detail: `${pushed.length} رسالةَ دفعٍ في الرحلةِ تتجاوزُ السقفَ ${budget}.`,
    });
  }

  // ٧) كلُّ ردٍّ مشدودٌ إلى تحديثٍ: ردٌّ بلا تحديثٍ دفعٌ غيرُ مُعلَنٍ.
  for (const message of replies) {
    if (message.duringUpdateFrom === null || message.updateIndex === null) {
      violations.push({
        rule: "reply.attributed",
        detail: `ردُّ حوارٍ إلى «${message.party}» بلا تحديثٍ يُسنَدُ إليه — وما خرجَ بلا طلبٍ دفعٌ يُحسَبُ في سقفِ الدفعِ.`,
      });
    } else if (message.duringUpdateFrom !== message.party) {
      violations.push({
        rule: "reply.attributed",
        detail: `ردُّ حوارٍ إلى «${message.party}» أثناءَ تحديثٍ من «${message.duringUpdateFrom}» — المُخاطَبُ غيرُ المُرسِلِ فهذا دفعٌ لا ردٌّ.`,
      });
    }
  }

  // ٨) لا دفقةَ ردٍّ تتجاوزُ الحدَّ المُعلَنَ: الإغراقُ يُخفي نفسَه في الإجماليِّ.
  const burstByUpdate = new Map<string, number>();
  for (const message of replies) {
    if (message.updateIndex === null) continue;
    const key = `${message.party}#${message.updateIndex}`;
    burstByUpdate.set(key, (burstByUpdate.get(key) ?? 0) + 1);
  }
  for (const [key, count] of burstByUpdate) {
    if (count > profile.maxReplyBurst) {
      violations.push({
        rule: "reply.burst-bounded",
        detail: `${count} رسالةً في ردٍّ واحدٍ على التحديثِ «${key}» تتجاوزُ الحدَّ المُعلَنَ ${profile.maxReplyBurst}.`,
      });
    }
  }

  // ٩) سقفُ الرحلةِ كلِّها.
  const rideCap = rideMessageBudget(facts.inboundUpdateCount, profile);
  if (facts.messages.length > rideCap) {
    violations.push({
      rule: "ride.within-budget",
      detail: `${facts.messages.length} رسالةً في الرحلةِ تتجاوزُ سقفَ الرحلةِ ${rideCap}.`,
    });
  }

  // ١٠) السقفُ مُشتَقٌّ لا مكتوبٌ: من كتبَهُ رقماً أكبرَ سقطَ.
  const derived = pushMessageBudget(profile);
  if (budget !== derived) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ الدفعِ المُستعمَلُ ${budget} لا يُطابِقُ المُشتَقَّ من الشكلِ ${derived} (بثٌّ ${profile.offeredDriverCount}×${profile.broadcastRoundCount} + انتقالاتٌ ${profile.crossPartyTransitionCount} + تقييمٌ مدفوعٌ ${profile.pushedRatingPromptCount}).`,
    });
  }
  if (profile.maxReplyBurst > maxAllowedReplyBurst()) {
    violations.push({
      rule: "budget.derived",
      detail: `حدُّ الدفقةِ ${profile.maxReplyBurst} فوقَ أقصى المسموحِ ${maxAllowedReplyBurst()} — ورفعُه لاستيعابِ إغراقٍ تليينٌ للبوّابةِ.`,
    });
  }

  // ١١) الفُرجةُ عن حدِّ `TG-001`: رحلةٌ واحدةٌ لا تبلغُ ≈30 رسالةً في الثانيةِ،
  //     فلا بثَّ مدفوعاً تستدعيه رحلةٌ منفردةٌ. وهذا حكمُ عددٍ لا حكمُ سعرٍ.
  if (facts.messages.length > TELEGRAM_FREE_RATE_PER_SECOND) {
    violations.push({
      rule: "rate-limit.headroom",
      detail: `${facts.messages.length} رسالةً لرحلةٍ واحدةٍ تبلغُ أو تتجاوزُ حدَّ ${TELEGRAM_FREE_RATE_PER_SECOND} رسالةً/ثانيةً (TG-001) — فرحلةٌ منفردةٌ صارَت تستدعي البثَّ المدفوعَ، وذاكَ قرارُ DEC-04 لا أثرٌ جانبيٌّ.`,
    });
  }

  // ١٢) عددُ الأنواعِ الحرجةِ من مصدرٍ واحدٍ: رقمٌ مكتوبٌ في القياسِ يُنسى تحديثُه.
  if (facts.criticalKindCount !== declaredCriticalKindCount) {
    violations.push({
      rule: "kinds.single-source",
      detail: `عددُ الأنواعِ الحرجةِ في القياسِ ${facts.criticalKindCount} يُخالِفُ المصدرَ الواحدَ ${declaredCriticalKindCount} (${NOTIFICATION_KINDS_FILE}).`,
    });
  }

  return violations;
}

/** وصفُ مخالفةٍ سطراً واحداً — للحاجزِ وللدليلِ. */
export function describeTelegramViolation(violation: TelegramMessageViolation): string {
  return `${violation.rule}: ${violation.detail}`;
}

/**
 * وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**: العددُ ليسَ تكلفةً.
 */
export function summarizeTelegramMessages(facts: TelegramMessageFacts, budget: number): string {
  const pushed = pushMessages(facts.messages).length;
  const replies = facts.messages.length - pushed;
  return (
    `${facts.messages.length} رسالةَ تيليجرام في رحلةٍ واحدةٍ — ` +
    `${pushed} منها دفعٌ من سقفِ ${budget} · ${replies} ردُّ حوارٍ على ` +
    `${facts.inboundUpdateCount} تحديثاً وارداً · ` +
    `سائقٌ ${facts.driverMessageCount} · راكبٌ ${facts.riderMessageCount}. ` +
    `وكلُّها دونَ حدِّ ${TELEGRAM_FREE_RATE_PER_SECOND} رسالةً/ثانيةً (TG-001). ` +
    "ولا يُدَّعى أنَّ هذا تكلفةٌ: العددُ مقيسٌ وتمكينُ البثِّ المدفوعِ وسعرُه في قرارِ DEC-04."
  );
}
