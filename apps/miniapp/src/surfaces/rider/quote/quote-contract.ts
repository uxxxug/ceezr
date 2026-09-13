/**
 * الغرض: **عقدُ** الاقتباسِ عندَ العميلِ — أشكالُ الطلبِ والردِّ وحدَها، بلا
 *   نداءِ شبكةٍ وبلا استيرادٍ زمنَ التنفيذِ (البند `F2-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `quote-api.ts` (النداءُ) و`quote-view.ts` (العرضُ).
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-05` تقرأُ البطاقةَ المختارةَ من هذا العقدِ.
 * ملاحظات مستقبلية: لا يُضافُ حقلُ سعرٍ ولا وسيلةِ دفعٍ ههنا قبلَ `DEC-11`.
 *
 * ## لماذا مِلفٌّ للعقدِ منفصلٌ — كما في `F2-03`
 *
 * نموذجُ العرضِ دالّاتٌ نقيّةٌ تُقاسُ بلا مُتصفِّحٍ، ولو استوردَ أشكالَه من مِلفِّ
 * النداءِ لَجرَّ معَه `api/client.ts` وفيه `window`.
 *
 * ## ولماذا المسافةُ كائنٌ لا رقمٌ
 *
 * `{ kind, meters }`: الوسمُ يُسافِرُ معَ القيمةِ على السلكِ وفي النوعِ، فلا
 * يُعرَضُ خطٌّ مستقيمٌ على أنَّه طولُ طريقٍ (`ADR 0024` قاسَ فارقاً يبلغُ 2.834
 * ضِعفاً في أسوأِ زوجٍ مقيسٍ).
 *
 * ## وما لا يفعلُه: لا دالّةَ ولا ثابتَ ولا نصَّ معروضاً — أنواعٌ تُمحى كلُّها.
 */

export interface ApiQuoteCity {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export interface ApiTaggedDistance {
  readonly kind: string;
  readonly meters: number;
}

/**
 * حكمُ المدّةِ كما يُنشَرُ — اتّحادٌ مُميَّزٌ بـ`kind`، وسببُ الامتناعِ **مُعلَنٌ**
 * لا مطويٌّ: «غيرُ متاحةٍ» بلا سببٍ تُقرأُ عطباً في التطبيقِ.
 */
export type ApiEtaVerdict =
  | {
      readonly kind: "ROUTED";
      readonly seconds: number;
      readonly minutes: number;
      readonly distanceMeters: number;
      readonly source: string;
    }
  | { readonly kind: "UNAVAILABLE"; readonly reason: string };

export type ApiServiceOffer =
  | { readonly service: string; readonly available: true }
  | { readonly service: string; readonly available: false; readonly reason: string };

/**
 * الردُّ يُميَّزُ بـ`accepted` لا برمزِ حالةٍ: الرفضُ جوابٌ كاملٌ بـ`200`، ولو
 * مُيِّزَ بـ`4xx` لَابتلعَه `apiFetch` خطأً فصارَ «انطلاقُك خارجَ الحدِّ» شاشةَ
 * انقطاعٍ.
 */
export type QuoteRideResponse =
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly city: ApiQuoteCity;
      readonly areaVersion: string;
      readonly distance: ApiTaggedDistance;
      readonly eta: ApiEtaVerdict;
      readonly services: readonly ApiServiceOffer[];
    }
  | {
      readonly ok: true;
      readonly accepted: false;
      readonly refusal: string;
      readonly city: ApiQuoteCity | null;
    };
