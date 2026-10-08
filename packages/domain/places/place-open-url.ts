/**
 * # روابطُ فتحِ المكانِ — تُبنى في الخادمِ وحدَه · `LOC-TRUST-01`
 *
 * **الغرض:** مصدرٌ واحدٌ لسؤالِ «أيُّ رابطٍ يُفتَحُ لهذا المكان؟»، تقرؤه بطاقةُ السائقِ
 * (Telegram وشاشتا العرضِ والمَهمّة) وشاشةُ الراكبِ («تحقّق على الخريطة»).
 *
 * والقاعدةُ (`ADR 0247`): **إن أدخلَ الراكبُ رابطاً أصليّاً يُفتَحُ هوَ نفسُه**، وإلّا
 * فرابطُ خرائطَ يُبنى من النقطة. والرابطُ الأصليُّ لا يُفتَحُ إلّا إن كانَ من مضيفي الخرائطِ
 * المقبولينَ وبصيغةٍ يقبلُها زرُّ Telegram (`isOpenableLink`)؛ وإلّا فمن النقطة.
 *
 * ولماذا في الخادم: حاجزُ `F1-10`/`TG-005` يمنعُ العنوانَ المطلقَ في شيفرةِ التطبيقِ
 * المصغَّر (الشرحُ في `navigationUrlFor`). فالشاشةُ تفتحُ ما أُعطِيَت ولا تُركِّبُ عنواناً.
 *
 * **لا يستوردُه التطبيقُ المصغَّرُ أبداً** — فيه عنوانٌ مطلق.
 *
 * **الحالة:** منفّذ فعلياً. **ينتمي إلى:** domain/places · يستخدمه: البوّابةُ ومُرسِلُ بطاقةِ السائق.
 */
import { isOpenableLink } from "./place-input.ts";

/**
 * رابطُ الملاحةِ من نقطةٍ. والمُضيفُ حرفيٌّ لا من تهيئةٍ: تهيئةٌ تُغيَّرُ بلا مراجعةٍ
 * تُحوِّلُ الرابطَ إلى وجهةٍ أُخرى في يدِ مَن يملكُ متغيّرَ بيئةٍ.
 */
export function navigationUrlFor(place: {
  readonly latitude: number;
  readonly longitude: number;
}): string {
  return `https://maps.google.com/?q=${place.latitude},${place.longitude}`;
}

/** الرابطُ الذي يُفتَحُ للسائق: الأصليُّ إن صلحَ للفتح، وإلّا من النقطة، وإلّا لا شيء. */
export function openUrlFor(place: {
  readonly link: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}): string | null {
  if (place.link !== null && isOpenableLink(place.link)) return place.link;
  if (place.latitude === null || place.longitude === null) return null;
  return navigationUrlFor({ latitude: place.latitude, longitude: place.longitude });
}
