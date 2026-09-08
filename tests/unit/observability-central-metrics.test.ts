/**
 * الغرض: إثبات عقد التجميع المركزي للمقاييس (البند F5-07 / SCL-006 — ADR 0062):
 *   هويّةُ العملية مُعلَنةٌ وثابتةٌ، والتحويلُ إلى OTLP/JSON صحيحٌ في دقائقِه التي
 *   تُقبَل بـ200 وهي كاذبة، والمُصدِّرُ يفشل مفتوحاً ويَعُدُّ فشلَه ولا يُسرِّب سرّاً.
 * الحالة: اختبار وحدة فعلي — بلا شبكة أو قاعدة (نداءُ الشبكة مُمرَّرٌ حقناً).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على طبقة observability أو على وصلِ البوابة.
 * ملاحظات مستقبلية: قبولُ المُجمِّعِ الحقيقيِّ لهذا الجسمِ غيرُ مُثبَتٍ ههنا — حدٌّ
 *   مُعلَنٌ في ADR 0062 §٥، والمُثبَتُ الشكلُ لا التشغيلُ البينيُّ.
 */

import { describe, expect, it } from "bun:test";
import {
  buildOtlpExportRequest,
  buildProcessIdentity,
  createCentralMetricsExport,
  differentialBuckets,
  METRIC_EXPORT_ENABLED,
  METRIC_EXPORT_FAILURES,
  METRIC_EXPORT_LAST_SUCCESS,
  METRIC_EXPORT_SUCCESS,
  METRIC_TARGET_INFO,
  type MetricsFetch,
  type ProcessIdentity,
  PrometheusRegistry,
  parseExportHeaders,
  registerCentralExportMetrics,
  SERVICE_NAME,
  UNKNOWN_ENVIRONMENT,
  unitOf,
  unixNano,
} from "../../packages/infrastructure/observability/index.ts";

/** بديلُ `!`: الغيابُ يُعلَن بخطأٍ مقروءٍ لا بتأكيدٍ صامتٍ يسقط بـ`undefined`. */
function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`غائب في الجسم: ${what}`);
  return value;
}

const IDENTITY: ProcessIdentity = {
  serviceName: SERVICE_NAME,
  role: "gateway",
  instanceId: "instance-a",
  environment: "test",
};

const WINDOW = { startedAtMs: 1_000, observedAtMs: 61_000 } as const;

function loadedRegistry(): PrometheusRegistry {
  const registry = new PrometheusRegistry();
  registry.defineCounter({ name: "waslah_rides_total", help: "رحلات.", labelNames: ["city"] });
  registry.defineGauge({ name: "waslah_drivers_online", help: "سائقون." });
  registry.defineHistogram({
    name: "waslah_request_duration_seconds",
    help: "زمن.",
    buckets: [0.1, 1],
  });
  registry.increment("waslah_rides_total", { city: "jeddah" }, 3);
  registry.setGauge("waslah_drivers_online", {}, 12);
  registry.observe("waslah_request_duration_seconds", {}, 0.05);
  registry.observe("waslah_request_duration_seconds", {}, 0.5);
  registry.observe("waslah_request_duration_seconds", {}, 5);
  return registry;
}

describe("هويّةُ العمليةِ مُعلَنةٌ لا مُستنتَجةٌ", () => {
  it("تأخذ معرّفَ النسخةِ من المنصّةِ ولا تُولِّد حينَ يُعلَن", () => {
    let generated = 0;
    const identity = buildProcessIdentity(
      "gateway",
      { SERVICE_INSTANCE_ID: " srv-7 ", DEPLOYMENT_ENVIRONMENT: "staging" },
      () => {
        generated += 1;
        return "generated";
      },
    );
    expect(identity.instanceId).toBe("srv-7");
    expect(identity.environment).toBe("staging");
    expect(generated).toBe(0);
  });

  it("تُولِّد معرّفاً عندَ الغيابِ ولا تُخمِّن بيئةً", () => {
    const identity = buildProcessIdentity("worker", {}, () => "uuid-1");
    expect(identity.instanceId).toBe("uuid-1");
    // الخطأُ في اتّجاهِ «production» يُلوّث لوحةَ الإنتاج، فالمجهولُ يُعلَن مجهولاً.
    expect(identity.environment).toBe(UNKNOWN_ENVIRONMENT);
    expect(identity.role).toBe("worker");
  });

  it("قيمةٌ فارغةٌ أو فراغاتٌ ليست إعلاناً", () => {
    const identity = buildProcessIdentity(
      "gateway",
      { SERVICE_INSTANCE_ID: "   ", DEPLOYMENT_ENVIRONMENT: "" },
      () => "uuid-2",
    );
    expect(identity.instanceId).toBe("uuid-2");
    expect(identity.environment).toBe(UNKNOWN_ENVIRONMENT);
  });

  it("عمليّتانِ بلا إعلانٍ تحملانِ معرّفينِ مختلفينِ", () => {
    const first = buildProcessIdentity("gateway", {});
    const second = buildProcessIdentity("gateway", {});
    expect(first.instanceId).not.toBe(second.instanceId);
  });
});

describe("قراءةُ المسجّلِ", () => {
  it("تعكس الحالةَ نفسَها التي يرسمها العرضُ النصّيُّ", () => {
    const registry = loadedRegistry();
    const snapshot = registry.snapshot();
    const counter = snapshot.find((family) => family.name === "waslah_rides_total");
    expect(counter?.type).toBe("counter");
    expect(counter?.samples).toEqual([{ labels: { city: "jeddah" }, value: 3 }]);
    const histogram = snapshot.find((family) => family.name === "waslah_request_duration_seconds");
    expect(histogram?.samples[0]).toMatchObject({
      count: 3,
      buckets: [
        { le: 0.1, cumulativeCount: 1 },
        { le: 1, cumulativeCount: 2 },
      ],
    });
  });

  it("لا تُسلِّم مرجعاً يُعدَّل به عدَّادٌ من خارجِ الواجهةِ", () => {
    const registry = loadedRegistry();
    const first = registry.snapshot();
    const samples = required(first[0], "أوّل عائلة").samples as unknown as { value: number }[];
    required(samples[0], "أوّل عيّنة").value = 999;
    const second = registry.snapshot();
    expect(second[0]?.samples[0]).toMatchObject({ value: 3 });
  });

  it("تذكر عائلةً مُعرَّفةً بلا عيّناتٍ — «لم يقع» خبرٌ لا فراغٌ", () => {
    const registry = new PrometheusRegistry();
    registry.defineCounter({ name: "waslah_never_total", help: "لم يقع." });
    expect(registry.snapshot()).toEqual([
      { name: "waslah_never_total", help: "لم يقع.", labelNames: [], type: "counter", samples: [] },
    ]);
  });
});

describe("التحويلُ إلى OTLP/JSON", () => {
  const request = buildOtlpExportRequest(loadedRegistry().snapshot(), IDENTITY, WINDOW);
  const metrics = request.resourceMetrics[0].scopeMetrics[0].metrics;

  it("يضع هويّةَ العمليةِ في المورِدِ لا في وسومِ السلاسلِ", () => {
    expect(request.resourceMetrics[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "waslah" } },
      { key: "service.instance.id", value: { stringValue: "instance-a" } },
      { key: "service.namespace", value: { stringValue: "gateway" } },
      { key: "deployment.environment", value: { stringValue: "test" } },
    ]);
    for (const metric of metrics) {
      const points = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
      for (const point of points) {
        expect(point.attributes.some((entry) => entry.key.startsWith("service."))).toBe(false);
      }
    }
  });

  it("يُرسِل العدَّادَ مجموعاً تراكميّاً أُحاديَّ الاتّجاهِ", () => {
    const counter = metrics.find((metric) => metric.name === "waslah_rides_total");
    expect(counter?.sum?.isMonotonic).toBe(true);
    expect(counter?.sum?.aggregationTemporality).toBe(2);
    expect(counter?.gauge).toBeUndefined();
    expect(counter?.sum?.dataPoints[0]).toEqual({
      attributes: [{ key: "city", value: { stringValue: "jeddah" } }],
      startTimeUnixNano: "1000000000",
      timeUnixNano: "61000000000",
      asDouble: 3,
    });
  });

  it("يُرسِل المقياسَ اللحظيَّ مقياساً لحظيّاً لا مجموعاً", () => {
    const gauge = metrics.find((metric) => metric.name === "waslah_drivers_online");
    expect(gauge?.gauge?.dataPoints[0]?.asDouble).toBe(12);
    expect(gauge?.sum).toBeUndefined();
  });

  it("يفكّ تراكمَ صناديقِ المدرَّجِ ويُلحِق صندوقَ الفيضِ", () => {
    const histogram = metrics.find((metric) => metric.name === "waslah_request_duration_seconds");
    const point = histogram?.histogram?.dataPoints[0];
    // القِيَمُ 0.05 و0.5 و5 على حدودِ [0.1, 1] ⇒ 1 ثمّ 1 ثمّ 1 في الفيضِ.
    expect(point?.bucketCounts).toEqual(["1", "1", "1"]);
    expect(point?.explicitBounds).toEqual([0.1, 1]);
    // الشرطُ الذي يرفضه المُستقبِلُ إن اختلّ: عددُ الصناديقِ = عددُ الحدودِ + ١.
    expect(point?.bucketCounts.length).toBe((point?.explicitBounds.length ?? 0) + 1);
    expect(point?.count).toBe("3");
    expect(point?.sum).toBeCloseTo(5.55, 6);
  });

  it("يُرسِل الأعدادَ ٦٤-بت نصوصاً كما يقتضي تعيينُ proto3 على JSON", () => {
    const histogram = metrics.find((metric) => metric.name === "waslah_request_duration_seconds");
    const point = histogram?.histogram?.dataPoints[0];
    expect(typeof point?.count).toBe("string");
    expect(typeof point?.timeUnixNano).toBe("string");
    for (const bucket of point?.bucketCounts ?? []) expect(typeof bucket).toBe("string");
  });

  it("يحذف العائلةَ الخاليةَ من الدفعةِ", () => {
    const registry = new PrometheusRegistry();
    registry.defineCounter({ name: "waslah_never_total", help: "لم يقع." });
    const empty = buildOtlpExportRequest(registry.snapshot(), IDENTITY, WINDOW);
    expect(empty.resourceMetrics[0].scopeMetrics[0].metrics).toEqual([]);
  });

  it("يستنتج الوحدةَ من اللاحقةِ وحدَها", () => {
    expect(unitOf("waslah_request_duration_seconds")).toBe("s");
    expect(unitOf("waslah_payload_bytes")).toBe("By");
    expect(unitOf("waslah_rides_total")).toBe("1");
  });

  it("يحوّل المللي إلى نانو بلا فقدِ دقّةٍ", () => {
    expect(unixNano(1_757_000_000_000)).toBe("1757000000000000000");
  });

  it("لا يُنتج عدّاً سالباً من قراءةٍ مشوَّهةٍ", () => {
    expect(differentialBuckets([5, 3], 4)).toEqual(["5", "0", "1"]);
  });
});

describe("رؤوسُ التصديرِ", () => {
  it("تُقطَع عندَ أوّلِ مساواةٍ فتسلم القيمُ المُرمَّزةُ بـbase64", () => {
    expect(parseExportHeaders("authorization=Bearer aGk=,x-scope=team")).toEqual({
      authorization: "Bearer aGk=",
      "x-scope": "team",
    });
  });

  it("تتجاهل المشوَّهَ ولا تُسقِط الصحيحَ معه", () => {
    expect(parseExportHeaders("bad,=novalue,nokey=,ok=1")).toEqual({ ok: "1" });
    expect(parseExportHeaders(undefined)).toEqual({});
  });
});

describe("مقاييسُ المُصدِّرِ عن نفسِه", () => {
  it("تُعرِّف العمليةَ في العرضِ ولو كان التصديرُ مُطفَأً", () => {
    const registry = new PrometheusRegistry();
    registerCentralExportMetrics(registry, IDENTITY, false);
    const text = registry.render();
    expect(text).toContain(
      `${METRIC_TARGET_INFO}{service="waslah",role="gateway",instance="instance-a",environment="test"} 1`,
    );
    expect(text).toContain(`${METRIC_EXPORT_ENABLED} 0`);
    expect(text).toContain(`${METRIC_EXPORT_LAST_SUCCESS} 0`);
  });

  it("تُعلِن التفعيلَ حينَ يُضبَط عنوانٌ", () => {
    const registry = new PrometheusRegistry();
    registerCentralExportMetrics(registry, IDENTITY, true);
    expect(registry.render()).toContain(`${METRIC_EXPORT_ENABLED} 1`);
  });
});

describe("المُصدِّرُ يفشل مفتوحاً ويَعُدُّ فشلَه", () => {
  function harness(fetchImpl: MetricsFetch, endpoint: string | undefined = "https://collector") {
    const registry = loadedRegistry();
    registerCentralExportMetrics(registry, IDENTITY, (endpoint ?? "").trim() !== "");
    const exporter = createCentralMetricsExport({
      registry,
      identity: IDENTITY,
      endpoint,
      headers: { authorization: "Bearer top-secret" },
      startedAtMs: 1_000,
      now: () => 61_000,
      fetchImpl,
      timeoutMs: 20,
    });
    return { registry, exporter };
  }

  it("ينجح فيَعُدَّ نجاحَه ويضبطَ طابعَ آخرِ نجاحٍ بالثواني", async () => {
    const { registry, exporter } = harness(async () => new Response("{}", { status: 200 }));
    expect(await exporter.exportOnce()).toEqual({ ok: true, status: 200 });
    const text = registry.render();
    expect(text).toContain(`${METRIC_EXPORT_SUCCESS} 1`);
    expect(text).toContain(`${METRIC_EXPORT_LAST_SUCCESS} 61`);
  });

  it("يُميّز ردَّ الخطأِ عن انقطاعِ الشبكةِ عن المهلةِ", async () => {
    const status = harness(async () => new Response("no", { status: 503 }));
    expect(await status.exporter.exportOnce()).toEqual({ ok: false, reason: "http_status" });

    const network = harness(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await network.exporter.exportOnce()).toEqual({ ok: false, reason: "network" });

    const slow = harness(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    expect(await slow.exporter.exportOnce()).toEqual({ ok: false, reason: "timeout" });
  });

  it("يُعلِن الإطفاءَ سبباً مستقلّاً فلا يُلوِّث معدَّلَ فشلِ الشبكةِ", async () => {
    const { registry, exporter } = harness(async () => new Response("{}"), "");
    expect(exporter.enabled).toBe(false);
    expect(await exporter.exportOnce()).toEqual({ ok: false, reason: "disabled" });
    expect(registry.render()).toContain(`${METRIC_EXPORT_FAILURES}{reason="disabled"} 1`);
  });

  it("لا يرمي إلى مُناديه مهما فعل الناقلُ", async () => {
    const { exporter } = harness(() => {
      throw new Error("مفاجئ");
    });
    await expect(exporter.exportOnce()).resolves.toMatchObject({ ok: false });
  });

  it("لا يُسرِّب سرَّ الرأسِ إلى سجلٍّ ولا إلى وسمِ مقياسٍ", async () => {
    const lines: string[] = [];
    const registry = loadedRegistry();
    registerCentralExportMetrics(registry, IDENTITY, true);
    const exporter = createCentralMetricsExport({
      registry,
      identity: IDENTITY,
      endpoint: "https://collector/v1/metrics?token=in-url",
      headers: { authorization: "Bearer top-secret" },
      startedAtMs: 1_000,
      fetchImpl: async () => {
        throw new Error("فشل الاتصال بـ https://collector/v1/metrics?token=in-url");
      },
      log: (message, meta) => lines.push(`${message} ${JSON.stringify(meta ?? {})}`),
    });
    await exporter.exportOnce();
    const emitted = `${lines.join("\n")}\n${registry.render()}`;
    expect(emitted).not.toContain("top-secret");
    expect(emitted).not.toContain("in-url");
    expect(lines.some((line) => line.includes("metrics.export.failed"))).toBe(true);
  });

  it("يُرسِل الرؤوسَ ونوعَ المحتوى إلى العنوانِ المضبوطِ", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const { exporter } = harness(async (input, init) => {
      seen = {
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      return new Response("{}", { status: 200 });
    });
    await exporter.exportOnce();
    expect(seen).toMatchObject({
      url: "https://collector",
      headers: { "content-type": "application/json", authorization: "Bearer top-secret" },
    });
  });

  it("لا يُشغِّل مؤقّتاً وهو مُطفَأٌ، و`stop` بلا `start` لا يرمي", () => {
    const { exporter } = harness(async () => new Response("{}"), "");
    exporter.start();
    exporter.stop();
    exporter.stop();
  });
});
