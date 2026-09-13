/**
 * الغرض: نداءا السجلِّ والتفاصيلِ — سطرانِ فوقَ حدِّ API ولا منطقَ عرضٍ
 *   (البند `F2-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/history
 * يُستخدم من: `RideHistoryScreen.tsx` و`RideDetailScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` تُنادي السجلَّ بالدالّةِ نفسِها.
 *
 * ## لماذا المؤشِّرُ يُرسَلُ **قيمتَينِ** في الاستعلامِ
 *
 * كي يكونَ مرئيّاً في أثرِ الطلبِ ومقروءاً في سجلٍّ، ولئلّا يصيرَ نصّاً مُعمّىً
 * يُحشى فيه ما لا يُفحَصُ. **ونصفُه يُرسَلُ كما هوَ** فتردَّ القاعدةُ
 * `INVALID_CURSOR`: حكمُ المفتاحِ في موضعٍ واحدٍ (القاعدة 0.6).
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يُدمِجُ صفحاتٍ ولا يحتفظُ بمؤشِّرٍ**: الحالةُ ملكُ الشاشةِ.
 *   ــ **لا يستقصي دوريّاً**: السجلُّ ماضٍ لا يتحرَّكُ بنفسِه.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API.
 *   ــ **لا يبني نمطَ بحثٍ ولا يُهذِّبُ النصَّ**: التهذيبُ حكمُ النطاقِ،
 *      والنمطُ حكمُ القاعدةِ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiRideHistoryCursor,
  RideDetailResponse,
  RideHistoryResponse,
} from "./ride-history-contract.ts";

export type * from "./ride-history-contract.ts";

export function readRideHistory(input: {
  readonly query: string | null;
  readonly pageSize: number;
  readonly cursor: ApiRideHistoryCursor | null;
}): Promise<RideHistoryResponse> {
  const params = new URLSearchParams();
  params.set("pageSize", String(input.pageSize));
  // النصُّ الفارغُ **غيابُ بحثٍ** لا بحثٌ عن فراغٍ: لا يُرسَلُ أصلاً.
  if (input.query !== null && input.query.trim().length > 0) params.set("q", input.query);
  if (input.cursor !== null) {
    params.set("cursorCreatedAt", input.cursor.createdAt);
    params.set("cursorId", input.cursor.id);
  }
  return apiFetch<RideHistoryResponse>(`/v1/rides?${params.toString()}`, { method: "GET" });
}

export function readRideDetail(orderId: string): Promise<RideDetailResponse> {
  return apiFetch<RideDetailResponse>(`/v1/rides/${encodeURIComponent(orderId)}/detail`, {
    method: "GET",
  });
}
