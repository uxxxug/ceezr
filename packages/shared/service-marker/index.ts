/**
 * الغرض: علامةُ لونِ الخدمةِ على بطاقاتِ تيليجرام (`MSG-COLOR-01`) — طلبُ المالكِ: التوصيلُ
 *   أصفرُ، والمشوارُ (النقلُ) أخضرُ، والشهريُّ مستقبلاً ورديٌّ فاتحٌ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/shared
 * يُتوقع أن يستخدمه لاحقاً: ناشرو بطاقاتِ العروضِ وبطاقاتِ القروبِ، ومعرضُ الرسائلِ.
 *
 * تيليجرام لا يُلوِّنُ خلفيّةَ رسالةٍ ولا زرٍّ، فاللونُ يُحمَلُ بمربّعٍ ملوَّنٍ في رأسِ
 * البطاقةِ — وهوَ ما يراهُ السائقُ في القائمةِ قبلَ أن يقرأَ حرفاً.
 */

export type MarkedService = "delivery" | "transport" | "monthly";

export const SERVICE_MARKER: Readonly<Record<MarkedService, string>> = {
  delivery: "🟨",
  transport: "🟩",
  /** محجوزٌ للخدمةِ الشهريّةِ حينَ تُضافُ — لا خدمةَ بهذا الاسمِ اليومَ. */
  monthly: "🩷",
};

/** رمزُ الخدمةِ بعدَ اللونِ: صندوقٌ للتوصيلِ وسيّارةٌ للمشوارِ. */
const SERVICE_ICON: Readonly<Record<MarkedService, string>> = {
  delivery: "📦",
  transport: "🚕",
  monthly: "🗓",
};

/** رأسُ البطاقةِ: اللونُ ثمَّ الرمزُ. خدمةٌ مجهولةٌ ← الرمزُ القديمُ وحدَه بلا لونٍ. */
export function serviceMarker(service: string | null): string {
  if (service === "delivery" || service === "transport" || service === "monthly") {
    return `${SERVICE_MARKER[service]} ${SERVICE_ICON[service]}`;
  }
  return "🚕";
}
