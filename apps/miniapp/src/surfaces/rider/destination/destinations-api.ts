/**
 * الغرض: بابُ اختيارِ الوجهةِ عندَ العميلِ — نداءانِ فقط، بلا منطقِ عرضٍ وبلا
 *   حالةٍ محفوظةٍ (البند `F2-03`).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 * يُستخدم من: `DestinationScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ بحاقنٍ
 *   فلا يُنادى `fetch` في اختبارِ شاشةٍ.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-04` — تُصادِقُ الدبّوسَ قبلَ إنشاءِ الطلبِ
 *   بذاتِ النداءِ ولا تُضيفُ ثالثاً.
 *
 * ما لا يفعلُه: لا يُخزِّنُ ردّاً في ذاكرةٍ ولا في `localStorage` (فوجهةٌ محفوظةٌ
 * محلّيّاً تبقى بعدَ تغيُّرِ حدِّ المدينةِ فتُقبَلُ اليومَ ما رُفِضَ أمسِ)، ولا
 * يُعيدُ المحاولةَ من نفسِه، ولا يُطبِّعُ النصَّ (التطبيعُ في النطاقِ والقاعدةِ)،
 * ولا يبتلعُ خطأً: يرمي كما يرمي حدُّ API.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  DestinationResolveResponse,
  DestinationSearchResponse,
} from "./destination-contract.ts";

export type * from "./destination-contract.ts";

/** الحدُّ لا يُمرَّرُ: العشرةُ حكمُ الخادمِ، فلا يُعادُ قولُه ههنا رقماً. */
export function searchDestinations(query: string): Promise<DestinationSearchResponse> {
  return apiFetch<DestinationSearchResponse>(
    `/v1/destinations/search?q=${encodeURIComponent(query)}`,
  );
}

export function resolveDestination(lat: number, lng: number): Promise<DestinationResolveResponse> {
  return apiFetch<DestinationResolveResponse>("/v1/destinations/resolve", {
    method: "POST",
    body: { lat, lng },
  });
}
