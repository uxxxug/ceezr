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
import type {
  DriverActiveJobResponse,
  DriverJobArrivedResponse,
  DriverJobCompletedResponse,
  DriverJobStartedResponse,
} from "./job-contract.ts";

export type * from "./job-contract.ts";

export function readDriverActiveJob(): Promise<DriverActiveJobResponse> {
  return apiFetch<DriverActiveJobResponse>("/v1/driver/job", { method: "GET" });
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
