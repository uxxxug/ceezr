/**
 * الغرض: نداءا حقَّي البيانةِ — سطرانِ فوقَ حدِّ API بلا منطقِ عرضٍ
 *   (البند `F2-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `AccountScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — المسارُ واحدٌ والدورُ خادميٌّ.
 *
 * ## لماذا كلمةُ التأكيدِ تُرسَلُ ولا تُستنتَجُ
 *
 * الخادمُ يُقابِلُها حرفاً على مجالٍ مغلقٍ من ثلاثِ كلماتٍ. ولو أرسلَت الشاشةُ
 * `confirmed: true` لَكانَ الحاجزُ في الواجهةِ وحدَها — وهيَ الطبقةُ التي
 * تُتجاوَزُ بنداءٍ مباشرٍ.
 *
 * ## وما لا يفعلانِه عن قصدٍ
 *
 *   ــ **لا يُعيدانِ محاولةً تلقائيّاً**: حذفٌ يُعادُ إرسالُه فعلٌ لا يُنقَضُ
 *      يقعُ مرّتَينِ، وتنزيلٌ يُعادُ نسخةٌ ثانيةٌ من بيانةِ إنسانٍ على الشبكةِ.
 *   ــ **لا يحفظانِ الحزمةَ في ذاكرةٍ محليّةٍ**: تُعرَضُ وتُنزَّلُ ثمَّ تذهبُ.
 */

import { apiFetch } from "../../../api/client.ts";
import type { DataExportResponse, ErasureResponse } from "./account-contract.ts";

export type * from "./account-contract.ts";

export function requestDataExport(): Promise<DataExportResponse> {
  return apiFetch<DataExportResponse>("/v1/me/data-export", { method: "GET" });
}

/**
 * **مفتاحُ اللاتكرارِ من المُنادي** (القسم 10): يُولَّدُ مرّةً عندَ فتحِ نافذةِ
 * التأكيدِ ويثبُتُ لكلِّ محاولاتِها، فنقرةٌ مزدوجةٌ أو شبكةٌ تعثَّرَت لا تُنشئانِ
 * أمرَ حذفٍ ثانياً على حسابٍ قد يكونُ الأوّلُ محاه بالفعلِ.
 */
export function requestErasure(input: {
  readonly confirmation: string;
  readonly idempotencyKey: string;
}): Promise<ErasureResponse> {
  return apiFetch<ErasureResponse>("/v1/me/erasure", {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: { confirmation: input.confirmation },
  });
}
