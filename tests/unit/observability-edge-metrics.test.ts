/**
 * الغرض: `F8-02` — إثباتُ **حدودِ الوسومِ** و**قراءةِ الذاكرةِ** و**تسجيلِ الحافةِ**
 *   على المُسجِّلِ الحقيقيِّ: أنَّ معرِّفاً في المسارِ لا يصيرُ سلسلةً، وأنَّ الخطأَ
 *   يُعَدُّ مرّةً واحدةً، وأنَّ الغيابَ يُنشَرُ صفرَ عدٍّ لا صفرَ زمنٍ.
 * الحالة: منفّذ فعلياً — اختبارُ وحدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`
 * يُتوقع أن يستخدمه لاحقاً: `F8-07` عندَ ربطِ التنبيهاتِ بهذه العائلاتِ.
 * الحاكم: docs/adr/0131-a-published-metric-is-a-contract-not-a-comment.md
 */

import { describe, expect, it } from "bun:test";
import {
  createOperationalMetrics,
  MAX_ROUTE_SEGMENTS,
  methodLabel,
  ROUTE_LABEL_UNKNOWN,
  readProcessMemory,
  routeLabel,
  statusClass,
} from "../../packages/infrastructure/observability/index.ts";

describe("F8-02 · تطبيعُ وسمِ المسارِ", () => {
  it("يقبلُ القالبَ المُعرَّفَ بوسائطِه كما هوَ", () => {
    expect(routeLabel("/v1/driver/offers/:offerId/accept")).toBe(
      "/v1/driver/offers/:offerId/accept",
    );
    expect(routeLabel("/healthz")).toBe("/healthz");
    expect(routeLabel("/")).toBe("/");
  });

  it("يرفضُ الجامعَ والفارغَ وغيرَ المُعرَّفِ إلى وسمٍ واحدٍ لا ينمو", () => {
    for (const input of ["*", "/v1/*", "", "   ", "v1/rides", undefined, null]) {
      expect(routeLabel(input)).toBe(ROUTE_LABEL_UNKNOWN);
    }
  });

  it("يرفضُ ما تجاوزَ حدَّ المقاطعِ أو حدَّ الطولِ — لا وسمَ يُصنَعُ من رأسٍ طويلٍ", () => {
    const deep = `/${Array.from({ length: MAX_ROUTE_SEGMENTS + 1 }, () => "a").join("/")}`;
    expect(routeLabel(deep)).toBe(ROUTE_LABEL_UNKNOWN);
    expect(routeLabel(`/${"a".repeat(200)}`)).toBe(ROUTE_LABEL_UNKNOWN);
  });

  it("يُطبِّعُ الطريقةَ ويرفضُ ما لم يُعلَنْ", () => {
    expect(methodLabel("get")).toBe("GET");
    expect(methodLabel("PROPFIND")).toBe(ROUTE_LABEL_UNKNOWN);
  });

  it("يُصنِّفُ الحالةَ في خمسٍ ويجعلُ ما خرجَ عن المدى `unknown`", () => {
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(404)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
    expect(statusClass(0)).toBe("unknown");
    expect(statusClass(Number.NaN)).toBe("unknown");
  });
});

describe("F8-02 · تسجيلُ الحافةِ على المُسجِّلِ الحقيقيِّ", () => {
  it("يعُدُّ الطلبَ ويقيسُ زمنَه ولا يعُدُّ خطأً لردٍّ ناجحٍ", () => {
    const metrics = createOperationalMetrics();
    metrics.recordHttpRequest("GET", "/v1/rides/:rideId", 200, 120);
    const text = metrics.registry.render();
    expect(text).toContain(
      'waslah_http_requests_total{route="/v1/rides/:rideId",method="GET",status_class="2xx"} 1',
    );
    expect(text).toContain(
      'waslah_http_request_duration_seconds_count{route="/v1/rides/:rideId",method="GET"} 1',
    );
    expect(text).not.toContain("waslah_http_errors_total{");
  });

  it("**لا يُخرِجُ معرِّفاً إلى وسمٍ** حتى لو مُرِّرَ مسارٌ خامٌّ", () => {
    const metrics = createOperationalMetrics();
    metrics.recordHttpRequest("GET", "/v1/rides/8f2c1b90-0000-4000-8000-000000000001", 200, 5);
    const text = metrics.registry.render();
    expect(text).not.toContain("8f2c1b90");
    expect(text).toContain('route="other"');
  });

  it("يعُدُّ خطأَ الخمسِمئةِ في العدَّادَينِ: المعدَّلُ والأخطاءُ من مصدرٍ واحدٍ", () => {
    const metrics = createOperationalMetrics();
    metrics.recordHttpRequest("POST", "/v1/rides", 500, 3);
    const text = metrics.registry.render();
    expect(text).toContain(
      'waslah_http_requests_total{route="/v1/rides",method="POST",status_class="5xx"} 1',
    );
    expect(text).toContain(
      'waslah_http_errors_total{route="/v1/rides",method="POST",status_class="5xx"} 1',
    );
  });

  it("الاستثناءُ غيرُ الملتقَطِ يُعَدُّ خطأً ولا يُعَدُّ طلباً ناجحاً", () => {
    const metrics = createOperationalMetrics();
    metrics.recordHttpUnhandledError("POST", "/v1/rides");
    const text = metrics.registry.render();
    expect(text).toContain(
      'waslah_http_errors_total{route="/v1/rides",method="POST",status_class="5xx"} 1',
    );
    expect(text).not.toContain('status_class="2xx"');
  });
});

describe("F8-02 · الذاكرةُ والاتصالاتُ وزمنُ الإسنادِ", () => {
  it("يقرأُ الذاكرةَ من واجهةِ المُنفِّذِ ويُطبِّعُ الرقمَ الفاسدَ صفراً لا `NaN`", () => {
    const snapshot = readProcessMemory(
      () =>
        ({
          rss: Number.NaN,
          heapUsed: -1,
          heapTotal: 2048,
          external: 512,
          arrayBuffers: 0,
        }) as NodeJS.MemoryUsage,
      () => 42,
    );
    expect(snapshot).toEqual({
      residentBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 2048,
      externalBytes: 512,
      uptimeSeconds: 42,
    });
  });

  it("ينشرُ الذاكرةَ لحظةَ الضبطِ", () => {
    const metrics = createOperationalMetrics();
    metrics.setProcessGauges({
      residentBytes: 1024,
      heapUsedBytes: 512,
      heapTotalBytes: 2048,
      externalBytes: 8,
      uptimeSeconds: 3,
    });
    const text = metrics.registry.render();
    expect(text).toContain("waslah_process_resident_memory_bytes 1024");
    expect(text).toContain("waslah_process_uptime_seconds 3");
  });

  it("ينشرُ الاتصالاتَ بحالاتِها **ومعَها السقفُ** — رقمٌ بلا حدٍّ لا يُقرأُ", () => {
    const metrics = createOperationalMetrics();
    metrics.setDatabaseGauges({
      searchingOrders: 0,
      availableDrivers: 0,
      expiredSubscriptionsToday: 0,
      lastSuccessfulBackupTimestampSeconds: 0,
      queues: [],
      connections: [
        { state: "active", count: 3 },
        { state: "idle", count: 7 },
      ],
      maxConnections: 100,
      assignment: { matchedInWindow: 0, p50Seconds: 0, p90Seconds: 0, windowSeconds: 300 },
    });
    const text = metrics.registry.render();
    expect(text).toContain('waslah_database_connections{state="active"} 3');
    expect(text).toContain('waslah_database_connections{state="idle"} 7');
    expect(text).toContain("waslah_database_connections_limit 100");
  });

  it("غيابُ الإسنادِ في النافذةِ يُنشَرُ **صفرَ عدٍّ** معَ الزمنِ، فلا يُقرأُ إسناداً فوريّاً", () => {
    const metrics = createOperationalMetrics();
    metrics.setDatabaseGauges({
      searchingOrders: 0,
      availableDrivers: 0,
      expiredSubscriptionsToday: 0,
      lastSuccessfulBackupTimestampSeconds: 0,
      queues: [],
      connections: [],
      maxConnections: 100,
      assignment: { matchedInWindow: 0, p50Seconds: 0, p90Seconds: 0, windowSeconds: 300 },
    });
    const text = metrics.registry.render();
    expect(text).toContain("waslah_orders_matched_in_window 0");
    expect(text).toContain('waslah_order_assignment_seconds{quantile="0.5"} 0');
    expect(text).toContain("waslah_order_assignment_window_seconds 300");
  });

  it("ينشرُ المئينَينِ والنافذةَ معاً عندَ وقوعِ إسنادٍ", () => {
    const metrics = createOperationalMetrics();
    metrics.setDatabaseGauges({
      searchingOrders: 0,
      availableDrivers: 0,
      expiredSubscriptionsToday: 0,
      lastSuccessfulBackupTimestampSeconds: 0,
      queues: [],
      connections: [],
      maxConnections: 100,
      assignment: { matchedInWindow: 12, p50Seconds: 4.5, p90Seconds: 19, windowSeconds: 300 },
    });
    const text = metrics.registry.render();
    expect(text).toContain("waslah_orders_matched_in_window 12");
    expect(text).toContain('waslah_order_assignment_seconds{quantile="0.5"} 4.5');
    expect(text).toContain('waslah_order_assignment_seconds{quantile="0.9"} 19');
  });

  it("**لا عائلةَ لنسبةِ القبولِ**: البسطُ والمقامُ منشورانِ والنسبةُ تُحسَبُ في الاستعلامِ", () => {
    const metrics = createOperationalMetrics();
    metrics.recordDispatchOffersSent(4);
    metrics.recordDispatchOfferAccepted();
    const text = metrics.registry.render();
    expect(text).toContain("waslah_dispatch_offers_sent_total 4");
    expect(text).toContain("waslah_dispatch_offers_accepted_total 1");
    expect(text).not.toContain("acceptance_rate");
  });
});
