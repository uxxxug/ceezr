/**
 * الغرض: حالةُ استخدامِ إرسالِ تقييمِ الراكبِ للسائقِ بوسومٍ من مُعجَمٍ محصورٍ —
 *   حدٌّ يفحصُ المُدخلَ بالنطاقِ، والقاعدةُ **هيَ الحكمُ** على المِلكيّةِ
 *   والنافذةِ والتكرارِ (البند `F2-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts` (`POST /v1/rides/:id/rating`)
 * يُتوقع أن يستخدمه لاحقاً: `SD-09` (تقييمُ السائقِ للراكبِ) يُنادي الأمرَ
 *   نفسَه من سطحِ السائقِ — الاتّجاهُ يُستنتَجُ في القاعدةِ لا ههنا.
 * ملاحظات مستقبلية: `F12-16` (بلاغُ تقييمٍ مُسيءٍ) يُنادي `flag_rating`
 *   القائمةَ في القاعدةِ، ولا يُوسِّعُ هذا الأمرَ.
 *
 * ## لماذا يُفحَصُ المُدخلُ ههنا **والقاعدةُ تفحصُه ثانيةً**
 *
 * القاعدة 0.6 لا تعني فحصاً واحداً، تعني **حُكماً واحداً**. والحكمُ في القاعدةِ
 * (قيدُ `ratings_tags_vocabulary` · القيدُ الفريدُ · النافذةُ بساعةِ القاعدةِ)،
 * والفحصُ ههنا **حدٌّ**: نجومٌ ليسَت عدداً صحيحاً في المدى أو ملاحظةٌ فوقَ الحدِّ
 * أو وسمٌ مجهولٌ **لا تستحقُّ جولةَ شبكةٍ ولا صفّاً في سجلٍّ**، ورمزُ رفضِها
 * ههنا **هوَ رمزُ القاعدةِ نفسُه** فلا يرى الراكبُ نصَّينِ لخطأٍ واحدٍ.
 *
 * ## ولماذا رفضُ القاعدةِ **يُنشَرُ رمزاً** ولا يُطوى عطباً
 *
 * `ALREADY_RATED` جوابٌ صحيحٌ عن سؤالٍ صحيحٍ: التقييمُ مكتوبٌ سلفاً. و`500`
 * مكانَه يجعلُ السطحَ يُعيدُ المحاولةَ بلا أملٍ ثمَّ يقولُ «عطبٌ» لِما ليسَ
 * عطباً. وكذلكَ `RATING_WINDOW_CLOSED` و`ORDER_NOT_COMPLETED`: أخبارٌ تُقالُ.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تقرأُ الملخَّصَ قبلَ الإرسالِ** ولا تفحصُ الأهليّةَ بنفسِها: فحصٌ
 *      كذلكَ **سباقٌ** — تُقرأُ `can_rate` ثمَّ تُكتَبُ، وبينَهما تُغلَقُ
 *      النافذةُ أو يسبقُ نداءٌ آخرُ. والقيدُ الفريدُ والنافذةُ في العبارةِ
 *      نفسِها هما الحكمُ.
 *   ــ **لا تُمرِّرُ اتّجاهاً**: من ليسَ طرفاً في الرحلةِ يُرَدُّ من القاعدةِ.
 *   ــ **لا تحسبُ متوسِّطاً**: `recompute_ratee_averages` في القاعدةِ.
 *   ــ **لا تعرفُ مبلغاً ولا إكراميّةً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 */

import {
  isRatingStars,
  MAX_RATING_COMMENT_LENGTH,
  readRatingTags,
} from "../../domain/transport/ride-summary.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type { RideRatingCommand, RideRatingVerdict } from "./ride-summary-ports.ts";

export interface SubmitRideRatingDeps {
  readonly sessions: MiniAppSessionReader;
  readonly ratings: RideRatingCommand;
  readonly now: () => Date;
}

/**
 * رمزُ الخطأِ المنشورُ — اتّحادُ رموزِ الجلسةِ والمخزنِ (مُعادٌ استعمالُه كما
 * هوَ) **وزيادةُ رموزِ حدِّ التقييمِ**. ولم يُوسَّعْ `RequestRidePublicErrorCode`
 * نفسُه: توسيعُه يُلزِمُ **كلَّ** مسارٍ يقرأُه بخريطةِ حالاتٍ لرموزٍ لا تخصُّه.
 */
export type SubmitRideRatingPublicErrorCode =
  | RequestRidePublicErrorCode
  | "STARS_OUT_OF_RANGE"
  | "COMMENT_TOO_LONG"
  | "UNKNOWN_RATING_TAG"
  | "TOO_MANY_RATING_TAGS"
  | "DUPLICATE_RATING_TAG";

export interface SubmitRideRatingInput {
  readonly accessToken: string | undefined;
  readonly orderId: string;
  readonly stars: unknown;
  readonly comment: unknown;
  readonly tags: unknown;
}

export async function submitRideRating(
  deps: SubmitRideRatingDeps,
  input: SubmitRideRatingInput,
): Promise<Result<RideRatingVerdict, SubmitRideRatingPublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  if (!isRatingStars(input.stars)) return err("STARS_OUT_OF_RANGE");

  // الملاحظةُ: `null` و`undefined` والنصُّ الفارغُ **غيابٌ واحدٌ**، والقاعدةُ
  // تُجرِّدُ الفراغَ وتُعدِمُه. وغيرُ النصِّ **مُدخلٌ فاسدٌ** لا ملاحظةٌ فارغةٌ.
  let comment: string | null = null;
  if (input.comment !== undefined && input.comment !== null) {
    if (typeof input.comment !== "string") return err("MALFORMED");
    if (input.comment.length > MAX_RATING_COMMENT_LENGTH) return err("COMMENT_TOO_LONG");
    comment = input.comment.trim().length === 0 ? null : input.comment;
  }

  const tags = readRatingTags(input.tags);
  if (!tags.accepted) return err(tags.refusal);

  const submitted = await deps.ratings.submit({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
    stars: input.stars as number,
    comment,
    tags: tags.tags,
  });
  if (!submitted.ok) return err(rideStoreErrorFrom(submitted.error));

  return ok(submitted.value);
}
