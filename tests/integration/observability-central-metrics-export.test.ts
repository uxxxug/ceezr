/**
 * الغرض: إثبات التجميع المركزي للمقاييس (F5-07 / SCL-006 — ADR 0062) على **مقبسٍ
 *   حقيقيّ**: مستقبِلٌ OTLP/HTTP يعمل فعلاً، ويُفحَص الجسمُ الذي وصله لا نداءٌ
 *   مُقنَّع. ويُثبَت أنّ دفعتينِ من عمليّتينِ تصلانِ بهويّتينِ مختلفتينِ فيقدر
 *   المُجمِّعُ على الجمعِ — وهي عينُ الفجوةِ التي يصفها SCL-006.
 * الحالة: اختبار تكامل فعلي — خادم HTTP محلّي، بلا قاعدة ولا Redis ولا شبكة خارجية.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديل على صيغة التصدير أو على وصلِ البوابة.
 * ملاحظات مستقبلية: هذا يُثبِت أنّ ما نُرسِله يصل كما بنيناه — ولا يُثبِت أنّ
 *   `OTEL Collector` حقيقيّاً يقبله ويَجمع عبر النسخ: حدٌّ مُعلَنٌ في ADR 0062 §٥.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  buildProcessIdentity,
  createCentralMetricsExport,
  METRIC_EXPORT_FAILURES,
  METRIC_EXPORT_SUCCESS,
  PrometheusRegistry,
  registerCentralExportMetrics,
} from "../../packages/infrastructure/observability/index.ts";

/** بديلُ `!`: الغيابُ يُعلَن بخطأٍ مقروءٍ لا بتأكيدٍ صامتٍ يسقط بـ`undefined`. */
function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`غائب في الجسم: ${what}`);
  return value;
}

interface ReceivedBatch {
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

interface Collector {
  readonly url: string;
  readonly batches: ReceivedBatch[];
  stop(): Promise<void>;
}

/** مستقبِلٌ حقيقيٌّ على منفذٍ يختاره النظامُ — لا منفذَ ثابتاً يتصادم في CI. */
async function startCollector(status = 200): Promise<Collector> {
  const batches: ReceivedBatch[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      batches.push({
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.json(),
      });
      return new Response("{}", { status });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1/metrics`,
    batches,
    async stop() {
      await server.stop(true);
    },
  };
}

function busyRegistry(): PrometheusRegistry {
  const registry = new PrometheusRegistry();
  registry.defineCounter({
    name: "waslah_dispatch_requests_total",
    help: "عدد طلبات التوزيع.",
  });
  registry.defineHistogram({
    name: "waslah_worker_duration_seconds",
    help: "زمن الشوط.",
    buckets: [0.1, 1],
  });
  return registry;
}

const collectors: Collector[] = [];

afterEach(async () => {
  while (collectors.length > 0) await collectors.pop()?.stop();
});

async function collector(status = 200): Promise<Collector> {
  const created = await startCollector(status);
  collectors.push(created);
  return created;
}

describe("الدفعُ إلى مُجمِّعٍ حقيقيٍّ", () => {
  it("يصل الجسمُ مطابقاً للعقدِ ومعه الرؤوسُ", async () => {
    const target = await collector();
    const registry = busyRegistry();
    const identity = buildProcessIdentity(
      "gateway",
      { SERVICE_INSTANCE_ID: "inst-1", DEPLOYMENT_ENVIRONMENT: "ci" },
      () => "unused",
    );
    registerCentralExportMetrics(registry, identity, true);
    registry.increment("waslah_dispatch_requests_total", {}, 7);
    registry.observe("waslah_worker_duration_seconds", {}, 0.4);

    const exporter = createCentralMetricsExport({
      registry,
      identity,
      endpoint: target.url,
      headers: { authorization: "Bearer ci-token" },
      startedAtMs: 1_000,
      now: () => 61_000,
    });

    expect(await exporter.exportOnce()).toMatchObject({ ok: true, status: 200 });
    expect(target.batches).toHaveLength(1);

    const batch = required(target.batches[0], "الدفعة الأولى");
    expect(batch.headers["content-type"]).toBe("application/json");
    expect(batch.headers.authorization).toBe("Bearer ci-token");

    const payload = batch.body as {
      resourceMetrics: {
        resource: { attributes: { key: string; value: { stringValue: string } }[] };
        scopeMetrics: {
          metrics: {
            name: string;
            sum?: { dataPoints: { asDouble: number }[]; isMonotonic: boolean };
            histogram?: { dataPoints: { bucketCounts: string[]; explicitBounds: number[] }[] };
          }[];
        }[];
      }[];
    };

    const attributes = Object.fromEntries(
      required(payload.resourceMetrics[0], "resourceMetrics").resource.attributes.map((entry) => [
        entry.key,
        entry.value.stringValue,
      ]),
    );
    expect(attributes).toEqual({
      "service.name": "waslah",
      "service.instance.id": "inst-1",
      "service.namespace": "gateway",
      "deployment.environment": "ci",
    });

    const metrics = required(
      required(payload.resourceMetrics[0], "resourceMetrics").scopeMetrics[0],
      "scopeMetrics",
    ).metrics;
    const dispatch = metrics.find((metric) => metric.name === "waslah_dispatch_requests_total");
    expect(dispatch?.sum?.isMonotonic).toBe(true);
    expect(dispatch?.sum?.dataPoints[0]?.asDouble).toBe(7);

    const worker = metrics.find((metric) => metric.name === "waslah_worker_duration_seconds");
    const point = worker?.histogram?.dataPoints[0];
    expect(point?.explicitBounds).toEqual([0.1, 1]);
    expect(point?.bucketCounts).toEqual(["0", "1", "0"]);

    // الجسمُ نصٌّ صالحٌ بحقٍّ: أُعيد تحليلُه من المقبسِ لا من كائنٍ في الذاكرةِ.
    expect(JSON.stringify(payload).length).toBeGreaterThan(100);
  });

  it("عمليّتانِ تُرسِلانِ بهويّتينِ مختلفتينِ فيمكن الجمعُ — وهذا نصُّ SCL-006", async () => {
    const target = await collector();
    const instances = ["inst-a", "inst-b"] as const;

    for (const [index, instanceId] of instances.entries()) {
      const registry = busyRegistry();
      const identity = buildProcessIdentity(
        "gateway",
        { SERVICE_INSTANCE_ID: instanceId, DEPLOYMENT_ENVIRONMENT: "ci" },
        () => "unused",
      );
      registerCentralExportMetrics(registry, identity, true);
      registry.increment("waslah_dispatch_requests_total", {}, index === 0 ? 4 : 6);
      const exporter = createCentralMetricsExport({
        registry,
        identity,
        endpoint: target.url,
        startedAtMs: 1_000,
      });
      expect(await exporter.exportOnce()).toMatchObject({ ok: true });
    }

    expect(target.batches).toHaveLength(2);
    const received = target.batches.map((batch) => {
      const payload = batch.body as {
        resourceMetrics: {
          resource: { attributes: { key: string; value: { stringValue: string } }[] };
          scopeMetrics: {
            metrics: { name: string; sum?: { dataPoints: { asDouble: number }[] } }[];
          }[];
        }[];
      };
      const instance = required(
        payload.resourceMetrics[0],
        "resourceMetrics",
      ).resource.attributes.find((entry) => entry.key === "service.instance.id")?.value.stringValue;
      const value = required(
        required(payload.resourceMetrics[0], "resourceMetrics").scopeMetrics[0],
        "scopeMetrics",
      ).metrics.find((metric) => metric.name === "waslah_dispatch_requests_total")?.sum
        ?.dataPoints[0]?.asDouble;
      return { instance, value };
    });

    // الهويّتانِ متمايزتانِ: لا تكتب إحداهما فوقَ الأخرى في المُجمِّعِ.
    expect(new Set(received.map((entry) => entry.instance)).size).toBe(2);
    // والمجموعُ ١٠ — وهو ما تعجز عنه كشطةُ عنوانٍ واحدٍ تُصيب واحدةً منهما.
    expect(received.reduce((total, entry) => total + (entry.value ?? 0), 0)).toBe(10);
  });

  it("ردُّ رفضٍ من المُجمِّعِ يُعَدُّ فشلاً ولا يرمي", async () => {
    const target = await collector(503);
    const registry = busyRegistry();
    const identity = buildProcessIdentity("gateway", {}, () => "inst-c");
    registerCentralExportMetrics(registry, identity, true);
    registry.increment("waslah_dispatch_requests_total", {}, 1);
    const exporter = createCentralMetricsExport({
      registry,
      identity,
      endpoint: target.url,
      startedAtMs: 1_000,
    });

    expect(await exporter.exportOnce()).toEqual({ ok: false, reason: "http_status" });
    expect(target.batches).toHaveLength(1);
    expect(registry.render()).toContain(`${METRIC_EXPORT_FAILURES}{reason="http_status"} 1`);
    expect(registry.render()).not.toContain(`${METRIC_EXPORT_SUCCESS} 1`);
  });

  it("مُجمِّعٌ ذهبَ لا يُسقِط العمليةَ", async () => {
    const target = await collector();
    const url = target.url;
    await target.stop();
    collectors.pop();

    const registry = busyRegistry();
    const identity = buildProcessIdentity("gateway", {}, () => "inst-d");
    registerCentralExportMetrics(registry, identity, true);
    const exporter = createCentralMetricsExport({
      registry,
      identity,
      endpoint: url,
      startedAtMs: 1_000,
      timeoutMs: 2_000,
    });

    const outcome = await exporter.exportOnce();
    expect(outcome.ok).toBe(false);
    expect(registry.render()).toContain(METRIC_EXPORT_FAILURES);
  });

  it("الدفعُ الدوريُّ يعمل فعلاً ثمّ يتوقّف بـstop", async () => {
    const target = await collector();
    const registry = busyRegistry();
    const identity = buildProcessIdentity("gateway", {}, () => "inst-e");
    registerCentralExportMetrics(registry, identity, true);
    registry.increment("waslah_dispatch_requests_total", {}, 1);
    const exporter = createCentralMetricsExport({
      registry,
      identity,
      endpoint: target.url,
      startedAtMs: 1_000,
      intervalMs: 15,
    });

    exporter.start();
    await Bun.sleep(120);
    exporter.stop();
    const afterStop = target.batches.length;
    expect(afterStop).toBeGreaterThanOrEqual(2);
    await Bun.sleep(80);
    // لا دفعةَ بعدَ التوقّفِ: مؤقّتٌ لا يُوقَف يُبقي العمليةَ تتحدّث بعدَ إطفائها.
    expect(target.batches.length).toBe(afterStop);
  });
});
