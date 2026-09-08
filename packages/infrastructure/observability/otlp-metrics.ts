/**
 * الغرض: تحويلُ قراءةِ المسجّلِ (`PrometheusRegistry.snapshot()`) إلى جسمِ
 *   `OTLP/HTTP + JSON` كما تقبله `ExportMetricsServiceRequest` — دالّةٌ **خالصةٌ**
 *   بلا شبكةٍ ولا وقتٍ ضمنيٍّ. الشطرُ الثاني من [ADR 0062](../../../docs/adr/0062-central-metric-aggregation-is-otlp-push-with-declared-process-identity.md) (`F5-07`/`SCL-006`).
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يستخدمه: central-metrics-export.ts
 * ملاحظات مستقبلية: يومَ يُقرَّر `protobuf` (لأداءٍ مُقاسٍ لا لذوقٍ) يُضاف مُرمِّزٌ
 *   ثانٍ يقرأ **هذا** الشكلَ الوسيطَ نفسَه — ولا يُعاد بناءُ التحويلِ من المسجّلِ.
 *
 * ## لماذا خالصةٌ ومنفصلةٌ عن الدفعِ
 *
 * لأنّ الخطأَ الصامتَ في التصديرِ يقع في **التحويلِ** لا في `fetch`: صندوقٌ تراكميٌّ
 * أُرسِل غيرَ مفكوكٍ، أو `explicitBounds` بطولٍ لا يساوي `bucketCounts − 1`، أو عدَّادٌ
 * أُرسِل `gauge` فلا يُحسَب له مُعدَّلٌ. وكلُّها تُقبَل بـ`200 OK` ثمّ تُنتج لوحةً
 * كاذبةً. فالتحويلُ دالّةٌ يُمكِن اختبارُها بمساواةِ كائناتٍ، لا أثراً جانبيّاً يُرصَد.
 *
 * ## دقائقُ الصيغةِ التي تُنسى فتكسر
 *
 * 1. **الأعدادُ ٦٤-بت نصوصٌ** في تعيين proto3 على JSON: الزمنُ بالنانو و`count`
 *    و`bucketCounts` سلاسلُ محارفَ لا أرقاماً. وإرسالُها أرقاماً يفقد الدقّةَ فوقَ
 *    2^53 ويرفضه بعضُ المستقبِلين.
 * 2. **`bucketCounts` تفاضليّةٌ** وطولُها `explicitBounds.length + 1`: الأخيرُ صندوقُ
 *    الفيضِ (`+Inf`). والمسجّلُ يحفظ تراكميّاً، فالطرحُ ههنا.
 * 3. **`aggregationTemporality = 2`** أي `CUMULATIVE` (ADR 0062 §٢-٨).
 * 4. **`isMonotonic = true`** للعدّاداتِ وحدَها.
 */

import type { ProcessIdentity } from "./process-identity.ts";
import type { MetricFamilySnapshot, MetricLabels } from "./registry.ts";

/** `AGGREGATION_TEMPORALITY_CUMULATIVE` في المواصفةِ. */
export const CUMULATIVE = 2 as const;

/** اسمُ النطاقِ المُصدِّرِ — يُميِّز مقاييسَنا عن مقاييسِ أدواتٍ أخرى في المُجمِّعِ. */
export const SCOPE_NAME = "waslah/observability";

export interface OtlpAttribute {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}

export interface OtlpNumberPoint {
  readonly attributes: readonly OtlpAttribute[];
  readonly startTimeUnixNano: string;
  readonly timeUnixNano: string;
  readonly asDouble: number;
}

export interface OtlpHistogramPoint {
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
  readonly unit: string;
  readonly sum?: {
    readonly dataPoints: readonly OtlpNumberPoint[];
    readonly aggregationTemporality: typeof CUMULATIVE;
    readonly isMonotonic: true;
  };
  readonly gauge?: { readonly dataPoints: readonly OtlpNumberPoint[] };
  readonly histogram?: {
    readonly dataPoints: readonly OtlpHistogramPoint[];
    readonly aggregationTemporality: typeof CUMULATIVE;
  };
}

export interface OtlpExportRequest {
  readonly resourceMetrics: readonly [
    {
      readonly resource: { readonly attributes: readonly OtlpAttribute[] };
      readonly scopeMetrics: readonly [
        {
          readonly scope: { readonly name: string };
          readonly metrics: readonly OtlpMetric[];
        },
      ];
    },
  ];
}

const attribute = (key: string, value: string): OtlpAttribute => ({
  key,
  value: { stringValue: value },
});

/** الوقتُ بالنانو نصّاً. المُدخَلُ بالمللي (`Date.now()`)، والضربُ صحيحٌ لا عائمٌ. */
export function unixNano(milliseconds: number): string {
  return `${BigInt(Math.trunc(milliseconds)) * 1_000_000n}`;
}

/**
 * هويّةُ العمليةِ في `resource` — لا في وسومِ السلاسلِ (ADR 0062 §٢-٩). والأسماءُ
 * بحسبِ الاصطلاحاتِ الدلاليّةِ لـOpenTelemetry كي يفهمَها المُجمِّعُ بلا تهيئةٍ.
 */
export function resourceAttributes(identity: ProcessIdentity): readonly OtlpAttribute[] {
  return [
    attribute("service.name", identity.serviceName),
    attribute("service.instance.id", identity.instanceId),
    attribute("service.namespace", identity.role),
    attribute("deployment.environment", identity.environment),
  ];
}

const pointAttributes = (labels: MetricLabels): readonly OtlpAttribute[] =>
  Object.keys(labels)
    .sort()
    .map((key) => attribute(key, labels[key] ?? ""));

/**
 * الوحدةُ تُستنتَج من لاحقةِ الاسمِ وحدَها — اصطلاحُ Prometheus نفسُه. ولو لم تُستنتَج
 * فـ`"1"` (بلا وحدةٍ)، ولا تُخترَع وحدةٌ من مضمونِ الاسمِ.
 */
export function unitOf(name: string): string {
  if (name.endsWith("_seconds") || name.endsWith("_seconds_total")) return "s";
  if (name.endsWith("_bytes")) return "By";
  return "1";
}

/** فكُّ التراكمِ: `[≤a, ≤b, ≤c]` ← `[a, b−a, c−b, count−c]`. */
export function differentialBuckets(
  cumulative: readonly number[],
  total: number,
): readonly string[] {
  const counts: string[] = [];
  let previous = 0;
  for (const value of cumulative) {
    counts.push(`${Math.max(0, Math.trunc(value - previous))}`);
    previous = value;
  }
  counts.push(`${Math.max(0, Math.trunc(total - previous))}`);
  return counts;
}

export interface ExportWindow {
  /** لحظةُ إقلاعِ العمليةِ بالمللي — بدايةُ التراكمِ. */
  readonly startedAtMs: number;
  /** لحظةُ أخذِ القراءةِ بالمللي. */
  readonly observedAtMs: number;
}

/**
 * يبني الجسمَ. العائلةُ الخاليةُ من العيّناتِ **تُحذَف** من الدفعةِ (لا نقطةَ بيانٍ
 * فلا شيءَ يُرسَل)، بخلافِ القراءةِ التي تذكرها: ذاك انعكاسٌ للحالةِ، وهذا نقلٌ.
 */
export function buildOtlpExportRequest(
  snapshot: readonly MetricFamilySnapshot[],
  identity: ProcessIdentity,
  window: ExportWindow,
): OtlpExportRequest {
  const startTimeUnixNano = unixNano(window.startedAtMs);
  const timeUnixNano = unixNano(window.observedAtMs);
  const metrics: OtlpMetric[] = [];

  for (const family of snapshot) {
    if (family.samples.length === 0) continue;
    const shared = {
      name: family.name,
      description: family.help,
      unit: unitOf(family.name),
    };

    if (family.type === "histogram") {
      metrics.push({
        ...shared,
        histogram: {
          aggregationTemporality: CUMULATIVE,
          dataPoints: family.samples.map((sample) => ({
            attributes: pointAttributes(sample.labels),
            startTimeUnixNano,
            timeUnixNano,
            count: `${Math.trunc(sample.count)}`,
            sum: sample.sum,
            bucketCounts: differentialBuckets(
              sample.buckets.map((bucket) => bucket.cumulativeCount),
              sample.count,
            ),
            explicitBounds: sample.buckets.map((bucket) => bucket.le),
          })),
        },
      });
      continue;
    }

    const dataPoints: OtlpNumberPoint[] = family.samples.map((sample) => ({
      attributes: pointAttributes(sample.labels),
      startTimeUnixNano,
      timeUnixNano,
      asDouble: sample.value,
    }));

    metrics.push(
      family.type === "counter"
        ? {
            ...shared,
            sum: { dataPoints, aggregationTemporality: CUMULATIVE, isMonotonic: true },
          }
        : { ...shared, gauge: { dataPoints } },
    );
  }

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes(identity) },
        scopeMetrics: [{ scope: { name: SCOPE_NAME }, metrics }],
      },
    ],
  };
}
