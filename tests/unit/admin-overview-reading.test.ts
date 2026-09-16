/**
 * الغرض: إثباتُ مسارِ قراءةِ لوحةِ النظرةِ العامّةِ (`F7-08` · `CAP-011`): **استعلامٌ
 *   واحدٌ** لا سبعةَ عشرَ، ووَسْمُ صدقٍ يُرافقُ كلَّ عائدٍ، وسقوطٌ إلى المسحِ الحيِّ
 *   **مُعلَنٌ ومُقيَّدٌ بإذنٍ** ولا يقعُ لمجرَّدِ تقادُمٍ.
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: tests/unit
 * يحرسُ: apps/gateway/src/admin/queries.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 */

import { describe, expect, it } from "bun:test";
import { adminOverviewReading, DAY_WINDOW_HOURS } from "../../apps/gateway/src/admin/queries.ts";
import { ADMIN_METRIC_WINDOW_HOURS } from "../../packages/domain/admin/metric-snapshot.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";

const OBSERVED = new Date("2026-09-16T12:00:00.000Z");

interface Recorder {
  readonly sql: Sql;
  readonly calls: string[];
}

/** قاعدةٌ مُزيَّفةٌ تُسجِّلُ **نصَّ كلِّ استعلامٍ** — فعددُ الاستعلاماتِ يُقاسُ لا يُفترَضُ. */
function recorder(responses: readonly unknown[][]): Recorder {
  const calls: string[] = [];
  const sql = ((strings: readonly string[]) => {
    calls.push(strings.join("?"));
    return Promise.resolve(responses[calls.length - 1] ?? []);
  }) as unknown as Sql;
  return { sql, calls };
}

function snapshotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    city_id: "11111111-1111-1111-1111-111111111111",
    code: "MKH",
    name_ar: "مكة",
    is_active: true,
    window_hours: ADMIN_METRIC_WINDOW_HOURS,
    computed_at: "2026-09-16T11:59:30.000Z",
    searching_orders: 3,
    matched_orders: 1,
    in_progress_orders: 2,
    available_drivers: 7,
    verified_drivers: 9,
    pending_drivers: 4,
    active_subscriptions: 5,
    trial_subscriptions: 6,
    open_tickets: 1,
    completed_orders_window: 12,
    failed_orders_window: 0,
    cancelled_orders_window: 1,
    match_seconds_sum: "420.000",
    match_seconds_count: 10,
    rating_stars_sum: "46.000",
    rating_count: 10,
    stale_after_seconds: 180,
    live_fallback: false,
    ...overrides,
  };
}

describe("نافذةُ الحصيلةِ موضِعٌ واحدٌ", () => {
  it("البوابةُ تقرأُ رقمَ النطاقِ نفسَه الذي يكتبُ بهِ العاملُ", () => {
    expect(DAY_WINDOW_HOURS).toBe(ADMIN_METRIC_WINDOW_HOURS);
  });
});

describe("استعلامٌ واحدٌ لا سبعةَ عشرَ", () => {
  it("صفحةٌ كاملةٌ من لقطةٍ = استعلامٌ واحدٌ على `admin_metric_snapshots`", async () => {
    const rec = recorder([[snapshotRow()]]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toContain("admin_metric_snapshots");
    expect(rec.calls[0]).not.toContain("from orders");
    expect(reading.stamp.source).toBe("snapshot");
  });

  it("يجمعُ المدنَ في حصيلةٍ واحدةٍ ويشتقُّ المتوسّطَينِ بعدَ الجمعِ", async () => {
    const rec = recorder([
      [
        snapshotRow(),
        snapshotRow({
          city_id: "22222222-2222-2222-2222-222222222222",
          code: "JED",
          name_ar: "جدة",
          searching_orders: 4,
          match_seconds_sum: "60000.000",
          match_seconds_count: 1000,
          rating_stars_sum: "4000.000",
          rating_count: 1000,
        }),
      ],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(reading.counters.searchingOrders).toBe(7);
    // ٤٢ ثانيةً لعشرٍ و٦٠ لألفٍ: المتوسّطُ ليسَ ٥١ بل مرجَّحٌ بالمقامِ
    expect(reading.counters.averageMatchSeconds).toBeCloseTo(60_420 / 1010, 6);
    expect(reading.cities).toHaveLength(2);
  });
});

describe("وَسْمُ الصدقِ يُرافقُ العائدَ", () => {
  it("عمرُ اللقطةِ يُحسَبُ على لحظةِ الملاحظةِ المُمرَّرةِ", async () => {
    const rec = recorder([[snapshotRow()]]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);
    expect(reading.stamp.ageSeconds).toBe(30);
    expect(reading.stamp.isStale).toBe(false);
  });

  it("عمرُ المجموعِ عمرُ **أقدمِ** مدينةٍ لا أحدثِها", async () => {
    const rec = recorder([
      [
        snapshotRow({ computed_at: "2026-09-16T11:59:58.000Z" }),
        snapshotRow({ code: "JED", computed_at: "2026-09-16T11:00:00.000Z" }),
      ],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);
    expect(reading.stamp.ageSeconds).toBe(3600);
    expect(reading.stamp.isStale).toBe(true);
  });

  it("مدينةٌ بلا لقطةٍ **لم تُقَسْ** ولا تُعرَضُ أصفاراً، والنقصُ يُنشَرُ", async () => {
    const rec = recorder([
      [
        snapshotRow(),
        {
          city_id: "33333333-3333-3333-3333-333333333333",
          code: "RUH",
          name_ar: "الرياض",
          is_active: true,
          window_hours: null,
          computed_at: null,
          stale_after_seconds: 180,
          live_fallback: false,
        },
      ],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(reading.stamp.citiesMeasured).toBe(1);
    expect(reading.stamp.citiesExpected).toBe(2);
    const unmeasured = reading.cities.find((city) => city.code === "RUH");
    expect(unmeasured?.liveOrders).toBeNull();
    expect(unmeasured?.availableDrivers).toBeNull();
    expect(unmeasured?.openTickets).toBeNull();
  });

  it("عتبةٌ غائبةٌ (إعدادٌ محذوفٌ) تُقرأُ تقادُماً لا سلامةً", async () => {
    const rec = recorder([[snapshotRow({ stale_after_seconds: null })]]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);
    expect(reading.stamp.staleAfterSeconds).toBe(0);
    expect(reading.stamp.isStale).toBe(true);
  });
});

describe("السقوطُ إلى المسحِ الحيِّ مُعلَنٌ لا صامتٌ", () => {
  it("لا لقطةَ ولا إذنَ ⇒ **لا مسحَ حيًّا**: استعلامٌ واحدٌ ووَسْمٌ يقولُ عدمَ الإتاحةِ", async () => {
    const rec = recorder([
      [
        {
          city_id: "11111111-1111-1111-1111-111111111111",
          code: "MKH",
          name_ar: "مكة",
          is_active: true,
          window_hours: null,
          computed_at: null,
          stale_after_seconds: 180,
          live_fallback: false,
        },
      ],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(rec.calls).toHaveLength(1);
    expect(reading.stamp.source).toBe("snapshot");
    expect(reading.stamp.computedAt).toBeNull();
    expect(reading.stamp.isStale).toBe(true);
    expect(reading.counters.searchingOrders).toBe(0);
    expect(reading.stamp.citiesMeasured).toBe(0);
  });

  it("لا لقطةَ **معَ** إذنٍ ⇒ مسحٌ حيٌّ موسومٌ `live` لا `snapshot`", async () => {
    const rec = recorder([
      [
        {
          city_id: "11111111-1111-1111-1111-111111111111",
          code: "MKH",
          name_ar: "مكة",
          is_active: true,
          window_hours: null,
          computed_at: null,
          stale_after_seconds: 180,
          live_fallback: true,
        },
      ],
      [
        {
          searching: 3,
          matched: 1,
          in_progress: 2,
          available_drivers: 7,
          verified_drivers: 9,
          pending_drivers: 4,
          active_subscriptions: 5,
          trial_subscriptions: 6,
          open_tickets: 1,
          completed_day: 12,
          failed_day: 0,
          cancelled_day: 1,
          avg_match_seconds: 42,
          avg_driver_rating: 4.6,
        },
      ],
      [
        {
          code: "MKH",
          name_ar: "مكة",
          is_active: true,
          live_orders: 6,
          available_drivers: 7,
          open_tickets: 1,
        },
      ],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(reading.stamp.source).toBe("live");
    expect(reading.stamp.ageSeconds).toBe(0);
    expect(reading.stamp.isStale).toBe(false);
    expect(reading.counters.searchingOrders).toBe(3);
    expect(rec.calls.some((text) => text.includes("from orders"))).toBe(true);
  });

  it("لقطةٌ **متقادِمةٌ** معَ إذنٍ ⇒ تُنشَرُ بعُمرِها ولا يجري مسحٌ ثقيلٌ", async () => {
    const rec = recorder([
      [snapshotRow({ computed_at: "2026-09-16T10:00:00.000Z", live_fallback: true })],
    ]);
    const reading = await adminOverviewReading(rec.sql, DAY_WINDOW_HOURS, OBSERVED);

    expect(rec.calls).toHaveLength(1);
    expect(reading.stamp.source).toBe("snapshot");
    expect(reading.stamp.isStale).toBe(true);
    expect(reading.stamp.ageSeconds).toBe(7200);
  });
});
