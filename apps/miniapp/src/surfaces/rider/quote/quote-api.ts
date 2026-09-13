/**
 * الغرض: بابُ الاقتباسِ عندَ العميلِ — نداءٌ واحدٌ، بلا منطقِ عرضٍ وبلا حالةٍ
 *   محفوظةٍ (البند `F2-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `QuoteScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ بحاقنٍ.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-05` تُعيدُ الاقتباسَ قبلَ الإنشاءِ ولا
 *   تُصدِّقُ نسخةً مخزَّنةً في العميلِ.
 *
 * ما لا يفعلُه: لا يُخزِّنُ ردّاً (اقتباسٌ محفوظٌ محلّيّاً يبقى بعدَ تغيُّرِ حدِّ
 * المدينةِ أو خروجِ آخرِ سائقٍ من الاشتراكِ، فيُقرأُ اليومَ ما صحَّ أمسِ)، ولا
 * يُعيدُ المحاولةَ من نفسِه، ولا يبتلعُ خطأً: يرمي كما يرمي حدُّ API.
 */

import { apiFetch } from "../../../api/client.ts";
import type { QuoteRideResponse } from "./quote-contract.ts";

export type * from "./quote-contract.ts";

export function quoteRide(input: {
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
}): Promise<QuoteRideResponse> {
  return apiFetch<QuoteRideResponse>("/v1/quote/ride", { method: "POST", body: input });
}
