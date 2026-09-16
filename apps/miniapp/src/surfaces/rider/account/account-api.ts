/**
 * الغرض: **مُهايئٌ رقيقٌ** لنداءَي حقَّي البيانةِ — المسارانِ لا يذكرانِ دوراً،
 *   فالنداءُ واحدٌ (`F2-11` · `SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-11`، ومُهيَّأٌ في `SD-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/account
 * يُستخدم من: `AccountScreen.tsx`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ## لماذا كلمةُ التأكيدِ تُرسَلُ ولا تُستنتَجُ (الحكمُ باقٍ حرفاً)
 *
 * الخادمُ يُقابِلُها حرفاً على مجالٍ مغلقٍ من ثلاثِ كلماتٍ. ولو أرسلَت الشاشةُ
 * `confirmed: true` لَكانَ الحاجزُ في الواجهةِ وحدَها — وهيَ الطبقةُ التي
 * تُتجاوَزُ بنداءٍ مباشرٍ.
 *
 * ## وما نُقِلَ (`ح-8`)
 *
 * جسمُ النداءَينِ في `surfaces/account/account-api.ts` موضعاً واحداً، وههنا
 * إعادةُ تصديرٍ بالأسماءِ نفسِها: `requestDataExport` · `requestErasure`.
 */

export { requestDataExport, requestErasure } from "../../account/account-api.ts";
export type * from "../../account/account-contract.ts";
