/**
 * الغرض: دفعُ قراءةِ المسجّلِ دوريّاً إلى مُجمِّعٍ مركزيٍّ عبرَ `OTLP/HTTP + JSON`،
 *   وتعريفُ العمليةِ بنفسِها في `/metrics`. الشطرُ الثالثُ والأخيرُ من
 *   [ADR 0062](../../../docs/adr/0062-central-metric-aggregation-is-otlp-push-with-declared-process-identity.md) (`F5-07`/`SCL-006`).
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يستخدمه: apps/gateway/src/index.ts
 * ملاحظات مستقبلية: يومَ يصير العاملُ عمليةً مستقلّةً (`F5-04`) تُركَّب هذه الوحدةُ
 *   هناك بـ`role: "worker"` — ولا يُنسَخ منطقُها.
 *
 * ## ثلاثةُ أحكامٍ لا تُساوَم
 *
 * 1. **لا يُسقِط شيئاً**: كلُّ دورةٍ محاطةٌ بالتقاطِ استثناءٍ، ولا `unhandledRejection`
 *    يخرج منها. مُصدِّرُ مقاييسَ يُسقِط بوابةً هو أسوأُ صفقةٍ في النظامِ كلِّه.
 * 2. **لا يفشل صامتاً**: كلُّ فشلٍ يُزيد عدَّاداً بسببٍ من قائمةٍ مغلقةٍ، وآخرُ نجاحٍ
 *    يُضبَط في مقياسٍ لحظيٍّ. فالمشغّلُ يستطيع أن يُنبِّه على «لم ينجح تصديرٌ منذُ
 *    ١٥ دقيقةً» — وبغيرِ ذلك يكون العمى مُصدَّراً لا مرفوعاً.
 * 3. **لا يُسرِّب سرّاً**: رؤوسُ المصادقةِ تُرسَل ولا تُطبَع ولا تدخل رسالةَ خطأٍ ولا
 *    وسمَ مقياسٍ. وسببُ الفشلِ رمزٌ مغلقٌ لا نصُّ استثناءٍ، لأنّ نصَّ الاستثناءِ من
 *    مكتبةِ شبكةٍ يحمل العنوانَ كاملاً وقد يحمل معه ما في استعلامِه.
 *
 * ## لماذا مؤقّتٌ لا دفعٌ عندَ كلِّ زيادةٍ
 *
 * لأنّ العدَّ في المسارِ الساخنِ يجب أن يبقى زيادةً في الذاكرةِ. والدفعُ الدوريُّ
 * يفصل كلفةَ الشبكةِ عن كلفةِ الطلبِ، ويجعل عطلَ المُجمِّعِ خسارةَ **دقّةِ نافذةٍ**
 * لا خسارةَ طلبٍ. والزمانيّةُ تراكميّةٌ، فالدفعةُ الفائتةُ تُعوَّض بالتاليةِ بلا ثقبٍ.
 */

import { buildOtlpExportRequest } from "./otlp-metrics.ts";
import type { ProcessIdentity } from "./process-identity.ts";
import type { PrometheusRegistry } from "./registry.ts";

/** أسبابُ الفشلِ — قائمةٌ مغلقةٌ، لا نصَّ استثناءٍ في وسمٍ (سقفُ الـcardinality والسرّيّةُ). */
export const EXPORT_FAILURE_REASONS = [
  "http_status",
  "timeout",
  "network",
  "encode",
  "disabled",
] as const;

export type ExportFailureReason = (typeof EXPORT_FAILURE_REASONS)[number];

export type ExportOutcome =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly reason: ExportFailureReason };

export const METRIC_EXPORT_SUCCESS = "waslah_metrics_export_success_total";
export const METRIC_EXPORT_FAILURES = "waslah_metrics_export_failures_total";
export const METRIC_EXPORT_LAST_SUCCESS = "waslah_metrics_export_last_success_timestamp_seconds";
export const METRIC_EXPORT_ENABLED = "waslah_metrics_central_export_enabled";
export const METRIC_TARGET_INFO = "waslah_target_info";

/** دورةُ الدفعِ الافتراضيّةُ: ٦٠ ثانيةً — نافذةُ الكشطِ المألوفةُ في Prometheus. */
export const DEFAULT_EXPORT_INTERVAL_MS = 60_000;
/** مهلةُ الطلبِ: أقصرُ من الدورةِ قطعاً، وإلّا تراكمت الدفعاتُ. */
export const DEFAULT_EXPORT_TIMEOUT_MS = 10_000;

/**
 * يُعرِّف مقاييسَ المُصدِّرِ عن نفسِه **وهويّةَ العمليةِ**، ويُضبَط `enabled` صراحةً.
 * يُستدعى دائماً — حتى حينَ لا مُجمِّعَ: `waslah_target_info` يُصلِح غموضَ الكشطةِ
 * وحدَه (ADR 0062 §٢-٥)، و`enabled=0` إعلانٌ لا صمتٌ (§٢-٦).
 */
export function registerCentralExportMetrics(
  registry: PrometheusRegistry,
  identity: ProcessIdentity,
  enabled: boolean,
): void {
  registry.defineGauge({
    name: METRIC_TARGET_INFO,
    help: "هويّةُ العمليةِ التي أنتجت هذه الأرقامَ — قيمتُها ١ دائماً والمعنى في وسومِها.",
    labelNames: ["service", "role", "instance", "environment"],
  });
  registry.defineGauge({
    name: METRIC_EXPORT_ENABLED,
    help: "هل التجميعُ المركزيُّ مُفعَّلٌ في هذه العمليةِ (١) أم لا (٠).",
  });
  registry.defineCounter({
    name: METRIC_EXPORT_SUCCESS,
    help: "عددُ دفعاتِ المقاييسِ التي قبلها المُجمِّعُ.",
  });
  registry.defineCounter({
    name: METRIC_EXPORT_FAILURES,
    help: "عددُ دفعاتِ المقاييسِ الفاشلةِ بحسبِ السببِ.",
    labelNames: ["reason"],
  });
  registry.defineGauge({
    name: METRIC_EXPORT_LAST_SUCCESS,
    help: "طابعُ آخرِ دفعةٍ ناجحةٍ بالثواني — صفرٌ يعني أنّه لم ينجح شيءٌ بعدُ.",
  });

  registry.setGauge(
    METRIC_TARGET_INFO,
    {
      service: identity.serviceName,
      role: identity.role,
      instance: identity.instanceId,
      environment: identity.environment,
    },
    1,
  );
  registry.setGauge(METRIC_EXPORT_ENABLED, {}, enabled ? 1 : 0);
  registry.setGauge(METRIC_EXPORT_LAST_SUCCESS, {}, 0);
}

/**
 * تحليلُ رؤوسِ التصديرِ: `k=v,k=v` — اصطلاحُ `OTEL_EXPORTER_OTLP_HEADERS` نفسُه.
 * القيمةُ قد تحوي `=` (رمزٌ مُرمَّزٌ بـbase64) فالقطعُ عندَ أوّلِ `=` وحدَه.
 * والمُدخَلُ المشوَّهُ يُتجاهَل جزؤه المشوَّهُ ولا يُسقِط البقيّةَ ولا الإقلاعَ.
 */
export function parseExportHeaders(raw: string | undefined): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key === "" || value === "") continue;
    headers[key] = value;
  }
  return headers;
}

/**
 * ناقلُ الدفعِ. النوعُ **أضيقُ من `typeof fetch`** عن قصدٍ: لا حاجةَ بنا إلى
 * `preconnect` ولا إلى `Request` كمُدخَلٍ، وتضييقُه يجعل الحقنَ في الاختبارِ دالّةً
 * بسيطةً لا محاكاةً لكلِّ سطحِ الويبِ — و`fetch` الحقيقيُّ يُسنَد إليه بلا تحويلٍ.
 */
export type MetricsFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface CentralMetricsExportOptions {
  readonly registry: PrometheusRegistry;
  readonly identity: ProcessIdentity;
  /** عنوانُ `…/v1/metrics`. غيابُه = التصديرُ مُطفَأٌ. */
  readonly endpoint: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
  /** لحظةُ إقلاعِ العمليةِ — بدايةُ التراكمِ في كلِّ نقطةِ بيانٍ. */
  readonly startedAtMs: number;
  readonly now?: () => number;
  readonly fetchImpl?: MetricsFetch;
  /** تسجيلٌ تشغيليٌّ. لا يُمرَّر إليه سرٌّ. */
  readonly log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface CentralMetricsExport {
  readonly enabled: boolean;
  /** دفعةٌ واحدةٌ الآنَ — مكشوفةٌ كي يُثبِتها اختبارُ التكاملِ بلا انتظارِ مؤقّتٍ. */
  exportOnce(): Promise<ExportOutcome>;
  start(): void;
  stop(): void;
}

/**
 * `Response.ok` وحدَه لا يكفي حكماً: بعضُ المُجمِّعاتِ ترُدُّ `200` بجسمِ رفضٍ جزئيٍّ
 * (`partialSuccess`). وقراءةُ ذلك عملُ بندِ رصدٍ لاحقٍ، ويُذكَر ههنا كي لا يُظَنَّ
 * أنّ `2xx` تعني «قُبِلت كلُّ نقطةٍ» — وهذا حدٌّ مُعلَنٌ لا سهوٌ.
 */
export function createCentralMetricsExport(
  options: CentralMetricsExportOptions,
): CentralMetricsExport {
  const {
    registry,
    identity,
    endpoint,
    headers = {},
    intervalMs = DEFAULT_EXPORT_INTERVAL_MS,
    timeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
    startedAtMs,
    now = Date.now,
    fetchImpl = fetch,
    log = () => {},
  } = options;

  const target = (endpoint ?? "").trim();
  const enabled = target !== "";
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const fail = (reason: ExportFailureReason): ExportOutcome => {
    registry.increment(METRIC_EXPORT_FAILURES, { reason });
    log("metrics.export.failed", { reason });
    return { ok: false, reason };
  };

  async function exportOnce(): Promise<ExportOutcome> {
    /** نداءٌ على مُصدِّرٍ مُطفَأٍ ليس عطلَ شبكةٍ: يُميَّز بسببِه كي لا يُلوِّث معدَّلَ الفشلِ. */
    if (!enabled) return fail("disabled");

    let body: string;
    try {
      body = JSON.stringify(
        buildOtlpExportRequest(registry.snapshot(), identity, {
          startedAtMs,
          observedAtMs: now(),
        }),
      );
    } catch {
      return fail("encode");
    }

    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        signal: controller.signal,
      });
      if (!response.ok) return fail("http_status");
      registry.increment(METRIC_EXPORT_SUCCESS);
      registry.setGauge(METRIC_EXPORT_LAST_SUCCESS, {}, Math.floor(now() / 1000));
      return { ok: true, status: response.status };
    } catch (error) {
      const aborted =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      return fail(aborted ? "timeout" : "network");
    } finally {
      clearTimeout(abort);
    }
  }

  return {
    enabled,
    exportOnce,
    start(): void {
      if (!enabled) {
        log("metrics.export.disabled", { reason: "no_endpoint" });
        return;
      }
      if (timer !== null) return;
      /**
       * `inFlight` يمنع تراكمَ الدفعاتِ حينَ يبطئ المُجمِّعُ: دفعةٌ واحدةٌ في الجوِّ،
       * والفائتةُ تُعوَّض بالتراكمِ. و`unref` كي لا يمنعَ المؤقّتُ خروجَ العمليةِ.
       */
      timer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        void exportOnce().finally(() => {
          inFlight = false;
        });
      }, intervalMs);
      timer.unref?.();
      log("metrics.export.started", { intervalMs });
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
