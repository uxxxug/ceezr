/**
 * الغرض: نقطة Prometheus المحمية لمسح المقاييس التشغيلية مع تحديث gauges القاعدة
 *   المخزنة مؤقتاً، لتعمل على Render بلا خدمة جانبية أو تبعية خارجية.
 * الحالة: منفّذ فعلياً — يحتاج تركيبه في index.ts أو server.ts كما في WIRING_METRICS.md.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: Prometheus/Grafana أو جامع متوافق يمرر سرّ المسار.
 * ملاحظات مستقبلية: لا تُفتح للعامة؛ غياب METRICS_TOKEN يغلق المسار بدلاً من فشل مفتوح.
 */

import { Hono } from "hono";
import type {
  DatabaseGaugeCollector,
  OperationalMetrics,
  ProcessMemorySnapshot,
} from "../../../../packages/infrastructure/observability/index.ts";
import { readProcessMemory } from "../../../../packages/infrastructure/observability/index.ts";

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const METRICS_TOKEN_HEADER = "x-metrics-token";

export interface MetricsRouteDependencies {
  readonly metrics: OperationalMetrics;
  /** سر ثابت للجامع؛ لا يُعاد استخدام كعكة الإدارة لأن Prometheus عميل آلة لا جلسة متصفح. */
  readonly metricsToken: string | undefined;
  readonly databaseGauges?: DatabaseGaugeCollector;
  readonly log?: (message: string, fields: Record<string, unknown>) => void;
  /**
   * `F8-02`: قارئُ ذاكرةِ العمليّةِ — يُحقَنُ للاختبارِ وحدَه، وللإنتاجِ
   * `readProcessMemory`. والقراءةُ **عندَ المسحِ بعدَ التحقُّقِ من السرِّ**:
   * مُجهولٌ يطرقُ المسارَ لا يُشغِّلُ عملاً في العمليّةِ بردَّةٍ واحدةٍ.
   */
  readonly readProcessMetrics?: () => ProcessMemorySnapshot;
}

/** مقارنة زمن ثابت تمنع استنتاج أجزاء سرّ مسار المراقبة من زمن الرفض. */
export function metricsSecretsMatch(provided: string, expected: string): boolean {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let diff = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return diff === 0;
}

/**
 * اخترنا رأساً مستقلاً لا حارس جلسة اللوحة: لهما القوة نفسها (سر + مقارنة زمن ثابت)،
 * لكن جامع Prometheus لا يملك كعكة متصفح ولا ينبغي أن يُمنح جلسة مسؤول لأجل قراءة نص.
 * المسار يفشل مغلقاً إن غاب السر في Render، فلا تتحول المراقبة إلى كشف عام بالخطأ.
 */
export function createMetricsRoutes(deps: MetricsRouteDependencies): Hono {
  const app = new Hono();

  app.get("/metrics", async (c) => {
    const token = deps.metricsToken;
    const supplied = c.req.header(METRICS_TOKEN_HEADER) ?? "";
    if (token === undefined || token === "" || !metricsSecretsMatch(supplied, token)) {
      deps.log?.("metrics.access_denied", {
        component: "metrics",
        reason: "invalid_or_missing_token",
      });
      return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    // `F8-02`: ذاكرةُ العمليّةِ تُقرأُ لحظةَ المسحِ لا بمؤقِّتٍ دائرٍ. وفشلُ
    // القراءةِ **لا يُسقِطُ المسحةَ**: مقاييسُ القاعدةِ والطوابيرِ والحافةِ
    // تُنشَرُ وإن عجزت واجهةُ المُنفِّذِ عن رقمِ ذاكرةٍ.
    try {
      deps.metrics.setProcessGauges((deps.readProcessMetrics ?? readProcessMemory)());
    } catch (cause) {
      deps.log?.("metrics.process_gauges_failed", {
        component: "metrics",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (deps.databaseGauges !== undefined) {
      const collected = await deps.databaseGauges.collect();
      if (!collected.ok) {
        deps.log?.("metrics.database_gauges_failed", {
          component: "metrics",
          error: collected.error.detail,
        });
      }
    }

    c.header("content-type", PROMETHEUS_CONTENT_TYPE);
    c.header("cache-control", "no-store");
    return c.body(deps.metrics.registry.render());
  });

  return app;
}
