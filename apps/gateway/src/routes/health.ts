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
  /** هل بدأ التصريفُ الرشيقُ؟ إن نعم: يرتدُّ `/ready` بـ`503` فوراً بلا فحص (F5-05). */
  readonly isDraining?: () => boolean;
  /** أقصى مهلةٍ لكلِّ فحصٍ على حدةٍ؛ من تجاوزها عُدَّ فاشلاً (F5-05 / CAP-008). */
  readonly probeTimeoutMs?: number;
  /** النومُ مَحقونٌ للاختبار؛ الافتراضُ `Bun.sleep`. */
  readonly sleep?: (ms: number) => Promise<void>;
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
  readonly check: () => Promise<boolean | ProbeOutcome>;
  readonly critical?: boolean;
}

/**
 * نتيجةٌ مفصّلة. اسمُ الفحصِ وحده يقول «المخطّط ناقص» ولا يقول ما الناقص، ومن
 * يقرأ `/ready` في حادثةٍ ليلاً يحتاج الاسمَ الناقصَ لا التصنيف. فالتفصيلُ اختياريٌّ
 * ولا يُذاع إلّا عند الإخفاق: لا قيمةَ في إغراقِ الردِّ الناجح.
 */
export interface ProbeOutcome {
  readonly ok: boolean;
  readonly detail?: string;
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
   *
   * ## التوازيُ والمهلة (F5-05 / CAP-008)
   *
   * الفحوصُ تُشغَّلُ **بالتوازي** (`Promise.all`) لا بالتسلسل — فلا يربط فحصٌ بطيءٌ
   * زمنَ ردِّ الفحوصِ كلِّها. ولكلِّ فحصٍ مهلةٌ مستقلّة: من تجاوزها عُدَّ فاشلاً
   * بتفصيلٍ «انقضتِ المهلة»، ولا يُنتظرُ إلى الأبد. وإن بدأ التصريفُ (`isDraining`)
   * ارتدَّ الردُّ `503` فوراً بلا تشغيلِ أيِّ فحص.
   */
  app.get("/ready", async (c) => {
    if (deps.isDraining?.() === true) {
      return c.json(
        { status: "draining", missingEnv: [], failedChecks: [], degradedChecks: [] },
        503,
      );
    }

    const missing = missingEnvKeys(deps.env);
    const failed: string[] = [];
    const degraded: string[] = [];

    const details: Record<string, string> = {};

    const probes = deps.readinessChecks ?? [];
    const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
    const timeoutMs = deps.probeTimeoutMs;

    const outcomes = await Promise.all(
      probes.map(async (probe) => {
        const outcome = await runProbe(probe, timeoutMs, sleep);
        return { probe, outcome };
      }),
    );

    for (const { probe, outcome } of outcomes) {
      const passed = typeof outcome === "boolean" ? outcome : outcome.ok;
      if (passed) continue;
      const detail = typeof outcome === "boolean" ? undefined : outcome.detail;
      if (detail !== undefined && detail !== "") details[probe.name] = detail;
      if (probe.critical ?? true) failed.push(probe.name);
      else degraded.push(probe.name);
    }

    const ready = missing.length === 0 && failed.length === 0;
    const status = !ready ? "not_ready" : degraded.length > 0 ? "degraded" : "ready";
    return c.json(
      {
        status,
        missingEnv: missing,
        failedChecks: failed,
        degradedChecks: degraded,
        checkDetails: details,
      },
      ready ? 200 : 503,
    );
  });

  return app;
}

async function runProbe(
  probe: ReadinessProbe,
  timeoutMs: number | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean | ProbeOutcome> {
  if (timeoutMs === undefined) {
    return probe.check().catch(
      (error: unknown): ProbeOutcome => ({
        ok: false,
        detail: error instanceof Error ? error.message : "فحص أخفق بلا رسالة",
      }),
    );
  }
  const timeout: Promise<ProbeOutcome> = sleep(timeoutMs).then(() => ({
    ok: false,
    detail: `انقضت المهلة بعد ${timeoutMs} ملّي ثانية`,
  }));
  return Promise.race([
    probe.check().catch(
      (error: unknown): ProbeOutcome => ({
        ok: false,
        detail: error instanceof Error ? error.message : "فحص أخفق بلا رسالة",
      }),
    ),
    timeout,
  ]);
}
