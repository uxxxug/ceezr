/**
 * الغرض: إدارةُ الأماكنِ المحفوظة ([B] · R13) — حفظٌ وتعديلٌ وحذفٌ فرادى على العقدِ القائم:
 *   `GET/POST /v1/me/places` · `PATCH/DELETE /v1/me/places/:id` · `GET /v1/me/recent-destinations`
 *   (`apps/gateway/src/routes/me-places.ts` · DEC-39/40).
 * الحالة: منفّذ فعلياً — UI-3 / PR 5 (ADR 0238).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/settings
 *
 * ## ما لا يفعلُه عن قصد
 *
 *   ــ **لا إحداثيّةَ مُختلَقة:** الحفظُ الجديدُ من وجهةٍ حديثةٍ قرأَها الخادمُ (لها إحداثيّتُها)، والتعديلُ يُعيدُ
 *      إحداثيّةَ المكانِ كما هيَ — فلا خريطةَ ولا التقاطَ موقعٍ ولا رقمٌ يُكتَبُ بيد.
 *   ــ **لا حذفَ بضغطةٍ واحدة:** تأكيدٌ صريحٌ ثمَّ نداء، والقائمةُ بعدَه تُقرأ من الخادم.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiRecentDestination,
  ApiSavedPlace,
  RecentDestinationsResponse,
  SavedPlacesResponse,
  SavePlaceResponse,
} from "../home/places-api.ts";

export type { ApiRecentDestination, ApiSavedPlace };

/** مرآةُ `packages/domain/places/place-kinds.ts` — الخادمُ هوَ الحكم. */
export const PLACE_KINDS = ["home", "work", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PLACE_LABEL_MAX = 80;

export interface SavedPlacesApi {
  readonly list: () => Promise<SavedPlacesResponse>;
  readonly recent: () => Promise<RecentDestinationsResponse>;
  readonly create: (input: {
    readonly kind: PlaceKind;
    readonly label: string;
    readonly lat: number;
    readonly lng: number;
  }) => Promise<SavePlaceResponse>;
  readonly update: (
    id: string,
    input: {
      readonly kind: PlaceKind;
      readonly label: string;
      readonly lat: number;
      readonly lng: number;
    },
  ) => Promise<{ readonly ok: true; readonly status: "updated"; readonly place: ApiSavedPlace }>;
  readonly remove: (id: string) => Promise<{ readonly ok: true; readonly status: "deleted" }>;
}

export const savedPlacesApi: SavedPlacesApi = {
  list: () => apiFetch<SavedPlacesResponse>("/v1/me/places"),
  recent: () => apiFetch<RecentDestinationsResponse>("/v1/me/recent-destinations"),
  create: (input) => apiFetch<SavePlaceResponse>("/v1/me/places", { method: "POST", body: input }),
  update: (id, input) =>
    apiFetch(`/v1/me/places/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  remove: (id) => apiFetch(`/v1/me/places/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export function isPlaceKind(value: string): value is PlaceKind {
  return (PLACE_KINDS as readonly string[]).includes(value);
}

/** نوعُ مكانٍ لا تعرفُه الواجهةُ يُعرَضُ «آخر» ولا يُسقَط — والتعديلُ يُرسلُه «آخر» صراحةً. */
export function placeKindKey(kind: string): string {
  return `rider.account.places.kind.${isPlaceKind(kind) ? kind : "other"}`;
}

export function labelProblem(label: string): "required" | "tooLong" | null {
  const trimmed = label.trim();
  if (trimmed.length === 0) return "required";
  if (trimmed.length > PLACE_LABEL_MAX) return "tooLong";
  return null;
}

/** «بيتٌ» و«عملٌ» واحدٌ لكلٍّ منهما في الخادم: الحفظُ فوقَ نوعٍ مشغولٍ يستبدلُه — يُقالُ قبلَ الضغط. */
export function replacesExisting(kind: PlaceKind, places: readonly ApiSavedPlace[]): boolean {
  return kind !== "other" && places.some((place) => place.kind === kind);
}

/** وجهاتٌ حديثةٌ ليست محفوظةً بعدُ (اللافتةُ والإحداثيّتان معاً) — لا يُعرَضُ حفظُ ما هوَ محفوظ. */
export function unsavedRecent(
  recent: readonly ApiRecentDestination[],
  places: readonly ApiSavedPlace[],
): readonly ApiRecentDestination[] {
  return recent.filter(
    (d) => !places.some((p) => p.label === d.label && p.lat === d.lat && p.lng === d.lng),
  );
}

export function placeErrorKey(code: string): string {
  switch (code) {
    case "MALFORMED":
    case "INVALID_BODY":
    case "UNKNOWN_PLACE_KIND":
      return "rider.account.places.error.invalid";
    case "PLACE_NOT_FOUND":
      return "rider.account.places.error.notFound";
    case "ACCOUNT_NOT_FOUND":
      return "rider.account.places.error.account";
    default:
      return "rider.account.places.error.generic";
  }
}
