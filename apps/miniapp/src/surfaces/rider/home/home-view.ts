/**
 * الغرض: نموذجُ عرضِ شاشةِ الراكبِ الرئيسةِ — تحويلُ ردَّيِ `/v1/me/places`
 *   و`/v1/me/recent-destinations` وأخطائِهما إلى صفوفٍ ومفاتيحِ نصٍّ، منطقاً
 *   خالصاً بلا DOM (البند `F2-02` · `SR-02`).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: `HomeScreen.tsx`، وشاشةُ `F2-03` (طلبُ المشوارِ)
 *   حينَ تُمرَّرُ إليها وجهةٌ مختارةٌ من ههنا.
 * ملاحظات مستقبلية: حينَ يُضافُ نوعُ مكانٍ رابعٌ فلا يتغيّرُ شيءٌ ههنا: الترتيبُ
 *   يُقرأُ من `SAVED_PLACE_KINDS` في طبقةِ النطاقِ، وحاجزُ `check-place-kinds`
 *   يفرضُ تطابقَها مع قيدِ الهجرةِ.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يُترجِمُ**: يُعيدُ مفاتيحَ (§9.11)، والترجمةُ في `shared/i18n/miniapp`.
 *   ــ **لا يُرتِّبُ بنفسِه خلافاً للقاعدةِ**: الخادمُ يُعيدُ الأماكنَ مرتَّبةً
 *      (المنزلُ ثمَّ العملُ ثمَّ الباقي بالأحدثِ) والدالّةُ ههنا تُثبِّتُ ذاكَ
 *      الترتيبَ لا تخترعُ ثانياً؛ ولو جاءَ الردُّ غيرَ مرتَّبٍ لظهرَ الخللُ في
 *      اختبارِ التكاملِ لا ههنا صامتاً.
 *   ــ **لا يُخفي «لا مكانَ محفوظاً»**: الفراغُ يُقالُ مفتاحاً (`UX-5`).
 *   ــ **لا يزعمُ خريطةً**: حينَ لا مزوّدَ مُهيَّأً يُعيدُ `mapUnavailable` —
 *      وذاكَ هو الحدُّ الحقيقيُّ لا رسمٌ بديلٌ يُوهِمُ موقعاً.
 */

import {
  isSavedPlaceKind,
  MAX_PLACE_LABEL_LENGTH,
  SAVED_PLACE_KINDS,
} from "../../../../../../packages/domain/places/place-kinds.ts";
import type { ApiRecentDestination, ApiSavedPlace } from "./places-api.ts";

export interface PlaceRow {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  /** مفتاحُ اسمِ النوعِ المعروضِ — `rider.home.place.home` وأخواتُه. */
  readonly kindKey: string;
}

export interface RecentRow {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly lastUsedAt: string;
}

/** الخدماتُ كما يُعلِنُها تعدادُ القاعدةِ `service_type` — لا ثالثةَ تُخترَعُ. */
export const HOME_SERVICES = ["transport", "delivery"] as const;
export type HomeService = (typeof HOME_SERVICES)[number];

const SERVICE_KEY: Readonly<Record<HomeService, string>> = {
  transport: "rider.home.service.transport",
  delivery: "rider.home.service.delivery",
};

export function serviceKey(service: HomeService): string {
  return SERVICE_KEY[service];
}

/**
 * مفتاحُ اسمِ النوعِ. والنوعُ المجهولُ **لا يُسقِطُ الصفَّ ولا الشاشةَ**: يُعرَضُ
 * بمفتاحِ «آخر»، لأنَّ إصداراً أحدثَ من الخادمِ قد يعرفُ نوعاً لا تعرفُه هذه
 * الحزمةُ، وإسقاطُ مكانٍ حفظَه المستخدمُ بنفسِه أسوأُ من عرضِه بعنوانٍ عامٍّ.
 */
export function placeKindKey(kind: string): string {
  return isSavedPlaceKind(kind) ? `rider.home.place.${kind}` : "rider.home.place.other";
}

const KIND_ORDER: ReadonlyMap<string, number> = new Map(
  SAVED_PLACE_KINDS.map((kind, index) => [kind, index]),
);

function orderOf(kind: string): number {
  return KIND_ORDER.get(kind) ?? SAVED_PLACE_KINDS.length;
}

/**
 * صفوفُ الأماكنِ. الترتيبُ يُثبَّتُ بترتيبِ `SAVED_PLACE_KINDS` ثمَّ بالأحدثِ
 * تحديثاً — نفسُ حكمِ `list_saved_places` في القاعدةِ، مكتوباً ههنا كي لا تتبدَّلَ
 * الشاشةُ لو جاءَ الردُّ من مسارٍ آخرَ (ذاكرةٍ وسيطةٍ مثلاً) غيرَ مرتَّبٍ.
 */
export function placeRows(places: readonly ApiSavedPlace[]): readonly PlaceRow[] {
  return [...places]
    .sort((left, right) => {
      const byKind = orderOf(left.kind) - orderOf(right.kind);
      if (byKind !== 0) return byKind;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((place) => ({
      id: place.id,
      kind: place.kind,
      label: place.label,
      lat: place.lat,
      lng: place.lng,
      kindKey: placeKindKey(place.kind),
    }));
}

/**
 * صفوفُ آخرِ الوجهاتِ. لا اقتطاعَ ههنا: الحدُّ حكمُ الخادمِ، واقتطاعٌ ثانٍ في
 * العميلِ يجعلُ «آخرُ ثلاثِ وجهاتٍ» مقولةً في موضعَينِ — وذاكَ مصدرٌ ثانٍ للحقيقةِ
 * (القاعدة 0.6). أمّا اللافتةُ الفارغةُ فتُسقَطُ: هيَ صفٌّ لا يُقرأُ.
 */
export function recentRows(destinations: readonly ApiRecentDestination[]): readonly RecentRow[] {
  return destinations
    .filter((destination) => destination.label.trim().length > 0)
    .map((destination) => ({
      label: destination.label,
      lat: destination.lat,
      lng: destination.lng,
      lastUsedAt: destination.lastUsedAt,
    }));
}

/** الوجهةُ المكتوبةُ: تُقصُّ أطرافُها ويُقاسُ طولُها بحدِّ النطاقِ لا بحدِّ القاعدةِ. */
export function isSubmittableDestination(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PLACE_LABEL_LENGTH;
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  MALFORMED: "rider.home.error.malformed",
  UNKNOWN_PLACE_KIND: "rider.home.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.home.error.account",
  PLACE_STORE_NOT_AVAILABLE: "rider.home.error.unavailable",
  SESSION_NOT_AVAILABLE: "rider.home.error.unavailable",
};

/** مفتاحُ رسالةِ الرفضِ الذي يخصُّ الأماكنَ — أمّا الجلسةُ والانقطاعُ فشاشةُ نظامٍ. */
export function placesErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.home.error.unavailable";
}

/** الأخطاءُ التي تُعيدُ المحاولةَ معنىً — لا التي تُصلَحُ بضغطِ زرٍّ مرّةً أخرى. */
export function isRetryablePlacesError(code: string): boolean {
  return code === "PLACE_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE";
}
