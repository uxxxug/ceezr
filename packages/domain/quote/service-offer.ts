/**
 * الغرض: بطاقةُ الخدمةِ — أيُّ خدمةٍ تُعرَضُ للراكبِ، ولماذا **لا** تُعرَضُ
 *   الأخرى، برمزٍ مُصنَّفٍ لا بإخفاءٍ صامتٍ (البند `F2-04` · `SR-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: packages/domain/quote
 * يُستخدم من: `packages/application/quote/quote-ride.ts` ·
 *   `apps/miniapp/src/surfaces/rider/quote/quote-view.ts` ·
 *   `scripts/check-quote-contract.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يقرأُ البطاقةَ المختارةَ ولا يقبلُ خدمةً
 *   بطاقتُها `unavailable` — فيُمنَعُ طلبٌ لخدمةٍ لا سائقَ لها من الخادمِ لا من
 *   الشاشةِ.
 * ملاحظات مستقبلية: يومَ يُغلَقُ `DEC-11` تُضافُ الأجرةُ **بطاقةً بطاقةً** ومعَها
 *   مصدرُ سياستِها — ولا حقلَ فارغاً لها اليومَ (`م13-7`).
 *
 * ## لماذا تُعرَضُ الخدمةُ غيرُ المتاحةِ ولا تُخفى
 *
 * راكبٌ يعلمُ أنَّ «توصيلَ الطلباتِ» موجودٌ في المنتَجِ ثمَّ لا يراهُ في مدينتِه
 * يظنُّ العطبَ في التطبيقِ، فيُعيدُ المحاولةَ ثمَّ يشكو. وإخفاءُ الخدمةِ يُنتِجُ
 * **سؤالاً بلا جوابٍ**، وإظهارُها معطَّلةً بسببِها يُنتِجُ **جواباً**. وهذا عينُ
 * ما فعلَه `ADR 0024` في الامتناعِ المُصنَّفِ: الغيابُ المُعلَنُ أصدقُ من رقمٍ
 * مخترَعٍ، **وأصدقُ كذلكَ من فراغٍ بلا تفسيرٍ**.
 *
 * ## ولماذا السببُ «لا سائقَ قادراً في المدينةِ» لا «لا سائقَ متّصلاً»
 *
 * لأنَّ المقيسَ في القاعدةِ **قدرةٌ لا اتّصالٌ**: سائقٌ موثَّقٌ مشترِكٌ قدرتُه
 * مُفعَّلةٌ. والاتّصالُ الآنَ وقُربُه شأنُ التوزيعِ في `F2-05`، ولو قيلَ للراكبِ
 * «لا سائقَ متّصلاً» بناءً على قدرةٍ لَكانَ ذلكَ **ادّعاءً لم يُقَسْ**. فاسمُ
 * الرمزِ يُطابِقُ ما قِيسَ حرفاً.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 * لا يُرتِّبُ البطاقاتِ بوزنٍ تجاريٍّ: الترتيبُ ثابتٌ مُعلَنٌ (`transport` ثمَّ
 * `delivery`) كي لا يصيرَ ترتيبُ العرضِ قراراً خفيّاً. ولا يعرفُ سعراً ولا وسيلةَ
 * دفعٍ (`ADR 0039`). ولا يُصيغُ نصّاً: مفاتيحُ i18n وحدَها.
 */

/**
 * الخدمتانِ في المنتَجِ — مطابقتانِ لـ`service_type` في القاعدةِ حرفاً بحرفٍ.
 *
 * وحاجزُ العقدِ يُقابِلُ هذه القائمةَ بقائمةِ النوعِ المعدودِ في الترحيلِ، فلا
 * تفترقانِ بصمتٍ (القاعدة 0.6).
 */
export const SERVICE_KINDS = ["transport", "delivery"] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** سببُ تعذُّرِ الخدمةِ. مُصنَّفٌ لا مُجمَّعٌ. */
export type ServiceUnavailableReason =
  /**
   * لا سائقَ في هذه المدينةِ موثَّقٌ مشترِكٌ قدرتُه على هذه الخدمةِ مُفعَّلةٌ.
   * حالةُ منتَجٍ سليمةٌ في مدينةٍ ناشئةٍ، لا عطبٌ.
   */
  "NO_CAPABLE_DRIVER_IN_CITY";

export type ServiceOffer =
  | { readonly service: ServiceKind; readonly available: true }
  | {
      readonly service: ServiceKind;
      readonly available: false;
      readonly reason: ServiceUnavailableReason;
    };

export function isServiceKind(value: string): value is ServiceKind {
  return (SERVICE_KINDS as readonly string[]).includes(value);
}

/**
 * بطاقاتُ الخدماتِ كلُّها، بترتيبٍ ثابتٍ، ولكلِّ متعذِّرةٍ سببُها.
 *
 * تُبنى من قائمةِ المخدومِ كما أعادتْها القاعدةُ — ولا تُعادُ حسبةُ «من يخدمُ»
 * ههنا: مصدرُ الحقيقةِ واحدٌ (القاعدة 0.6).
 */
export function offersFromServed(served: readonly string[]): readonly ServiceOffer[] {
  const servedSet = new Set(served);
  return SERVICE_KINDS.map((service) =>
    servedSet.has(service)
      ? ({ service, available: true } as const)
      : ({ service, available: false, reason: "NO_CAPABLE_DRIVER_IN_CITY" } as const),
  );
}

/** هل في المدينةِ خدمةٌ واحدةٌ على الأقلِّ؟ الشاشةُ تحتاجُ الجوابَ سطراً واحداً. */
export function hasAnyAvailable(offers: readonly ServiceOffer[]): boolean {
  return offers.some((offer) => offer.available);
}
