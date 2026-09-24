/**
 * الغرض: نداءا حقَّي البيانةِ — سطرانِ فوقَ حدِّ API بلا منطقِ عرضٍ ولا ذكرِ
 *   دورٍ (`F2-11` · `SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`، ومنقولٌ عن `F2-11`.
 * ينتمي إلى: apps/miniapp/src/surfaces/account
 * يُستخدم من: `rider/account/AccountScreen.tsx` · `driver/account/AccountScreen.tsx`.
 *
 * ## لماذا مِلفٌّ واحدٌ للدورَينِ
 *
 * لأنَّ المسارَينِ **لا يذكرانِ دوراً**: المعرِّفُ من الرمزِ الموقَّعِ، والدورُ
 * يُقرأُ في القاعدةِ. ونسخةٌ ثانيةٌ من سطرَينِ تعني أنَّ مفتاحَ اللاتكرارِ أو
 * ترويسةً تُصحَّحُ في أحدِهما وتُنسى في الآخرِ.
 *
 * ## وما لا يفعلانِه عن قصدٍ
 *
 *   ــ **لا يُعيدانِ محاولةً تلقائيّاً**: حذفٌ يُعادُ إرسالُه فعلٌ لا يُنقَضُ
 *      يقعُ مرّتَينِ، وتنزيلٌ يُعادُ نسخةٌ ثانيةٌ من بيانةِ إنسانٍ على الشبكةِ.
 *   ــ **لا يحفظانِ الحزمةَ في ذاكرةٍ محليّةٍ**: تُعرَضُ وتُنزَّلُ ثمَّ تذهبُ.
 */

import {
  isMiniAppLanguage,
  type MiniAppLanguage,
} from "../../../../../packages/shared/i18n/miniapp/core.ts";
import { apiFetch } from "../../api/client.ts";
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

/**
 * تحديثُ لغةِ الواجهةِ في الحسابِ (`PD-030`). الخادمُ يُصادِقُ على القيمةِ،
 * والعميلُ يُصادِقُ على الردِّ لا يُصدِّقُه. ولا دورَ يُذكرُ: الرمزُ الموقَّعُ هو المعرِّف.
 */
export async function updateAccountLanguage(
  languageCode: MiniAppLanguage,
): Promise<MiniAppLanguage> {
  const result = await apiFetch<{ readonly languageCode?: unknown }>("/v1/me/language", {
    method: "PUT",
    body: { languageCode },
  });
  if (typeof result.languageCode !== "string" || !isMiniAppLanguage(result.languageCode)) {
    throw new Error("INVALID_LANGUAGE_RESPONSE");
  }
  return result.languageCode;
}
