/**
 * الغرض: اختبار حوار بوت العميل من /start إلى إنشاء طلب حقيقي وبدء البحث عن سائق.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة التسعير المسبق يُضاف اختبار يقارن التقدير بالتعرفة المخزَّنة.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { DriverId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import {
  cityDirectory,
  JEDDAH,
  notifierDouble,
  type OrderWriterDouble,
  offerWriterDouble,
  orderWriter,
  riderDirectory,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

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
      offerWriter: offerWriterDouble(),
      notifier: notifierDouble(),
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
    // بعد التسجيل يُسأل العميل عن الخدمة: النقل والتوصيل مساران مختلفان من أول خطوة
    expect(city[1]?.text).toBe(ar("rider.ask_service"));
    expect(city[1]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("rider.service_transport"), data: "svc:transport" }],
        [{ label: ar("rider.service_delivery"), data: "svc:delivery" }],
        [{ label: ar("common.back_button"), data: "back:city" }],
      ],
    });
    expect(riders.registrations).toHaveLength(1);

    const chosen = await handleRiderUpdate(callback("svc:transport"), withRiders);
    expect(chosen[0]?.text).toBe(ar("rider.ask_pickup"));
    expect(chosen[0]?.keyboard).toEqual({
      kind: "request_location",
      label: ar("rider.share_location_button"),
    });

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
            ratingCount: 12,
            capabilities: [
              {
                driverId: "driver-1" as DriverId,
                cityId: JEDDAH.id,
                service: "transport",
                isEnabled: true,
              },
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

describe("مسار التوصيل في حوار العميل", () => {
  const REGISTERED = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const DELIVERY_ORDER: Order = {
    id: ORDER_ID,
    cityId: JEDDAH.id,
    service: "delivery",
    status: "searching",
    pickup: PICKUP,
    dropoff: DROPOFF,
    assignedDriverId: null,
    broadcastRound: 0,
  };

  function deliveryDeps(): RiderBotDependencies {
    return build({
      riders: riderDirectory(REGISTERED),
      matching: { ...deps.matching, orders: orderRepo([DELIVERY_ORDER]) },
    });
  }

  it("‏/start لعميل مسجَّل يعرض اختيار الخدمة لا موقع الانطلاق مباشرة", async () => {
    const d = deliveryDeps();
    const replies = await handleRiderUpdate(text("/start"), d);
    expect(replies[0]?.text).toBe(ar("rider.ask_service"));
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("rider.service_transport"), data: "svc:transport" }],
        [{ label: ar("rider.service_delivery"), data: "svc:delivery" }],
        [{ label: ar("common.back_button"), data: "back:city" }],
      ],
    });
  });

  it("‏/delivery يمضي: استلام ← تسليم ← وصف الطرد ← طلب delivery بوصفه في notes", async () => {
    const d = deliveryDeps();

    const started = await handleRiderUpdate(text("/delivery"), d);
    expect(started[0]?.text).toBe(ar("rider.ask_parcel_pickup"));

    const pickup = await handleRiderUpdate(location(PICKUP), d);
    expect(pickup[0]?.text).toBe(ar("rider.ask_parcel_dropoff"));

    const dropoff = await handleRiderUpdate(location(DROPOFF), d);
    expect(dropoff[0]?.text).toBe(ar("rider.ask_parcel"));

    const done = await handleRiderUpdate(text("صندوق كتب متوسط"), d);
    expect(done[0]?.text).toBe(ar("rider.delivery_searching"));

    expect(orders.createdFull).toEqual([
      {
        cityId: JEDDAH.id,
        riderId: REGISTERED.id,
        service: "delivery",
        pickup: PICKUP,
        dropoff: DROPOFF,
        notes: "صندوق كتب متوسط",
      },
    ]);
  });

  it("زرّ svc:delivery يسلك نفس مسار /delivery", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/start"), d);
    const chosen = await handleRiderUpdate(callback("svc:delivery"), d);
    expect(chosen[0]?.text).toBe(ar("rider.ask_parcel_pickup"));
  });

  it("لا يقبل /skip في التوصيل: الوجهة ركن لا خيار", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const refused = await handleRiderUpdate(text("/skip"), d);
    expect(refused[0]?.text).toBe(ar("rider.delivery_dropoff_required"));
    expect(orders.createdFull).toHaveLength(0);
  });

  it("يرفض وصف طرد قصيراً ويبقى في نفس الخطوة حتى يصحّ", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);

    const refused = await handleRiderUpdate(text("أب"), d);
    expect(refused[0]?.text).toBe(ar("rider.parcel_invalid"));
    expect(orders.createdFull).toHaveLength(0);

    const accepted = await handleRiderUpdate(text("كيس ملابس"), d);
    expect(accepted[0]?.text).toBe(ar("rider.delivery_searching"));
    expect(orders.createdFull).toHaveLength(1);
  });

  it("يرفض وصفاً أطول من الحد ولا ينشئ طلباً", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    const refused = await handleRiderUpdate(text("ط".repeat(201)), d);
    expect(refused[0]?.text).toBe(ar("rider.parcel_too_long"));
    expect(orders.createdFull).toHaveLength(0);
  });

  it("يرفض نصاً مكان موقع التسليم", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const refused = await handleRiderUpdate(text("حي الصفا"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
  });

  it("‏/ride يبقى مسار نقل خالصاً بلا وصف طرد", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    expect(orders.createdFull[0]?.service).toBe("transport");
    expect(orders.createdFull[0]?.notes).toBeNull();
  });
});
