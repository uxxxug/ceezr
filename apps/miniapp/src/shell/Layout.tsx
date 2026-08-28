/**
 * الغرض: الإطارُ المتجاوبُ للتطبيقِ — رأسٌ ثم محتوىً ثم منطقةُ فعلٍ سفليةٌ
 *   (القسم 9.3)، بحواشي الجهازِ الآمنةِ من `F1-06` وبخصائصَ منطقيةٍ تنقلب مع
 *   الاتجاهِ بلا نسخةٍ ثانيةٍ من التنسيق.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/shell (حزمة `shell` — «الإطار» في القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` اليومَ، وكلُّ سطحٍ جذريٍّ في
 *   `F2`/`F3` حين تصير للشاشاتِ رؤوسٌ وأزرارٌ سفلية.
 * ملاحظات مستقبلية: **الشريطُ السفليُّ بأربعِ علاماتٍ** لكلِّ دورٍ (القسم 9.3)
 *   بندُ `F2`/`F3` ولا يُبنى ههنا: شريطٌ بلا شاشاتٍ يتنقّل بينها هيكلٌ فارغ.
 *   و`BottomButton` الأصليُّ من تيليجرام يحتاج قراراً في أيِّ الشاشاتِ يُستعمل،
 *   فمنطقةُ الفعلِ ههنا حاوٍ عاديٌّ لا زرٌّ أصلي.
 *
 * لماذا التنسيقُ في `global.css` لا في كائنٍ داخلَ الملفِّ؟ لأنّ التجاوبَ يحتاج
 * `@media` و`:empty`، وكلاهما لا يُكتَب في `style` سطريّ. والإطارُ الذي لا
 * يتجاوب في التنسيقِ لا يتجاوب بالنيّة.
 */

import type { ReactNode } from "react";

export interface LayoutProps {
  /** رأسُ الشاشة — يُحذَف من الشجرةِ إن لم يُمرَّر، فلا فراغَ يُحجَز بلا محتوى. */
  readonly header?: ReactNode;
  readonly children: ReactNode;
  /** منطقةُ الفعلِ السفلية. */
  readonly action?: ReactNode;
  /** `UX-10`: يُعلَن الانشغالُ للقارئِ الآليِّ لا باللونِ وحدَه. */
  readonly busy?: boolean;
}

export function Layout({ header, children, action, busy = false }: LayoutProps) {
  return (
    <main className="app-frame" aria-busy={busy ? "true" : undefined}>
      {header === undefined ? <div /> : <header>{header}</header>}
      <div className="app-frame__content">{children}</div>
      <div className="app-frame__action">{action}</div>
    </main>
  );
}
