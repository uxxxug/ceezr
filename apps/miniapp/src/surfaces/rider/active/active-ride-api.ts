/**
 * الغرض: نداءُ لقطةِ الرحلةِ النشطةِ — سطرٌ واحدٌ فوقَ حدِّ API ولا منطقَ عرضٍ
 *   (البند `F2-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `ActiveRideScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` (شاشةُ الإنهاءِ) تقرأُ اللقطةَ نفسَها.
 *
 * ## لماذا مِلفٌّ لنداءٍ واحدٍ
 *
 * كي تبقى الشاشةُ مقيسةً بلا شبكةٍ: الاختبارُ يُمرِّرُ دالّةً بديلةً، ولا
 * يُرقَّعُ `fetch` عالميّاً. وحدُّ API واحدٌ (`api/client.ts`) يملكُ الرمزَ
 * والترويساتِ والأخطاءَ، فلا تُعادُ كتابتُها ههنا.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يستقصي دوريّاً**: التكرارُ قرارُ الشاشةِ لا قرارُ الناقلِ.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API.
 *   ــ **لا يُصلِحُ ردّاً ناقصاً**: العقدُ يُقرأُ كما نُشِرَ.
 */

import { apiFetch } from "../../../api/client.ts";
import type { ActiveRideResponse } from "./active-ride-contract.ts";

export type * from "./active-ride-contract.ts";

export function readRide(orderId: string): Promise<ActiveRideResponse> {
  return apiFetch<ActiveRideResponse>(`/v1/rides/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}
