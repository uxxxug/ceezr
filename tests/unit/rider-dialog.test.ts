/**
 * الغرض: اختبار حوار بوت العميل من /start إلى إنشاء طلب حقيقي وبدء البحث عن سائق.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة التسعير المسبق يُضاف اختبار يقارن التقدير بالتعرفة المخزَّنة.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import type { DriverId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";
import {
  JEDDAH,
  cityDirectory,
  orderWriter,
  riderDirectory,
  type OrderWriterDouble,
} from "../support/bot-doubles.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "500", chatId: "500", languageHint: "ar" };
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5, longitude: 39.2 };
const ORDER_ID = "order-1" as OrderId;

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, text: value };
}
function location(coords: { latitude: number; longitude: number }): IncomingUpdate {
  return { kind: "location", from: SENDER, location: coords };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, data };
}

const SEARCHING_ORDER: Order = {
  id: ORDER_ID,
  cityId: JEDDAH.id,
  service: "transport",
  status: "searching",
  pickup: PICKUP,
  dropoff: null,
  assignedDriverId: null,
  broadcastRound: 0,
};

let orders: OrderWriterDouble;
let deps: RiderBotDependencies;

function build(overrides: Partial<RiderBotDependencies> = {}): RiderBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  orders = orderWriter(ORDER_ID);
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    riders: riderDirectory(null),
    cities: cityDirectory([JEDDAH]),
    orders,
    activeOrderOf: async () => null,
    matching: {
      orders: orderRepo([SEARCHING_ORDER]),
      offers: offerRepo([]),
      candidates: candidateRepo([]),
      settings: settingsRepo(seededRows(JEDDAH.id)),
      clock: fixedClock(NOW),
    },
    clock: fixedClock(NOW),
  };
});

describe("تسجيل العميل وطلب رحلة", () => {
  it("يمضي من /start إلى طلب مُنشَأ بموقع حقيقي", async () => {
    const start = await handleRiderUpdate(text("/start"), deps);
    expect(start.map((r) => r.text)).toEqual([ar("rider.welcome"), ar("rider.ask_name")]);

    const name = await handleRiderUpdate(text("سالم"), deps);
    expect(name[0]?.text).toBe(ar("rider.ask_city"));

    const riders = riderDirectory(null);
    const withRiders = build({ riders });
    // نعيد المسار على دليل عملاء يسجّل فعلاً
    await handleRiderUpdate(text("/start"), withRiders);
    await handleRiderUpdate(text("سالم"), withRiders);
    const city = await handleRiderUpdate(callback(`city:${JEDDAH.id}`), withRiders);
    expect(city[0]?.text).toBe(ar("rider.registered", { name: "سالم", city: "جدة" }));
    expect(city[1]?.keyboard).toEqual({
      kind: "request_location",
      label: ar("rider.share_location_button"),
    });
    expect(riders.registrations).toHaveLength(1);

    const pickup = await handleRiderUpdate(location(PICKUP), withRiders);
    expect(pickup[0]?.text).toBe(ar("rider.ask_dropoff"));

    const dropoff = await handleRiderUpdate(location(DROPOFF), withRiders);
    expect(dropoff[0]?.text).toBe(ar("rider.searching"));

    expect(orders.created).toEqual([
      {
        cityId: JEDDAH.id,
        riderId: "rider-1" as RiderId,
        pickup: PICKUP,
        dropoff: DROPOFF,
      },
    ]);
  });

  it("يقبل /skip فيُنشئ الطلب بلا نقطة وصول", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const created = await handleRiderUpdate(text("/skip"), d);
    expect(created[0]?.text).toBe(ar("rider.searching"));
    expect(orders.created[0]?.dropoff).toBeNull();
  });

  it("يرفض عنواناً نصياً مكان الموقع", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(text("حي الصفا قرب المسجد"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
    expect(orders.created).toHaveLength(0);
  });

  it("يرفض إحداثيات مستحيلة", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(location({ latitude: 200, longitude: 39 }), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
    expect(orders.created).toHaveLength(0);
  });

  it("يطلب التسجيل قبل /ride", async () => {
    const replies = await handleRiderUpdate(text("/ride"), deps);
    expect(replies[0]?.text).toBe(ar("rider.must_register_first"));
  });

  it("لا يعرض مدناً إن لم تكن هناك مدينة مفعَّلة", async () => {
    const d = build({ cities: cityDirectory([]) });
    await handleRiderUpdate(text("/start"), d);
    const replies = await handleRiderUpdate(text("سالم"), d);
    expect(replies[0]?.text).toBe(ar("common.no_active_city"));
  });
});

describe("الإلغاء", () => {
  it("يلغي الطلب النشط فعلاً", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders, activeOrderOf: async () => ORDER_ID });
    const replies = await handleRiderUpdate(text("/cancel"), d);
    expect(replies[0]?.text).toBe(ar("rider.order_cancelled"));
    expect(orders.cancellations).toEqual([ORDER_ID]);
  });

  it("يخبر بعدم وجود طلب نشط ولا يستدعي الإلغاء", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const replies = await handleRiderUpdate(text("/cancel"), build({ riders }));
    expect(replies[0]?.text).toBe(ar("rider.no_active_order"));
    expect(orders.cancellations).toHaveLength(0);
  });
});

describe("المطابقة بعد الإنشاء", () => {
  it("ينشئ الطلب ويعلن البحث حتى لو لم يوجد سائق مؤهل الآن", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const replies = await handleRiderUpdate(text("/skip"), d);
    expect(replies[0]?.text).toBe(ar("rider.searching"));
    expect(orders.created).toHaveLength(1);
  });

  it("يبثّ على سائق مؤهل عند وجوده", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({
      riders,
      matching: {
        ...deps.matching,
        candidates: candidateRepo([
          {
            driverId: "driver-1" as DriverId,
            cityId: JEDDAH.id,
            location: { latitude: 21.545, longitude: 39.175 },
            isAvailable: true,
            isVerified: true,
            ratingAverage: 4.8,
            capabilities: [
              { driverId: "driver-1" as DriverId, cityId: JEDDAH.id, service: "transport", isEnabled: true },
            ],
            subscription: {
              driverId: "driver-1" as DriverId,
              cityId: JEDDAH.id,
              plan: "transport",
              status: "active",
              trialEndsAt: null,
              currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
            },
          },
        ]),
      },
    });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const replies = await handleRiderUpdate(text("/skip"), d);
    expect(replies[0]?.text).toBe(ar("rider.searching"));
  });
});
