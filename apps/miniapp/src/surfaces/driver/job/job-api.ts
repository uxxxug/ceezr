/**
 * الغرض: نداءاتُ مَهمّةِ السائقِ النشطةِ — قراءةٌ وثلاثةُ أفعالٍ، كلُّ فعلٍ
 *   مسارُه (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `JobScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — نداءُ الأرباحِ يُضافُ في ملفِّه لا ههنا.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ لا إعادةَ محاولةٍ تلقائيّةً لأيِّ فعلٍ ههنا
 *
 * الثلاثةُ **تكتبُ**: إعادةُ ختمِ وصولٍ بعدَ انقطاعِ شبكةٍ قد تكونُ إعادةً لفعلٍ
 * نجحَ ولم يصلْ جوابُه، فيرى السائقُ `ALREADY_ARRIVED` عطلاً وهوَ نجاحٌ سبقَ.
 * فالإعادةُ **قراءةُ الحالِ من القاعدةِ** بزرٍّ يفهمُه الإنسانُ، لا نداءٌ ثانٍ
 * لكاتبٍ.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُطوِّلُ مهلةً ولا تُقصِّرُها**: مهلةُ `apiFetch` واحدةٌ للسطحِ كلِّه.
 *   ــ **لا تُخزِّنُ مَهمّةً محلّيّاً**: مَهمّةٌ مخزَّنةٌ تُريكَ طَوراً مضى.
 *   ــ **لا تُرسِلُ موضعاً**: بثُّ الموضعِ بندٌ آخرُ (`F3-04`)، ولا طَورَ من قُربٍ.
 */

import { apiFetch } from "../../../api/client.ts";
import type { SosSurfaceResponse } from "../../rider/sos/sos-contract.ts";
import { publishLocationBroadcastPolicy } from "../location/broadcast-api.ts";
import type {
  DriverActiveJobResponse,
  DriverCannotCompleteResponse,
  DriverJobArrivedResponse,
  DriverJobCompletedResponse,
  DriverJobStartedResponse,
} from "./job-contract.ts";

export type { SosSurfaceResponse } from "../../rider/sos/sos-contract.ts";
export type * from "./job-contract.ts";

export async function readDriverActiveJob(): Promise<DriverActiveJobResponse> {
  const response = await apiFetch<DriverActiveJobResponse>("/v1/driver/job", { method: "GET" });
  // وقد صارَت هذه القراءةُ تنشُرُ سياسةَ النبضةِ (`F3-04`) **زيادةً** (`ح-8`):
  // من قرأَ مَهمّتَه فقد قرأَ سياستَه معاً، فلا مسارَ سياسةٍ ثانياً ولا رحلتَينِ
  // في دورةٍ. **وحمولةٌ بلا كتلةٍ لا تُكتَبُ سياسةً مُخترَعةً**: المخزنُ يبقى
  // على ما كانَ والباثُّ يقرأُ غياباً فيسكنُ.
  if (response.location_broadcast !== undefined && response.location_broadcast !== null) {
    publishLocationBroadcastPolicy(response.location_broadcast);
  }
  return response;
}

export function markDriverArrived(orderId: string): Promise<DriverJobArrivedResponse> {
  return apiFetch<DriverJobArrivedResponse>(`/v1/driver/job/${orderId}/arrived`, {
    method: "POST",
  });
}

export function startDriverRide(orderId: string): Promise<DriverJobStartedResponse> {
  return apiFetch<DriverJobStartedResponse>(`/v1/driver/job/${orderId}/start`, {
    method: "POST",
  });
}

export function completeDriverRide(orderId: string): Promise<DriverJobCompletedResponse> {
  return apiFetch<DriverJobCompletedResponse>(`/v1/driver/job/${orderId}/complete`, {
    method: "POST",
  });
}

/**
 * فعلُ «تعذّرَ الإكمالُ» (`PD-020` · `ADR 0159`) — بلاغُ سلامةٍ **بحكمِ المَهمّةِ**:
 * المعرّفُ في المسارِ من جوابِ القاعدةِ لا من ذاكرةِ شاشةٍ، والرفضُ يصلُ جواباً
 * 200 لا عطلاً، فلا إعادةَ محاولةٍ آليّةً له.
 */
export function reportDriverCannotComplete(orderId: string): Promise<DriverCannotCompleteResponse> {
  return apiFetch<DriverCannotCompleteResponse>(`/v1/driver/job/${orderId}/cannot-complete`, {
    method: "POST",
  });
}

/**
 * قراءةُ سردِ بلاغِ السائقِ (`PD-020`) — الحاكمُ واحدٌ بسؤالِهِ واحدٍ، والدورُ
 * **مُركّبٌ خادميّاً** يُنشرُ حُكمًا لا يُقاسُ من الجهازِ. والنصوصُ الجاهزةُ
 * في القواميسِ تنطقُ بلسانِ السائقِ (`driver.job.cannotComplete.*`) لا بلسانِ
 * الراكبِ.
 */
export function readDriverSafetyNarrative(): Promise<SosSurfaceResponse> {
  return apiFetch<SosSurfaceResponse>("/v1/driver/safety/sos", { method: "GET" });
}
