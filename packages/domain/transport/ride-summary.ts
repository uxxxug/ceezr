/**
 * الغرض: نطاقُ ملخَّصِ الرحلةِ المنتهيةِ وتقييمِها — تصنيفُ أهليّةِ التقييمِ،
 *   وحكمُ المدّةِ، وحكمُ **وترِ الخطِّ المستقيمِ** (لا مسافةٍ مقطوعةٍ)، ومُعجَمُ
 *   الوسومِ وحكمُ مجموعةٍ منها (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: packages/domain/transport
 * يُستخدم من: `application/transport/{read-ride-summary,submit-ride-rating}.ts`
 *   و`apps/miniapp/src/surfaces/rider/summary/ride-summary-view.ts`
 *   و`scripts/lib/ride-summary-contract.ts` (مقابلةُ المُعجَمِ بالهجرةِ).
 * يُتوقع أن يستخدمه لاحقاً: `SD-09` (تقييمُ السائقِ للراكبِ) يُعيدُ استعمالَ
 *   `readRatingTags` و`RATING_STARS` ولا يكتبُ مُعجَماً ثانياً.
 * ملاحظات مستقبلية: **لا حقلَ أجرةٍ ولا مبلغٍ ولا وسيلةِ دفعٍ ههنا ولا خانةً
 *   لها** قبلَ `DEC-11` (`ADR 0039` §٤ · `م13-7`)؛ ومتى فُكَّ التجميدُ فالإيصالُ
 *   الماليُّ **مقولةٌ أُخرى** لها ملفُّها لا حقلٌ يُدَسُّ في هذا.
 *
 * ## لماذا «وترُ خطٍّ مستقيمٍ» اسمٌ في النطاقِ لا تفصيلُ عرضٍ
 *
 * لأنَّ الاسمَ **هوَ الحكمُ**. لا أثرَ مسارٍ في المخطَّطِ: `orders` فيها نقطتانِ
 * ولا سلسلةَ إحداثيّاتٍ ولا عدّادَ كيلومتراتٍ. فرقمٌ يُسمّى «المسافةَ» وهوَ وترٌ
 * بينَ نقطتَينِ **شاهدٌ كاذبٌ** في نزاعٍ: الرحلةُ حولَ خليجٍ تُقرأُ ثلاثةَ
 * كيلومتراتٍ وقد سارَ السائقُ أحدَ عشرَ. ولو سُمّيَ الحقلُ في النطاقِ
 * `distanceMeters` لَنسخَه السطحُ «المسافةُ» بلا سؤالٍ — والتسميةُ الصريحةُ
 * ههنا هيَ ما يجعلُ الكذبَ **متعبّاً** لا سهلاً. وحاجزٌ ساكنٌ يفرضُها
 * (`scripts/check-ride-summary-contract.ts`).
 *
 * ## ولماذا أهليّةُ التقييمِ **تصنيفٌ** لا رايةٌ واحدةٌ
 *
 * «قيَّمتَ سلفاً» و«انقضَت النافذةُ» و«الرحلةُ لم تنتهِ» ثلاثةُ أخبارٍ مختلفةٍ
 * للراكبِ، وأوَّلُها خبرٌ طيّبٌ والثاني خبرُ فَقْدٍ والثالثُ خطأُ مسارٍ. ورايةُ
 * `canRate: false` وحدَها تُساويها كلَّها فتُفقَدُ المعلومةُ، فتُرسَمُ شاشةٌ
 * صامتةٌ يظنُّ الراكبُ فيها أنَّ الزرَّ عاطلٌ.
 *
 * ## ولماذا مُعجَمُ الوسومِ مكتوبٌ ههنا **ومُقابَلٌ** بالقاعدةِ لا مُشتَقٌّ منها
 *
 * القاعدةُ هيَ الحكمُ (قيدُ `ratings_tags_vocabulary`)، والنطاقُ يحتاجُ القائمةَ
 * **قبلَ أيِّ نداءٍ** كي يُرَدَّ وسمٌ مجهولٌ في الحدِّ لا بعدَ جولةِ شبكةٍ. فهما
 * نسختانِ بالضرورةِ، **والفَرْقُ بينَهما عطبٌ صامتٌ**: وسمٌ يُرسِلُه السطحُ
 * فيُرَدُّ من القاعدةِ برمزٍ لا يُترجَمُ. ولذلكَ **يُقابِلُهما حاجزٌ ساكنٌ نصّاً**
 * ويسقطُ البناءُ إن افترقَتا — ولا يُشتَقُّ المُعجَمُ من القاعدةِ في زمنِ
 * التشغيلِ: اشتقاقٌ كذلكَ يجعلُ نشرَ عميلٍ يعتمدُ على نداءٍ ناجحٍ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحسبُ أجرةً ولا يعرفُ مبلغاً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا يُصيغُ نصّاً ولا يُنسِّقُ رقماً للعرضِ**: النصُّ في `i18n`، وههنا
 *      أرقامٌ ورموزٌ. وتحويلُ المدّةِ إلى دقائقَ وثوانٍ **حسابٌ لا صياغةٌ**.
 *   ــ **لا يقرأُ ساعةً**: المدّةُ تأتي محسوبةً من القاعدةِ بساعتِها، وحسابُها
 *      ههنا من ختمَينِ يُدخِلُ ساعةً ثالثةً في مقولةٍ لا تحتاجُها.
 *   ــ **لا يعرفُ تقييمَ السائقِ للراكبِ** (`SD-09`): الاتّجاهُ يُستنتَجُ في
 *      القاعدةِ من هويّةِ المُقيِّمِ، ولا يُمرَّرُ من سطحٍ.
 */

/** حدّا النجومِ — مطابقانِ لقيدِ `ratings_stars_check` في القاعدةِ. */
export const MIN_RATING_STARS = 1;
export const MAX_RATING_STARS = 5;

/** حدُّ الملاحظةِ — مطابقٌ لقيدِ `ratings_comment_length` (1000 محرفاً). */
export const MAX_RATING_COMMENT_LENGTH = 1000;

/**
 * سقفُ عددِ الوسومِ. وليسَ ذوقاً: قائمةٌ بلا سقفٍ تُختارُ كلُّها فتستوي
 * التقييماتُ ولا تُفرِّقُ بينَ رحلةٍ ورحلةٍ، فيُفقَدُ معنى الوسمِ أصلاً.
 */
export const MAX_RATING_TAGS = 3;

/**
 * مُعجَمُ وسومِ التقييمِ — **حرفاً بحرفٍ** كما في قيدِ
 * `ratings_tags_vocabulary` في `20260914010000_f2_07_ride_summary_and_rating_tags.sql`.
 * وترتيبُه هوَ ترتيبُ العرضِ، ولا يُعادُ ترتيبُه في السطحِ.
 */
export const RATING_TAGS = [
  "cleanliness",
  "politeness",
  "route_adherence",
  "punctuality",
  "driving_safety",
] as const;

export type RatingTag = (typeof RATING_TAGS)[number];

export function isRatingTag(value: unknown): value is RatingTag {
  return typeof value === "string" && (RATING_TAGS as readonly string[]).includes(value);
}

/** نجومٌ صحيحةٌ في المدى — ولا تقريبَ: `4.5` رفضٌ لا أربعٌ ولا خمسٌ. */
export function isRatingStars(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING_STARS &&
    value <= MAX_RATING_STARS
  );
}

/**
 * حكمُ مجموعةِ الوسومِ.
 *
 * والرفضُ **مُصنَّفٌ**: «وسمٌ لا نعرفُه» غيرُ «اخترتَ أكثرَ من ثلاثةٍ» وغيرُ
 * «وسمٌ مرّتَينِ»، وثلاثتُها تُقالُ للراكبِ بثلاثةِ نصوصٍ. ولا يُصلَحُ المُدخلُ
 * صامتاً: إسقاطُ وسمٍ مجهولٍ يجعلُ الراكبَ يظنُّ أنَّ رأيَه سُجِّلَ وقد أُسقِطَ.
 */
export type RatingTagsVerdict =
  | { readonly accepted: true; readonly tags: readonly RatingTag[] }
  | {
      readonly accepted: false;
      readonly refusal: "UNKNOWN_RATING_TAG" | "TOO_MANY_RATING_TAGS" | "DUPLICATE_RATING_TAG";
    };

/**
 * يقرأُ مجموعةَ وسومٍ من مُدخلٍ غيرِ موثوقٍ (جسمُ طلبٍ). والغيابُ **مقبولٌ**:
 * تقييمٌ بلا وسومٍ تقييمٌ تامٌّ، والوسومُ زيادةُ بيانٍ لا شرطُ صحّةٍ.
 */
export function readRatingTags(value: unknown): RatingTagsVerdict {
  if (value === undefined || value === null) return { accepted: true, tags: [] };
  if (!Array.isArray(value)) return { accepted: false, refusal: "UNKNOWN_RATING_TAG" };
  if (value.length > MAX_RATING_TAGS) return { accepted: false, refusal: "TOO_MANY_RATING_TAGS" };

  const tags: RatingTag[] = [];
  for (const entry of value) {
    if (!isRatingTag(entry)) return { accepted: false, refusal: "UNKNOWN_RATING_TAG" };
    if (tags.includes(entry)) return { accepted: false, refusal: "DUPLICATE_RATING_TAG" };
    tags.push(entry);
  }
  return { accepted: true, tags };
}

/** أهليّةُ التقييمِ — تصنيفٌ واحدٌ يُترجَمُ نصّاً، لا رايةٌ عارِيةٌ. */
export type RatingEligibility =
  | "CAN_RATE"
  | "ALREADY_RATED"
  | "WINDOW_CLOSED"
  | "RIDE_NOT_COMPLETED";

export interface RatingEligibilityFacts {
  /** حالةُ الرحلةِ كما نشرَتها القاعدةُ. */
  readonly status: string;
  readonly alreadyRated: boolean;
  /** انقضاءُ النافذةِ **كما قاسَته القاعدةُ بساعتِها** لا بساعةِ جهازٍ. */
  readonly windowClosed: boolean;
}

/**
 * وترتيبُ الفحصِ مقصودٌ: «لم تنتهِ» أوَّلاً لأنَّها خطأُ مسارٍ لا خبرُ تقييمٍ،
 * ثمَّ «قيَّمتَ سلفاً» لأنَّها خبرٌ طيّبٌ يُقالُ **ولو انقضَت النافذةُ بعدَه** —
 * فمن قيَّمَ لا يُقالُ له «فاتَ الوقتُ».
 */
export function ratingEligibilityOf(facts: RatingEligibilityFacts): RatingEligibility {
  if (facts.status !== "completed") return "RIDE_NOT_COMPLETED";
  if (facts.alreadyRated) return "ALREADY_RATED";
  if (facts.windowClosed) return "WINDOW_CLOSED";
  return "CAN_RATE";
}

/**
 * حكمُ مدّةِ الرحلةِ.
 *
 * و**غيابُ ختمٍ ليسَ صفراً**: رحلةٌ لم يُكتَبْ لها `started_at` مدّتُها
 * **غيرُ معلومةٍ**، وصفرُ دقائقَ يُقرأُ «رحلةً لحظيّةً». والسببُ مُصنَّفٌ كي
 * يُقالَ للراكبِ «لم يُسجَّلْ بدءُ الرحلةِ» لا أن يُعرَضَ «٠ د».
 */
export type RideDurationVerdict =
  | {
      readonly known: true;
      readonly totalSeconds: number;
      readonly minutes: number;
      readonly seconds: number;
    }
  | { readonly known: false; readonly reason: "MISSING_STAMP" };

export function rideDurationVerdict(totalSeconds: number | null): RideDurationVerdict {
  if (totalSeconds === null) return { known: false, reason: "MISSING_STAMP" };
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return { known: false, reason: "MISSING_STAMP" };
  }
  const whole = Math.floor(totalSeconds);
  return {
    known: true,
    totalSeconds: whole,
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  };
}

/**
 * حكمُ وترِ الخطِّ المستقيمِ بينَ نقطةِ الالتقاطِ والوجهةِ.
 *
 * و`NO_DROPOFF` **وسمٌ مُصنَّفٌ لا صفرٌ**: خدمةٌ بلا وجهةٍ (`orders.dropoff`
 * عمودٌ يقبلُ العَدَمَ) لا وترَ لها أصلاً، وصفرُ أمتارٍ يُقرأُ «لم تتحرَّكْ».
 * و`NOT_MEASURED` لحمولةٍ نشرَت رقماً غيرَ منتهٍ — عطبُ عقدٍ يُقالُ ولا يُطوى.
 */
export type StraightLineVerdict =
  | { readonly known: true; readonly meters: number; readonly kilometers: number }
  | { readonly known: false; readonly reason: "NO_DROPOFF" | "NOT_MEASURED" };

export function straightLineVerdict(meters: number | null): StraightLineVerdict {
  if (meters === null) return { known: false, reason: "NO_DROPOFF" };
  if (!Number.isFinite(meters) || meters < 0) return { known: false, reason: "NOT_MEASURED" };
  return { known: true, meters, kilometers: meters / 1000 };
}
