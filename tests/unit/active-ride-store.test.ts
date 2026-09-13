/**
 * الغرض: قياسُ محوّلِ قراءةِ الرحلةِ النشطةِ — النداءُ الواحدُ، وتحويلُ الحمولةِ،
 *   وتصنيفُ الرفضِ، وإعلانُ العطبِ (البند `F2-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: tests/unit
 *
 * ولماذا يُقاسُ بمحرِّكٍ مُصنَّعٍ: هذا المِلفُّ حدُّ النظامِ معَ القاعدةِ، والمقيسُ
 * ههنا **شكلُ النداءِ وتحويلُ الحمولةِ** لا سلوكُ PostgreSQL — وذاكَ يُقاسُ في
 * `tests/integration/active-ride.test.ts` على قاعدةٍ حقيقيّةٍ.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

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

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    order_id: ORDER_ID,
    status: "matched",
    service: "transport",
    pickup: { lat: 21.4858, lng: 39.1925, label: "البلد" },
    dropoff: { lat: 21.5433, lng: 39.1728, label: null },
    created_at: "2027-03-01T09:00:00.000Z",
    matched_at: "2027-03-01T09:01:30.000Z",
    started_at: null,
    completed_at: null,
    driver: {
      first_name: "خالد",
      vehicle_type: "سيدان",
      plate_number: "ABC 1234",
      rating_average: "4.70",
      rating_count: 31,
      position: { lat: 21.49, lng: 39.19, age_seconds: 6 },
    },
    ...overrides,
  };
}

describe("نداءُ القاعدةِ", () => {
  // المعرِّفُ يُمرَّرُ نصّاً مُتحقَّقاً منهُ (`^[0-9]{1,19}$`) وتُحوِّلُه القاعدةُ
  // إلى `bigint` عندَ حدِّ المُعامَلِ. ولا يُحوَّلُ ههنا بـ`Number` كي لا يَفقدَ
  // معرِّفٌ فوقَ 2^53 دقّتَه صامتاً.
  it("نداءٌ واحدٌ بدالّةِ اللقطةِ ومُعامَلَينِ: نصٌّ مُتحقَّقٌ ومعرِّفُ طلبٍ", async () => {
    const { sql, calls } = fakeSql(snapshot());
    await createActiveRideReader(sql).read({ telegramUserId: "5550001", orderId: ORDER_ID });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("select active_ride_snapshot($1, $2) as result");
    expect(calls[0]?.values).toEqual(["5550001", ORDER_ID]);
  });

  it("معرِّفُ تلغرامَ ليسَ عدداً يُرفَضُ قبلَ لمسِ القاعدةِ", async () => {
    for (const bad of ["لا-عددَ", "", "12a", "-5", "12345678901234567890"]) {
      const { sql, calls } = fakeSql(snapshot());
      const outcome = await createActiveRideReader(sql).read({
        telegramUserId: bad,
        orderId: ORDER_ID,
      });
      expect(calls).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe("USER_NOT_FOUND");
    }
  });
});

describe("تحويلُ الحمولةِ", () => {
  it("اللقطةُ الكاملةُ تُقرأُ حالةً مُصنَّفةً، و`numeric` نصّاً يُقرأُ عدداً", async () => {
    const { sql } = fakeSql(snapshot());
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.found) throw new Error("انتظرَ الاختبارُ حالةً");
    const state = outcome.value.state;
    expect(state.orderId).toBe(ORDER_ID);
    expect(state.status).toBe("matched");
    expect(state.pickup).toEqual({ lat: 21.4858, lng: 39.1925, label: "البلد" });
    expect(state.dropoff).toEqual({ lat: 21.5433, lng: 39.1728, label: null });
    expect(state.createdAtMs).toBe(Date.parse("2027-03-01T09:00:00.000Z"));
    expect(state.matchedAtMs).toBe(Date.parse("2027-03-01T09:01:30.000Z"));
    expect(state.startedAtMs).toBeNull();
    expect(state.driver?.ratingAverage).toBe(4.7);
    expect(state.driver?.ratingCount).toBe(31);
    expect(state.driver?.position).toEqual({ lat: 21.49, lng: 39.19, ageSeconds: 6 });
  });

  it("سائقٌ غائبٌ يُقرأُ عَدَماً — لا بطاقةً فارغةً", async () => {
    const { sql } = fakeSql(snapshot({ driver: null }));
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("انتظرَ الاختبارُ حالةً");
    expect(outcome.value.state.driver).toBeNull();
  });

  it("موضعٌ بلا ختمٍ يُنقَلُ عُمرُه عَدَماً ولا يُقرأُ صفراً", async () => {
    const { sql } = fakeSql(
      snapshot({
        driver: {
          first_name: null,
          vehicle_type: null,
          plate_number: null,
          rating_average: null,
          rating_count: null,
          position: { lat: 21.49, lng: 39.19, age_seconds: null },
        },
      }),
    );
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("انتظرَ الاختبارُ حالةً");
    expect(outcome.value.state.driver?.position?.ageSeconds).toBeNull();
    expect(outcome.value.state.driver?.ratingCount).toBe(0);
  });

  it("موضعٌ ناقصُ إحداثيّةٍ يُلغى كلُّه: لا نصفَ نقطةٍ تُرسَمُ", async () => {
    const { sql } = fakeSql(
      snapshot({
        driver: {
          first_name: "خالد",
          vehicle_type: null,
          plate_number: null,
          rating_average: null,
          rating_count: 0,
          position: { lat: 21.49, age_seconds: 3 },
        },
      }),
    );
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("انتظرَ الاختبارُ حالةً");
    expect(outcome.value.state.driver?.position).toBeNull();
  });

  it("وجهةٌ غائبةٌ جائزةٌ — عمودُها يقبلُ العَدَمَ", async () => {
    const { sql } = fakeSql(snapshot({ dropoff: null }));
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("انتظرَ الاختبارُ حالةً");
    expect(outcome.value.state.dropoff).toBeNull();
  });
});

describe("تصنيفُ الرفضِ والعطبِ", () => {
  it("«لا طلبَ» رفضٌ مُصنَّفٌ لا عطبٌ — ومِلكيّةُ الغيرِ تُقرأُ كذلكَ", async () => {
    const { sql } = fakeSql({ ok: false, error: "ORDER_NOT_FOUND" });
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toEqual({ found: false, refusal: "ORDER_NOT_FOUND" });
  });

  it("معرِّفٌ ليسَ `uuid` رفضٌ مُصنَّفٌ", async () => {
    const { sql } = fakeSql({ ok: false, error: "INVALID_ORDER_ID" });
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: "لا-معرِّفَ",
    });
    if (outcome.ok) expect(outcome.value).toEqual({ found: false, refusal: "INVALID_ORDER_ID" });
  });

  it("راكبٌ غيرُ مُسجَّلٍ وحسابٌ غائبٌ عطبٌ مُصنَّفٌ لا «لا طلبَ»", async () => {
    for (const [code, reason] of [
      ["USER_NOT_FOUND", "USER_NOT_FOUND"],
      ["RIDER_NOT_REGISTERED", "RIDER_NOT_REGISTERED"],
    ] as const) {
      const { sql } = fakeSql({ ok: false, error: code });
      const outcome = await createActiveRideReader(sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe(reason);
    }
  });

  it("سقوطُ الاتصالِ يُعلَنُ عطباً ولا يُطوى نجاحاً فارغاً", async () => {
    const { sql } = fakeSql({ throws: true });
    const outcome = await createActiveRideReader(sql).read({
      telegramUserId: "5550001",
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe("STORE_ERROR");
  });

  it("حمولةٌ معدومةٌ أو ناقصةُ حقلٍ إلزاميٍّ عطبٌ لا حالةٌ منقوصةٌ", async () => {
    for (const payload of [null, snapshot({ pickup: null }), snapshot({ status: "teleported" })]) {
      const { sql } = fakeSql(payload);
      const outcome = await createActiveRideReader(sql).read({
        telegramUserId: "5550001",
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe("STORE_ERROR");
    }
  });
});
