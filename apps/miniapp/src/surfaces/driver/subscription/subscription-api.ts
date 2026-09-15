/**
 * الغرض: نداءا اشتراكِ السائقِ — **قراءتانِ لا كتابةَ فيهما** (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `SubscriptionScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — نداءُ التجديدِ يُضافُ في ملفِّه لا ههنا.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ **تُعادُ المحاولةُ** ههنا
 *
 * لأنَّ هاتَينِ قراءتانِ لا كاتبَتانِ: إعادةُ قراءةٍ بعدَ انقطاعِ شبكةٍ لا تُعيدُ
 * فعلاً نجحَ ولم يصلْ جوابُه. ولكنَّ الإعادةَ **بزرٍّ يفهمُه الإنسانُ** لا حلقةً
 * تلقائيّةً.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِلُ معرِّفَ سائقٍ**: الهويّةُ في الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُخزِّنُ جواباً محلّيّاً**: لوحٌ مخزَّنٌ يُقرأُ حالاً لا حالاً.
 *   ــ **لا تجمعُ النداءَينِ في واحدٍ**: التاريخُ يُطلَبُ عندَ التوسيعِ فحسب.
 *   ــ **التجديدُ يبدأُ معاملةً ولا يُفعِّلُها**: التفعيلُ حقُّ الويبهوكِ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiDriverSubscriptionDashboardResponse,
  ApiDriverSubscriptionHistoryResponse,
  ApiDriverSubscriptionRenewalResponse,
} from "./subscription-contract.ts";

export type * from "./subscription-contract.ts";

export function readDriverSubscriptionDashboard(): Promise<ApiDriverSubscriptionDashboardResponse> {
  return apiFetch<ApiDriverSubscriptionDashboardResponse>("/v1/driver/subscription", {
    method: "GET",
  });
}

export function readDriverSubscriptionHistory(
  limit: number,
): Promise<ApiDriverSubscriptionHistoryResponse> {
  return apiFetch<ApiDriverSubscriptionHistoryResponse>(
    `/v1/driver/subscription/history?limit=${String(limit)}`,
    { method: "GET" },
  );
}

export function renewDriverSubscription(
  plan: string,
): Promise<ApiDriverSubscriptionRenewalResponse> {
  return apiFetch<ApiDriverSubscriptionRenewalResponse>("/v1/driver/subscription/renew", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}
