/**
 * الغرض: **موضعُ القياسِ الواحدُ في التطبيقِ المصغَّر** — يستقبل حدثاً، يُنقّيه،
 *   يضع عليه لحظةً، ويسلّمه إلى المَصرِف. البند `F1-08`.
 * الحالة: منفّذ فعلياً — البند `F1-08`.
 * ينتمي إلى: apps/miniapp/src/telemetry (حزمة «القياس» — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` (يُنشئ واحداً ويمرّره)، و`identity/boot.ts`
 *   و`shell/ErrorBoundary.tsx` (يستقبلانه اختياريّاً)، و`api/client.ts` عبرَ
 *   `observe` — والحدُّ لا يعرف القياسَ ولا يستوردُه.
 * ملاحظات مستقبلية: `flush` ودفعُ الأحداثِ إلى الشبكةِ **ليسا ههنا**: لا مستقبِلَ
 *   (`REQ-05` معلَّق) ولا موافقةَ (9.12). وحين يُقرَّران يُضاف مَصرِفٌ لا مِنصةٌ ههنا.
 *
 * ثلاثةُ عهودٍ يقطعها هذا الملفُّ، ولكلٍّ منها اختبارٌ:
 *   ــ **لا يرمي أبداً**: مَصرِفٌ معطوبٌ يرمي فيُلتقَط ويُهمَل. قياسٌ يُسقِط شاشةً
 *      أسوأُ من لا قياسٍ — والمستخدمُ لا يخسر رحلتَه لأنّ عدّاداً انكسر.
 *   ــ **لا حدثَ يمرُّ بلا تنقيةٍ**: `sanitizeEvent` تُنادى ههنا لا في المنادي،
 *      فلا يوجد طريقٌ يتجاوزها.
 *   ــ **لا وقتَ من داخلِه**: الساعةُ محقونةٌ (`now`)، فالاختبارُ يقرأ لحظةً
 *      معلومةً لا لحظةَ التشغيل.
 *
 * ولا مؤقّتَ ولا `setInterval` ولا شبكةَ ولا تخزينَ ههنا — وحاجزُ
 * `scripts/check-telemetry-policy.ts` يفرض ذلك على المجلَّدِ كلِّه.
 */

import { sanitizeEvent, type TelemetryEvent } from "./events.ts";
import { noopSink, type TelemetrySink } from "./sink.ts";

export interface Telemetry {
  record(event: TelemetryEvent): void;
}

export interface TelemetryDeps {
  /** غيابُه = `noopSink`: الافتراضُ أن لا شيءَ يخرج (قرارُ `F1-08`). */
  readonly sink?: TelemetrySink;
  readonly now?: () => number;
}

export function createTelemetry(deps: TelemetryDeps = {}): Telemetry {
  const sink = deps.sink ?? noopSink;
  const now = deps.now ?? (() => Date.now());
  return {
    record: (event: TelemetryEvent): void => {
      try {
        sink.record({ atMs: now(), event: sanitizeEvent(event) });
      } catch {
        // يُهمَل عن قصدٍ ولا يُطبَع: `console.error` ههنا يجعل مَصرِفاً معطوباً
        // يملأ أثرَ التشخيصِ بضجيجٍ في كلِّ نداءٍ، والقياسُ ليس أهمَّ من الشاشة.
      }
    },
  };
}
