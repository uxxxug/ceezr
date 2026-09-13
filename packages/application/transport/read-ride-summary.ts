/**
 * الغرض: حالةُ استخدامِ قراءةِ ملخَّصِ الرحلةِ المنتهيةِ — مدّةٌ بحكمٍ، ووترُ
 *   خطٍّ مستقيمٍ **بحكمٍ مُصنَّفٍ لا رقمٍ عارٍ**، وأهليّةُ تقييمٍ مُصنَّفةٌ
 *   (البند `F2-07` · `SR-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts` (`GET /v1/rides/:id/summary`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` (مشاركةُ الرحلةِ) يقرأُ الملخَّصَ نفسَه
 *   لصفحةِ المشاركةِ ولا يكتبُ قارئاً ثانياً.
 * ملاحظات مستقبلية: متى فُكَّ تجميدُ الأجرةِ (`DEC-11`) فالإيصالُ **حالةُ
 *   استخدامٍ أُخرى** لها ملفُّها، ولا يُدَسُّ حقلُ مبلغٍ في هذا العرضِ.
 *
 * ## لماذا قارئٌ ثانٍ ولم يُستعمَلْ قارئُ `F2-06` بعدَ `completed`
 *
 * رأسُ `read-active-ride.ts` توقَّعَ ذلكَ («`F2-07` يقرأُ بهذا القارئِ نفسِه»)،
 * **والقياسُ نقضَ التوقُّعَ**: لقطةُ النشطةِ لا تحملُ مدّةً محسوبةً ولا وتراً ولا
 * حالةَ تقييمٍ، وتحملُ **موقعَ سائقٍ وعُمرَه** ومدّةَ وصولٍ تُطلَبُ من محرِّكِ
 * توجيهٍ. فاستعمالُها ههنا يعني نداءَ محرِّكٍ لرحلةٍ انتهت، ثمَّ حسابَ المدّةِ
 * والوترِ في طبقةٍ لا تملكُ ساعةَ القاعدةِ ولا `st_distance`. فالقارئُ الثاني
 * **تصحيحٌ بالإضافةِ** (`ح-8`): الرأسُ القديمُ يبقى مكتوباً، وهذا السطرُ يقولُ
 * لماذا لم يُنفَّذْ توقُّعُه.
 *
 * ## ولماذا أهليّةُ التقييمِ تُحسَبُ ههنا **ومعَها حكمُ القاعدةِ**
 *
 * القاعدةُ تنشرُ `can_rate` (بساعتِها) والنطاقُ يُصنِّفُ (`CAN_RATE` ·
 * `ALREADY_RATED` · `WINDOW_CLOSED` · `RIDE_NOT_COMPLETED`). والاثنانِ
 * يُنشَرانِ معاً **لا أحدُهما**: الرايةُ وحدَها لا تُترجَمُ نصّاً، والتصنيفُ
 * وحدَه يُخفي أنَّ الحكمَ الملزِمَ حكمُ القاعدةِ. **وتنافرُهما عطبٌ يُرى** في
 * الردِّ نفسِه لا يُطوى.
 *
 * ## وما لا تفعلُه هذه الحالةُ عن قصدٍ
 *
 *   ــ **لا تكتبُ شيئاً**: تبعيّاتُها قارئٌ وجلسةٌ وساعةٌ — ومن قرأَ المُركِّبَ
 *      رأى أنَّ مسارَ `GET` لا يملكُ حقَّ كتابةٍ.
 *   ــ **لا تسألُ محرِّكَ توجيهٍ**: لا مدّةَ وصولٍ لرحلةٍ انتهت.
 *   ــ **لا تُنسِّقُ نصّاً ولا تُرجِمُ**: رموزٌ وأرقامٌ، والنصُّ في `i18n`.
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا تفتحُ تذكرةَ دعمٍ** — غيابٌ مُصرَّحٌ بلا زرٍّ.
 */

import {
  type RatingEligibility,
  type RideDurationVerdict,
  ratingEligibilityOf,
  rideDurationVerdict,
  type StraightLineVerdict,
  straightLineVerdict,
} from "../../domain/transport/ride-summary.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import { type RequestRidePublicErrorCode, rideStoreErrorFrom } from "./request-ride.ts";
import type {
  RideSummaryReader,
  RideSummaryRefusal,
  RideSummaryState,
} from "./ride-summary-ports.ts";

export interface ReadRideSummaryDeps {
  readonly sessions: MiniAppSessionReader;
  readonly rides: RideSummaryReader;
  readonly now: () => Date;
}

export interface RideSummaryView {
  readonly state: RideSummaryState;
  readonly duration: RideDurationVerdict;
  /** **وترٌ** لا مقطوعٌ — والاسمُ حكمٌ لا تفصيلُ عرضٍ. */
  readonly straightLine: StraightLineVerdict;
  readonly eligibility: RatingEligibility;
}

export type ReadRideSummaryResult =
  | { readonly found: true; readonly view: RideSummaryView }
  | { readonly found: false; readonly refusal: RideSummaryRefusal };

export async function readRideSummary(
  deps: ReadRideSummaryDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<ReadRideSummaryResult, RequestRidePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }

  const read = await deps.rides.read({
    telegramUserId: session.value.telegramUserId,
    orderId: input.orderId,
  });
  if (!read.ok) return err(rideStoreErrorFrom(read.error));

  const verdict = read.value;
  if (!verdict.found) return ok({ found: false, refusal: verdict.refusal });

  const { state } = verdict;
  return ok({
    found: true,
    view: {
      state,
      duration: rideDurationVerdict(state.durationSeconds),
      straightLine: straightLineVerdict(state.straightLineMeters),
      eligibility: ratingEligibilityOf({
        status: state.status,
        alreadyRated: state.rating.alreadyRated,
        windowClosed: state.rating.windowClosed,
      }),
    },
  });
}
