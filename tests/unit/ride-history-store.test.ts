/**
 * الغرض: قياسُ محوّلَي السجلِّ والتفاصيلِ — النداءُ الواحدُ وترتيبُ وسائطِه،
 *   وتحويلُ الحمولةِ، وحفظُ العَدَمِ عَدَماً، وتصنيفُ الرفضِ، وإعلانُ العطبِ
 *   بدلَ عرضِ سجلٍّ ناقصٍ (البند `F2-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ بمحرِّكٍ مُصنَّعٍ: المقيسُ ههنا **شكلُ النداءِ وتحويلُ الحمولةِ**.
 * وترتيبُ الوسائطِ الخمسةِ يستحقُّ قياساً وحدَه: تبديلُ المؤشِّرِ بالحدِّ لا
 * يُسقِطُ بناءً ولا نوعاً، بل يُعطي صفحةً ثانيةً تبدأُ من حيثُ بدأت الأولى —
 * فيقرأُ الراكبُ سجلّاً يُكرِّرُ ويُسقِطُ وهوَ يظنُّه تامّاً.
 *
 * وما لا يفعلُه عن قصدٍ: لا يزعمُ أنَّ الدالّتَينِ في القاعدةِ تفعلانِ ما تقولُه
 * هذه الحمولاتُ المصنوعةُ — ذاكَ أثرٌ يُقاسُ في `tests/integration/ride-history.test.ts`
 * على PostgreSQL حقيقيٍّ بمنطقتِه وفهرسِه وقيودِه.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createRideDetailReader,
  createRideHistoryReader,
} from "../../packages/infrastructure/transport/ride-history-store.ts";

const ORDER_ID = "45a913e0-fc11-4431-84a0-b943debc7ab7";
const OTHER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeSql(result: unknown | { readonly throws: true }): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    if (typeof result === "object" && result !== null && "throws" in result) {
      throw new Error("فشلُ اتصالٍ مُصنَّع");
    }
    return [{ result }];
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: ORDER_ID,
    status: "completed",
    service: "transport",
    pickup_label: "البلد",
    dropoff_label: null,
    created_at: "2026-09-13T21:30:00.000Z",
    completed_at: "2026-09-13T21:46:00.000Z",
    month_key: "2026-09",
    ...overrides,
  };
}

function historyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    month_timezone: "Asia/Riyadh",
    month_timezone_source: "CITY_SETTING",
    query: null,
    limit: 20,
    rides: [historyRow()],
    has_more: false,
    next_cursor: null,
    ...overrides,
  };
}

function detailPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    found: true,
    order_id: ORDER_ID,
    status: "completed",
    service: "transport",
    pickup_label: "البلد",
    dropoff_label: "الجامعة",
    cancelled_reason: null,
    driver: {
      first_name: "خالد",
      vehicle_type: "سيدان",
      plate_number: "ABC 1234",
      rating_average: "4.70",
      rating_count: 31,
    },
    events: [{ kind: "REQUESTED", at: "2026-09-13T21:30:00.000Z", source: "orders.created_at" }],
    ...overrides,
  };
}

const INPUT = { telegramUserId: "200001", query: null, cursor: null, limit: 20 } as const;

describe("قارئُ السجلِّ — نداءٌ واحدٌ وترتيبٌ مُثبَتٌ", () => {
  it("يُنادي الدالّةَ مرّةً واحدةً بخمسِ وسائطَ في ترتيبِها", async () => {
    const { sql, calls } = fakeSql(historyPayload());
    await createRideHistoryReader(sql).read({
      telegramUserId: "200001",
      query: "البلد",
      cursor: { createdAt: "2026-09-13T21:30:00.000Z", id: OTHER_ID },
      limit: 20,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe(
      "select rider_ride_history($1::bigint, $2::text, $3::timestamptz, $4::uuid, $5::integer) as result",
    );
    expect(calls[0]?.values).toEqual(["200001", "البلد", "2026-09-13T21:30:00.000Z", OTHER_ID, 20]);
  });

  it("المعرِّفُ يُمرَّرُ نصّاً — فرقمُ تِلِغرام يتجاوزُ دقّةَ العددِ الآمنِ", async () => {
    const { sql, calls } = fakeSql(historyPayload());
    await createRideHistoryReader(sql).read({ ...INPUT, telegramUserId: "9007199254740993" });
    expect(calls[0]?.values[0]).toBe("9007199254740993");
    expect(typeof calls[0]?.values[0]).toBe("string");
  });

  it("غيابُ المؤشِّرِ يُمرَّرُ عَدَمَينِ لا نصّاً فارغاً", async () => {
    const { sql, calls } = fakeSql(historyPayload());
    await createRideHistoryReader(sql).read(INPUT);
    expect(calls[0]?.values[2]).toBeNull();
    expect(calls[0]?.values[3]).toBeNull();
  });

  it("المعرِّفُ غيرُ الرقميِّ يُرَدُّ قبلَ أيِّ نداءٍ", async () => {
    for (const telegramUserId of ["", "12a", "-1", "1".repeat(20), "1e9"]) {
      const { sql, calls } = fakeSql(historyPayload());
      const outcome = await createRideHistoryReader(sql).read({ ...INPUT, telegramUserId });
      expect(outcome.ok).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("قارئُ السجلِّ — تحويلُ الحمولةِ", () => {
  it("يُحوِّلُ الصفَّ ويحفظُ العَدَمَ عَدَماً", async () => {
    const { sql } = fakeSql(historyPayload({ rides: [historyRow({ completed_at: null })] }));
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    if (!outcome.ok) throw new Error("توقَّعنا نجاحاً");
    if (!outcome.value.ok) throw new Error("توقَّعنا قبولاً");
    const row = outcome.value.page.rides[0];
    expect(row?.orderId).toBe(ORDER_ID);
    expect(row?.monthKey).toBe("2026-09");
    expect(row?.dropoffLabel).toBeNull();
    expect(row?.completedAtMs).toBeNull();
    expect(row?.createdAtMs).toBe(Date.parse("2026-09-13T21:30:00.000Z"));
  });

  it("منطقةُ الشهرِ ومصدرُها يُنقَلانِ كما نطقَت بهما القاعدةُ", async () => {
    const { sql } = fakeSql(
      historyPayload({
        month_timezone: "UTC",
        month_timezone_source: "FALLBACK_UTC_SETTING_ABSENT",
      }),
    );
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    if (!outcome.ok || !outcome.value.ok) throw new Error("توقَّعنا قبولاً");
    expect(outcome.value.page.monthTimezone).toBe("UTC");
    expect(outcome.value.page.monthTimezoneSource).toBe("FALLBACK_UTC_SETTING_ABSENT");
  });

  it("المؤشِّرُ التالي يُقرأُ حينَ هناكَ مزيدٌ", async () => {
    const { sql } = fakeSql(
      historyPayload({
        has_more: true,
        next_cursor: { created_at: "2026-09-13T21:30:00.000Z", id: ORDER_ID },
      }),
    );
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    if (!outcome.ok || !outcome.value.ok) throw new Error("توقَّعنا قبولاً");
    expect(outcome.value.page.hasMore).toBe(true);
    expect(outcome.value.page.nextCursor).toEqual({
      createdAt: "2026-09-13T21:30:00.000Z",
      id: ORDER_ID,
    });
  });

  it("المؤشِّرُ يُطرَحُ حينَ لا مزيدَ — فطريقٌ إلى صفحةٍ غيرِ مُعلَنةٍ كذبٌ", async () => {
    const { sql } = fakeSql(
      historyPayload({
        has_more: false,
        next_cursor: { created_at: "2026-09-13T21:30:00.000Z", id: ORDER_ID },
      }),
    );
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    if (!outcome.ok || !outcome.value.ok) throw new Error("توقَّعنا قبولاً");
    expect(outcome.value.page.nextCursor).toBeNull();
  });

  it("«مزيدٌ» بلا مؤشِّرٍ **عطبٌ** لا صفحةٌ أخيرةٌ", async () => {
    const { sql } = fakeSql(historyPayload({ has_more: true, next_cursor: null }));
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe("STORE_ERROR");
  });

  it("صفٌّ ناقصٌ يُعلَنُ عطباً ولا يُسقَطُ صامتاً", async () => {
    for (const broken of [
      historyRow({ order_id: null }),
      historyRow({ month_key: null }),
      historyRow({ created_at: null }),
      "ليسَ صفّاً",
    ]) {
      const { sql } = fakeSql(historyPayload({ rides: [broken] }));
      const outcome = await createRideHistoryReader(sql).read(INPUT);
      expect(outcome.ok).toBe(false);
    }
  });

  it("سجلٌّ فارغٌ ليسَ عطباً — فراكبٌ بلا رحلاتٍ حالةٌ مشروعةٌ", async () => {
    const { sql } = fakeSql(historyPayload({ rides: [] }));
    const outcome = await createRideHistoryReader(sql).read(INPUT);
    if (!outcome.ok || !outcome.value.ok) throw new Error("توقَّعنا قبولاً");
    expect(outcome.value.page.rides).toEqual([]);
  });
});

describe("قارئُ السجلِّ — تصنيفُ الرفضِ والعطبِ", () => {
  it("كلُّ رمزٍ في مكانِه: رفضٌ يُعرَضُ، وعطبٌ يُعلَنُ", async () => {
    const cases: readonly [string, "refusal" | "failure", string][] = [
      ["INVALID_LIMIT", "refusal", "INVALID_PAGE_SIZE"],
      ["INVALID_CURSOR", "refusal", "INVALID_CURSOR"],
      ["USER_NOT_FOUND", "failure", "USER_NOT_FOUND"],
      ["RIDER_NOT_REGISTERED", "failure", "RIDER_NOT_REGISTERED"],
      ["رمزٌ لم يُعرَفْ بعدُ", "failure", "STORE_ERROR"],
    ];
    for (const [code, shape, expected] of cases) {
      const { sql } = fakeSql({ ok: false, error: code });
      const outcome = await createRideHistoryReader(sql).read(INPUT);
      if (shape === "refusal") {
        if (!outcome.ok || outcome.value.ok) throw new Error(`توقَّعنا رفضاً لـ${code}`);
        expect(outcome.value.refusal).toBe(expected as never);
      } else {
        if (outcome.ok) throw new Error(`توقَّعنا عطباً لـ${code}`);
        expect(outcome.error.reason).toBe(expected as never);
      }
    }
  });

  it("سقوطُ الاتصالِ والحمولةُ العَدَمُ يُعلَنانِ عطباً", async () => {
    const thrown = fakeSql({ throws: true } as const);
    expect((await createRideHistoryReader(thrown.sql).read(INPUT)).ok).toBe(false);
    const empty = fakeSql(null);
    expect((await createRideHistoryReader(empty.sql).read(INPUT)).ok).toBe(false);
  });
});

describe("قارئُ التفاصيلِ", () => {
  it("يُنادي الدالّةَ مرّةً بوسيطَينِ: الراكبُ ثمَّ الطلبُ", async () => {
    const { sql, calls } = fakeSql(detailPayload());
    await createRideDetailReader(sql).read({ telegramUserId: "200001", orderId: ORDER_ID });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("select rider_ride_detail($1, $2) as result");
    expect(calls[0]?.values).toEqual(["200001", ORDER_ID]);
  });

  it("يُحوِّلُ الحالةَ والسائقَ والأحداثَ", async () => {
    const { sql } = fakeSql(detailPayload());
    const outcome = await createRideDetailReader(sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("توقَّعنا وجداناً");
    expect(outcome.value.state.driver?.firstName).toBe("خالد");
    expect(outcome.value.state.driver?.ratingAverage).toBe(4.7);
    expect(outcome.value.state.events[0]).toEqual({
      kind: "REQUESTED",
      rawKind: "REQUESTED",
      atMs: Date.parse("2026-09-13T21:30:00.000Z"),
      source: "orders.created_at",
      detail: {},
    });
  });

  it("حدثٌ بلا ختمٍ يُنقَلُ عَدَماً لا لحظةَ صفرٍ", async () => {
    const { sql } = fakeSql(
      detailPayload({
        events: [{ kind: "CANCELLED", at: null, source: "UNRECORDED" }],
      }),
    );
    const outcome = await createRideDetailReader(sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("توقَّعنا وجداناً");
    expect(outcome.value.state.events[0]?.atMs).toBeNull();
    expect(outcome.value.state.events[0]?.source).toBe("UNRECORDED");
  });

  it("نوعُ حدثٍ مجهولٌ يُنقَلُ خامّاً ولا يُسقَطُ", async () => {
    const { sql } = fakeSql(
      detailPayload({ events: [{ kind: "TELEPORTED", at: null, source: "orders.created_at" }] }),
    );
    const outcome = await createRideDetailReader(sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("توقَّعنا وجداناً");
    expect(outcome.value.state.events[0]?.kind).toBe("UNKNOWN");
    expect(outcome.value.state.events[0]?.rawKind).toBe("TELEPORTED");
  });

  it("سجلٌّ بلا حدثٍ **عطبٌ**: لكلِّ رحلةٍ لحظةُ طلبٍ", async () => {
    const { sql } = fakeSql(detailPayload({ events: [] }));
    const outcome = await createRideDetailReader(sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
  });

  it("السائقُ الغائبُ عَدَمٌ — ورحلةٌ لم تُطابَقْ بلا سائقٍ حالةٌ مشروعةٌ", async () => {
    const { sql } = fakeSql(detailPayload({ driver: null, status: "searching" }));
    const outcome = await createRideDetailReader(sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("توقَّعنا وجداناً");
    expect(outcome.value.state.driver).toBeNull();
  });

  it("الطلبُ غيرُ الموجودِ وغيرُ الصالحِ رفضانِ مفصولانِ لا عطبٌ واحدٌ", async () => {
    const missing = fakeSql({ ok: true, found: false, refusal: "ORDER_NOT_FOUND" });
    const one = await createRideDetailReader(missing.sql).read({
      telegramUserId: "200001",
      orderId: ORDER_ID,
    });
    if (!one.ok || one.value.found) throw new Error("توقَّعنا رفضاً");
    expect(one.value.refusal).toBe("ORDER_NOT_FOUND");

    const invalid = fakeSql({ ok: false, error: "INVALID_ORDER_ID" });
    const two = await createRideDetailReader(invalid.sql).read({
      telegramUserId: "200001",
      orderId: "ليسَ معرِّفاً",
    });
    if (!two.ok || two.value.found) throw new Error("توقَّعنا رفضاً");
    expect(two.value.refusal).toBe("INVALID_ORDER_ID");
  });

  it("الراكبُ المجهولُ وغيرُ المسجَّلِ عطبانِ مُصنَّفانِ", async () => {
    for (const code of ["USER_NOT_FOUND", "RIDER_NOT_REGISTERED"]) {
      const { sql } = fakeSql({ ok: false, error: code });
      const outcome = await createRideDetailReader(sql).read({
        telegramUserId: "200001",
        orderId: ORDER_ID,
      });
      if (outcome.ok) throw new Error("توقَّعنا عطباً");
      expect(outcome.error.reason).toBe(code as never);
    }
  });
});
