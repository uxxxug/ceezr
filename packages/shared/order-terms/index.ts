/**
 * الغرض: `ORDER-TERMS-01` — سطورُ شروطِ الطلبِ على كلِّ بطاقةٍ (العرضُ الخاصُّ للمشتركِ،
 *   وبطاقةُ قروبِ غيرِ المشتركينَ): وقتُ حضورِ السائقِ، ونوعُ الطردِ في التوصيلِ. صياغةٌ
 *   واحدةٌ في مكانٍ واحدٍ فلا تختلفُ البطاقتانِ.
 *   ولا سطرَ للمبلغِ: آليّةُ الأجرةِ محجوبةٌ بـ`ADR 0039` حتى يُغلَقَ `DEC-11` بسندٍ نظاميٍّ.
 * الحالة: منفّذ فعلياً — 2026-10-03.
 * ينتمي إلى: shared
 * ملاحظات: الوقتُ يُعرَضُ بتوقيتِ السعوديّةِ (كلُّ مدنِ الخدمةِ فيها) بنظامِ ١٢ ساعةً وص/م.
 */

/** ما يعرضُه الراكبُ على السائقِ. كلُّ حقلٍ غائبٍ له معنىً مُعلَنٌ لا فراغٌ. */
export interface OrderTerms {
  /** وقتُ حضورِ السائقِ — `null` ⇒ «الآن». */
  readonly pickupAt: Date | null;
  /** نوعُ الطردِ في التوصيلِ — `null` ⇒ «لم يُحدَّد». يُتجاهَلُ في النقلِ. */
  readonly parcel: string | null;
}

/** المنطقةُ الزمنيّةُ لعرضِ الوقتِ: مدنُ الخدمةِ كلُّها في السعوديّةِ (UTC+3 بلا توقيتٍ صيفيٍّ). */
export const ORDER_TERMS_TIME_ZONE = "Asia/Riyadh";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** «1:30 م» — الساعةُ والدقائقُ بتوقيتِ الرياضِ ولاحقةُ ص/م من القاموسِ. */
export function formatPickupClock(at: Date, tr: Translate): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORDER_TERMS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const suffix = period.toUpperCase().startsWith("A") ? tr("common.time_am") : tr("common.time_pm");
  return `${hour}:${minute} ${suffix}`;
}

/** سطرُ الوقتِ (وسطرُ الطردِ في التوصيلِ) بالترتيبِ الذي طلبَه المالكُ. */
export function orderTermsLines(
  tr: Translate,
  service: string | null,
  terms: OrderTerms,
): readonly string[] {
  const lines: string[] = [
    terms.pickupAt === null
      ? tr("driver.offer_card_pickup_now")
      : tr("driver.offer_card_pickup_at", { time: formatPickupClock(terms.pickupAt, tr) }),
  ];
  if (service === "delivery") {
    const parcel = terms.parcel?.trim() ?? "";
    lines.push(
      parcel === ""
        ? tr("driver.offer_card_parcel_none")
        : tr("driver.offer_card_parcel", { parcel }),
    );
  }
  return lines;
}
