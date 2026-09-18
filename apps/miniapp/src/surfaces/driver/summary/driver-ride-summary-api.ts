/**
 * الغرض: نداءا الملخَّصِ والتقييمِ للسائقِ — سطرانِ فوقَ حدِّ API ولا منطقَ عرضٍ
 *   (البند `F12-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F12-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/summary
 * يُستخدم من: `DriverRideSummaryScreen.tsx`.
 *
 * ## لماذا مِلفٌّ مستقلٌّ لا استيرادٌ من راكبٍ
 *
 * لأنَّ السائقَ يرى بطاقةَ الراكبِ (`rider`) لا بطاقةَ السائقِ (`driver`)،
 * والاتّجاهَ `driver_to_rider` لا `rider_to_driver`. والعقدُ واحدٌ والعرضُ مختلفٌ.
 * فيُستورَدُ العقدُ من راكبٍ، ويُعادُ تصديرُه هنا، وتُكتبُ الدالّتانِ فوقَه.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يستقصي دوريّاً**: الملخَّصُ يُقرأُ مرّةً — الرحلةُ انتهت.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API.
 *   ــ **لا وسومَ للسائقِ**: النجومُ والملاحظةُ وحدَها في تقييمِ السائقِ للراكبِ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  RideRatingResponse,
  RideSummaryResponse,
} from "../../rider/summary/ride-summary-contract.ts";

export type * from "../../rider/summary/ride-summary-contract.ts";

export function readDriverRideSummary(orderId: string): Promise<RideSummaryResponse> {
  return apiFetch<RideSummaryResponse>(`/v1/rides/${encodeURIComponent(orderId)}/summary`, {
    method: "GET",
  });
}

export function submitDriverRideRating(
  orderId: string,
  input: {
    readonly stars: number;
    readonly comment: string | null;
  },
): Promise<RideRatingResponse> {
  return apiFetch<RideRatingResponse>(`/v1/rides/${encodeURIComponent(orderId)}/rating`, {
    method: "POST",
    body: JSON.stringify({
      stars: input.stars,
      comment: input.comment === null || input.comment.trim().length === 0 ? null : input.comment,
      tags: [],
    }),
  });
}
