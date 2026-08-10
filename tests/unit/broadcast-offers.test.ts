/**
 * الغرض: اختبار حالة الاستخدام broadcastOffers وحدها: ماذا يُكتب في العروض، ومَن يُخطَر،
 *   وماذا يحدث حين يتعذّر الوصول إلى سائق أو تفشل كتابة الدورة.
 * الحالة: اختبار فعلي بمزدوجات في الذاكرة (النظير التكاملي على قاعدة حقيقية في tests/integration).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة دورات البثّ التالية يُضاف هنا سيناريو الدورة الثانية.
 */
import { describe, expect, it } from "bun:test";
import {
  type BroadcastDependencies,
  broadcastOffers,
} from "../../packages/application/dispatch/broadcast-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { DriverCandidate } from "../../packages/domain/dispatch/entity.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, isErr, isOk } from "../../packages/shared/result/index.ts";
import { notifierDouble, offerWriterDouble } from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const JED = "city-jed" as CityId;
const ORDER_ID = "order-1" as OrderId;
const NOW = new Date("2026-08-06T12:00:30.000Z");
const FUTURE = new Date("2026-09-06T00:00:00.000Z");
const PICKUP = { latitude: 21.4858, longitude: 39.1925 };
const NEAR = { latitude: 21.5058, longitude: 39.1925 };
const MID = { latitude: 21.5458, longitude: 39.1925 };

const ORDER: Order = {
  id: ORDER_ID,
  cityId: JED,
  service: "transport",
  status: "searching",
  pickup: PICKUP,
  dropoff: null,
  assignedDriverId: null,
  broadcastRound: 0,
};

function driver(id: string, location: { latitude: number; longitude: number }): DriverCandidate {
  const driverId = id as DriverId;
  const subscription: Subscription = {
    driverId,
    cityId: JED,
    plan: "both",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
  };
  return {
    driverId,
    cityId: JED,
    location,
    isAvailable: true,
    isVerified: true,
    isBlocked: false,
    ratingAverage: null,
    ratingCount: 0,
    capabilities: [{ driverId, cityId: JED, service: "transport", isEnabled: true }],
    subscription,
  };
}

function deps(over: Partial<BroadcastDependencies> = {}): BroadcastDependencies {
  return {
    orders: orderRepo([ORDER]),
    offers: offerRepo([]),
    candidates: candidateRepo([driver("near", NEAR), driver("far", MID)]),
    settings: settingsRepo(seededRows(JED, {})),
    clock: fixedClock(NOW),
    offerWriter: offerWriterDouble(),
    notifier: notifierDouble(),
    ...over,
  };
}

describe("broadcastOffers", () => {
  it("يفتح دورة عروض بمهلة الإعدادات ويُخطر كل سائق في الدفعة", async () => {
    const offerWriter = offerWriterDouble();
    const notifier = notifierDouble();
    const result = await broadcastOffers({ orderId: ORDER_ID }, deps({ offerWriter, notifier }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.offered.map(String)).toEqual(["near", "far"]);
    expect(result.value.notified.map(String)).toEqual(["near", "far"]);
    expect(result.value.unreachable).toHaveLength(0);
    // 45 ثانية مصدرها offer_timeout_seconds لا ثابت في الكود
    expect(result.value.expiresAt.getTime() - NOW.getTime()).toBe(45_000);

    expect(offerWriter.rounds).toHaveLength(1);
    const round = offerWriter.rounds[0];
    expect(round?.round).toBe(1);
    expect(round?.cityId).toBe(JED);
    expect(round?.entries.map((e) => String(e.driverId))).toEqual(["near", "far"]);
    // المسافة محسوبة فعلاً لا صفراً
    expect(round?.entries[0]?.distanceKm).toBeGreaterThan(0);
    expect(round?.entries[0]?.distanceKm).toBeLessThan(round?.entries[1]?.distanceKm ?? 0);

    expect(notifier.sent.map((n) => String(n.driverId))).toEqual(["near", "far"]);
    expect(notifier.sent[0]?.expiresInSeconds).toBe(45);
    expect(notifier.sent[0]?.orderId).toBe(ORDER_ID);
  });

  it("سائق حجب البوت يُحسب unreachable ولا يُوقف بقية الدفعة", async () => {
    const notifier = notifierDouble(["near"]);
    const result = await broadcastOffers({ orderId: ORDER_ID }, deps({ notifier }));

    if (!isOk(result)) throw new Error("توقّعنا نجاح البثّ");
    expect(result.value.unreachable.map(String)).toEqual(["near"]);
    expect(result.value.notified.map(String)).toEqual(["far"]);
    // العرض مكتوب للاثنين رغم تعذّر الإخطار: من حقّه أن يراه إن فتح البوت
    expect(result.value.offered).toHaveLength(2);
    expect(notifier.sent).toHaveLength(2);
  });

  it("فشل كتابة الدورة يُوقف البثّ فلا يُخطَر أحد بعرض غير موجود", async () => {
    const notifier = notifierDouble();
    const failingWriter = {
      openRound: async () => err(new PortFailureError("offers.openRound", "قاعدة معطّلة")),
    };
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ notifier, offerWriter: failingWriter }),
    );

    expect(isErr(result)).toBe(true);
    expect(notifier.sent).toHaveLength(0);
  });

  it("لا مرشحين مؤهلين: خطأ صريح بلا دورة ولا إخطار", async () => {
    const offerWriter = offerWriterDouble();
    const notifier = notifierDouble();
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ candidates: candidateRepo([]), offerWriter, notifier }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("NO_ELIGIBLE_DRIVER");
    // لا عرض يُكتب ولا سائق يُخطَر: الطلب يبقى في البحث للدورة التالية
    expect(offerWriter.rounds).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });
});
