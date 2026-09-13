/**
 * الغرض: قياسُ محوّلَي الملخَّصِ والتقييمِ — النداءُ الواحدُ وترتيبُ وسائطِه،
 *   وتحويلُ الحمولةِ، وحفظُ العَدَمِ عَدَماً، وتصنيفُ الرفضِ، وإعلانُ العطبِ
 *   (البند `F2-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ بمحرِّكٍ مُصنَّعٍ: المقيسُ ههنا **شكلُ النداءِ وتحويلُ الحمولةِ**
 * لا سلوكُ PostgreSQL. وترتيبُ الوسائطِ خاصّةً يستحقُّ قياساً: خطأٌ فيه يُرسِلُ
 * معرّفَ الطلبِ مكانَ معرّفِ الراكبِ فيسقطُ التحويلُ في القاعدةِ — أو الأسوأُ،
 * يُقيَّمُ طلبٌ باسمِ غيرِ صاحبِه.
 *
 * وما لا يفعلُه عن قصدٍ: لا يزعمُ أنَّ الدالّتَينِ في القاعدةِ تفعلانِ ما تقولُه
 * هذه الحمولاتُ المصنوعةُ — ذاكَ أثرٌ يُقاسُ في `tests/integration/ride-summary.test.ts`
 * على قاعدةٍ حقيقيّةٍ بساعتِها وقيودِها.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createRideRatingCommand,
  createRideSummaryReader,
} from "../../packages/infrastructure/transport/ride-summary-store.ts";

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const RATING_ID = "6b2d4e10-9c33-4a77-8f01-2d5e7a9b1c33";

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

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    order_id: ORDER_ID,
    status: "completed",
    service: "transport",
    pickup_label: "البلد",
    dropoff_label: null,
    created_at: "2027-03-01T09:00:00.000Z",
    matched_at: "2027-03-01T09:01:30.000Z",
    started_at: "2027-03-01T09:04:00.000Z",
    completed_at: "2027-03-01T09:16:34.000Z",
    duration_seconds: 754,
    straight_line_meters: "4210.5",
    driver: {
      first_name: "خالد",
      vehicle_type: "سيدان",
      plate_number: "ABC 1234",
      rating_average: "4.70",
      rating_count: 31,
    },
    rating: { already_rated: false, window_hours: 48, window_closed: false, can_rate: true },
    ...overrides,
  };
}

describe("قارئُ الملخَّصِ — النداءُ", () => {
  it("نداءٌ واحدٌ بمعرِّفِ الراكبِ ثمَّ معرِّفِ الطلبِ", async () => {
    const { sql, calls } = fakeSql(summary());
    await createRideSummaryReader(sql).read({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("select completed_ride_summary($1, $2) as result");
    expect(calls[0]?.values).toEqual(["5550001", ORDER_ID]);
  });

  it("معرِّفٌ غيرُ رقميٍّ **لا يُرسَلُ إلى القاعدةِ أصلاً**", async () => {
    const { sql, calls } = fakeSql(summary());
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001; drop table users",
      orderId: ORDER_ID,
    });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("USER_NOT_FOUND");
  });
});

describe("قارئُ الملخَّصِ — تحويلُ الحمولةِ", () => {
  it("الأختامُ الأربعةُ والمدّةُ والوترُ وبطاقةُ السائقِ تُقرأُ كما نُشِرَت", async () => {
    const { sql } = fakeSql(summary());
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.found) throw new Error("قراءةٌ فاشلةٌ");
    const state = result.value.state;
    expect(state.orderId).toBe(ORDER_ID);
    expect(state.status).toBe("completed");
    expect(state.createdAtMs).toBe(Date.parse("2027-03-01T09:00:00.000Z"));
    expect(state.matchedAtMs).toBe(Date.parse("2027-03-01T09:01:30.000Z"));
    expect(state.startedAtMs).toBe(Date.parse("2027-03-01T09:04:00.000Z"));
    expect(state.completedAtMs).toBe(Date.parse("2027-03-01T09:16:34.000Z"));
    expect(state.durationSeconds).toBe(754);
    // `numeric` قد يُنشَرَ نصّاً — يُقرأُ رقماً ولا يُفترَضُ نوعُه.
    expect(state.straightLineMeters).toBe(4210.5);
    expect(state.driver).toEqual({
      firstName: "خالد",
      vehicleType: "سيدان",
      plateNumber: "ABC 1234",
      ratingAverage: 4.7,
      ratingCount: 31,
    });
    expect(state.rating).toEqual({
      alreadyRated: false,
      windowHours: 48,
      windowClosed: false,
      canRate: true,
    });
  });

  it("**بطاقةُ السائقِ بلا موضعٍ ولا هاتفٍ**: الرحلةُ انتهَت", async () => {
    const { sql } = fakeSql(
      summary({
        driver: {
          first_name: "خالد",
          vehicle_type: "سيدان",
          plate_number: "ABC 1234",
          rating_average: null,
          rating_count: 0,
          position: { lat: 21.49, lng: 39.19 },
          phone: "+966500000000",
        },
      }),
    );
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!result.ok || !result.value.found) throw new Error("قراءةٌ فاشلةٌ");
    expect(Object.keys(result.value.state.driver ?? {}).sort()).toEqual([
      "firstName",
      "plateNumber",
      "ratingAverage",
      "ratingCount",
      "vehicleType",
    ]);
    // لا تقييمَ بعدُ ⇒ عَدَمٌ، **ولا يُستبدَلُ بصفرٍ يُقرأُ «سائقٌ سيّئٌ»**.
    expect(result.value.state.driver?.ratingAverage).toBeNull();
  });

  it("العَدَمُ يُنقَلُ عَدَماً: ختمٌ ناقصٌ ⇒ مدّةٌ `null`، ولا وجهةَ ⇒ وترٌ `null`", async () => {
    const { sql } = fakeSql(
      summary({ started_at: null, duration_seconds: null, straight_line_meters: null }),
    );
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!result.ok || !result.value.found) throw new Error("قراءةٌ فاشلةٌ");
    expect(result.value.state.startedAtMs).toBeNull();
    expect(result.value.state.durationSeconds).toBeNull();
    expect(result.value.state.straightLineMeters).toBeNull();
  });

  it("لا سائقَ ⇒ `null` ولا بطاقةٌ فارغةٌ تُخترَعُ", async () => {
    const { sql } = fakeSql(summary({ driver: null }));
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!result.ok || !result.value.found) throw new Error("قراءةٌ فاشلةٌ");
    expect(result.value.state.driver).toBeNull();
  });
});

describe("قارئُ الملخَّصِ — الرفضُ والعطبُ", () => {
  it("«لا طلبَ» و«معرِّفٌ فاسدٌ» رفضٌ مقروءٌ لا عطبٌ", async () => {
    for (const code of ["ORDER_NOT_FOUND", "INVALID_ORDER_ID"] as const) {
      const { sql } = fakeSql({ ok: false, error: code });
      const result = await createRideSummaryReader(sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(result.ok).toBe(true);
      if (result.ok && !result.value.found) expect(result.value.refusal).toBe(code);
    }
  });

  it("نقصُ الحسابِ يُعلَنُ بسببِه لا رفضاً", async () => {
    for (const [code, reason] of [
      ["USER_NOT_FOUND", "USER_NOT_FOUND"],
      ["RIDER_NOT_REGISTERED", "RIDER_NOT_REGISTERED"],
    ] as const) {
      const { sql } = fakeSql({ ok: false, error: code });
      const result = await createRideSummaryReader(sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe(reason);
    }
  });

  it("**رمزٌ لا نعرفُه لا يُقرأُ نجاحاً** بل عطباً", async () => {
    const { sql } = fakeSql({ ok: false, error: "A_CODE_FROM_A_LATER_MIGRATION" });
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("STORE_ERROR");
  });

  it("حمولةٌ ناقصةُ حقلٍ ملزمٍ عطبٌ يُعلَنُ لا نصفُ ملخَّصٍ يُعرَضُ", async () => {
    for (const broken of [
      summary({ status: null }),
      summary({ created_at: "ليسَ ختماً" }),
      summary({ rating: { already_rated: false } }),
      summary({ rating: { already_rated: false, window_closed: false, can_rate: true } }),
      null,
    ]) {
      const { sql } = fakeSql(broken);
      const result = await createRideSummaryReader(sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("STORE_ERROR");
    }
  });

  it("سقوطُ الاتصالِ يُعلَنُ عطباً ولا يُبتَلَعُ", async () => {
    const { sql } = fakeSql({ throws: true });
    const result = await createRideSummaryReader(sql).read({
      telegramUserId: "5550001",
      orderId: "ليسَ معرِّفاً",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("STORE_ERROR");
  });
});

describe("أمرُ التقييمِ", () => {
  const accepted = {
    ok: true,
    rating_id: RATING_ID,
    direction: "rider_to_driver",
    stars: 5,
    tags: ["cleanliness", "punctuality"],
  };

  it("نداءٌ واحدٌ بترتيبِ الوسائطِ المُعلَنِ: الطلبُ ثمَّ المُقيِّمُ ثمَّ النجومُ ثمَّ الملاحظةُ ثمَّ الوسومُ", async () => {
    const { sql, calls } = fakeSql(accepted);
    await createRideRatingCommand(sql).submit({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
      stars: 5,
      comment: "شكراً",
      tags: ["cleanliness", "punctuality"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("select submit_rating_with_tags($1, $2, $3, $4, $5) as result");
    expect(calls[0]?.values).toEqual([
      ORDER_ID,
      "5550001",
      5,
      "شكراً",
      ["cleanliness", "punctuality"],
    ]);
  });

  it("**مصفوفةٌ فارغةٌ تُرسَلُ `null`**: الوجهانِ لمعنىً واحدٍ لا يُخزَّنانِ", async () => {
    const { sql, calls } = fakeSql({ ...accepted, tags: [] });
    await createRideRatingCommand(sql).submit({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
      stars: 4,
      comment: null,
      tags: [],
    });
    expect(calls[0]?.values[4]).toBeNull();
    expect(calls[0]?.values[3]).toBeNull();
  });

  it("القبولُ يُقرأُ بمعرِّفِه واتجاهِه ونجومِه ووسومِه", async () => {
    const { sql } = fakeSql(accepted);
    const result = await createRideRatingCommand(sql).submit({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
      stars: 5,
      comment: null,
      tags: ["cleanliness", "punctuality"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.accepted) throw new Error("قبولٌ فاشلٌ");
    expect(result.value.rating).toEqual({
      ratingId: RATING_ID,
      direction: "rider_to_driver",
      stars: 5,
      tags: ["cleanliness", "punctuality"],
    });
  });

  it("وسمٌ خارجَ المُعجَمِ في **قراءةِ** الردِّ يُسقَطُ ولا يُنشَرُ خاماً", async () => {
    const { sql } = fakeSql({ ...accepted, tags: ["cleanliness", "mystery", "cleanliness"] });
    const result = await createRideRatingCommand(sql).submit({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
      stars: 5,
      comment: null,
      tags: ["cleanliness"],
    });
    if (!result.ok || !result.value.accepted) throw new Error("قبولٌ فاشلٌ");
    expect(result.value.rating.tags).toEqual(["cleanliness"]);
  });

  it("رفضاتُ القاعدةِ التسعُ تُقرأُ رفضاً مُصنَّفاً لا عطباً", async () => {
    const codes = [
      "STARS_OUT_OF_RANGE",
      "ORDER_NOT_FOUND",
      "ORDER_NOT_COMPLETED",
      "RATER_NOT_PARTY_TO_ORDER",
      "RATING_WINDOW_CLOSED",
      "ALREADY_RATED",
      "UNKNOWN_RATING_TAG",
      "TOO_MANY_RATING_TAGS",
      "DUPLICATE_RATING_TAG",
    ] as const;
    for (const code of codes) {
      const { sql } = fakeSql({ ok: false, error: code });
      const result = await createRideRatingCommand(sql).submit({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
        stars: 5,
        comment: null,
        tags: [],
      });
      expect(result.ok).toBe(true);
      if (result.ok && !result.value.accepted) expect(result.value.refusal).toBe(code);
    }
  });

  it("«المُقيِّمُ غيرُ موجودٍ» نقصُ حسابٍ لا رفضُ تقييمٍ", async () => {
    const { sql } = fakeSql({ ok: false, error: "RATER_NOT_FOUND" });
    const result = await createRideRatingCommand(sql).submit({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
      stars: 5,
      comment: null,
      tags: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("USER_NOT_FOUND");
  });

  it("رمزُ رفضٍ لا نعرفُه، وقبولٌ ناقصُ حقلٍ: عطبٌ يُعلَنُ", async () => {
    for (const payload of [
      { ok: false, error: "A_CODE_FROM_A_LATER_MIGRATION" },
      { ok: true, rating_id: RATING_ID, direction: null, stars: 5, tags: [] },
      { ok: true, rating_id: null, direction: "rider_to_driver", stars: 5, tags: [] },
      null,
    ]) {
      const { sql } = fakeSql(payload);
      const result = await createRideRatingCommand(sql).submit({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
        stars: 5,
        comment: null,
        tags: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe("STORE_ERROR");
    }
  });
});
