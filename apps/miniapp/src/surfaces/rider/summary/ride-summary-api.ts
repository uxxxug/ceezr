/**
 * الغرض: نداءا الملخَّصِ والتقييمِ — سطرانِ فوقَ حدِّ API ولا منطقَ عرضٍ
 *   (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/summary
 * يُستخدم من: `RideSummaryScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` تقرأُ الملخَّصَ بالدالّةِ نفسِها.
 *
 * ## لماذا مِلفٌّ لنداءَينِ
 *
 * كي تبقى الشاشةُ مقيسةً بلا شبكةٍ: الاختبارُ يُمرِّرُ دالّةً بديلةً، ولا
 * يُرقَّعُ `fetch` عالميّاً. وحدُّ API واحدٌ (`api/client.ts`) يملكُ الرمزَ
 * والترويساتِ والأخطاءَ، فلا تُعادُ كتابتُها ههنا.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يستقصي دوريّاً**: الملخَّصُ يُقرأُ مرّةً — الرحلةُ انتهت.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API.
 *   ــ **لا يفحصُ نجوماً ولا وسماً**: النطاقُ يفحصُ والقاعدةُ تحكمُ.
 *   ــ **لا يُرسِلُ ترويسةَ `Idempotency-Key`**: القيدُ الفريدُ في القاعدةِ هوَ
 *      الحاجزُ، ومفتاحٌ ثانٍ يُنشئُ حكماً يخالفُه.
 */

import { apiFetch } from "../../../api/client.ts";
import type { RideRatingResponse, RideSummaryResponse } from "./ride-summary-contract.ts";

export type * from "./ride-summary-contract.ts";

export function readRideSummary(orderId: string): Promise<RideSummaryResponse> {
  return apiFetch<RideSummaryResponse>(`/v1/rides/${encodeURIComponent(orderId)}/summary`, {
    method: "GET",
  });
}

export function submitRideRating(
  orderId: string,
  input: {
    readonly stars: number;
    readonly comment: string | null;
    readonly tags: readonly string[];
  },
): Promise<RideRatingResponse> {
  return apiFetch<RideRatingResponse>(`/v1/rides/${encodeURIComponent(orderId)}/rating`, {
    method: "POST",
    body: JSON.stringify({
      stars: input.stars,
      // النصُّ الفارغُ **غيابٌ** لا ملاحظةٌ: يُرسَلُ `null` فلا يُخزَّنُ وجهانِ
      // لمعنىً واحدٍ في القاعدةِ.
      comment: input.comment === null || input.comment.trim().length === 0 ? null : input.comment,
      tags: input.tags,
    }),
  });
}
