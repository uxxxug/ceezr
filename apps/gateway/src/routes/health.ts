/**
 * الغرض: مسارات الصحة والجهوزية الحقيقية التي تعتمد عليها Render في إعادة التشغيل.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts، لوحة Render، تنبيهات المراقبة
 * ملاحظات مستقبلية: عند وصل Supabase و Redis يضاف فحص اتصال فعلي إلى /ready بلا تغيير العقد.
 */

import { Hono } from "hono";
import { missingEnvKeys } from "../../../../packages/shared/config/index.ts";

export interface HealthDependencies {
  /** لحظة الآن — مُمرَّرة لتكون النتيجة قابلة للاختبار حتمياً. */
  readonly now: () => Date;
  readonly startedAt: Date;
  readonly env: Record<string, string | undefined>;
  /** فحوص جهوزية إضافية (قاعدة البيانات، Redis) تُضاف عند وصلها. */
  readonly readinessChecks?: readonly {
    readonly name: string;
    readonly check: () => Promise<boolean>;
  }[];
}

const MS_PER_SECOND = 1000;

export function createHealthRoutes(deps: HealthDependencies): Hono {
  const app = new Hono();

  /** حيّ: يجيب دائماً ما دامت العملية تعمل. لا يفحص التبعيات. */
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      uptimeSeconds: Math.floor(
        (deps.now().getTime() - deps.startedAt.getTime()) / MS_PER_SECOND,
      ),
    }),
  );

  /** جاهز: يجيب 503 إن كان أي مفتاح ناقصاً أو أي فحص فاشلاً، ويسمّي الناقص. */
  app.get("/ready", async (c) => {
    const missing = missingEnvKeys(deps.env);
    const failed: string[] = [];

    for (const probe of deps.readinessChecks ?? []) {
      const passed = await probe.check().catch(() => false);
      if (!passed) failed.push(probe.name);
    }

    const ready = missing.length === 0 && failed.length === 0;
    return c.json(
      { status: ready ? "ready" : "not_ready", missingEnv: missing, failedChecks: failed },
      ready ? 200 : 503,
    );
  });

  return app;
}
