/**
 * الغرض: العرضُ الموحَّدُ لكلِّ حالةِ نظامٍ — عنوانٌ وشرحٌ وسطرٌ ثانويٌّ وزرُّ فعلٍ
 *   واحد. تنفيذُ `UX-5` (لكلِّ شاشةٍ حالةُ خطأٍ **لها زرُّ فعل**) و`UX-10`
 *   (مساحةُ لمسٍ ≥44×44 · قارئُ شاشةٍ يعمل · لا معلومةَ باللونِ وحدَه).
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — «حدود الخطأ» في القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` و`shell/ErrorBoundary.tsx`
 *   و`routing/RoleRouter.tsx`، وكلُّ شاشةٍ تفشل في `F2`/`F3`.
 * ملاحظات مستقبلية: زرُّ الفعلِ ههنا زرُّ HTML عاديّ. وربطُه بزرِّ تيليجرامَ
 *   الرئيسِ (`BottomButton` — القسم 9.3) يحتاج قراراً في أيِّ الشاشاتِ يُستعمل
 *   الزرُّ الأصليُّ وأيِّها الزرُّ الداخليّ، فلا يُخلَط ههنا.
 *
 * **لا قرارَ نصٍّ في هذا الملفِّ**: النصُّ كلُّه في `state-text.ts`، وهذا عرضٌ
 * لا أكثر. ولذلك يبقى الملفُّ عاجزاً عن أن يخترع حالةً لا نصَّ لها.
 */

import { type ScreenState, screenText, screenTone } from "./state-text.ts";

export interface SystemScreenProps {
  readonly state: ScreenState;
  /** الفعلُ بيدِ المستخدمِ وحدَه — ولا إعادةَ محاولةٍ تلقائيةً ولا استقصاءَ دوريّاً. */
  readonly onAction?: () => void;
  /** الفعلُ جارٍ: يُعطَّل الزرُّ فلا يُنادى مرّتين بلمستين. */
  readonly busy?: boolean;
}

export function SystemScreen({ state, onAction, busy = false }: SystemScreenProps) {
  const text = screenText(state);
  const showAction = text.actionLabel !== null && onAction !== undefined;

  return (
    <section className="sys" role={screenTone(state)}>
      <h1 className="sys__title">{text.title}</h1>
      <p className="sys__body">{text.body}</p>
      {text.hint === null ? null : <p className="sys__hint">{text.hint}</p>}
      {showAction ? (
        <button
          type="button"
          className="sys__action"
          onClick={onAction}
          disabled={busy}
          aria-busy={busy ? "true" : undefined}
        >
          {busy ? "جارٍ المحاولة…" : text.actionLabel}
        </button>
      ) : null}
    </section>
  );
}
