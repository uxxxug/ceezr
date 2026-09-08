/**
 * الغرض: دفعُ مقاييسِ العمليّةِ دوريّاً إلى مُجمِّعٍ مركزيٍّ عبر OTLP/HTTP، بحيث
 *   يُقرأ مجموعُ النظامِ من موضعٍ واحدٍ مهما تعدّدت العمليّاتُ والنسخ.
 * الحالة: منفّذ فعلياً — F5-07 / SCL-006 (التجميع المركزي للمقاييس).
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts و apps/workers/src/index.ts
 *
 * ## المشكلةُ التي يحلُّها هذا الملفّ
 *
 * `GET /metrics` يعرض مقاييسَ **العمليّةِ التي أجابت الطلب**. وما دامت نسخةٌ
 * واحدةٌ فهذا كافٍ. فإذا صار خلفَ المُوجِّهِ ثلاثُ نسخٍ (`F5-06` / `SCL-008`) أو
 * انفصل العاملُ عن البوابة (`F5-04` / `SCL-007`) صار كلُّ كشطٍ يقرأ عمليّةً
 * عشوائيّةً: عدّادٌ يرتفع وينخفض بلا معنى، ومجموعُ النظامِ لا يُقرأ من أيّ موضع.
 * وهذا هو السببُ الذي يجعل `SCL-006` **شرطاً سابقاً** لـ`SCL-007` و`SCL-008` لا
 * تحسيناً بجانبِهما: التوسُّعُ بلا تجميعٍ مركزيٍّ يُعمي المراقبةَ لحظةَ الحاجةِ إليها.
 *
 * ## قراراتُ التصميم — وما يُقابلُ كلَّ واحدٍ منها من خطر
 *
 * **دفعٌ لا كشط.** الكشطُ يفترض أنّ المُجمِّعَ يعرف عناوينَ كلِّ النسخِ ويصل إليها؛
 * وعلى Render النسخُ خلفَ مُوجِّهٍ بلا عناوينَ فرديّةٍ يمكن كشطُها. والدفعُ فوقَ ذلك
 * يُنجي العدَّ الأخيرَ لعمليّةٍ تموت (انظر `stop`).
 *
 * **فشلٌ مفتوح، دائماً.** المُجمِّعُ خدمةٌ مساعِدةٌ لا مسارٌ حرج. سقوطُ الشبكةِ أو
 * ردُّ `500` أو انتهاءُ المهلةِ **لا يرمي ولا يُوقف ولا يُبطئ مسارَ الطلب**: يُسجَّل
 * ويُعَدُّ في مقياسٍ ذاتيٍّ ويستمرُّ الدَورُ التالي. وإسقاطُ منصّةِ نقلٍ لأنّ لوحةَ
 * مراقبتِها لا تُجيب هو عينُ ما تمنعه القاعدةُ.
 *
 * **مقاييسُ ذاتيّةٌ لا سجلٌّ وحدَه.** «هل يصل الدفعُ؟» سؤالٌ يُجاب بمقياسٍ لا
 * بقراءةِ سجل: `..._attempts_total{outcome}` و`..._last_success_timestamp_seconds`
 * يجعلان صمتَ المُصدِّرِ مرئيّاً في المُجمِّعِ نفسِه. وهي تُسجَّل **بعدَ** أخذِ
 * اللقطة، فتصل قيمتُها في الدورِ التالي — وهذا مقصودٌ ومكتوبٌ لا سهو.
 *
 * **لا سرَّ في سجلّ.** الترويسات (`METRICS_EXPORT_HEADERS`) تحمل رمزَ اعتمادِ
 * المُجمِّع. لا تُسجَّل أسماؤها ولا قيمُها ولا عددُها في أيِّ سطرٍ، ولا تدخل رسالةَ
 * خطأ. والنقطةُ (`endpoint`) تُسجَّل **مُختصَرةً إلى أصلِها** دون مسارٍ ولا استعلام،
 * لأنّ بعضَ المُجمِّعات تضع الرمزَ في المسار.
 */

import { countSeries, type MetricsResource, toOtlpExportRequest } from "./otlp.ts";
import type { PrometheusRegistry } from "./registry.ts";

/** نتيجةُ محاولةِ دفعٍ واحدة. لا ترمي أبداً — الفشلُ قيمةٌ لا استثناء. */
export interface MetricsExportOutcome {
  readonly outcome: "exported" | "rejected" | "failed";
  /** عددُ السلاسلِ في الجسمِ المدفوع. */
  readonly seriesCount: number;
  readonly durationMs: number;
  /** رمزُ حالةِ HTTP إن وصل ردٌّ — وإلّا `null`. */
  readonly status: number | null;
  /** سببٌ مُصنَّفٌ للفشل، خالٍ من أيِّ سرّ. */
  readonly detail: string | null;
}

export type MetricsExporterLog = (message: string, meta: Record<string, unknown>) => void;

export interface MetricsExporterOptions {
  /** المسجِّلُ الذي تُقرأ منه اللقطةُ وتُكتَب فيه المقاييسُ الذاتيّة. */
  readonly registry: PrometheusRegistry;
  /** نقطةُ الاستقبال الكاملة، مثل `https://collector.example/v1/metrics`. */
  readonly endpoint: string;
  /** ترويساتُ الاعتماد. سرٌّ: لا تُسجَّل ولا تُعاد في أيِّ نتيجة. */
  readonly headers: Readonly<Record<string, string>>;
  readonly resource: MetricsResource;
  /** الفاصلُ بين دورَي دفعٍ (ملّي ثانية). */
  readonly intervalMs: number;
  /** مهلةُ الطلبِ الواحد (ملّي ثانية). الافتراضُ `5000`. */
  readonly timeoutMs?: number;
  readonly log?: MetricsExporterLog;
  /** الساعةُ — محقونةٌ للاختبار. */
  readonly now?: () => number;
  /** ناقلُ HTTP — محقونٌ للاختبار. */
  readonly fetch?: typeof fetch;
  /** يُنفَّذ قبلَ كلِّ لقطةٍ (تحديثُ مقاييسِ القاعدةِ مثلاً). فشلُه لا يُوقف الدفع. */
  readonly beforeSnapshot?: () => Promise<void>;
}

export interface MetricsExporter {
  /** يبدأ الدَورَ الدوريّ. النداءُ الثاني لا يُنشئ مؤقّتاً ثانياً. */
  readonly start: () => void;
  /** دفعةٌ واحدةٌ الآن. لا ترمي. */
  readonly exportOnce: () => Promise<MetricsExportOutcome>;
  /** يوقف الدَورَ ويدفع دفعةً أخيرةً (إنقاذُ العدِّ عند `SIGTERM`). */
  readonly stop: () => Promise<MetricsExportOutcome | null>;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** أسماءُ المقاييسِ الذاتيّة — مُصدَّرةٌ ليقرأها الاختبارُ والوثائقُ بلا نسخِ نصّ. */
export const METRICS_EXPORT_ATTEMPTS = "waslah_metrics_export_attempts_total";
export const METRICS_EXPORT_DURATION = "waslah_metrics_export_duration_seconds";
export const METRICS_EXPORT_LAST_SUCCESS = "waslah_metrics_export_last_success_timestamp_seconds";
export const METRICS_EXPORT_SERIES = "waslah_metrics_export_series_count";

/**
 * أصلُ النقطةِ وحدَه للسجلّ: `https://host:port` بلا مسارٍ ولا استعلام. وإن تعذّر
 * التحليلُ فـ`"invalid"` لا النصُّ الخام — نصٌّ لم يُفهَم قد يكون رابطاً فيه رمز.
 */
export function safeEndpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "invalid";
  }
}

/** رسالةُ الخطأِ مُصنَّفةٌ ومقصوصةٌ: لا نُمرِّر نصَّ استثناءٍ قد يحمل رابطاً بالرمز. */
function safeDetail(cause: unknown): string {
  const raw = cause instanceof Error ? cause.name : "unknown_error";
  return raw.slice(0, 64);
}

function defineSelfMetrics(registry: PrometheusRegistry): void {
  registry.defineCounter({
    name: METRICS_EXPORT_ATTEMPTS,
    help: "عدد محاولات دفع المقاييس إلى المُجمِّع المركزي بحسب النتيجة.",
    labelNames: ["outcome"],
  });
  registry.defineHistogram({
    name: METRICS_EXPORT_DURATION,
    help: "زمن محاولة دفع المقاييس إلى المُجمِّع المركزي.",
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });
  registry.defineGauge({
    name: METRICS_EXPORT_LAST_SUCCESS,
    help: "Unix timestamp لآخر دفعٍ ناجحٍ للمقاييس، أو صفر إن لم ينجح دفعٌ بعد.",
  });
  registry.defineGauge({
    name: METRICS_EXPORT_SERIES,
    help: "عدد السلاسل في آخر جسمِ مقاييسٍ دُفِع إلى المُجمِّع.",
  });
}

/**
 * ينشئ المُصدِّر. **لا يبدأ من تلقاء نفسه** — الإقلاعُ قرارُ نقطةِ التشغيل، فيبقى
 * الاختبارُ قادراً على دفعةٍ واحدةٍ بلا مؤقّتٍ يعمل في الخلفيّة.
 */
export function createMetricsExporter(options: MetricsExporterOptions): MetricsExporter {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => Date.now());
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTimeMs = now();
  const endpointOrigin = safeEndpointOrigin(options.endpoint);

  defineSelfMetrics(options.registry);

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<MetricsExportOutcome> | null = null;
  let stopped = false;

  const record = (outcome: MetricsExportOutcome): void => {
    options.registry.increment(METRICS_EXPORT_ATTEMPTS, { outcome: outcome.outcome });
    options.registry.observe(METRICS_EXPORT_DURATION, {}, outcome.durationMs / 1000);
    options.registry.setGauge(METRICS_EXPORT_SERIES, {}, outcome.seriesCount);
    if (outcome.outcome === "exported") {
      options.registry.setGauge(METRICS_EXPORT_LAST_SUCCESS, {}, Math.trunc(now() / 1000));
    }
  };

  const attempt = async (): Promise<MetricsExportOutcome> => {
    const started = now();
    let seriesCount = 0;
    try {
      if (options.beforeSnapshot !== undefined) {
        // فشلُ تحديثِ المقاييسِ اللحظيّةِ لا يُلغي الدفعَ: البقيّةُ ما زالت صحيحةً،
        // وإلغاءُ الدفعِ كلِّه لأجلِ استعلامٍ متعثّرٍ يُفقِد العدّاداتِ كلَّها.
        try {
          await options.beforeSnapshot();
        } catch (cause) {
          log("metrics_export.before_snapshot_failed", { detail: safeDetail(cause) });
        }
      }
      const request = toOtlpExportRequest({
        snapshot: options.registry.snapshot(),
        resource: options.resource,
        startTimeMs,
        timeMs: now(),
      });
      seriesCount = countSeries(request);
      const response = await send(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const durationMs = now() - started;
      if (!response.ok) {
        // الردُّ غيرُ الناجحِ يُصنَّف `rejected` لا `failed`: المُجمِّعُ حيٌّ ويردّ،
        // والعلّةُ في الطلبِ أو في اعتمادِه — وهو تشخيصٌ مختلفٌ تماماً عن انقطاعِ شبكة.
        const outcome: MetricsExportOutcome = {
          outcome: "rejected",
          seriesCount,
          durationMs,
          status: response.status,
          detail: "non_ok_status",
        };
        log("metrics_export.rejected", {
          endpointOrigin,
          status: response.status,
          seriesCount,
          durationMs,
        });
        record(outcome);
        return outcome;
      }
      const outcome: MetricsExportOutcome = {
        outcome: "exported",
        seriesCount,
        durationMs,
        status: response.status,
        detail: null,
      };
      record(outcome);
      return outcome;
    } catch (cause) {
      const outcome: MetricsExportOutcome = {
        outcome: "failed",
        seriesCount,
        durationMs: now() - started,
        status: null,
        detail: safeDetail(cause),
      };
      log("metrics_export.failed", {
        endpointOrigin,
        detail: outcome.detail,
        durationMs: outcome.durationMs,
      });
      record(outcome);
      return outcome;
    }
  };

  /**
   * دفعةٌ واحدةٌ في كلِّ لحظة. لو تأخّر دفعٌ أطولَ من الفاصلِ، لا يتراكم الطلبُ فوقَ
   * الطلبِ حتى يُغرِق المُجمِّعَ ومنفذَ الشبكةِ في العمليّة؛ يُعادُ الوعدُ الجاري نفسُه.
   */
  const exportOnce = (): Promise<MetricsExportOutcome> => {
    if (inFlight !== null) return inFlight;
    inFlight = attempt().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    start: (): void => {
      if (timer !== null || stopped) return;
      timer = setInterval(() => {
        void exportOnce();
      }, options.intervalMs);
      // لا يُبقي المؤقّتُ العمليّةَ حيّةً: مُصدِّرُ مقاييسَ يمنع خروجَ عمليّةٍ أنهت
      // عملَها عطبٌ لا ميزة. والخادمُ هو ما يُبقي البوابةَ حيّةً لا هذا.
      timer.unref?.();
      log("metrics_export.started", {
        endpointOrigin,
        intervalMs: options.intervalMs,
        serviceName: options.resource.serviceName,
        serviceInstanceId: options.resource.serviceInstanceId,
      });
    },

    exportOnce,

    /**
     * **الدفعةُ الأخيرة هي نصفُ قيمةِ هذا الملفّ.** عمليّةٌ تموت عند إعادةِ النشرِ
     * تحمل حتى `intervalMs` من العدِّ لم يُدفَع بعد. ودفعُها هنا يجعل مجموعَ النظامِ
     * صحيحاً عبرَ إعاداتِ النشرِ لا بينَها فقط. وتُنتظَر الدفعةُ الجاريةُ أوّلاً كي
     * لا تُلغى وسطَ الطريق.
     */
    stop: async (): Promise<MetricsExportOutcome | null> => {
      if (stopped) return null;
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight;
      const outcome = await attempt();
      log("metrics_export.stopped", { endpointOrigin, finalOutcome: outcome.outcome });
      return outcome;
    },
  };
}

/**
 * معرّفٌ يفرِق بين عمليّتَين تعملان معاً على المضيفِ نفسِه وفي الثانيةِ نفسِها.
 *
 * ورقمُ العمليّةِ وحدَه لا يكفي: على مضيفَين مختلفَين قد يتكرّر `pid`، فتصل سلسلتان
 * مختلفتان إلى المُجمِّعِ بهويّةٍ واحدةٍ فيدهس أحدُهما الآخر — وهذا عينُ العطبِ الذي جاء
 * `SCL-006` يمنعُه. فيُضاف جزءٌ عشوائيٌّ من `randomUUID`.
 */
export function generateServiceInstanceId(serviceName: string, pid: number): string {
  return `${serviceName}-${pid}-${crypto.randomUUID().slice(0, 8)}`;
}

/** ما يلزم لبناءِ مُصدِّرٍ من الضبط — بحقولٍ أوليّةٍ لا بـ`AppConfig` كاملاً. */
export interface ConfiguredMetricsExporterInput {
  readonly registry: PrometheusRegistry;
  /** `waslah-gateway` أو `waslah-worker`. */
  readonly serviceName: string;
  readonly deploymentEnvironment: string;
  readonly processTopology: string;
  readonly metricsExport: {
    readonly endpoint: string | null;
    readonly headers: Readonly<Record<string, string>>;
    readonly intervalSeconds: number;
    readonly serviceInstanceId: string | null;
  };
  readonly log?: MetricsExporterLog;
  readonly beforeSnapshot?: () => Promise<void>;
  readonly pid?: number;
}

/**
 * يبني المُصدِّرَ من الضبط، أو يردُّ `null` إن لم تُضبَط نقطةٌ.
 *
 * **`null` ليست فشلاً**: هي «لا مُجمِّعَ مضبوطاً»، وهو حالُ التطويرِ والاختبارِ
 * والإنتاجِ اليومَ قبلَ أن يُنشَأ المُجمِّع. وتمييزُ هذه الحالةِ في النوعِ يجعل
 * نقطةَ التشغيلِ تكتب `if (exporter !== null)` ولا تحمل مُصدِّراً مُعطّلاً يدّعي العمل.
 */
export function createConfiguredMetricsExporter(
  input: ConfiguredMetricsExporterInput,
): MetricsExporter | null {
  const endpoint = input.metricsExport.endpoint;
  if (endpoint === null) return null;
  const pid = input.pid ?? process.pid;
  return createMetricsExporter({
    registry: input.registry,
    endpoint,
    headers: input.metricsExport.headers,
    intervalMs: input.metricsExport.intervalSeconds * 1000,
    resource: {
      serviceName: input.serviceName,
      serviceInstanceId:
        input.metricsExport.serviceInstanceId ?? generateServiceInstanceId(input.serviceName, pid),
      deploymentEnvironment: input.deploymentEnvironment,
      processTopology: input.processTopology,
      processPid: pid,
    },
    ...(input.log === undefined ? {} : { log: input.log }),
    ...(input.beforeSnapshot === undefined ? {} : { beforeSnapshot: input.beforeSnapshot }),
  });
}
