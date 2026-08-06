/**
 * الغرض: اختبار حالة الاستخدام الكاملة matchOrder عبر المنافذ — من الإعدادات إلى دفعة البثّ.
 * الحالة: اختبار فعلي. لا يحتاج أي مفتاح خارجي: المنافذ مزدوجات في الذاكرة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصول مفاتيح Supabase يُضاف نظير تكاملي في tests/integration يستدعي القاعدة الحقيقية.
 */
import { describe, expect, it } from "bun:test";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";
import type { DriverCandidate } from "../../packages/domain/dispatch/entity.ts";
import type { Offer } from "../../packages/domain/dispatch/value-objects.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import {
  matchOrder,
  type MatchOrderDependencies,
} from "../../packages/application/dispatch/match-order.ts";
import {
  candidateRepo,
  failingOrderRepo,
  failingSettingsRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";
import type { SettingKey } from "../../packages/domain/policy/entity.ts";

const JED = "city-jed" as CityId;
const MKK = "city-mkk" as CityId;
const ORDER_ID = "order-1" as OrderId;
const NOW = new Date("2026-08-06T12:00:30.000Z");
const FUTURE = new Date("2026-09-06T00:00:00.000Z");

const PICKUP = { latitude: 21.4858, longitude: 39.1925 };
/** يبعد نحو 2.2 كم عن نقطة الانطلاق. */
const NEAR = { latitude: 21.5058, longitude: 39.1925 };
/** يبعد نحو 6.7 كم. */
const MID = { latitude: 21.5458, longitude: 39.1925 };
/** مكة — خارج نصف قطر 10 كم بفارق كبير. */
const OUTSIDE = { latitude: 21.3891, longitude: 39.8579 };

function order(over: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    cityId: JED,
    service: "transport",
    status: "searching",
    pickup: PICKUP,
    dropoff: null,
    assignedDriverId: null,
    broadcastRound: 0,
    ...over,
  };
}

function liveSub(driverId: DriverId, plan: Subscription["plan"] = "both"): Subscription {
  return {
    driverId,
    cityId: JED,
    plan,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
  };
}

function driver(
  id: string,
  location: { latitude: number; longitude: number },
  over: Partial<DriverCandidate> = {},
): DriverCandidate {
  const driverId = id as DriverId;
  return {
    driverId,
    cityId: JED,
    location,
    isAvailable: true,
    isVerified: true,
    ratingAverage: null,
    capabilities: [{ driverId, cityId: JED, service: "transport", isEnabled: true }],
    subscription: liveSub(driverId),
    ...over,
  };
}

function deps(opts: {
  orders?: readonly Order[];
  offers?: readonly Offer[];
  candidates?: readonly DriverCandidate[];
  settingOverrides?: Partial<Record<SettingKey, unknown>>;
  now?: Date;
}): MatchOrderDependencies {
  return {
    orders: orderRepo(opts.orders ?? [order()]),
    offers: offerRepo(opts.offers ?? []),
    candidates: candidateRepo(opts.candidates ?? []),
    settings: settingsRepo(seededRows(JED, opts.settingOverrides ?? {})),
    clock: fixedClock(opts.now ?? NOW),
  };
}

describe("matchOrder — المسار السليم", () => {
  it("يرتّب المرشحين ويعيد دفعة البثّ ومهلة العرض من الإعدادات", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({ candidates: [driver("far", MID), driver("near", NEAR)] }),
    );

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.batch.map((c) => String(c.driverId))).toEqual(["near", "far"]);
    expect(result.value.offerTimeoutSeconds).toBe(45);
    expect(result.value.round).toBe(1);
    expect(result.value.cityId).toBe(JED);
  });

  it("يحترم حجم الدفعة القادم من الإعدادات وحده", async () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      driver(`d${i}`, { latitude: 21.4858 + i * 0.005, longitude: 39.1925 }),
    );
    const five = await matchOrder({ orderId: ORDER_ID }, deps({ candidates: many }));
    const two = await matchOrder(
      { orderId: ORDER_ID },
      deps({ candidates: many, settingOverrides: { broadcast_batch_size: 2 } }),
    );

    if (!isOk(five) || !isOk(two)) throw new Error("توقّعنا نجاح الحالتين");
    expect(five.value.batch).toHaveLength(5);
    expect(two.value.batch).toHaveLength(2);
  });

  it("تغيير الوزنين في الإعدادات يقلب الترتيب بلا نشر كود", async () => {
    const candidates = [
      driver("near-low-rating", NEAR, { ratingAverage: 3 }),
      driver("far-high-rating", MID, { ratingAverage: 5 }),
    ];
    const proximityHeavy = await matchOrder({ orderId: ORDER_ID }, deps({ candidates }));
    const ratingHeavy = await matchOrder(
      { orderId: ORDER_ID },
      deps({
        candidates,
        settingOverrides: { match_weight_proximity: 0.05, match_weight_rating: 0.95 },
      }),
    );

    if (!isOk(proximityHeavy) || !isOk(ratingHeavy)) throw new Error("توقّعنا نجاح الحالتين");
    expect(String(proximityHeavy.value.batch[0]?.driverId)).toBe("near-low-rating");
    expect(String(ratingHeavy.value.batch[0]?.driverId)).toBe("far-high-rating");
  });

  it("يستبعد صاحب العرض المعلَّق الساري ويُبقي من انتهت مهلته", async () => {
    const offers: Offer[] = [
      {
        orderId: ORDER_ID,
        driverId: "busy" as DriverId,
        status: "pending",
        sentAt: new Date("2026-08-06T12:00:20.000Z"),
        round: 1,
      },
      {
        orderId: ORDER_ID,
        driverId: "stale" as DriverId,
        status: "pending",
        sentAt: new Date("2026-08-06T11:58:00.000Z"),
        round: 1,
      },
    ];
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({ candidates: [driver("busy", NEAR), driver("stale", MID)], offers }),
    );

    if (!isOk(result)) throw new Error("توقّعنا النجاح");
    expect(result.value.batch.map((c) => String(c.driverId))).toEqual(["stale"]);
    expect(result.value.evaluation.rejected).toEqual([
      { driverId: "busy" as DriverId, reason: "EXCLUDED_THIS_ROUND" },
    ]);
  });

  it("يستبعد من رفض العرض في دورة سابقة", async () => {
    const offers: Offer[] = [
      {
        orderId: ORDER_ID,
        driverId: "rejecter" as DriverId,
        status: "rejected",
        sentAt: new Date("2026-08-06T11:59:00.000Z"),
        round: 1,
      },
    ];
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({ candidates: [driver("rejecter", NEAR), driver("other", MID)], offers }),
    );
    if (!isOk(result)) throw new Error("توقّعنا النجاح");
    expect(result.value.batch.map((c) => String(c.driverId))).toEqual(["other"]);
  });
});

describe("matchOrder — الرفض بسبب واضح", () => {
  it("طلب غير موجود", async () => {
    const result = await matchOrder({ orderId: "ghost" as OrderId }, deps({}));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("طلب ليس في حالة البحث", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({
        orders: [order({ status: "in_progress", assignedDriverId: "d1" as DriverId })],
        candidates: [driver("near", NEAR)],
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("ORDER_NOT_SEARCHING");
  });

  it("استُنفدت دورات البثّ عند الحد المبذور", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({ orders: [order({ broadcastRound: 3 })], candidates: [driver("near", NEAR)] }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.code === "BROADCAST_ROUNDS_EXHAUSTED") {
      expect(result.error.maxRounds).toBe(3);
    } else {
      throw new Error("توقّعنا BROADCAST_ROUNDS_EXHAUSTED");
    }
  });

  it("لا سائق مؤهل، ويعيد سبب استبعاد كل مرشح", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({
        candidates: [
          driver("outside", OUTSIDE),
          driver("busy-elsewhere", NEAR, { isAvailable: false }),
          driver("no-sub", MID, { subscription: null }),
        ],
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.code === "NO_ELIGIBLE_DRIVER") {
      expect(result.error.evaluation.rejected.map((r) => r.reason).sort()).toEqual([
        "NOT_AVAILABLE",
        "NO_LIVE_SUBSCRIPTION",
        "OUT_OF_RADIUS",
      ]);
    } else {
      throw new Error("توقّعنا NO_ELIGIBLE_DRIVER");
    }
  });

  it("سائق من مدينة أخرى لا يدخل حتى قائمة المرشحين", async () => {
    const foreign: DriverCandidate = { ...driver("makkah-driver", NEAR), cityId: MKK };
    const result = await matchOrder({ orderId: ORDER_ID }, deps({ candidates: [foreign] }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NO_ELIGIBLE_DRIVER");
  });

  it("إعدادات ناقصة تُوقف المطابقة بدل استخدام قيمة افتراضية مخفية", async () => {
    const rows = seededRows(JED).filter((r) => r.key !== "search_radius_km");
    const result = await matchOrder(
      { orderId: ORDER_ID },
      { ...deps({ candidates: [driver("near", NEAR)] }), settings: settingsRepo(rows) },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("MISSING_SETTING");
  });

  it("وزنان لا يجمعان واحداً يُوقفان المطابقة", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      deps({
        candidates: [driver("near", NEAR)],
        settingOverrides: { match_weight_proximity: 0.9, match_weight_rating: 0.5 },
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("INCONSISTENT_WEIGHTS");
  });
});

describe("matchOrder — أعطال المنافذ تُنقل كنتيجة لا كاستثناء", () => {
  it("فشل مستودع الطلبات", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      { ...deps({}), orders: failingOrderRepo("timeout") },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.code === "PORT_FAILURE") {
      expect(result.error.port).toBe("OrderRepository");
    } else {
      throw new Error("توقّعنا PORT_FAILURE");
    }
  });

  it("فشل مستودع الإعدادات", async () => {
    const result = await matchOrder(
      { orderId: ORDER_ID },
      { ...deps({ candidates: [driver("near", NEAR)] }), settings: failingSettingsRepo("5xx") },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("PORT_FAILURE");
  });
});
