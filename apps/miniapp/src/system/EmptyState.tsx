/**
 * الغرض: الحالةُ الفارغة — تنفيذُ `UX-5` في القسم 9.1: «لكلِّ شاشةٍ … **حالةُ
 *   فراغ**». تقول ما الذي ليس ههنا ولماذا، لا فراغاً صامتاً يُقرأ عطلاً.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: أسطحُ `F2`/`F3` حين تعرض قوائمَ قد تخلو (رحلاتٌ
 *   سابقةٌ · عروضٌ · طلباتٌ قريبة).
 * ملاحظات مستقبلية: الفعلُ اختياريٌّ ههنا وليس كذلك في شاشةِ الخطأ: قائمةٌ فارغةٌ
 *   قد لا يكون بيدِ المستخدمِ ما يفعله بها، أمّا الخطأُ فله فعلٌ دائماً (`UX-5`).
 *
 * الفرقُ بينه وبين `SystemScreen` مقصود: هذا **ليس فشلاً**. ولذلك لا `role="alert"`
 * ولا زرَّ إعادةِ محاولة: قائمةٌ فارغةٌ نتيجةٌ صحيحةٌ لا عطلٌ يُصلَح.
 */

import type { ReactNode } from "react";

export interface EmptyStateProps {
  readonly title: string;
  readonly body: string;
  /** ما يمكن فعلُه — إن كان ثمّةَ فعلٌ أصلاً. */
  readonly action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <section className="sys">
      <h2 className="sys__title">{title}</h2>
      <p className="sys__hint">{body}</p>
      {action}
    </section>
  );
}
