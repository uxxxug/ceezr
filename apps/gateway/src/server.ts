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
  createTelegramWebhookRoutes,
  type WebhookDependencies,
} from "./routes/telegram-webhook.ts";

export interface ServerDependencies {
  readonly health: HealthDependencies;
  readonly webhook: WebhookDependencies;
}

export function createServer(deps: ServerDependencies): Hono {
  const app = new Hono();

  app.route("/", createHealthRoutes(deps.health));
  app.route("/", createTelegramWebhookRoutes(deps.webhook));

  app.notFound((c) => c.json({ ok: false, error: "NOT_FOUND" }, 404));

  // أي استثناء غير متوقَّع لا يكشف تفاصيل داخلية للمُرسِل
  app.onError((error, c) => {
    deps.webhook.log?.("استثناء غير متوقَّع", { message: String(error) });
    return c.json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  });

  return app;
}
