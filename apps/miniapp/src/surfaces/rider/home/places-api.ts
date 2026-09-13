/**
 * الغرض: بابُ الأماكنِ وآخرِ الوجهاتِ عندَ العميلِ — ثلاثةُ نداءاتٍ فقط، بلا
 *   منطقِ عرضٍ وبلا حالةٍ محفوظةٍ (البند `F2-02`).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: `HomeScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ
 *   بحاقنٍ فلا يُنادى `fetch` في اختبارِ شاشةٍ.
 * ملاحظات مستقبلية: `SR-12` يحتاجُ حذفَ مكانٍ، و`F2-03` يحتاجُ الأماكنَ القريبةَ
 *   من نقطةٍ — يُضافانِ ههنا نداءَينِ جديدَينِ لا وسيطَينِ اختياريَّينِ على هذَينِ.
 *
 * ما لا يفعلُه: لا يُخزِّنُ ردّاً في ذاكرةٍ ولا في `localStorage` (فمكانٌ محفوظٌ
 * محلّيّاً يبقى بعدَ حذفِه من الحسابِ)، ولا يُعيدُ المحاولةَ من نفسِه، ولا
 * يُمرِّرُ `Idempotency-Key` (تماثُلُ الحفظِ بنيويٌّ في القاعدةِ — ADR 0092)،
 * ولا يبتلعُ خطأً: يرمي كما يرمي حدُّ API.
 */

import { apiFetch } from "../../../api/client.ts";

export interface ApiSavedPlace {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly updatedAt: string;
}

export interface SavedPlacesResponse {
  readonly ok: true;
  readonly places: readonly ApiSavedPlace[];
}

export interface ApiRecentDestination {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly lastUsedAt: string;
}

export interface RecentDestinationsResponse {
  readonly ok: true;
  readonly destinations: readonly ApiRecentDestination[];
}

export interface SavePlaceResponse {
  readonly ok: true;
  readonly status: "created" | "updated";
  readonly place: ApiSavedPlace;
}

export function fetchSavedPlaces(): Promise<SavedPlacesResponse> {
  return apiFetch<SavedPlacesResponse>("/v1/me/places");
}

/** الحدُّ لا يُمرَّرُ: الثلاثةُ حكمُ الخادمِ (§9.5)، فلا يُعادُ قولُه ههنا رقماً. */
export function fetchRecentDestinations(): Promise<RecentDestinationsResponse> {
  return apiFetch<RecentDestinationsResponse>("/v1/me/recent-destinations");
}

export function savePlace(
  kind: string,
  label: string,
  lat: number,
  lng: number,
): Promise<SavePlaceResponse> {
  return apiFetch<SavePlaceResponse>("/v1/me/places", {
    method: "POST",
    body: { kind, label, lat, lng },
  });
}
