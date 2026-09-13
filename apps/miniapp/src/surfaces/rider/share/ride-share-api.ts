/**
 * الغرض: نداءاتُ مشاركةِ الرحلةِ الثلاثةُ — ثلاثةُ أسطرٍ فوقَ حدِّ API بلا منطقِ
 *   عرضٍ (البند `F2-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/share
 * يُستخدم من: `RideShareCard.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إن شارَكَ بلاغُ الطوارئِ الرابطَ نفسَه.
 *
 * ## لماذا مِلفٌّ لثلاثةِ نداءاتٍ
 *
 * كي تبقى البطاقةُ مقيسةً بلا شبكةٍ: الاختبارُ يُمرِّرُ دالّاتٍ بديلةً ولا
 * يُرقَّعُ `fetch` عالميّاً. وحدُّ API واحدٌ يملكُ الرمزَ والترويساتِ والأخطاءَ.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يبني رابطاً**: الرابطُ يصلُ كاملاً من الخادمِ.
 *   ــ **لا يبتلعُ خطأً ولا يُصلِحُ ردّاً ناقصاً**: العقدُ يُقرأُ كما نُشِرَ.
 *   ــ **لا يُكرِّرُ الإيقافَ تلقائيّاً**: الإيقافُ فعلُ إنسانٍ صريحٌ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ShareStateResponse,
  StartShareResponse,
  StopShareResponse,
} from "./ride-share-contract.ts";

export type * from "./ride-share-contract.ts";

export function readShare(orderId: string): Promise<ShareStateResponse> {
  return apiFetch<ShareStateResponse>(`/v1/rides/${encodeURIComponent(orderId)}/share`, {
    method: "GET",
  });
}

export function startShare(orderId: string): Promise<StartShareResponse> {
  return apiFetch<StartShareResponse>(`/v1/rides/${encodeURIComponent(orderId)}/share`, {
    method: "POST",
  });
}

export function stopShare(orderId: string): Promise<StopShareResponse> {
  return apiFetch<StopShareResponse>(`/v1/rides/${encodeURIComponent(orderId)}/share`, {
    method: "DELETE",
  });
}
