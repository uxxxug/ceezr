/**
 * الغرض: إثباتُ أحكامِ نطاقِ لقطةِ مقاييسِ الإدارةِ (`F7-08` · `CAP-011`): المتوسّطُ
 *   يُشتَقُّ من بسطٍ ومقامٍ ولا يُخزَّنُ، وعمرُ المجموعِ عمرُ **أقدمِ** أجزائِه،
 *   والعتبةُ الفاسدةُ تُقرَأُ تقادُماً لا سلامةً.
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: tests/unit
 * يحرسُ: packages/domain/admin/metric-snapshot.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 */

import { describe, expect, it } from "bun:test";
import {
  ADMIN_METRIC_WINDOW_HOURS,
  ageSecondsOf,
  isMetricSource,
  type MetricSnapshotRow,
  metricAverage,
  metricTruthStamp,
  oldestComputedAt,
  sumMetricRows,
} from "../../packages/domain/admin/metric-snapshot.ts";

const OBSERVED = new Date("2026-09-16T12:00:00.000Z");

function row(overrides: Partial<MetricSnapshotRow> = {}): MetricSnapshotRow {
  return {
    cityId: "11111111-1111-1111-1111-111111111111",
    windowHours: ADMIN_METRIC_WINDOW_HOURS,
    computedAt: "2026-09-16T11:59:30.000Z",
    searchingOrders: 0,
    matchedOrders: 0,
    inProgressOrders: 0,
    availableDrivers: 0,
    verifiedDrivers: 0,
    pendingDrivers: 0,
    activeSubscriptions: 0,
    trialSubscriptions: 0,
    openTickets: 0,
    completedOrdersWindow: 0,
    failedOrdersWindow: 0,
    cancelledOrdersWindow: 0,
    matchSecondsSum: 0,
    matchSecondsCount: 0,
    ratingStarsSum: 0,
    ratingCount: 0,
    ...overrides,
  };
}

describe("المتوسّطُ بمقامِه", () => {
  it("مقامٌ صفرٌ يُنتِجُ null لا صفراً — الصفرُ يُقرَأُ «سريعٌ جدّاً»", () => {
    const average = metricAverage(0, 0);
    expect(average.average).toBeNull();
    expect(average.count).toBe(0);
  });

  it("مقامٌ سالبٌ أو غيرُ منتهٍ لا يُقسَمُ عليهِ", () => {
    expect(metricAverage(100, -5).average).toBeNull();
    expect(metricAverage(100, Number.NaN).average).toBeNull();
    expect(metricAverage(Number.POSITIVE_INFINITY, 4).sum).toBe(0);
  });

  it("يشتقُّ المتوسّطَ من البسطِ والمقامِ", () => {
    expect(metricAverage(120, 4).average).toBe(30);
  });
});

describe("جمعُ المدنِ جمعُ بسوطٍ ومقاماتٍ", () => {
  it("**ليسَ متوسّطَ متوسّطاتٍ**: عشرُ مطابقاتٍ بـ٢٠ وألفٌ بـ٦٠ لا تُعطي ٤٠", () => {
    const totals = sumMetricRows([
      row({ matchSecondsSum: 200, matchSecondsCount: 10 }),
      row({ matchSecondsSum: 60_000, matchSecondsCount: 1000 }),
    ]);
    expect(totals.matchSeconds.count).toBe(1010);
    expect(totals.matchSeconds.average).toBeCloseTo(60_200 / 1010, 6);
    expect(totals.matchSeconds.average).not.toBe(40);
  });

  it("مجموعةٌ فارغةٌ تُعطي أصفاراً ومتوسّطاً غائباً لا صفراً", () => {
    const totals = sumMetricRows([]);
    expect(totals.openTickets).toBe(0);
    expect(totals.driverRating.average).toBeNull();
  });

  it("يجمعُ العدَّاداتَ الحيّةَ وعدَّاداتِ النافذةِ معاً", () => {
    const totals = sumMetricRows([
      row({ searchingOrders: 3, completedOrdersWindow: 12 }),
      row({ searchingOrders: 4, completedOrdersWindow: 8 }),
    ]);
    expect(totals.searchingOrders).toBe(7);
    expect(totals.completedOrdersWindow).toBe(20);
  });
});

describe("عمرُ المجموعِ عمرُ أقدمِ أجزائِه", () => {
  it("لقطةٌ حديثةٌ ولقطةٌ قديمةٌ ⇒ يُنشَرُ **القديمُ**", () => {
    const oldest = oldestComputedAt([
      row({ computedAt: "2026-09-16T11:59:58.000Z" }),
      row({ computedAt: "2026-09-16T11:00:00.000Z" }),
    ]);
    expect(oldest).toBe("2026-09-16T11:00:00.000Z");
  });

  it("زمنٌ لا يُقرأُ يُتجاوَزُ ولا يُبتكَرُ بديلُه", () => {
    expect(oldestComputedAt([row({ computedAt: "ليسَ زمناً" })])).toBeNull();
  });
});

describe("حسابُ العمرِ", () => {
  it("انحرافُ ساعةٍ يُنتِجُ مستقبلاً فيُقصَرُ العمرُ على صفرٍ لا سالباً", () => {
    expect(ageSecondsOf("2026-09-16T12:05:00.000Z", OBSERVED)).toBe(0);
  });

  it("يحسبُ الثوانيَ على لحظةِ ملاحظةٍ مُمرَّرةٍ لا على ساعةِ الجهازِ", () => {
    expect(ageSecondsOf("2026-09-16T11:59:00.000Z", OBSERVED)).toBe(60);
  });
});

describe("وَسْمُ الصدقِ", () => {
  it("لا لقطةَ ألبتّةَ ⇒ لا زمنٌ ولا عمرٌ، و`isStale` صحيحٌ", () => {
    const stamp = metricTruthStamp({
      source: "snapshot",
      rows: [],
      observedAt: OBSERVED,
      staleAfterSeconds: 180,
      citiesExpected: 3,
    });
    expect(stamp.computedAt).toBeNull();
    expect(stamp.ageSeconds).toBeNull();
    expect(stamp.isStale).toBe(true);
    expect(stamp.citiesMeasured).toBe(0);
    expect(stamp.citiesExpected).toBe(3);
  });

  it("نقصٌ في المدنِ يُنشَرُ ولا يُخفى وراءَ مجموعٍ يبدو تامّاً", () => {
    const stamp = metricTruthStamp({
      source: "snapshot",
      rows: [row()],
      observedAt: OBSERVED,
      staleAfterSeconds: 180,
      citiesExpected: 4,
    });
    expect(stamp.citiesMeasured).toBe(1);
    expect(stamp.citiesExpected).toBe(4);
    expect(stamp.isStale).toBe(false);
  });

  it("عتبةٌ صفرٌ أو سالبةٌ ⇒ متقادِمٌ: العتبةُ المفقودةُ **لا تُقرأُ سلامةً**", () => {
    for (const threshold of [0, -1, Number.NaN]) {
      const stamp = metricTruthStamp({
        source: "snapshot",
        rows: [row()],
        observedAt: OBSERVED,
        staleAfterSeconds: threshold,
        citiesExpected: 1,
      });
      expect(stamp.isStale).toBe(true);
      expect(stamp.staleAfterSeconds).toBe(0);
    }
  });

  it("عمرٌ يتجاوزُ العتبةَ ⇒ متقادِمٌ، وعمرٌ دونَها ⇒ حديثٌ", () => {
    const fresh = metricTruthStamp({
      source: "snapshot",
      rows: [row({ computedAt: "2026-09-16T11:59:00.000Z" })],
      observedAt: OBSERVED,
      staleAfterSeconds: 180,
      citiesExpected: 1,
    });
    expect(fresh.isStale).toBe(false);
    expect(fresh.ageSeconds).toBe(60);

    const stale = metricTruthStamp({
      source: "snapshot",
      rows: [row({ computedAt: "2026-09-16T11:50:00.000Z" })],
      observedAt: OBSERVED,
      staleAfterSeconds: 180,
      citiesExpected: 1,
    });
    expect(stale.isStale).toBe(true);
    expect(stale.ageSeconds).toBe(600);
  });

  it("مصدرُ الرقمِ محصورٌ في المعروفِ", () => {
    expect(isMetricSource("snapshot")).toBe(true);
    expect(isMetricSource("live")).toBe(true);
    expect(isMetricSource("guess")).toBe(false);
  });
});
