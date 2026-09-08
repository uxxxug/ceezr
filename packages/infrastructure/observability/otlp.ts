/**
 * الغرض: تحويلُ لقطةِ مسجِّلِ المقاييس إلى جسمِ طلبِ OTLP/HTTP بصيغة JSON، بلا شبكةٍ
 *   ولا حالةٍ ولا مكتبةٍ خارجية — دالّةٌ صِرفةٌ تُختبَر بمدخلٍ ومخرج.
 * الحالة: منفّذ فعلياً — F5-07 / SCL-006 (التجميع المركزي للمقاييس).
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: metrics-exporter.ts وأيّ مُصدِّرٍ ثانٍ إن وُجد.
 *
 * ## لماذا OTLP/HTTP JSON مكتوبٌ باليد لا مكتبةُ OpenTelemetry
 *
 * (١) المستودعُ كتب مسجِّلَ Prometheus بيده أصلاً (`registry.ts`) لنفسِ السبب:
 *     الاعتمادُ الخارجيُّ في مسارِ المراقبةِ يعني شجرةَ اعتمادياتٍ ضخمةً تعمل في
 *     كلِّ عمليةٍ إنتاجيّةٍ لأجلِ تسلسلِ JSON.
 * (٢) `scripts/check-telemetry-policy.ts` يمنع مزوّدي التحليلاتِ الخارجيّين. وهذا
 *     ليس مزوّداً بل بروتوكولٌ مفتوحٌ ندفعُ إليه، لكنّ روحَ الحاجزِ أن يبقى مسارُ
 *     القياسِ مقروءاً في هذا المستودعِ لا في `node_modules`.
 * (٣) ما نحتاجه من البروتوكول ثلاثةُ أنواعٍ فقط: `Sum` و`Gauge` و`Histogram`.
 *
 * ## عقدُ الترجمة — ما يُقابِلُ ماذا ولماذا
 *
 * | في المسجِّل | في OTLP | السبب |
 * | --- | --- | --- |
 * | `counter` | `sum` بـ`isMonotonic: true` و`aggregationTemporality: 2` | عدّادٌ لا ينقص، وقيمتُه تراكميّةٌ منذ إقلاعِ العمليّة |
 * | `gauge` | `gauge` | قيمةٌ لحظيّةٌ لا تُجمَع عبر الزمن |
 * | `histogram` | `histogram` تراكميٌّ | نفسُ السلالِ ونفسُ الحدود |
 *
 * و**`startTimeUnixNano` ليس زينةً**: بدونه لا يعرف المُجمِّعُ متى بدأ العدُّ، فلا
 * يستطيع أن يُميِّز «عدّادٌ نزل لأنّ العمليّةَ أُعيد تشغيلُها» من «عدّادٌ نزل لأنّ
 * البياناتِ فسدت». وهو عينُ ما يجعل الجمعَ المركزيَّ صحيحاً عبر إعاداتِ النشر.
 *
 * ## السلالُ: تراكميٌّ ← منفرد
 *
 * Prometheus يعرض `le` تراكميّاً، وOTLP يريد `bucketCounts` **منفردةً** وطولُها
 * `explicitBounds.length + 1` (الأخيرةُ لما فوقَ آخرِ حدّ). فالفرقُ يُحسَب هنا،
 * ولا تُغيَّر دلالةُ الحقلِ في المسجِّل. وهذا موضعُ الخطأِ الأوّلِ في كلِّ تنفيذٍ
 * يدويٍّ لهذا التحويل، فله اختبارٌ مستقلٌّ يقارن المجموعَ بالعدِّ الكلّي.
 */

import type { MetricLabels, MetricsSnapshot } from "./registry.ts";

/**
 * سماتُ المورد — **هي ما يجعل التجميعَ مركزيّاً لا مُجمَّعاً**. بدون
 * `service.instance.id` تصل سلاسلُ عمليتَين إلى المُجمِّعِ بنفسِ الهويّةِ فيَدهس
 * أحدُهما الآخر، فيُقرأ مجموعُ النظامِ رقمَ عمليّةٍ واحدةٍ ويُظنُّ صحيحاً.
 */
export interface MetricsResource {
  /** اسمُ الخدمة: `waslah-gateway` أو `waslah-worker`. */
  readonly serviceName: string;
  /** معرّفُ النسخةِ — يجب أن يفترق بين عمليتَين تعملان معاً. */
  readonly serviceInstanceId: string;
  /** البيئةُ المُعلَنة: `production` / `development` / `test`. */
  readonly deploymentEnvironment: string;
  /** الطوبولوجيا المُعلَنة (ADR 0051) — تُقرأ في المُجمِّع لتفسيرِ العدد. */
  readonly processTopology: string;
  /** رقمُ العمليّةِ في نظامِ التشغيل — يفصل عمليتَين على مضيفٍ واحد. */
  readonly processPid: number;
}

interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue: string } | { readonly intValue: string };
}

interface OtlpNumberDataPoint {
  readonly attributes: readonly OtlpAttribute[];
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly asDouble: number;
}

interface OtlpHistogramDataPoint {
  readonly attributes: readonly OtlpAttribute[];
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly count: string;
  readonly sum: number;
  readonly bucketCounts: readonly string[];
  readonly explicitBounds: readonly number[];
}

export interface OtlpMetric {
  readonly name: string;
  readonly description: string;
  readonly sum?: {
    readonly dataPoints: readonly OtlpNumberDataPoint[];
    readonly aggregationTemporality: 2;
    readonly isMonotonic: true;
  };
  readonly gauge?: { readonly dataPoints: readonly OtlpNumberDataPoint[] };
  readonly histogram?: {
    readonly dataPoints: readonly OtlpHistogramDataPoint[];
    readonly aggregationTemporality: 2;
  };
}

export interface OtlpExportRequest {
  readonly resourceMetrics: readonly [
    {
      readonly resource: { readonly attributes: readonly OtlpAttribute[] };
      readonly scopeMetrics: readonly [
        {
          readonly scope: { readonly name: string; readonly version: string };
          readonly metrics: readonly OtlpMetric[];
        },
      ];
    },
  ];
}

export interface OtlpConversionInput {
  readonly snapshot: MetricsSnapshot;
  readonly resource: MetricsResource;
  /** لحظةُ بدءِ العدِّ في هذه العمليّة (ملّي ثانية Unix). */
  readonly startTimeMs: number;
  /** لحظةُ أخذِ اللقطة (ملّي ثانية Unix). */
  readonly timeMs: number;
}

/** اسمُ النطاقِ المُبلِّغ — ثابتٌ يُقرأ في المُجمِّع لتمييزِ مصدرِ التحويل. */
export const OTLP_SCOPE_NAME = "waslah/observability";
/** إصدارُ عقدِ التحويلِ لا إصدارُ التطبيق: يتغيّر إن تغيّرت دلالةُ حقلٍ هنا. */
export const OTLP_SCOPE_VERSION = "1";

/** التمثيلُ الزمنيُّ في OTLP نانوثانيةٌ في سلسلةٍ نصّيّة (uint64 لا يسعه `number`). */
function nanos(milliseconds: number): string {
  const safe = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.trunc(milliseconds) : 0;
  return `${BigInt(safe) * 1_000_000n}`;
}

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function attributesFrom(labels: MetricLabels): readonly OtlpAttribute[] {
  return Object.keys(labels)
    .sort()
    .map((key) => stringAttribute(key, labels[key] ?? ""));
}

function resourceAttributes(resource: MetricsResource): readonly OtlpAttribute[] {
  return [
    stringAttribute("service.name", resource.serviceName),
    stringAttribute("service.instance.id", resource.serviceInstanceId),
    stringAttribute("deployment.environment", resource.deploymentEnvironment),
    // مسبوقةٌ بـ`waslah.` لأنّها ليست من اصطلاحات OTel: اسمٌ خامٌ في فضاءِ
    // `process.*` قد يصطدم غداً باصطلاحٍ قياسيٍّ بدلالةٍ أخرى، فتُقرأ قيمتُنا
    // على غيرِ معناها في لوحةٍ جاهزة.
    stringAttribute("waslah.process.topology", resource.processTopology),
    { key: "process.pid", value: { intValue: `${Math.trunc(resource.processPid)}` } },
  ];
}

/**
 * تحويلُ العدِّ التراكميِّ إلى أعدادٍ منفردةٍ بطولِ `bounds + 1`.
 *
 * والحدُّ الأخيرُ (`+Inf`) يُحسَب من `count` لا من آخرِ سلّةٍ: قيمةٌ فوقَ أكبرِ حدٍّ
 * لا تدخل أيَّ سلّةٍ في المسجِّل، فلو أُخذ الأخيرُ من السلالِ وحدَها ضاعت.
 * ونمنع السالبَ صراحةً: عدٌّ تراكميٌّ نازلٌ يعني فساداً في المصدر، ودفعُ رقمٍ
 * سالبٍ إلى المُجمِّعِ يُفسِد الجمعَ بصمتٍ بدل أن يُقرأ صفراً ظاهراً.
 */
export function deltaBucketCounts(
  cumulative: readonly number[],
  totalCount: number,
): readonly number[] {
  const out: number[] = [];
  let previous = 0;
  for (const value of cumulative) {
    out.push(Math.max(0, value - previous));
    previous = value;
  }
  out.push(Math.max(0, totalCount - previous));
  return out;
}

/**
 * يبني جسمَ `ExportMetricsServiceRequest` كاملاً. **لا يُصدِر العائلةَ الفارغةَ**:
 * مقياسٌ بلا نقطةِ بياناتٍ حِملٌ على الشبكةِ وضجيجٌ في المُجمِّع، وغيابُه ليس
 * إخفاءً — العائلةُ تظهر أوّلَ ما تُسجَّل قيمةٌ فيها.
 */
export function toOtlpExportRequest(input: OtlpConversionInput): OtlpExportRequest {
  const startTimeUnixNano = nanos(input.startTimeMs);
  const timeUnixNano = nanos(input.timeMs);
  const metrics: OtlpMetric[] = [];

  for (const family of input.snapshot.families) {
    if (family.series.length === 0) continue;

    if (family.type === "histogram") {
      const dataPoints = family.series.map((series) => ({
        attributes: attributesFrom(series.labels),
        startTimeUnixNano,
        timeUnixNano,
        count: `${Math.trunc(series.count)}`,
        sum: series.sum,
        bucketCounts: deltaBucketCounts(
          series.buckets.map((bucket) => bucket.cumulativeCount),
          series.count,
        ).map((value) => `${Math.trunc(value)}`),
        explicitBounds: series.buckets.map((bucket) => bucket.upperBound),
      }));
      metrics.push({
        name: family.name,
        description: family.help,
        histogram: { dataPoints, aggregationTemporality: 2 },
      });
      continue;
    }

    const dataPoints = family.series.map((series) => ({
      attributes: attributesFrom(series.labels),
      startTimeUnixNano,
      timeUnixNano,
      asDouble: series.value,
    }));
    if (family.type === "counter") {
      metrics.push({
        name: family.name,
        description: family.help,
        sum: { dataPoints, aggregationTemporality: 2, isMonotonic: true },
      });
    } else {
      metrics.push({ name: family.name, description: family.help, gauge: { dataPoints } });
    }
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes(input.resource) },
        scopeMetrics: [
          {
            scope: { name: OTLP_SCOPE_NAME, version: OTLP_SCOPE_VERSION },
            metrics,
          },
        ],
      },
    ],
  };
}

/** عددُ السلاسلِ في الطلب — يُقاس ويُسجَّل، فيُعرَف حجمُ ما يُدفَع بلا قراءةِ الجسم. */
export function countSeries(request: OtlpExportRequest): number {
  let total = 0;
  for (const metric of request.resourceMetrics[0].scopeMetrics[0].metrics) {
    total += metric.sum?.dataPoints.length ?? 0;
    total += metric.gauge?.dataPoints.length ?? 0;
    total += metric.histogram?.dataPoints.length ?? 0;
  }
  return total;
}
