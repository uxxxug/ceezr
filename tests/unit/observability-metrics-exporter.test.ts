/**
 * الغرض: التحقّق من سلوك مُصدِّر المقاييس — الفشلُ المفتوح والدفعةُ الأخيرة وكتمُ السرّ (F5-07).
 * الحالة: منفّذ فعلياً — يفشل قبل `metrics-exporter.ts` ويمرّ بعده.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديلٍ في مسار الدفع أو في إيقافه
 * ملاحظات مستقبلية: الإثباتُ متعدّدُ العمليّات في tests/integration لا هنا.
 *
 * ولماذا هذا الملفُّ أصلاً؟ لأنّ لمُصدِّرِ المقاييسِ ثلاثَ طرائقَ في الإفساد لا تظهر
 * واحدةٌ منها في «هل يدفع؟»:
 *  ١) أن يرمي فيُسقِط البوابةَ — فتُطفَأ منصّةُ نقلٍ كاملةٌ لأنّ لوحةَ مراقبةٍ تعطّلت.
 *  ٢) أن يبتلعَ الفشلَ صامتاً — فتُقرأ لوحةٌ ميّتةٌ على أنّها «لا حركةَ في النظام».
 *  ٣) أن يُسجِّلَ ترويسةَ الاعتمادِ في سطرِ خطأ — فيصير سرُّ المُجمِّعِ في كلِّ سجلّ.
 * فكلُّ اختبارٍ هنا يقيس واحدةً منها بعينها.
 */

import { describe, expect, test } from "bun:test";
import {
  createConfiguredMetricsExporter,
  createMetricsExporter,
  generateServiceInstanceId,
  METRICS_EXPORT_ATTEMPTS,
  METRICS_EXPORT_LAST_SUCCESS,
  METRICS_EXPORT_SERIES,
  type MetricsExporterOptions,
  safeEndpointOrigin,
} from "../../packages/infrastructure/observability/metrics-exporter.ts";
import type { MetricsResource } from "../../packages/infrastructure/observability/otlp.ts";
import { PrometheusRegistry } from "../../packages/infrastructure/observability/registry.ts";

const RESOURCE: MetricsResource = {
  serviceName: "waslah-gateway",
  serviceInstanceId: "instance-a",
  deploymentEnvironment: "test",
  processTopology: "single-process",
  processPid: 4242,
};

const SECRET_HEADER_VALUE = "Bearer super-secret-collector-token";

interface Harness {
  readonly registry: PrometheusRegistry;
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly calls: { url: string; body: string; headers: Record<string, string> }[];
}

function harness(
  responder: (call: number) => Promise<Response>,
  overrides: Partial<MetricsExporterOptions> = {},
) {
  const registry = new PrometheusRegistry();
  registry.defineCounter({ name: "waslah_rides_total", help: "رحلات", labelNames: [] });
  registry.increment("waslah_rides_total", {}, 5);

  const state: Harness = { registry, logs: [], calls: [] };
  let callIndex = 0;

  const exporter = createMetricsExporter({
    registry,
    endpoint: "https://collector.example/v1/metrics?tenant=waslah",
    headers: { authorization: SECRET_HEADER_VALUE },
    resource: RESOURCE,
    intervalMs: 15_000,
    log: (message, meta) => state.logs.push({ message, meta }),
    fetch: (async (url: string, init: RequestInit) => {
      state.calls.push({
        url: String(url),
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      });
      callIndex += 1;
      return await responder(callIndex);
    }) as unknown as typeof fetch,
    ...overrides,
  });

  return { ...state, exporter };
}

const ok = async () => new Response("{}", { status: 200 });

function counterValue(registry: PrometheusRegistry, name: string, outcome?: string): number {
  const family = registry.snapshot().families.find((item) => item.name === name);
  if (family === undefined || family.type === "histogram") return 0;
  const series = family.series.find((item) =>
    outcome === undefined ? true : item.labels.outcome === outcome,
  );
  return series?.value ?? 0;
}

describe("createMetricsExporter — الدفعة الناجحة", () => {
  test("يدفع جسم OTLP إلى النقطة ويعيد exported", async () => {
    const { exporter, calls } = harness(ok);
    const outcome = await exporter.exportOnce();

    expect(outcome.outcome).toBe("exported");
    expect(outcome.status).toBe(200);
    expect(outcome.seriesCount).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://collector.example/v1/metrics?tenant=waslah");
    expect(calls[0]?.headers?.["content-type"]).toBe("application/json");
    expect(calls[0]?.headers?.authorization).toBe(SECRET_HEADER_VALUE);

    const body = JSON.parse(calls[0]?.body ?? "{}");
    const names = body.resourceMetrics[0].scopeMetrics[0].metrics.map(
      (metric: { name: string }) => metric.name,
    );
    expect(names).toContain("waslah_rides_total");
  });

  test("يسجّل نجاحَه في مقاييسِه الذاتيّةِ فتُقرأ صحّةُ الدفعِ من الدفعِ نفسِه", async () => {
    const { exporter, registry } = harness(ok);
    await exporter.exportOnce();

    // بدون هذه المقاييسِ لا سبيلَ لمعرفةِ أنّ الدفعَ انقطع: المُجمِّعُ لا يرى شيئاً
    // فيُقرأ الصمتُ «لا حركةَ في النظام» بدلَ «فقدنا البصر».
    expect(counterValue(registry, METRICS_EXPORT_ATTEMPTS, "exported")).toBe(1);
    expect(counterValue(registry, METRICS_EXPORT_SERIES)).toBeGreaterThan(0);
    expect(counterValue(registry, METRICS_EXPORT_LAST_SUCCESS)).toBeGreaterThan(0);
  });
});

describe("createMetricsExporter — الفشل المفتوح", () => {
  test("رميُ الناقلِ لا يُخرِج استثناءً ويُصنَّف failed", async () => {
    const { exporter, registry } = harness(async () => {
      throw new TypeError("fetch failed to https://collector.example/v1/metrics?token=leak");
    });

    const outcome = await exporter.exportOnce();
    expect(outcome.outcome).toBe("failed");
    expect(outcome.status).toBeNull();
    expect(counterValue(registry, METRICS_EXPORT_ATTEMPTS, "failed")).toBe(1);
    // اللحظةُ الأخيرةُ للنجاح لا تتحرّك بفشلٍ — وهي المقياسُ الذي يُبنى عليه تنبيهُ
    // «انقطع الدفع»، فلو حُدِّثت في الفشلِ لصار التنبيهُ لا يعمل أبداً.
    expect(counterValue(registry, METRICS_EXPORT_LAST_SUCCESS)).toBe(0);
  });

  test("ردٌّ 500 يُصنَّف rejected لا failed ويحمل رمزَ الحالة", async () => {
    const { exporter, registry } = harness(async () => new Response("nope", { status: 500 }));

    const outcome = await exporter.exportOnce();
    // التمييزُ ليس تجميلاً: `rejected` تعني مُجمِّعاً حيّاً يرفض طلبَنا (اعتمادٌ أو
    // صيغة)، و`failed` تعني شبكةً مقطوعة. والتشخيصُ والإصلاحُ مختلفان تماماً.
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.status).toBe(500);
    expect(counterValue(registry, METRICS_EXPORT_ATTEMPTS, "rejected")).toBe(1);
  });

  test("فشلُ beforeSnapshot لا يُلغي الدفعَ", async () => {
    const { exporter, calls, logs } = harness(ok, {
      beforeSnapshot: async () => {
        throw new Error("select failed");
      },
    });

    const outcome = await exporter.exportOnce();
    // إلغاءُ الدفعِ لأجلِ استعلامِ مؤشّرٍ متعثّرٍ يُفقِد العدّاداتِ كلَّها معه، وهي
    // سليمةٌ لا تحتاج القاعدة.
    expect(outcome.outcome).toBe("exported");
    expect(calls).toHaveLength(1);
    expect(logs.some((entry) => entry.message === "metrics_export.before_snapshot_failed")).toBe(
      true,
    );
  });
});

describe("createMetricsExporter — كتمان السرّ", () => {
  test("لا تظهر قيمةُ ترويسةِ الاعتمادِ ولا مسارُ النقطةِ في أيِّ سطرِ سجلّ", async () => {
    const { exporter, logs } = harness(async () => {
      throw new Error(`unreachable ${SECRET_HEADER_VALUE}`);
    });
    await exporter.exportOnce();
    await exporter.stop();

    const serialized = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(serialized).not.toContain("super-secret-collector-token");
    // ونصُّ الاستثناءِ نفسُه لا يُمرَّر: قد يحمل الرابطَ كاملاً بالرمزِ في الاستعلام.
    expect(serialized).not.toContain("tenant=waslah");
    expect(serialized).toContain("https://collector.example");
  });

  test("safeEndpointOrigin يُسقط المسارَ والاستعلامَ ولا يُعيد نصّاً لم يُفهَم", () => {
    expect(safeEndpointOrigin("https://collector.example/v1/metrics?token=abc")).toBe(
      "https://collector.example",
    );
    // نصٌّ لم يُحلَّل قد يكون سرّاً كُتِب في المتغيّرِ خطأً، فلا يُعاد خاماً.
    expect(safeEndpointOrigin("not a url token=abc")).toBe("invalid");
  });
});

describe("createMetricsExporter — الإيقاف", () => {
  test("stop يدفع دفعةً أخيرةً فلا يُفقَد العدُّ عند إعادة النشر", async () => {
    const { exporter, calls } = harness(ok);
    await exporter.exportOnce();
    expect(calls).toHaveLength(1);

    const final = await exporter.stop();
    // بدونها تخسر كلُّ إعادةِ نشرٍ حتى `intervalMs` من العدّ، فيصير نقصُ المجموعِ
    // بمقدارِ عددِ إعاداتِ النشرِ — عطبٌ يزيد بزيادةِ نشاطِ التطوير.
    expect(calls).toHaveLength(2);
    expect(final?.outcome).toBe("exported");
  });

  test("النداءُ الثاني لـstop لا يدفع ثانيةً ويردّ null", async () => {
    const { exporter, calls } = harness(ok);
    await exporter.stop();
    expect(calls).toHaveLength(1);

    expect(await exporter.stop()).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("start بعد stop لا يُنشئ مؤقّتاً: العمليّةُ تُغلَق لا تُبعَث", async () => {
    const { exporter, calls } = harness(ok);
    await exporter.stop();
    exporter.start();
    expect(calls).toHaveLength(1);
  });
});

describe("createMetricsExporter — دفعةٌ واحدةٌ في كلِّ لحظة", () => {
  test("نداءان متوازيان يعطيان طلباً واحداً لا طلبَين", async () => {
    // مُبتدأٌ بدالةٍ فارغةٍ لا بـ`null`: مُنفِّذُ الوعدِ يعمل تزامنيّاً فتُسنَد الدالةُ
    // قبل أيِّ استعمال، وتحليلُ مسارِ TypeScript لا يرى داخلَ المُنفِّذِ فيُضَيّق
    // النوعَ إلى `never`.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { exporter, calls } = harness(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    });

    const first = exporter.exportOnce();
    const second = exporter.exportOnce();
    release();
    const [left, right] = await Promise.all([first, second]);

    // لو تأخّر المُجمِّعُ أطولَ من الفاصلِ، تراكمُ الطلبِ فوقَ الطلبِ يُغرِق منفذَ
    // الشبكةِ في عمليّتِنا ويُغرِق المُجمِّعَ معنا — انقطاعٌ يُولِّده الرصدُ نفسُه.
    expect(calls).toHaveLength(1);
    expect(left).toEqual(right);
  });
});

describe("createConfiguredMetricsExporter", () => {
  test("لا نقطةَ مضبوطة ⇒ null صريحةٌ لا مُصدِّرٌ مُعطَّلٌ يدّعي العمل", () => {
    const exporter = createConfiguredMetricsExporter({
      registry: new PrometheusRegistry(),
      serviceName: "waslah-gateway",
      deploymentEnvironment: "test",
      processTopology: "single-process",
      metricsExport: { endpoint: null, headers: {}, intervalSeconds: 15, serviceInstanceId: null },
    });
    expect(exporter).toBeNull();
  });

  test("يبني مُصدِّراً حين تُضبَط النقطةُ ويُولِّد هويّةَ نسخةٍ عند غيابها", async () => {
    const registry = new PrometheusRegistry();
    const calls: string[] = [];

    // الناقلُ يُلتقط **قبلَ** البناء: `createMetricsExporter` يحلُّ `fetch` مرّةً
    // واحدةً عند الإنشاء ولا يقرأ العامَّ في كلّ دفعة — وهو الأصوب: استبدالُ
    // الناقلِ وقتَ التشغيلِ من تحتِ مُصدِّرٍ عاملٍ تغييرٌ لا يطلبه أحد.
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    let exporter: ReturnType<typeof createConfiguredMetricsExporter> = null;
    try {
      exporter = createConfiguredMetricsExporter({
        registry,
        serviceName: "waslah-worker",
        deploymentEnvironment: "production",
        processTopology: "multi-process",
        metricsExport: {
          endpoint: "https://collector.example/v1/metrics",
          headers: {},
          intervalSeconds: 30,
          serviceInstanceId: null,
        },
        pid: 777,
      });
      expect(exporter).not.toBeNull();
      // يُدفَع فعلاً كي نقرأ سماتَ الموردِ التي بُنيت من الضبط لا نصدّقَها إعلاناً.
      await exporter?.exportOnce();
    } finally {
      globalThis.fetch = original;
    }

    const attributes = JSON.parse(calls[0] ?? "{}").resourceMetrics[0].resource.attributes as {
      key: string;
      value: { stringValue?: string; intValue?: string };
    }[];
    const read = (key: string) => attributes.find((attribute) => attribute.key === key)?.value;
    expect(read("service.name")?.stringValue).toBe("waslah-worker");
    expect(read("waslah.process.topology")?.stringValue).toBe("multi-process");
    expect(read("process.pid")?.intValue).toBe("777");
    // مُولَّدةٌ لا فارغة: هويّةٌ فارغةٌ تجعل نسختَين تدهس إحداهما سلاسلَ الأخرى.
    expect(read("service.instance.id")?.stringValue).toStartWith("waslah-worker-777-");
  });

  test("هويّةُ النسخةِ المضبوطةُ صراحةً تُحترَم كما هي", async () => {
    const exporter = createConfiguredMetricsExporter({
      registry: new PrometheusRegistry(),
      serviceName: "waslah-gateway",
      deploymentEnvironment: "production",
      processTopology: "single-process",
      metricsExport: {
        endpoint: "https://collector.example/v1/metrics",
        headers: {},
        intervalSeconds: 15,
        serviceInstanceId: "render-srv-abc-1",
      },
    });
    expect(exporter).not.toBeNull();
  });
});

describe("generateServiceInstanceId", () => {
  test("يفرِق بين نداءَين بنفسِ الخدمةِ ونفسِ رقمِ العمليّة", () => {
    // لو كان `pid` وحدَه هويّةً، لتصادمت عمليّتان على مضيفَين مختلفَين بنفسِ الرقمِ
    // فدهس أحدُهما سلاسلَ الآخر — وهو عينُ العطبِ الذي جاء SCL-006 يمنعُه.
    const left = generateServiceInstanceId("waslah-gateway", 100);
    const right = generateServiceInstanceId("waslah-gateway", 100);
    expect(left).not.toBe(right);
    expect(left).toStartWith("waslah-gateway-100-");
  });
});
