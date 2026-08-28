/**
 * الغرض: تركيب تطبيق Hono الفعلي: المسارات، معالجة الأخطاء، ورفض ما لا يُعرَف.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/gateway-*.test.ts
 * ملاحظات مستقبلية: مسارات لوحة الإدارة تُضاف كموجّه منفصل بلا تعديل هذا الملف.
 */

import { Hono } from "hono";
import { createHealthRoutes, type HealthDependencies } from "./routes/health.ts";
import {
  createPaymentWebhookRoutes,
  type PaymentWebhookDependencies,
} from "./routes/payment-webhook.ts";
import {
  createSessionRefreshRoutes,
  type SessionRefreshDependencies,
} from "./routes/session-refresh.ts";
import {
  createSessionTelegramRoutes,
  type SessionTelegramDependencies,
} from "./routes/session-telegram.ts";
import {
  createTelegramWebhookRoutes,
  type WebhookDependencies,
} from "./routes/telegram-webhook.ts";

export interface ServerDependencies {
  readonly health: HealthDependencies;
  readonly webhook: WebhookDependencies;
  /** منفذ ويبهوك الدفع — اختياري: يُفعَّل فقط عند توفّر أسرار الدفع (البند 8). */
  readonly paymentWebhook?: PaymentWebhookDependencies;
  /**
   * مسارُ جلسةِ التطبيقِ المصغَّر (`F1-03`) — اختياريٌّ: يُركَّب فقط عند توفّرِ سرِّ
   * التوقيعِ ورمزِ بوتٍ موقِّع. وغيابُه هنا يعني أنّ المسارَ غيرُ موجودٍ أصلاً
   * (`404`)، وحضورُه بلا تبعياتِ تحقّقٍ يعني تعطيلاً معلَناً (`503`).
   */
  readonly sessionTelegram?: SessionTelegramDependencies;
  /**
   * مسارُ تجديدِ الجلسة (`F1-04`) — اختياريٌ بنفسِ منطقِ مسارِ الإنشاء:
   * غيابُه هنا = لا مسار (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَن (`503`).
   */
  readonly sessionRefresh?: SessionRefreshDependencies;
}

export function createServer(deps: ServerDependencies): Hono {
  const app = new Hono();

  app.route("/", createHealthRoutes(deps.health));
  app.route("/", createTelegramWebhookRoutes(deps.webhook));
  if (deps.paymentWebhook !== undefined) {
    app.route("/", createPaymentWebhookRoutes(deps.paymentWebhook));
  }
  if (deps.sessionTelegram !== undefined) {
    app.route("/", createSessionTelegramRoutes(deps.sessionTelegram));
  }
  if (deps.sessionRefresh !== undefined) {
    app.route("/", createSessionRefreshRoutes(deps.sessionRefresh));
  }

  app.notFound((c) => c.json({ ok: false, error: "NOT_FOUND" }, 404));

  // أي استثناء غير متوقَّع لا يكشف تفاصيل داخلية للمُرسِل
  app.onError((error, c) => {
    deps.webhook.log?.("استثناء غير متوقَّع", { message: String(error) });
    return c.json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  });

  return app;
}
