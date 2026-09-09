/**
 * الغرض: إثبات أن المقاييس التشغيلية تُزاد وأن إخراجها نص Prometheus صالح، وأن
 *   /metrics محمي دائماً بسرّ مخصص ولا يُخزَّن في الاستجابة.
 * الحالة: اختبار وحدة فعلي — بلا شبكة أو قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل لطبقة observability أو مسار /metrics.
 * ملاحظات مستقبلية: يبقى هذا اختبار العقد النصي حتى عند إدخال عميل Prometheus خارجي.
 */

import { describe, expect, it } from "bun:test";
import { createMetricsRoutes, metricsSecretsMatch } from "../../apps/gateway/src/routes/metrics.ts";
import { createOperationalMetrics } from "../../packages/infrastructure/observability/index.ts";

function metricValue(text: string, name: string, labels = ""): number {
  const line = text.split("\n").find((entry) => entry.startsWith(`${name}${labels} `));
  if (line === undefined) throw new Error(`لا يوجد السطر ${name}${labels}`);
  const value = line.split(" ").at(-1);
  return Number(value);
}

function isPrometheusText(text: string): boolean {
  const allowed =
    /^(# (HELP|TYPE) [a-zA-Z_:][a-zA-Z0-9_:]* .+|[a-zA-Z_:][a-zA-Z0-9_:]*(\{[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*"(,[a-zA-Z_][a-zA-Z0-9_]*="(?:[^"\\]|\\.)*")*\})? ([-+]?\d+(\.\d+)?|\+Inf|NaN))$/;
  return text
    .trim()
    .split("\n")
    .every((line) => allowed.test(line));
}

describe("مقاييس التشغيل بصيغة Prometheus", () => {
  it("يزيد العدادات ويسجل المدرجات والمقاييس اللحظية بنص صالح", () => {
    const metrics = createOperationalMetrics();
    metrics.recordTelegramUpdate("driver", "handled", 125);
    metrics.recordTelegramUpdate("rider", "failed", 250);
    metrics.recordTelegramDuplicate("driver");
    metrics.recordDispatchRequest();
    metrics.recordDispatchOffersSent(3);
    metrics.recordDispatchOfferAccepted();
    metrics.recordDispatchOfferTimedOut(2);
    metrics.recordDispatchNoDriver();
    metrics.recordWorkerRun("expire-offers:city", "success", 80, new Date("2026-08-13T00:00:00Z"));
    metrics.recordWorkerRun("expire-offers:city", "skipped_locked_elsewhere", 1, new Date());
    metrics.recordPaymentCreated();
    metrics.recordPaymentConfirmed();
    metrics.recordPaymentFailure();
    metrics.recordPaymentWebhookDuplicate();
    metrics.setDatabaseGauges({
      searchingOrders: 4,
      availableDrivers: 7,
      expiredSubscriptionsToday: 2,
      lastSuccessfulBackupTimestampSeconds: 1234,
      queues: [
        {
          queue: "notification_outbox",
          depth: 12,
          oldestDueAgeSeconds: 45,
          deadInWindow: 3,
          claimed: 2,
        },
        {
          queue: "telegram_update_jobs",
          depth: 0,
          oldestDueAgeSeconds: 0,
          deadInWindow: 0,
          claimed: 0,
        },
      ],
    });

    const text = metrics.registry.render();
    expect(isPrometheusText(text)).toBe(true);
    expect(
      metricValue(
        text,
        "waslah_telegram_webhook_updates_total",
        '{bot="driver",outcome="handled"}',
      ),
    ).toBe(1);
    expect(metricValue(text, "waslah_telegram_webhook_failures_total", '{bot="rider"}')).toBe(1);
    expect(metricValue(text, "waslah_dispatch_offers_sent_total")).toBe(3);
    expect(
      metricValue(
        text,
        "waslah_worker_executions_total",
        '{job="expire-offers:city",outcome="success"}',
      ),
    ).toBe(1);
    expect(
      metricValue(
        text,
        "waslah_worker_last_success_timestamp_seconds",
        '{job="expire-offers:city"}',
      ),
    ).toBe(1_786_579_200);
    expect(metricValue(text, "waslah_orders_searching")).toBe(4);
    expect(text).toContain("waslah_telegram_webhook_duration_seconds_bucket");
  });
});

describe("حراسة مسار المقاييس", () => {
  it("ترفض الغياب والخطأ وتسمح للسر الصحيح فقط", async () => {
    const metrics = createOperationalMetrics();
    metrics.recordDispatchRequest();
    const app = createMetricsRoutes({ metrics, metricsToken: "metrics-test-token" });

    const denied = await app.fetch(new Request("http://localhost/metrics"));
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain("waslah_");

    const wrong = await app.fetch(
      new Request("http://localhost/metrics", { headers: { "x-metrics-token": "wrong" } }),
    );
    expect(wrong.status).toBe(401);

    const accepted = await app.fetch(
      new Request("http://localhost/metrics", {
        headers: { "x-metrics-token": "metrics-test-token" },
      }),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    expect(await accepted.text()).toContain("waslah_dispatch_requests_total 1");
  });

  it("المقارنة لا تتأثر بطول المدخل أو موضع الاختلاف", () => {
    expect(metricsSecretsMatch("same", "same")).toBe(true);
    expect(metricsSecretsMatch("same", "different")).toBe(false);
    expect(metricsSecretsMatch("", "different")).toBe(false);
  });
});
