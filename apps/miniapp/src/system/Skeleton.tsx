/**
 * الغرض: هيكلُ التحميلِ — تنفيذُ `UX-5` في القسم 9.1: «لكلِّ شاشةٍ **هيكلُ تحميل
 *   (skeleton)**». أسطرٌ بمقاسِ ما سيحلّ مكانَها، لا دائرةٌ تدور.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: كلُّ شاشةٍ تنتظر ردَّ خادمٍ في `F2`/`F3`.
 * ملاحظات مستقبلية: مقاساتُ الأسطرِ تُمرَّر من الشاشةِ حين تصير للشاشاتِ أشكالٌ
 *   معروفةٌ (بطاقةُ عرضٍ · صفُّ رحلةٍ)، فيصير الهيكلُ شبيهاً بما يأتي فعلاً.
 *
 * لماذا `aria-hidden` على الهيكلِ؟ لأنّ الأسطرَ الرماديةَ لا معنى لها في قارئِ
 * الشاشةِ، والخبرُ الصحيحُ «جارٍ التحميل» يحمله `aria-busy` على الحاوي (`UX-10`).
 * وقارئٌ يقرأ أربعةَ عناصرَ فارغةٍ أسوأُ من قارئٍ يقول «مشغول».
 */

/** أشكالُ الأسطر: عنوانٌ ثم نصٌّ ثم سطرٌ قصير. بمعرّفاتٍ ثابتةٍ لا بترتيبِ مصفوفة. */
const DEFAULT_LINES = [
  { id: "title", modifier: "sk__line--title" },
  { id: "body-1", modifier: "" },
  { id: "body-2", modifier: "" },
  { id: "tail", modifier: "sk__line--short" },
] as const;

export type SkeletonLine = { readonly id: string; readonly modifier: string };

export function Skeleton({ lines = DEFAULT_LINES }: { lines?: readonly SkeletonLine[] }) {
  return (
    <div className="sk" aria-hidden="true">
      {lines.map((line) => (
        <span key={line.id} className={`sk__line ${line.modifier}`.trimEnd()} />
      ))}
    </div>
  );
}
