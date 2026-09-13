/**
 * الغرض: نموذجُ عرضِ ملخَّصِ الرحلةِ المنتهيةِ — **مفاتيحُ نصٍّ وأرقامٌ لا نصٌّ**:
 *   سطرُ المدّةِ، وسطرُ **وترِ الخطِّ المستقيمِ**، وحالةُ التقييمِ، ووسومُه
 *   (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/summary
 * يُستخدم من: `RideSummaryScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (صفحةُ المشاركةِ) تعرضُ السطرَينِ نفسَيهما.
 *
 * ## لماذا المدّةُ والوترُ **اتّحادانِ بحكمٍ** لا رقمانِ مُنسَّقانِ
 *
 * «لم يُسجَّلْ بدءُ الرحلةِ» و«لا وجهةَ لهذه الخدمةِ» خبرانِ يُقالانِ للراكبِ،
 * وشَرطةٌ واحدةٌ تُساويهما فتُفقَدُ المعلومةُ. **ولا يُعرَضُ صفرٌ أبداً**: «٠ د»
 * تُقرأُ رحلةً لحظيّةً و«٠ م» تُقرأُ «لم تتحرَّكْ» — وكلاهما كذبٌ عن غيابٍ.
 *
 * ## ولماذا الوترُ يُعرَضُ بمفتاحٍ **يذكرُ الخطَّ المستقيمَ** في نصِّه
 *
 * الرقمُ وحدَه يُقرأُ «المسافةَ»، ولا أثرَ مسارٍ في القاعدةِ فالمقطوعُ **غيرُ
 * مُقاسٍ**. فمفتاحُ النصِّ نفسُه (`…straightLine…`) يحملُ القيدَ، وحاجزٌ ساكنٌ
 * يُسقِطُ أيَّ رقمِ مسافةٍ يُعرَضُ بمفتاحٍ لا يُصرِّحُ به.
 *
 * ## ولماذا الوسومُ تُقرأُ من النطاقِ لا من قائمةٍ مكتوبةٍ ههنا
 *
 * `RATING_TAGS` في النطاقِ هيَ نظيرُ مُعجَمِ القاعدةِ، ومُقابَلتُهما محروسةٌ.
 * فقائمةٌ ثالثةٌ ههنا تفترقُ عندَ أوّلِ زيادةٍ، فيُرسَلُ وسمٌ يُرَدُّ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ مبلغاً ولا أجرةً ولا إكراميّةً** (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يخترعُ حكماً**: أهليّةُ التقييمِ من الردِّ، وزرُّ الإرسالِ يُرسَمُ
 *      بحكمِ القاعدةِ (`canRate`) وحدَه.
 *   ــ **لا يُصيغُ نصّاً**: النصُّ في `packages/shared/i18n` وحدَه.
 *   ــ **لا يرسمُ زرَّ تذكرةِ دعمٍ**: لا مسارَ لها في هذا البندِ — غيابٌ
 *      مُصرَّحٌ، وزرٌّ بلا مسارٍ وعدٌ لا عقدٌ.
 */

import {
  MAX_RATING_COMMENT_LENGTH,
  MAX_RATING_TAGS,
  RATING_TAGS,
} from "../../../../../../packages/domain/transport/ride-summary.ts";

/** يُعادُ نشرُها كي تستوردَ الشاشةُ حدودَها من بابٍ واحدٍ ولا تنسخَ رقماً. */
export { MAX_RATING_COMMENT_LENGTH, MAX_RATING_TAGS, RATING_TAGS };

/** سطرُ المدّةِ — دقائقُ وثوانٍ، أو غيابٌ بسببِه. ولا صفرَ ولا شَرطةَ. */
export type DurationLine =
  | {
      readonly known: true;
      readonly key: string;
      readonly minutes: number;
      readonly seconds: number;
    }
  | { readonly known: false; readonly key: string };

const DURATION_MISSING_KEYS: Readonly<Record<string, string>> = {
  MISSING_STAMP: "rider.summary.duration.missingStamp",
};

export function durationLine(
  duration:
    | { readonly known: true; readonly minutes: number; readonly seconds: number }
    | { readonly known: false; readonly reason: string },
): DurationLine {
  if (!duration.known) {
    return {
      known: false,
      key: DURATION_MISSING_KEYS[duration.reason] ?? "rider.summary.duration.unknown",
    };
  }
  const minutes = Number.isFinite(duration.minutes) ? Math.max(0, Math.trunc(duration.minutes)) : 0;
  const seconds = Number.isFinite(duration.seconds) ? Math.max(0, Math.trunc(duration.seconds)) : 0;
  // رحلةٌ دونَ دقيقةٍ تُعرَضُ بالثواني: «٠ د» تُقرأُ «لا مدّةَ» لا «٤٠ ثانيةً».
  return {
    known: true,
    key: minutes === 0 ? "rider.summary.duration.seconds" : "rider.summary.duration.minutes",
    minutes,
    seconds,
  };
}

/**
 * سطرُ وترِ الخطِّ المستقيمِ — **بمفتاحٍ يُصرِّحُ بأنَّه وترٌ**، أو غيابٌ بسببِه.
 * والكيلومترُ يُعرَضُ بخانةٍ عشريّةٍ واحدةٍ فوقَ الكيلومترِ، وبالأمتارِ دونَه:
 * «٠٫٣ كم» أقلُّ صدقاً من «٣٢٠ م» عن رقمٍ وترُه ليسَ مقطوعاً أصلاً.
 */
export type StraightLineLine =
  | {
      readonly known: true;
      readonly key: string;
      readonly meters: number;
      readonly kilometers: string;
    }
  | { readonly known: false; readonly key: string };

const STRAIGHT_LINE_MISSING_KEYS: Readonly<Record<string, string>> = {
  NO_DROPOFF: "rider.summary.straightLine.noDropoff",
  NOT_MEASURED: "rider.summary.straightLine.notMeasured",
};

export function straightLineLine(
  line:
    | { readonly known: true; readonly meters: number }
    | { readonly known: false; readonly reason: string },
): StraightLineLine {
  if (!line.known) {
    return {
      known: false,
      key: STRAIGHT_LINE_MISSING_KEYS[line.reason] ?? "rider.summary.straightLine.unknown",
    };
  }
  const meters = Number.isFinite(line.meters) && line.meters > 0 ? line.meters : 0;
  return {
    known: true,
    key:
      meters >= 1000
        ? "rider.summary.straightLine.kilometers"
        : "rider.summary.straightLine.meters",
    meters: Math.round(meters),
    kilometers: (meters / 1000).toFixed(1),
  };
}

const ELIGIBILITY_KEYS: Readonly<Record<string, string>> = {
  CAN_RATE: "rider.summary.rating.canRate",
  ALREADY_RATED: "rider.summary.rating.alreadyRated",
  WINDOW_CLOSED: "rider.summary.rating.windowClosed",
  RIDE_NOT_COMPLETED: "rider.summary.rating.notCompleted",
};

/** تصنيفُ الأهليّةِ ⇒ مفتاحُ نصٍّ. وما لا يُعرَفُ يُقالُ عامّاً لا خاماً. */
export function eligibilityKey(code: string): string {
  return ELIGIBILITY_KEYS[code] ?? "rider.summary.rating.unknown";
}

/** وسمٌ ⇒ مفتاحُ نصِّه. والمفاتيحُ مشتقّةٌ من المُعجَمِ لا مكتوبةٌ ثانيةً. */
export function tagKey(tag: string): string {
  return `rider.summary.tag.${tag}`;
}

const RATING_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  STARS_OUT_OF_RANGE: "rider.summary.refusal.stars",
  ORDER_NOT_FOUND: "rider.summary.refusal.notFound",
  ORDER_NOT_COMPLETED: "rider.summary.refusal.notCompleted",
  RATER_NOT_PARTY_TO_ORDER: "rider.summary.refusal.notParty",
  RATING_WINDOW_CLOSED: "rider.summary.refusal.windowClosed",
  ALREADY_RATED: "rider.summary.refusal.alreadyRated",
  UNKNOWN_RATING_TAG: "rider.summary.refusal.unknownTag",
  TOO_MANY_RATING_TAGS: "rider.summary.refusal.tooManyTags",
  DUPLICATE_RATING_TAG: "rider.summary.refusal.duplicateTag",
  COMMENT_TOO_LONG: "rider.summary.refusal.commentTooLong",
};

export function ratingRefusalKey(code: string): string {
  return RATING_REFUSAL_KEYS[code] ?? "rider.summary.refusal.unknown";
}

const READ_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_ORDER_ID: "rider.summary.read.invalidId",
  ORDER_NOT_FOUND: "rider.summary.read.notFound",
};

export function summaryRefusalKey(code: string): string {
  return READ_REFUSAL_KEYS[code] ?? "rider.summary.read.unknown";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.summary.error.session",
  SESSION_INVALID: "rider.summary.error.session",
  SESSION_EXPIRED: "rider.summary.error.session",
  SESSION_NOT_AVAILABLE: "rider.summary.error.unavailable",
  MALFORMED: "rider.summary.error.malformed",
  INVALID_JSON: "rider.summary.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.summary.error.account",
  RIDER_NOT_REGISTERED: "rider.summary.error.notRegistered",
  RIDE_STORE_NOT_AVAILABLE: "rider.summary.error.unavailable",
  STARS_OUT_OF_RANGE: "rider.summary.refusal.stars",
  COMMENT_TOO_LONG: "rider.summary.refusal.commentTooLong",
  UNKNOWN_RATING_TAG: "rider.summary.refusal.unknownTag",
  TOO_MANY_RATING_TAGS: "rider.summary.refusal.tooManyTags",
  DUPLICATE_RATING_TAG: "rider.summary.refusal.duplicateTag",
};

export function summaryErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.summary.error.unavailable";
}

/**
 * وهل يُرسَمُ زرُّ الإرسالِ؟ **بحكمِ القاعدةِ وحدَه** (`canRate`) لا بتصنيفِ
 * النطاقِ: زرٌّ يُرسَمُ ثمَّ يُرفَضُ نداؤُه أسوأُ من زرٍّ لا يُرسَمُ ومعَه سببُه.
 */
export function showsRatingForm(rating: { readonly canRate: boolean }): boolean {
  return rating.canRate;
}

/**
 * وهل يُقبَلُ الإرسالُ بما اختارَه الراكبُ؟ **حدُّ شاشةٍ لا حكمٌ**: النجومُ
 * إلزاميّةٌ، والوسومُ محصورةٌ عدداً، والملاحظةُ محدودةٌ طولاً — والقاعدةُ
 * تُعيدُ الفحصَ كلَّه وهيَ الحكمُ.
 */
export function canSubmitRating(input: {
  readonly stars: number | null;
  readonly tags: readonly string[];
  readonly comment: string;
}): boolean {
  if (input.stars === null) return false;
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) return false;
  if (input.tags.length > MAX_RATING_TAGS) return false;
  if (new Set(input.tags).size !== input.tags.length) return false;
  if (input.tags.some((tag) => !(RATING_TAGS as readonly string[]).includes(tag))) return false;
  return input.comment.length <= MAX_RATING_COMMENT_LENGTH;
}
