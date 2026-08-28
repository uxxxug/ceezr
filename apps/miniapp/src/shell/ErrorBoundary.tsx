/**
 * الغرض: حدُّ الخطأ — يمنع الشاشةَ البيضاءَ عندَ استثناءٍ في العرضِ (`UX-5`،
 *   القسم 9.1)، ويعرض بدلَها شاشةَ حالةٍ لها زرُّ فعل.
 * الحالة: منفّذ فعلياً — البند `F1-01`، ومُوسَّعٌ في `F1-07`.
 * ينتمي إلى: apps/miniapp/src/shell (حزمة `shell` — «حدود الخطأ» في القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: كلُّ سطحٍ جذريٍّ يُلَفُّ بحدٍّ خاصٍّ به في `F2`/`F3`.
 * ملاحظات مستقبلية: إرسالُ الخطأِ إلى مرصدٍ خارجيٍّ (القسم 9.4: «القياس») ما زال
 *   ليس ههنا: `F1-08` أضاف حدثَ قياسٍ **لا يخرج من الجهازِ** (قرارُ المالك)،
 *   و`console.error` أثرٌ محليٌّ لا قياس. والمرصدُ الخارجيُّ قرارٌ لم يُتَّخذ.
 *
 * `F1-07` — إضافتان اثنتان لا ثالثةَ لهما:
 *   ــ **العرضُ صار عبرَ `SystemScreen`**: فنصُّ «حدث خطأٌ غيرُ متوقّع» صار في
 *      موضعِ النصوصِ الواحدِ لا مكرَّراً في مكانين يفترقان مع الوقت.
 *   ــ **`onReset` اختياريٌّ**: مسحُ الخطأِ وحدَه يعيد عرضَ الشجرةِ نفسِها،
 *      وسببُ السقوطِ قد يكون في حالةٍ أعلى. فالمنادي الذي يملك إعادةَ المحاولةِ
 *      حقّاً (إعادةُ طلبٍ · إعادةُ تحميلِ حزمةٍ) يمرّرها، والباقي يمسح فقط.
 *
 * ولا يُسجَّل ههنا شيءٌ من محتوى الخطأِ إلى مكانٍ دائم، ولا يُعرَض نصُّ الاستثناءِ
 * للمستخدم: قد يحمل عنواناً أو معرّفاً، والشاشةُ ليست موضعَ تشخيصٍ تقنيّ.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { SystemScreen } from "../system/SystemScreen.tsx";
import type { Telemetry } from "../telemetry/telemetry.ts";

type Props = {
  children: ReactNode;
  /** اسمُ الموضعِ في أثرِ التشخيصِ — لتمييزِ حدِّ الجذرِ من حدِّ السطح. */
  label?: string;
  /** فعلٌ إضافيٌّ عندَ إعادةِ المحاولة — يُنادى بعدَ مسحِ الخطأ. */
  onReset?: () => void;
  /**
   * `F1-08`: القياسُ اختياريٌّ. والمُسجَّلُ **وسمُ الموضعِ وحدَه** — لا رسالةُ
   * الاستثناءِ ولا مسارُ المكوّناتِ: كلاهما نصٌّ حرٌّ قد يحمل عنواناً أو معرّفاً،
   * وقائمةُ المسموحِ في `telemetry/events.ts` ترفضهما أصلاً.
   */
  telemetry?: Telemetry;
};
type State = { error: Error | null };

/** UX-5: never a blank white screen (ROADMAP §9.1). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // `F1-08`: حدثُ خطأِ واجهةٍ بلا معرّفِ طلبٍ — سقوطُ العرضِ ليس ردَّ خادمٍ،
    // ولا يُنسَب إلى نداءٍ لم يُعرَف أنه سببُه.
    this.props.telemetry?.record({
      kind: "ui_error",
      label: this.props.label ?? null,
      requestId: null,
    });
    console.error(
      `[miniapp] uncaught${this.props.label ? ` @${this.props.label}` : ""}`,
      error,
      info.componentStack,
    );
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      return <SystemScreen state={{ kind: "unknown_error" }} onAction={this.reset} />;
    }
    return this.props.children;
  }
}
