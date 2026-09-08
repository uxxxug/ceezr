/**
 * الغرض: مسجّل مقاييس Prometheus صغير داخل العملية، بلا مكتبة خارجية أو شبكة، يدعم
 *   العدّادات والمدرجات والمقاييس اللحظية ويُنتج نصّ exposition قياسياً.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/metrics.ts وعامل المهامّ.
 * ملاحظات مستقبلية: عند الحاجة إلى exemplars أو OpenMetrics تُضاف كواجهة تصدير ثانية.
 */

export type MetricLabels = Readonly<Record<string, string>>;

/**
 * ## لقطةُ المسجِّل — لماذا بنيةٌ لا نصّ (F5-07 · SCL-006)
 *
 * `render()` يُنتج نصَّ Prometheus، وهو **صيغةُ عرضٍ لا صيغةُ نقل**: من أراد أن
 * يدفع المقاييسَ إلى مُجمِّعٍ مركزيٍّ بصيغةٍ أخرى (OTLP مثلاً) اضطُرَّ إلى تحليلِ
 * النصِّ سطراً سطراً — وتحليلُ نصٍّ وَلَّدناهُ نحن عبثٌ يُدخِل طبقةَ خطأٍ لا سببَ
 * لها. فاللقطةُ هي المصدرُ البنيويُّ الذي يُبنى عليه كلُّ مُصدِّرٍ، ويبقى
 * `render()` أحدَ قُرّائه لا الطريقَ الوحيد.
 *
 * والعقدُ المُعلَنُ هنا: **العدُّ في السلالِ تراكميٌّ** كما يعرضه Prometheus
 * (`le` تعني «أصغرَ من أو يساوي»)، لا عدَّ سلّةٍ منفردة. ومن أراد الفروقَ
 * — وOTLP يريدها — فليحسبْها، ولا نُغيّرَ نحن دلالةَ الحقل.
 */
export interface CounterOrGaugeSeries {
  readonly labels: MetricLabels;
  readonly value: number;
}

export interface HistogramBucketSnapshot {
  /** الحدُّ الأعلى للسلّة. */
  readonly upperBound: number;
  /** العدُّ **التراكميُّ** حتى هذا الحدِّ ضمناً — لا عدُّ السلّةِ وحدَها. */
  readonly cumulativeCount: number;
}

export interface HistogramSeriesSnapshot {
  readonly labels: MetricLabels;
  readonly count: number;
  readonly sum: number;
  readonly buckets: readonly HistogramBucketSnapshot[];
}

export interface ValueFamilySnapshot {
  readonly type: "counter" | "gauge";
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly series: readonly CounterOrGaugeSeries[];
}

export interface HistogramFamilySnapshot {
  readonly type: "histogram";
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly buckets: readonly number[];
  readonly series: readonly HistogramSeriesSnapshot[];
}

export type MetricFamilySnapshot = ValueFamilySnapshot | HistogramFamilySnapshot;

export interface MetricsSnapshot {
  /**
   * كلُّ عائلةٍ مُعرَّفةٍ — **بما فيها الفارغةُ من القيم**. وهذا يفترق عن
   * `render()` الذي يُسقِط العائلةَ الخاليةَ من سطورِ القيم. والسببُ أنّ اللقطةَ
   * عقدٌ لقارئٍ برمجيٍّ: من أراد إسقاطَ الفارغِ أسقطَه بشرطٍ واحدٍ، ومن أراد أن
   * يعرفَ أنّ العائلةَ مُعرَّفةٌ ولم تُسجَّل بعدُ لا يستطيع استرجاعَ ما حُذف.
   */
  readonly families: readonly MetricFamilySnapshot[];
}

export interface MetricDefinition {
  readonly name: string;
  readonly help: string;
  readonly labelNames?: readonly string[];
}

export interface HistogramDefinition extends MetricDefinition {
  readonly buckets: readonly number[];
}

interface MetricFamily extends MetricDefinition {
  readonly type: "counter" | "gauge";
}

interface HistogramFamily extends HistogramDefinition {
  readonly type: "histogram";
}

interface HistogramValue {
  count: number;
  sum: number;
  readonly buckets: Map<number, number>;
}

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function labelsKey(names: readonly string[], labels: MetricLabels): string {
  return names.map((name) => `${name}\u0000${labels[name] ?? ""}`).join("\u0001");
}

function labelsFor(names: readonly string[], labels: MetricLabels): string {
  if (names.length === 0) return "";
  return `{${names
    .map(
      (name) =>
        `${name}="${(labels[name] ?? "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"')}"`,
    )
    .join(",")}}`;
}

function validDefinition(definition: MetricDefinition): readonly string[] | null {
  if (!METRIC_NAME.test(definition.name)) {
    return null;
  }
  const names = definition.labelNames ?? [];
  const unique = new Set<string>();
  for (const name of names) {
    if (!LABEL_NAME.test(name) || unique.has(name)) {
      return null;
    }
    unique.add(name);
  }
  return names;
}

function labelsMatch(names: readonly string[], labels: MetricLabels): boolean {
  const received = Object.keys(labels).sort();
  const expected = [...names].sort();
  return (
    received.length === expected.length && !received.some((name, index) => name !== expected[index])
  );
}

function numberText(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}

/**
 * مسجّل متعمّد البساطة: كل عدّاد ومقياس لحظي محفوظان بحسب مجموعة الوسوم الكاملة؛ فلا
 * تسمح الواجهة بإضافة وسم عشوائي يرفع cardinality ويؤذي Prometheus في الإنتاج.
 */
export class PrometheusRegistry {
  private readonly families = new Map<string, MetricFamily | HistogramFamily>();
  private readonly values = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, HistogramValue>>();

  defineCounter(definition: MetricDefinition): void {
    this.define({ ...definition, type: "counter" });
  }

  defineGauge(definition: MetricDefinition): void {
    this.define({ ...definition, type: "gauge" });
  }

  defineHistogram(definition: HistogramDefinition): void {
    const labelNames = validDefinition(definition);
    if (labelNames === null) return;
    const buckets = [...definition.buckets].sort((left, right) => left - right);
    if (
      buckets.length === 0 ||
      buckets.some((bucket, index) => bucket < 0 || buckets[index - 1] === bucket)
    )
      return;
    this.addFamily({ ...definition, labelNames, buckets, type: "histogram" });
  }

  increment(name: string, labels: MetricLabels = {}, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) return;
    const family = this.valueFamily(name, "counter");
    if (family === null || !labelsMatch(family.labelNames ?? [], labels)) return;
    const key = labelsKey(family.labelNames ?? [], labels);
    const values = this.values.get(name) ?? new Map<string, number>();
    this.values.set(name, values);
    values.set(key, (values.get(key) ?? 0) + amount);
  }

  setGauge(name: string, labels: MetricLabels = {}, value: number): void {
    if (!Number.isFinite(value)) return;
    const family = this.valueFamily(name, "gauge");
    if (family === null || !labelsMatch(family.labelNames ?? [], labels)) return;
    const key = labelsKey(family.labelNames ?? [], labels);
    const values = this.values.get(name) ?? new Map<string, number>();
    this.values.set(name, values);
    values.set(key, value);
  }

  observe(name: string, labels: MetricLabels = {}, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const family = this.histogramFamily(name);
    if (family === null) return;
    const names = family.labelNames ?? [];
    if (!labelsMatch(names, labels)) return;
    const key = labelsKey(names, labels);
    const byLabels = this.histograms.get(name) ?? new Map<string, HistogramValue>();
    this.histograms.set(name, byLabels);
    const value = byLabels.get(key) ?? {
      count: 0,
      sum: 0,
      buckets: new Map<number, number>(family.buckets.map((bucket) => [bucket, 0])),
    };
    value.count += 1;
    value.sum += seconds;
    for (const bucket of family.buckets) {
      if (seconds <= bucket) value.buckets.set(bucket, (value.buckets.get(bucket) ?? 0) + 1);
    }
    byLabels.set(key, value);
  }

  /**
   * لقطةٌ بنيويّةٌ لكلِّ ما في المسجِّل الآن. نسخةٌ مستقلّةٌ: تعديلُ المسجِّل بعدَ
   * أخذِها لا يُغيِّرها، فلا يقرأُ المُصدِّرُ بنيةً تتحرّك تحته أثناءَ التسلسل.
   */
  snapshot(): MetricsSnapshot {
    const families: MetricFamilySnapshot[] = [];
    for (const family of this.families.values()) {
      const names = family.labelNames ?? [];
      if (family.type === "histogram") {
        const stored = this.histograms.get(family.name);
        const series: HistogramSeriesSnapshot[] = [];
        for (const [key, value] of stored ?? []) {
          series.push({
            labels: this.labelsFromKey(names, key),
            count: value.count,
            sum: value.sum,
            buckets: family.buckets.map((upperBound) => ({
              upperBound,
              cumulativeCount: value.buckets.get(upperBound) ?? 0,
            })),
          });
        }
        families.push({
          type: "histogram",
          name: family.name,
          help: family.help,
          labelNames: [...names],
          buckets: [...family.buckets],
          series,
        });
        continue;
      }
      const stored = this.values.get(family.name);
      const series: CounterOrGaugeSeries[] = [];
      for (const [key, value] of stored ?? []) {
        series.push({ labels: this.labelsFromKey(names, key), value });
      }
      families.push({
        type: family.type,
        name: family.name,
        help: family.help,
        labelNames: [...names],
        series,
      });
    }
    return { families };
  }

  render(): string {
    const lines: string[] = [];
    for (const family of this.families.values()) {
      lines.push(`# HELP ${family.name} ${family.help.replaceAll("\n", " ")}`);
      lines.push(`# TYPE ${family.name} ${family.type}`);
      if (family.type === "histogram") {
        this.renderHistogram(lines, family);
      } else {
        this.renderValues(lines, family);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private define(family: MetricFamily): void {
    const labelNames = validDefinition(family);
    if (labelNames === null) return;
    this.addFamily({ ...family, labelNames });
  }

  private addFamily(family: MetricFamily | HistogramFamily): void {
    const existing = this.families.get(family.name);
    if (existing !== undefined) return;
    this.families.set(family.name, family);
  }

  private valueFamily(name: string, type: "counter" | "gauge"): MetricFamily | null {
    const family = this.families.get(name);
    if (family === undefined || family.type !== type) return null;
    return family;
  }

  private histogramFamily(name: string): HistogramFamily | null {
    const family = this.families.get(name);
    if (family === undefined || family.type !== "histogram") return null;
    return family;
  }

  private renderValues(lines: string[], family: MetricFamily): void {
    const names = family.labelNames ?? [];
    const values = this.values.get(family.name);
    if (values === undefined) return;
    for (const [key, value] of values) {
      const labels = this.labelsFromKey(names, key);
      lines.push(`${family.name}${labelsFor(names, labels)} ${numberText(value)}`);
    }
  }

  private renderHistogram(lines: string[], family: HistogramFamily): void {
    const names = family.labelNames ?? [];
    const values = this.histograms.get(family.name);
    if (values === undefined) return;
    for (const [key, value] of values) {
      const labels = this.labelsFromKey(names, key);
      for (const bucket of family.buckets) {
        lines.push(
          `${family.name}_bucket${labelsFor([...names, "le"], { ...labels, le: numberText(bucket) })} ${numberText(value.buckets.get(bucket) ?? 0)}`,
        );
      }
      lines.push(
        `${family.name}_bucket${labelsFor([...names, "le"], { ...labels, le: "+Inf" })} ${numberText(value.count)}`,
      );
      lines.push(`${family.name}_sum${labelsFor(names, labels)} ${numberText(value.sum)}`);
      lines.push(`${family.name}_count${labelsFor(names, labels)} ${numberText(value.count)}`);
    }
  }

  private labelsFromKey(names: readonly string[], key: string): MetricLabels {
    const values = key === "" ? [] : key.split("\u0001");
    const labels: Record<string, string> = {};
    for (const [index, name] of names.entries()) {
      const value = values[index]?.split("\u0000")[1];
      labels[name] = value ?? "";
    }
    return labels;
  }
}
