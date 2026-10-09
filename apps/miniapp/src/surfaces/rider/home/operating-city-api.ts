/**
 * الغرض: عقدُ المدينةِ التشغيليّةِ للراكب (R1 · ADR 0252) من جهةِ العميل — قراءتُها، وإرسالُ
 *   آخرِ موقعٍ صالحٍ ليحكمَ الخادمُ بالمدينةِ المفعَّلةِ التي تغطّيه. لا اختيارَ يدويّاً.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: miniapp/surfaces/rider/home
 */

import { apiFetch } from "../../../api/client.ts";

export interface ApiOperatingCity {
  readonly code: string;
  readonly name_ar: string;
  readonly name_en: string;
  readonly is_active: boolean;
}

export interface OperatingCityResponse {
  readonly ok: true;
  readonly city: ApiOperatingCity | null;
}

export type LocateOutcome = "CHANGED" | "SAME_CITY" | "OUTSIDE_ACTIVE_CITIES" | "ACTIVE_RIDE";

export interface LocateCityResponse {
  readonly ok: true;
  readonly outcome: LocateOutcome;
  readonly city: ApiOperatingCity | null;
}

export function fetchOperatingCity(): Promise<OperatingCityResponse> {
  return apiFetch<OperatingCityResponse>("/v1/me/operating-city");
}

export function postOperatingCityLocation(lat: number, lng: number): Promise<LocateCityResponse> {
  return apiFetch<LocateCityResponse>("/v1/me/operating-city", {
    method: "POST",
    body: { lat, lng },
  });
}

/** اسمُ المدينةِ بلغةِ العرض؛ والأرديّةُ تقرأُ الاسمَ العربيَّ (لا اسمَ أرديّاً في الجدول). */
export function cityLabel(city: ApiOperatingCity, language: string): string {
  return language === "en" ? city.name_en : city.name_ar;
}

/** مفتاحُ نصِّ نتيجةِ التحديث. `null` ⇒ لا رسالة. */
export function locateMessageKey(outcome: LocateOutcome): string {
  switch (outcome) {
    case "CHANGED":
      return "rider.home.city.changed";
    case "SAME_CITY":
      return "rider.home.city.same";
    case "OUTSIDE_ACTIVE_CITIES":
      return "rider.home.city.outside";
    case "ACTIVE_RIDE":
      return "rider.home.city.activeRide";
  }
}
