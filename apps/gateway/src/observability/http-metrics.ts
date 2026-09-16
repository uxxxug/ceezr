/**
 * الغرض: `F8-02` — **معدَّلُ الحافةِ وتأخّرُها وأخطاؤُها**: وسيطٌ واحدٌ يعُدُّ كلَّ
 *   طلبٍ يمرُّ بالبوّابةِ ويقيسُ زمنَه ويعُدُّ ما فشلَ منه، بوسمٍ **قالبَ المسارِ**
 *   لا المسارَ الخامَّ.
 * الحالة: منفّذ فعلياً — البند `F8-02`.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` وحدَه (موضعُ التركيبِ الواحدُ).
 * ملاحظات مستقبلية: عندَ تركيبِ ناقلِ OpenTelemetry (`F8-01` · `DEC-17`) يصيرُ هذا
 *   الموضعُ مصدرَ المدى (span) لا موضعاً يُلغى.
 *
 * ## ثلاثةُ حدودٍ مقصودةٍ
 *
 *   ــ **الوسمُ قالبُ Hono لا `c.req.path`**: `c.req.routePath` يُعيدُ النمطَ
 *      المُعرَّفَ (`/v1/driver/offers/:offerId/accept`)، والمسارُ الخامُّ يحملُ
 *      معرِّفاً فيُنشئُ سلسلةً لكلِّ طلبٍ. والتطبيعُ نفسُه في
 *      `packages/infrastructure/observability/http-metrics.ts` **فلا يملكُ هذا
 *      الوسيطُ أن يُمرِّرَ وسماً حرّاً حتى لو أخطأَ**.
 *   ــ **الاستثناءُ يُعَدُّ ثمَّ يُعادُ رفعُه**: طلبٌ ماتَ باستثناءٍ لا يعبرُ من
 *      غيرِ عدٍّ (وإلّا صارَ الانفجارُ **نقصاً** في عدَّادِ الطلباتِ لا زيادةً في
 *      عدَّادِ الأخطاءِ)، ولا يُلتقَطُ ليُبتلَعَ: يُعادُ رفعُه إلى `onError`.
 *   ــ **لا يُسقِطُ الطلبَ ألبتّةَ**: خطأٌ في التسجيلِ نفسِه يُبتلَعُ صامتاً —
 *      وسيطُ مراقبةٍ يُسقِطُ ما يراقبُه أسوأُ من غيابِ المراقبةِ.
 */

import type { MiddlewareHandler } from "hono";
import type { OperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";

/**
 * `now` يُحقَنُ للاختبارِ وحدَه؛ وللإنتاجِ `performance.now` لأنَّه ساعةٌ
 * **رتيبةٌ** لا تُزاحُ بمزامنةِ الوقتِ، فزمنُ طلبٍ لا يصيرُ سالباً عندَ ضبطِ
 * ساعةِ النظامِ في منتصفِ الطلبِ.
 */
export function createHttpMetricsMiddleware(
  metrics: OperationalMetrics,
  now: () => number = () => performance.now(),
): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = now();
    const method = c.req.method;
    try {
      await next();
    } catch (cause) {
      try {
        metrics.recordHttpUnhandledError(method, c.req.routePath);
      } catch {
        /* لا يُسقِطُ التسجيلُ طلباً ولا يُخفي سبباً: السببُ يُعادُ رفعُه فوراً. */
      }
      throw cause;
    }
    try {
      metrics.recordHttpRequest(method, c.req.routePath, c.res.status, now() - startedAt);
    } catch {
      /* المراقبةُ لا تُسقِطُ ما تراقبُه. */
    }
  };
}
