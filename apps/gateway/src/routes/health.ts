/**
 * الغرض: مسارات الصحة والجهوزية الحقيقية التي تعتمد عليها Render في إعادة التشغيل.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts، لوحة Render، تنبيهات المراقبة
 * ملاحظات مستقبلية: فحص قاعدة البيانات مركَّب فعلاً في index.ts؛ وفحص Redis مركَّب
 *   بنفس الشكل لكن بـ critical=false — راجع التعليق على ReadinessProbe أدناه.
 */

import { Hono } from "hono";
import { missingEnvKeys } from "../../../../packages/shared/config/index.ts";

export interface HealthDependencies {
  /** لحظة الآن — مُمرَّرة لتكون النتيجة قابلة للاختبار حتمياً. */
  readonly now: () => Date;
  readonly startedAt: Date;
  readonly env: Record<string, string | undefined>;
  /** فحوص جهوزية إضافية (قاعدة البيانات، Redis) تُضاف عند وصلها. */
  readonly readinessChecks?: readonly ReadinessProbe[];
}

/**
 * تبعية تُفحص قبل إعلان الجهوزية.
 *
 * `critical` يفصل بين «الخدمة لا تعمل» و«الخدمة تعمل ناقصةً». الفرق ليس تجميلياً:
 * Render يوقف توجيه الحركة إلى النسخة بعد 15 ثانية من فشل الفحص، ويعيد تشغيلها
 * بعد 60 ثانية (توثيق Render — Health Checks). وبما أن `numInstances = 1` فلا
 * نسخة أخرى تستقبل بدلاً منها، فالنتيجة انقطاع كامل.
 *
 * لذلك القاعدة: تبعية لا تُصلحها إعادة التشغيل ولا يتوقّف عليها استقبال
 * التحديثات ليست `critical`. إسقاط الخدمة كلها من أجلها يحوّل عطلاً جزئياً
 * خارجياً إلى انقطاع كامل، ويدخلها في دورة إعادة تشغيل لا تُصلح شيئاً.
 *
 * الافتراضي `true`: من يضيف فحصاً ولا يفكّر في تصنيفه يحصل على السلوك الأكثر
 * تحفّظاً، لا على تساهلٍ صامت.
 */
export interface ReadinessProbe {
  readonly name: string;
  readonly check: () => Promise<boolean>;
  readonly critical?: boolean;
}

const MS_PER_SECOND = 1000;

export function createHealthRoutes(deps: HealthDependencies): Hono {
  const app = new Hono();

  /** حيّ: يجيب دائماً ما دامت العملية تعمل. لا يفحص التبعيات. */
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      uptimeSeconds: Math.floor((deps.now().getTime() - deps.startedAt.getTime()) / MS_PER_SECOND),
    }),
  );

  /**
   * جاهز: يجيب 503 إن كان أي مفتاح ناقصاً أو أي فحص **حرج** فاشلاً، ويسمّي الناقص.
   *
   * فشل تبعية غير حرجة يعيد 200 مع `status: "degraded"` واسمها في `degradedChecks`.
   * ⚠️ للمراقبة: لا يكفي مراقبة رمز HTTP وحده — يجب الإنذار حين لا يكون
   * `status` هو `"ready"`. راجع docs/render-deployment-vars.md §5.
   */
  app.get("/ready", async (c) => {
    const missing = missingEnvKeys(deps.env);
    const failed: string[] = [];
    const degraded: string[] = [];

    for (const probe of deps.readinessChecks ?? []) {
      const passed = await probe.check().catch(() => false);
      if (passed) continue;
      if (probe.critical ?? true) failed.push(probe.name);
      else degraded.push(probe.name);
    }

    const ready = missing.length === 0 && failed.length === 0;
    const status = !ready ? "not_ready" : degraded.length > 0 ? "degraded" : "ready";
    return c.json(
      { status, missingEnv: missing, failedChecks: failed, degradedChecks: degraded },
      ready ? 200 : 503,
    );
  });

  return app;
}
