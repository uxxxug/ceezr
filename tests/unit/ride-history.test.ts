/**
 * الغرض: قياسُ نطاقِ السجلِّ ونموذجِ عرضِه — حدودُ الصفحةِ والبحثِ، وثقةُ منطقةِ
 *   الشهرِ، وطيُّ المجموعاتِ، وتصنيفُ المآلِ، وصياغةُ اللحظةِ بمنطقةٍ مُسمَّاةٍ
 *   (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ هذا نقيّاً: هذه الدوالُّ **لا تلمسُ شبكةً ولا قاعدةً**، فحكمُها
 * يُقاسُ بمدخلاتٍ مصنوعةٍ ويُثبَتُ على حدودِه لا على مسارِه السعيدِ. والحدُّ
 * ههنا هوَ موضعُ الكذبِ: صفحةٌ تُقصَرُ صامتةً، ولحظةٌ تُصاغُ بساعةِ الجهازِ.
 *
 * وما لا يفعلُه عن قصدٍ: لا يزعمُ أنَّ القاعدةَ تُرسِلُ ما تُرسِلُه هذه
 * الحمولاتُ المصنوعةُ — ذاكَ أثرٌ يُقاسُ في `tests/integration/ride-history.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  detailRefusalKey,
  eventLabel,
  eventSourceKey,
  historyErrorKey,
  historyRefusalKey,
  instantParts,
  monthHeading,
  monthNameKey,
  outcomeKey,
  serviceKey,
  showsTimezoneNotice,
  statusLabel,
  timezoneTrustKey,
} from "../../apps/miniapp/src/surfaces/rider/history/ride-history-view.ts";
import {
  DEFAULT_RIDE_HISTORY_PAGE_SIZE,
  groupRidesByMonth,
  isRideEventKind,
  MAX_RIDE_HISTORY_PAGE_SIZE,
  MAX_RIDE_HISTORY_QUERY_LENGTH,
  monthTimezoneTrustOf,
  type RideHistoryRow,
  readRideHistoryPageSize,
  readRideHistoryQuery,
  rideOutcomeClassOf,
} from "../../packages/domain/transport/ride-history.ts";

function ride(monthKey: string, orderId: string): RideHistoryRow {
  return {
    orderId,
    status: "completed",
    service: "transport",
    pickupLabel: "البلد",
    dropoffLabel: null,
    createdAtMs: 1_770_000_000_000,
    completedAtMs: 1_770_000_900_000,
    monthKey,
  };
}

describe("حجمُ الصفحةِ — يُرَدُّ ولا يُقصَرُ", () => {
  it("الغيابُ يُعطي الافتراضَ", () => {
    for (const value of [undefined, null, ""]) {
      expect(readRideHistoryPageSize(value)).toEqual({
        accepted: true,
        limit: DEFAULT_RIDE_HISTORY_PAGE_SIZE,
      });
    }
  });

  it("الحدُّ الأعلى مقبولٌ وما فوقَه مردودٌ — لا مقصورٌ", () => {
    expect(readRideHistoryPageSize(MAX_RIDE_HISTORY_PAGE_SIZE)).toEqual({
      accepted: true,
      limit: MAX_RIDE_HISTORY_PAGE_SIZE,
    });
    expect(readRideHistoryPageSize(MAX_RIDE_HISTORY_PAGE_SIZE + 1)).toEqual({
      accepted: false,
      refusal: "INVALID_PAGE_SIZE",
    });
  });

  it("الصفرُ والسالبُ والكسرُ والنصُّ مردودةٌ", () => {
    for (const value of [0, -1, 2.5, "كثيراً", "20.5", Number.NaN]) {
      expect(readRideHistoryPageSize(value).accepted).toBe(false);
    }
  });

  it("النصُّ الرقميُّ مقبولٌ — فمُعامِلُ الاستعلامِ نصٌّ دائماً", () => {
    expect(readRideHistoryPageSize("20")).toEqual({ accepted: true, limit: 20 });
  });
});

describe("نصُّ البحثِ — الفراغُ ليسَ بحثاً", () => {
  it("الغيابُ والفراغُ يُطبَّعانِ إلى لا شيءٍ", () => {
    expect(readRideHistoryQuery(undefined)).toEqual({ accepted: true, query: null });
    expect(readRideHistoryQuery("   ")).toEqual({ accepted: true, query: null });
  });

  it("الطولُ يُقاسُ بعدَ التشذيبِ", () => {
    const padded = `  ${"م".repeat(MAX_RIDE_HISTORY_QUERY_LENGTH)}  `;
    expect(readRideHistoryQuery(padded).accepted).toBe(true);
    expect(readRideHistoryQuery("م".repeat(MAX_RIDE_HISTORY_QUERY_LENGTH + 1))).toEqual({
      accepted: false,
      refusal: "QUERY_TOO_LONG",
    });
  });

  it("المُشذَّبُ هوَ ما يُرسَلُ لا الخامُّ", () => {
    expect(readRideHistoryQuery("  البلد  ")).toEqual({ accepted: true, query: "البلد" });
  });
});

describe("ثقةُ منطقةِ الشهرِ", () => {
  it("إعدادُ المدينةِ وحدَه مُعلَنٌ، وكلُّ سواه سقوطٌ", () => {
    expect(monthTimezoneTrustOf("CITY_SETTING")).toBe("DECLARED");
    for (const source of [
      "FALLBACK_UTC_SETTING_ABSENT",
      "FALLBACK_UTC_SETTING_UNKNOWN",
      "مصدرٌ لم يُعرَفْ بعدُ",
      "",
    ]) {
      expect(monthTimezoneTrustOf(source)).toBe("FALLBACK");
    }
  });

  it("الإشعارُ يُعرَضُ للسقوطِ وحدَه", () => {
    expect(showsTimezoneNotice("DECLARED")).toBe(false);
    expect(showsTimezoneNotice("FALLBACK")).toBe(true);
    expect(timezoneTrustKey("DECLARED")).toBe("rider.history.timezone.declared");
    expect(timezoneTrustKey("FALLBACK")).toBe("rider.history.timezone.fallback");
  });
});

describe("طيُّ المجموعاتِ — متتابعٌ لا متباعدٌ", () => {
  it("يطوي المتتابعَ ويحفظُ الترتيبَ", () => {
    const groups = groupRidesByMonth([
      ride("2026-09", "a"),
      ride("2026-09", "b"),
      ride("2026-08", "c"),
    ]);
    expect(groups.map((group) => group.monthKey)).toEqual(["2026-09", "2026-08"]);
    expect(groups[0]?.rides.map((row) => row.orderId)).toEqual(["a", "b"]);
  });

  it("لا يدمجُ متباعداً ولا يُعيدُ فرزاً — فالترتيبُ حكمُ القاعدةِ", () => {
    const groups = groupRidesByMonth([
      ride("2026-09", "a"),
      ride("2026-08", "b"),
      ride("2026-09", "c"),
    ]);
    expect(groups.map((group) => group.monthKey)).toEqual(["2026-09", "2026-08", "2026-09"]);
  });

  it("الفراغُ يُعطي فراغاً لا مجموعةً بلا صفوفٍ", () => {
    expect(groupRidesByMonth([])).toEqual([]);
  });
});

describe("تصنيفُ المآلِ — ثلاثُ نتائجَ لا اثنتانِ", () => {
  it("الجاريةُ ليست منتهيةً", () => {
    for (const status of ["searching", "matched", "in_progress"]) {
      expect(rideOutcomeClassOf(status)).toBe("IN_FLIGHT");
    }
  });

  it("المنتهيةُ وغيرُ المتمَّةِ مفصولتانِ", () => {
    expect(rideOutcomeClassOf("completed")).toBe("COMPLETED");
    expect(rideOutcomeClassOf("cancelled")).toBe("NOT_COMPLETED");
    expect(rideOutcomeClassOf("failed")).toBe("NOT_COMPLETED");
  });

  it("المجهولةُ تُصنَّفُ سواها ولا تُطوى في «انتهت»", () => {
    expect(rideOutcomeClassOf("expired")).toBe("OTHER");
    expect(outcomeKey("OTHER")).toBe("rider.history.outcome.other");
  });

  it("الحالةُ المجهولةُ تُعرَضُ خامّاً بمفتاحٍ مُعلَنٍ", () => {
    expect(statusLabel("completed")).toEqual({
      known: true,
      key: "rider.history.status.completed",
    });
    expect(statusLabel("expired")).toEqual({
      known: false,
      key: "rider.history.status.raw",
      raw: "expired",
    });
  });
});

describe("عنوانُ الشهرِ", () => {
  it("يُفكَّكُ المفتاحُ إلى سنةٍ وشهرٍ", () => {
    expect(monthHeading("2026-09")).toEqual({
      known: true,
      key: "rider.history.month.heading",
      year: 2026,
      month: 9,
    });
    expect(monthNameKey(9)).toBe("rider.history.monthName.9");
  });

  it("المفتاحُ المعطوبُ يُعرَضُ خامّاً ولا يُخمَّنُ", () => {
    for (const key of ["2026-13", "غيرُ مفتاحٍ", "2026-00", "2026-9"]) {
      expect(monthHeading(key).known).toBe(false);
    }
  });
});

describe("صياغةُ اللحظةِ — بمنطقةٍ مُسمَّاةٍ لا بساعةِ الجهازِ", () => {
  it("المنطقةُ المُسمَّاةُ تُغيِّرُ اليومَ لا الساعةَ وحدَها", () => {
    const utc = instantParts("2026-09-13T21:30:00.000Z", "UTC");
    const riyadh = instantParts("2026-09-13T21:30:00.000Z", "Asia/Riyadh");
    expect(utc).toEqual({ year: 2026, month: 9, day: 13, hour: 21, minute: 30 });
    expect(riyadh).toEqual({ year: 2026, month: 9, day: 14, hour: 0, minute: 30 });
  });

  it("منتصفُ الليلِ يُطوى إلى صفرٍ لا إلى أربعٍ وعشرينَ", () => {
    expect(instantParts("2026-09-13T21:00:00.000Z", "Asia/Riyadh")?.hour).toBe(0);
  });

  it("المنطقةُ المجهولةُ تُعطي عدماً — **ولا تسقطُ إلى ساعةِ الجهازِ**", () => {
    expect(instantParts("2026-09-13T21:30:00.000Z", "Mars/Olympus")).toBeNull();
  });

  it("اللحظةُ المعطوبةُ تُعطي عدماً", () => {
    expect(instantParts("ليست لحظةً", "UTC")).toBeNull();
  });
});

describe("مفاتيحُ الأحداثِ والخدمةِ والرفضِ", () => {
  it("النوعُ المعروفُ يُترجَمُ والمجهولُ يُعرَضُ خامّاً", () => {
    expect(isRideEventKind("REQUESTED")).toBe(true);
    expect(isRideEventKind("TELEPORTED")).toBe(false);
    expect(eventLabel({ kind: "REQUESTED", rawKind: "REQUESTED" })).toEqual({
      known: true,
      key: "rider.history.event.requested",
    });
    expect(eventLabel({ kind: "UNKNOWN", rawKind: "TELEPORTED" })).toEqual({
      known: false,
      key: "rider.history.event.raw",
      raw: "TELEPORTED",
    });
  });

  it("مصدرُ الحدثِ مُسمًّى — فالمراجعةُ تحتاجُ أن تعرفَ من كتبَ الأثرَ", () => {
    for (const column of ["created_at", "matched_at", "started_at", "completed_at"]) {
      expect(eventSourceKey(`orders.${column}`)).toBe("rider.history.eventSource.orderStamp");
    }
    expect(eventSourceKey("audit_log")).toBe("rider.history.eventSource.auditLog");
    expect(eventSourceKey("UNRECORDED")).toBe("rider.history.eventSource.unrecorded");
    expect(eventSourceKey("مصدرٌ جديدٌ")).toBe("rider.history.eventSource.other");
  });

  it("الخدمةُ المجهولةُ لها مفتاحُها ولا تُنسَبُ إلى رحلةٍ", () => {
    expect(serviceKey("transport")).toBe("rider.history.service.ride");
    expect(serviceKey("delivery")).toBe("rider.history.service.delivery");
    expect(serviceKey("خدمةٌ جديدةٌ")).toBe("rider.history.service.other");
  });

  it("كلُّ رفضٍ مُسمًّى، والمجهولُ لا يُطوى في المعروفِ", () => {
    expect(historyRefusalKey("INVALID_PAGE_SIZE")).toBe("rider.history.refusal.pageSize");
    expect(historyRefusalKey("INVALID_CURSOR")).toBe("rider.history.refusal.cursor");
    expect(historyRefusalKey("رفضٌ جديدٌ")).toBe("rider.history.refusal.unknown");
    expect(detailRefusalKey("ORDER_NOT_FOUND")).toBe("rider.history.detailRefusal.notFound");
    expect(detailRefusalKey("رفضٌ جديدٌ")).toBe("rider.history.detailRefusal.unknown");
  });

  it("عطبُ المخزنِ يُعلَنُ ولا يُعرَضُ قائمةً فارغةً", () => {
    expect(historyErrorKey("SESSION_REQUIRED")).toBe("rider.history.error.session");
    expect(historyErrorKey("STORE_ERROR")).toBe("rider.history.error.unavailable");
  });
});
