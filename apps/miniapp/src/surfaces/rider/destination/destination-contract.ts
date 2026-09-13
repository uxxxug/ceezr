/**
 * الغرض: **عقدُ** اختيارِ الوجهةِ عندَ العميلِ — أشكالُ الطلبِ والردِّ وحدَها،
 *   بلا نداءِ شبكةٍ وبلا استيرادٍ زمنَ التنفيذِ (البند `F2-03`).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 * يُستخدم من: `destinations-api.ts` (النداءُ) و`destination-view.ts` (العرضُ).
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-04` بذاتِ العقدِ.
 *
 * ## لماذا مِلفٌّ للعقدِ منفصلٌ عن مِلفِّ النداءِ
 *
 * نموذجُ العرضِ دالّاتٌ **نقيّةٌ** تُقاسُ في `tests/unit` بلا مُتصفِّحٍ. ولو
 * استوردَ أشكالَه من مِلفِّ النداءِ لَجرَّ معه `api/client.ts` وفيه `window`،
 * فيُخفِقُ فحصُ الأنواعِ في سياقٍ بلا DOM — لا لِعطبٍ في المنطقِ بل لِترتيبِ
 * استيرادٍ. والعقدُ لا يملكُه النداءُ أصلاً: النداءُ والعرضُ كِلاهما تابعانِ له.
 *
 * وما لا يفعلُه: لا يحملُ دالّةً ولا ثابتاً ولا نصّاً معروضاً — أنواعٌ فقط،
 * تُمحى كلَّها زمنَ التنفيذِ.
 */

export interface ApiDestinationSuggestion {
  readonly source: string;
  readonly refId: string | null;
  readonly kind: string | null;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly matchRank: number;
}

export interface DestinationSearchResponse {
  readonly ok: true;
  readonly query: string;
  readonly suggestions: readonly ApiDestinationSuggestion[];
}

export interface ApiDestinationCity {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly areaVersion: string | null;
}

export interface ApiNearestLandmark {
  readonly kind: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly straightDistanceM: number;
}

export interface ApiAcceptedDestination {
  readonly lat: number;
  readonly lng: number;
  readonly city: ApiDestinationCity;
  readonly nearest: ApiNearestLandmark | null;
}

/**
 * الردُّ يُميِّزُ بـ`accepted` لا برمزِ حالةٍ: الرفضُ جوابٌ كاملٌ بـ`200`
 * (الشرحُ في `apps/gateway/src/routes/destinations.ts`)، ولو مُيِّزَ بـ`4xx`
 * لَابتلعَه `apiFetch` خطأً فصارَ «خارجَ منطقةِ الخدمةِ» شاشةَ انقطاعٍ.
 */
export type DestinationResolveResponse =
  | { readonly ok: true; readonly accepted: true; readonly destination: ApiAcceptedDestination }
  | {
      readonly ok: true;
      readonly accepted: false;
      readonly refusal: string;
      readonly city: ApiDestinationCity | null;
    };
