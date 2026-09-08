/**
 * الغرض: التحقّق من تحويل لقطةِ المسجِّل إلى جسم OTLP/HTTP — البند F5-07 (SCL-006).
 * الحالة: منفّذ فعلياً — يفشل قبل `otlp.ts` ويمرّ بعده.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تغييرٍ في دلالةِ حقلٍ من حقول OTLP
 * ملاحظات مستقبلية: إن تغيّر العقدُ يُرفَع `OTLP_SCOPE_VERSION` ويُعدَّل هنا معاً.
 *
 * ولماذا هذا الملفُّ أصلاً؟ لأنّ خطأَ التحويلِ لا يُسقط شيئاً: العمليّةُ تدفع،
 * والمُجمِّعُ يجيب `200`، والرقمُ في اللوحةِ خطأٌ صامت. وأخطرُ صنفٍ منه تراكميّةُ
 * الحُزَم: Prometheus يعدّ الحزمةَ `le` تراكميّةً (كلُّ ما ≤ الحدّ)، وOTLP يعدّها
 * فرقيّةً (ما بين الحدَّين). فنسخُ المصفوفةِ كما هي — وهو أبسطُ ما يُكتَب — يعطي
 * جسماً صالحاً بأرقامٍ منفوخةٍ نفخاً هائلاً، ولا حرفَ يشكو. فهذا يُقاس هنا لا يُراجَع.
 */

import { describe, expect, test } from "bun:test";
import {
  countSeries,
  deltaBucketCounts,
  type MetricsResource,
  OTLP_SCOPE_NAME,
  OTLP_SCOPE_VERSION,
  toOtlpExportRequest,
} from "../../packages/infrastructure/observability/otlp.ts";
import { PrometheusRegistry } from "../../packages/infrastructure/observability/registry.ts";

const RESOURCE: MetricsResource = {
  serviceName: "waslah-gateway",
  serviceInstanceId: "waslah-gateway-1234-abcd",
  deploymentEnvironment: "test",
  processTopology: "single-process",
  processPid: 1234,
};

function convert(registry: PrometheusRegistry) {
  return toOtlpExportRequest({
    snapshot: registry.snapshot(),
    resource: RESOURCE,
    startTimeMs: 1_700_000_000_000,
    timeMs: 1_700_000_060_000,
  });
}

function metricsOf(request: ReturnType<typeof convert>) {
  return request.resourceMetrics[0].scopeMetrics[0].metrics;
}

describe("deltaBucketCounts", () => {
  test("يحوّل التراكميَّ إلى فرقيٍّ ويجعل مجموعَه مساوياً للعدّ الكلّي", () => {
    // تراكميّاً: ٢ ≤ ٠٫١، و٥ ≤ ٠٫٥، و٥ ≤ ١. والعدُّ الكلّيُّ ٧ ⇒ اثنتان فوق الحدّ الأعلى.
    const delta = deltaBucketCounts([2, 5, 5], 7);
    expect(delta).toEqual([2, 3, 0, 2]);
    expect(delta.reduce((sum, value) => sum + value, 0)).toBe(7);
  });

  test("الخانةُ الأخيرةُ هي +Inf وتُشتقُّ من العدِّ لا من حدٍّ مُعلَن", () => {
    // لا قياسَ واحدٌ فوق الحدِّ الأعلى ⇒ خانةُ `+Inf` صفر، والطولُ يبقى حدوداً+١.
    expect(deltaBucketCounts([4, 9, 12], 12)).toEqual([4, 5, 3, 0]);
  });

  test("لا يُنتج عدّاً سالباً حين يكون العدُّ الكلّيُّ أقلَّ من التراكميّ", () => {
    // حالةٌ لا تقع في مسجِّلٍ سليم، لكن عدّاً سالباً في OTLP يُرفَض الجسمُ كلُّه
    // فتضيع كلُّ المقاييس بسبب حزمةٍ واحدة. فالقصُّ إلى صفرٍ يفقد دقّةَ حزمةٍ
    // واحدةٍ لا لقطةً كاملة. والحُزَمُ تُقرأ كما هي ولا تُقصّ إلى `count`: قصُّها
    // كان سيخفي الفسادَ بدل أن يُبقيَه ظاهراً للقارئ في اللوحة.
    expect(deltaBucketCounts([9], 3)).toEqual([9, 0]);
    expect(deltaBucketCounts([9], 3).every((value) => value >= 0)).toBe(true);
  });

  test("لا حدودَ مُعلَنة ⇒ خانةٌ واحدةٌ تحمل العدَّ كلَّه", () => {
    expect(deltaBucketCounts([], 6)).toEqual([6]);
  });
});

describe("toOtlpExportRequest — سمات المورد", () => {
  test("يحمل هويّةَ النسخةِ التي تفصلها عن أختِها في المُجمِّع", () => {
    const registry = new PrometheusRegistry();
    const attributes = convert(registry).resourceMetrics[0].resource.attributes;
    const read = (key: string) => attributes.find((attribute) => attribute.key === key)?.value;

    expect(read("service.name")).toEqual({ stringValue: "waslah-gateway" });
    // هذه هي السمةُ التي عليها يقوم البندُ كلُّه: بدونها تدهس سلاسلُ نسخةٍ سلاسلَ
    // أختِها في المُجمِّع، فيُقرأ رقمُ آخرِ دافعٍ لا مجموعُ النظام.
    expect(read("service.instance.id")).toEqual({ stringValue: "waslah-gateway-1234-abcd" });
    expect(read("deployment.environment")).toEqual({ stringValue: "test" });
    expect(read("waslah.process.topology")).toEqual({ stringValue: "single-process" });
    expect(read("process.pid")).toEqual({ intValue: "1234" });
  });

  test("يُعلن نطاقاً واحداً ثابتاً بإصداره", () => {
    const scope = convert(new PrometheusRegistry()).resourceMetrics[0].scopeMetrics[0].scope;
    expect(scope).toEqual({ name: OTLP_SCOPE_NAME, version: OTLP_SCOPE_VERSION });
  });
});

describe("toOtlpExportRequest — أنواع المقاييس", () => {
  test("العدّادُ يصير Sum تصاعديّاً بزمنيّةٍ تراكميّة", () => {
    const registry = new PrometheusRegistry();
    registry.defineCounter({ name: "waslah_rides_total", help: "رحلات", labelNames: ["city"] });
    registry.increment("waslah_rides_total", { city: "riyadh" }, 3);

    const metric = metricsOf(convert(registry)).find((item) => item.name === "waslah_rides_total");
    expect(metric?.sum?.isMonotonic).toBe(true);
    // `2` = CUMULATIVE. وإعلانُها `1` (DELTA) يجعل المُجمِّعَ يجمع كلَّ لقطةٍ إلى
    // ما قبلها، فيصير منحنى العدّادِ متسارعاً بلا سببٍ في العالم.
    expect(metric?.sum?.aggregationTemporality).toBe(2);
    expect(metric?.sum?.dataPoints).toHaveLength(1);

    const point = metric?.sum?.dataPoints[0];
    expect(point?.asDouble).toBe(3);
    expect(point?.attributes).toEqual([{ key: "city", value: { stringValue: "riyadh" } }]);
    // `startTimeUnixNano` هو ما يُعلم المُجمِّعَ أنّ العدَّ بدأ من صفرٍ عند الإقلاع،
    // فلا يُقرأ إعادةُ النشرِ هبوطاً مفاجئاً في العدّاد.
    expect(point?.startTimeUnixNano).toBe("1700000000000000000");
    expect(point?.timeUnixNano).toBe("1700000060000000000");
  });

  test("المؤشّرُ يصير Gauge بلا زمنيّة", () => {
    const registry = new PrometheusRegistry();
    registry.defineGauge({ name: "waslah_drivers_online", help: "سائقون", labelNames: [] });
    registry.setGauge("waslah_drivers_online", {}, 12);

    const metric = metricsOf(convert(registry)).find(
      (item) => item.name === "waslah_drivers_online",
    );
    expect(metric?.gauge?.dataPoints[0]?.asDouble).toBe(12);
    expect(metric?.sum).toBeUndefined();
  });

  test("المُدرَّجُ يحمل حدوداً وحُزَماً فرقيّةً مجموعُها العدُّ الكلّي", () => {
    const registry = new PrometheusRegistry();
    registry.defineHistogram({
      name: "waslah_request_seconds",
      help: "زمن",
      labelNames: [],
      buckets: [0.1, 0.5, 1],
    });
    for (const value of [0.05, 0.05, 0.3, 2]) {
      registry.observe("waslah_request_seconds", {}, value);
    }

    const point = metricsOf(convert(registry)).find(
      (item) => item.name === "waslah_request_seconds",
    )?.histogram?.dataPoints[0];

    expect(point?.count).toBe("4");
    expect(point?.sum).toBeCloseTo(2.4, 10);
    expect(point?.explicitBounds).toEqual([0.1, 0.5, 1]);
    // حدودٌ ثلاثةٌ ⇒ أربعُ حُزَم. وطولٌ مساوٍ للحدود يُرفَض في OTLP.
    expect(point?.bucketCounts).toHaveLength(4);
    expect(point?.bucketCounts).toEqual(["2", "1", "0", "1"]);
  });
});

describe("toOtlpExportRequest — الفراغ", () => {
  test("يُسقط العائلةَ التي لا سلسلةَ فيها ولا يدفع مقياساً فارغاً", () => {
    const registry = new PrometheusRegistry();
    registry.defineCounter({ name: "waslah_never_touched", help: "لم يُلمَس", labelNames: [] });
    registry.defineCounter({ name: "waslah_touched", help: "لُمِس", labelNames: [] });
    registry.increment("waslah_touched", {}, 1);

    const names = metricsOf(convert(registry)).map((item) => item.name);
    // عائلةٌ بلا نقاطٍ جسمٌ أثقلُ بلا معلومة، وبعضُ المُجمِّعات ترفض المقياسَ الفارغ
    // فيسقط الجسمُ كلُّه بسبب عدّادٍ مُعرَّفٍ لم يُلمَس بعد.
    expect(names).toContain("waslah_touched");
    expect(names).not.toContain("waslah_never_touched");
  });

  test("مسجِّلٌ بلا سلسلةٍ واحدةٍ يعطي قائمةَ مقاييسٍ فارغةً وعدَّ سلاسلَ صفراً", () => {
    const request = convert(new PrometheusRegistry());
    expect(metricsOf(request)).toHaveLength(0);
    expect(countSeries(request)).toBe(0);
  });
});

describe("countSeries", () => {
  test("يعدّ نقاطَ البياناتِ لا العائلاتِ", () => {
    const registry = new PrometheusRegistry();
    registry.defineCounter({ name: "waslah_a_total", help: "أ", labelNames: ["city"] });
    registry.increment("waslah_a_total", { city: "riyadh" }, 1);
    registry.increment("waslah_a_total", { city: "jeddah" }, 1);
    registry.defineGauge({ name: "waslah_b", help: "ب", labelNames: [] });
    registry.setGauge("waslah_b", {}, 1);
    registry.defineHistogram({ name: "waslah_c_seconds", help: "ج", labelNames: [], buckets: [1] });
    registry.observe("waslah_c_seconds", {}, 0.5);

    // ٢ سلاسلِ عدّادٍ + ١ مؤشّر + ١ مُدرَّج = ٤. وهذا الرقمُ يُدفَع كمقياسٍ ذاتيٍّ،
    // فانفجارُ العلاماتِ يُرى في اللوحةِ قبل أن يُرى في فاتورةِ المُجمِّع.
    expect(countSeries(convert(registry))).toBe(4);
  });
});
