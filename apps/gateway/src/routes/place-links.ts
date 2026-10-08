/**
 * روابطُ فتحِ المكانِ للبوّابة — `LOC-TRUST-01`. المصدرُ الواحدُ في
 * `packages/domain/places/place-open-url.ts` (يقرؤه مُرسِلُ بطاقةِ السائقِ أيضاً)،
 * وهذا الملفُّ نافذتُه للمسارات. والسببُ أنَّ الرابطَ يُبنى في الخادمِ لا في المصغَّرِ
 * (`F1-10` · `TG-005`) مكتوبٌ هناك.
 */
export { navigationUrlFor, openUrlFor } from "../../../../packages/domain/places/place-open-url.ts";
