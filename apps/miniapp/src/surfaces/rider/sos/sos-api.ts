/**
 * الغرض: نداءا سطحِ الاستغاثةِ — سطرانِ فوقَ حدِّ API بلا منطقِ عرضٍ
 *   (البند `F2-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: `SosCard.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — المسارُ واحدٌ والدورُ خادميٌّ.
 *
 * ## لماذا لا مُعرِّفَ في المسارِ
 *
 * الطلبُ يُحَلُّ في القاعدةِ تحتَ القفلِ (`ADR 0077`). ومُعرِّفٌ يُرسَلُ من
 * الشاشةِ قد يكونُ مُعرِّفَ رحلةِ أمسِ بقيَ في ذاكرةِ مُكوِّنٍ لم يُحدَّثْ.
 *
 * ## وما لا يفعلانِه عن قصدٍ
 *
 *   ــ **لا يُعيدانِ محاولةً تلقائيّاً**: ضغطةٌ ثانيةٌ فعلُ إنسانٍ صريحٌ، ولا
 *      يُفتَحُ بلاغانِ لأنَّ الشبكةَ تعثَّرَت مرّةً.
 *   ــ **لا يبتلعانِ خطأً**: العقدُ يُقرأُ كما نُشِرَ.
 */

import { apiFetch } from "../../../api/client.ts";
import type { SosSurfaceResponse, SosTriggerResponse } from "./sos-contract.ts";

export type * from "./sos-contract.ts";

export function readSosSurface(): Promise<SosSurfaceResponse> {
  return apiFetch<SosSurfaceResponse>("/v1/safety/sos", { method: "GET" });
}

export function triggerSos(): Promise<SosTriggerResponse> {
  return apiFetch<SosTriggerResponse>("/v1/safety/sos", { method: "POST" });
}
