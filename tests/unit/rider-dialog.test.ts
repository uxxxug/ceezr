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
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "../../packages/application/bots/main-menu.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type { SupportDialogDependencies } from "../../packages/application/bots/support-dialog.ts";
import type {
  ActiveOrderSummary,
  IncomingUpdate,
  Sender,
} from "../../packages/application/bots/types.ts";
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
    activeOrdersOf: async () => [],
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

describe("القائمة الدائمة في حوار العميل", () => {
  it("ترافق الترحيب من أوّل رسالة", async () => {
    const d = build();
    const start = await handleRiderUpdate(text("/start"), d);
    expect(start[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  /**
   * مطلب «ضغطة واحدة في كل الحالات»: لوحة الردّ ترسل **نصّ الزرّ حرفياً**
   * كأنّ المستخدم كتبه. فبلا ترجمة قبل فحص الخطوة يُسجَّل نصّ الزرّ اسماً للعميل.
   */
  it("زرّ القائمة يعمل في منتصف التسجيل ولا يُسجَّل اسماً", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);

    const pressed = await handleRiderUpdate(text(ar("menu.rider.cancel")), d);
    // أُلغيت الخطوة فعلاً — لا «سُجّل اسمك» ولا «لم أفهم هذه الرسالة»
    expect(pressed[0]?.text).toBe(ar("common.cancelled"));
    expect(pressed[0]?.text).not.toBe(ar("common.unknown_command"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يفهم زرّاً بلغة أخرى — لوحة قديمة باقية على جهاز المستخدم", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);
    const pressed = await handleRiderUpdate(text(translate("en", "menu.rider.cancel")), d);
    expect(pressed[0]?.text).toBe(ar("common.cancelled"));
  });
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
    // البند 4.3: زرّ الموقع ومعه القائمة تحته، فزرّ الدعم لا يُمحى في منتصف الطلب
    expect(chosen[0]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_location", label: ar("rider.share_location_button") },
        "rider",
        "ar",
      ),
    );

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

  it("يرفض زر خدمة قديماً أثناء انتظار موقع الانطلاق ولا يبدّل نوع الطلب", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });

    await handleRiderUpdate(text("/ride"), d);
    const stale = await handleRiderUpdate(callback("svc:delivery"), d);
    expect(stale[0]?.text).toBe(ar("common.unknown_command"));

    // لو قُبل الزرّ القديم لتحوّل السؤال إلى موقع استلام طرد؛ يبقى الطلب نقلاً.
    const pickup = await handleRiderUpdate(location(PICKUP), d);
    expect(pickup[0]?.text).toBe(ar("rider.ask_dropoff"));
  });

  it("يلغي تسجيل العميل غير المكتمل ويمحو جلسته", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);

    const cancelled = await handleRiderUpdate(text("/cancel"), d);
    expect(cancelled[0]?.text).toBe(ar("common.cancelled"));
    // كان يثبّت `{kind:"remove"}`. والسلوك تغيّر عمداً: عميلٌ ألغى تسجيله ناقصاً
    // أحوج الناس إلى طريق عودة وإلى زرّ الدعم، وإخلاء أسفل الشاشة يسلبه إيّاهما.
    expect(cancelled[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يسمّي إلغاء مسودة طلب إلغاءً بدلاً من نفي طلب نشط", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);

    const cancelled = await handleRiderUpdate(text("/cancel"), d);
    expect(cancelled[0]?.text).toBe(ar("common.cancelled"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
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
    const active = {
      orderId: ORDER_ID,
      service: "transport" as const,
      status: "searching",
      pickupLabel: null,
      dropoffLabel: "النسيم",
      createdAt: new Date("2026-08-11T05:29:00Z"),
    };
    const d = build({ riders, activeOrdersOf: async () => [active] });
    const replies = await handleRiderUpdate(text("/cancel"), d);
    // التأكيد يسمّي الطلب: «تم إلغاء طلبك» المجرّدة هي ما أوهم العميل في الإنتاج
    expect(replies[0]?.text).toContain("النسيم");
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
            isBlocked: false,
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

/**
 * البند 2.2 — «أين طلبي؟ / أين سائقي؟». كل حالة هنا شكوى حقيقية محتملة:
 * سائق أُسنِد ولا يعرف العميل كيف يميّزه، وانتظارٌ طال بلا أداة فعل، وطلبان
 * نشطان يُعرض أحدهما فيُحسب الآخر منتهياً.
 */
describe("تتبّع الطلب: /status", () => {
  const RIDER = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const active = (overrides: Partial<ActiveOrderSummary> = {}): ActiveOrderSummary => ({
    orderId: ORDER_ID,
    service: "transport",
    status: "searching",
    pickupLabel: null,
    dropoffLabel: "حي الصفا",
    createdAt: new Date(NOW.getTime() - 4 * 60_000),
    assignedDriver: null,
    ...overrides,
  });

  const statusDeps = (orders: readonly ActiveOrderSummary[]) =>
    build({ riders: riderDirectory(RIDER), activeOrdersOf: async () => orders });

  it("يطلب التسجيل من غير المسجَّل ولا يقرأ طلبات أصلاً", async () => {
    let reads = 0;
    const d = build({
      activeOrdersOf: async () => {
        reads += 1;
        return [];
      },
    });
    const replies = await handleRiderUpdate(text("/status"), d);
    expect(replies[0]?.text).toBe(ar("rider.must_register_first"));
    expect(reads).toBe(0);
  });

  /**
   * «لا يوجد طلب» تُرسل بلوحة **بلا** زرّ تتبّع: من انتهى طلبه وبقيت لوحته
   * القديمة معروضة يُصحَّح معروضُه بنفس الردّ، فلا يبقى زرّ يسأل عن لا شيء.
   */
  it("يقول لا يوجد طلب، ويسحب زرّ التتبّع من اللوحة", async () => {
    const replies = await handleRiderUpdate(text("/status"), statusDeps([]));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("rider.status_none"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  it("في البحث: يقول لم يُسنَد أحد بعد ولا يخترع سائقاً", async () => {
    const replies = await handleRiderUpdate(text("/status"), statusDeps([active()]));
    expect(replies).toHaveLength(1);
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_searching"));
    expect(body).toContain(ar("rider.status_waiting", { minutes: 4 }));
    // لا سطر سائق ولا لوحة مركبة حين لا سائق
    expect(body).not.toContain(ar("rider.status_driver", { name: "" }).trim());
    expect(replies[0]?.photoFileId).toBeUndefined();
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
  });

  /**
   * جوهر البند: الاسم وحده لا يميّز سيارةً على رصيف مزدحم. اللوحة وصورة
   * المركبة هما ما يُعرَف به السائق فعلاً حين يصل.
   */
  it("عند الإسناد: يعرض الاسم واللوحة وصورة المركبة تعليقاً على التقرير", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          assignedDriver: {
            fullName: "أحمد العمري",
            vehicleType: "سيدان",
            plateNumber: "ح ط ب 1234",
            vehiclePhotoFileId: "photo-1",
          },
        }),
      ]),
    );
    expect(replies).toHaveLength(1);
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_matched"));
    expect(body).toContain(ar("rider.status_driver", { name: "أحمد العمري" }));
    expect(body).toContain(ar("rider.status_plate", { plate: "ح ط ب 1234" }));
    expect(body).toContain(ar("rider.status_vehicle", { vehicle: "سيدان" }));
    // صورة واحدة مع التقرير لا رسالة ثانية تفترق عنه في محادثة مزدحمة
    expect(replies[0]?.photoFileId).toBe("photo-1");
  });

  it("لوحة ناقصة تُقال صراحة ولا تُسكت", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          assignedDriver: {
            fullName: "أحمد العمري",
            vehicleType: null,
            plateNumber: "   ",
            vehiclePhotoFileId: null,
          },
        }),
      ]),
    );
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_plate_missing"));
    expect(replies[0]?.photoFileId).toBeUndefined();
  });

  /**
   * انتظار طال: الدلالة على الدعم تأتي من البوت لا من صبر العميل. الحدّ 15 دقيقة،
   * وما دونه لا يُقلق أحداً بلا سبب.
   */
  it("يدلّ على الدعم متى طال الانتظار، ولا يفعل قبل ذلك", async () => {
    const long = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() - 21 * 60_000) })]),
    );
    expect(long[0]?.text).toContain(ar("rider.status_waiting_long", { minutes: 21 }));

    const short = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() - 14 * 60_000) })]),
    );
    expect(short[0]?.text).toContain(ar("rider.status_waiting", { minutes: 14 }));
    expect(short[0]?.text).not.toContain(ar("rider.status_waiting_long", { minutes: 14 }));
  });

  it("ساعة قاعدة تسبق ساعتنا لا تُنتج انتظاراً سالباً", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() + 5_000) })]),
    );
    expect(replies[0]?.text).toContain(ar("rider.status_waiting", { minutes: 0 }));
  });

  /**
   * من له مشوار وطرد معاً ورأى حالة أحدهما وحده يحسب الآخر منتهياً — وهي نفس
   * العلّة التي وقعت في /cancel.
   */
  it("يعرض كل طلب نشط لا الأحدث وحده، واللوحة مع الأخير", async () => {
    const second = active({
      orderId: "order-2" as OrderId,
      service: "delivery",
      status: "matched",
    });
    const replies = await handleRiderUpdate(text("/status"), statusDeps([active(), second]));
    expect(replies).toHaveLength(2);
    expect(replies[0]?.keyboard).toBeNull();
    expect(replies[1]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
    expect(replies[0]?.text).toContain(ar("rider.service_transport"));
    expect(replies[1]?.text).toContain(ar("rider.service_delivery"));
  });

  it("زرّ «أين طلبي؟» يصل إلى /status نصّاً بأي لغة مدعومة", async () => {
    const d = statusDeps([active()]);
    for (const label of [
      ar("menu.rider.status"),
      translate("en", "menu.rider.status"),
      translate("ur", "menu.rider.status"),
    ]) {
      const replies = await handleRiderUpdate(text(label), d);
      expect(replies[0]?.text).toContain(ar("rider.status_heading"));
    }
  });

  it("بدء البحث نفسه يعرض زرّ التتبّع فوراً، لا برسالة تالية", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const created = await handleRiderUpdate(text("/skip"), d);
    expect(created[0]?.text).toBe(ar("rider.searching"));
    expect(created[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
  });
});

/**
 * البند 4.3 في بوت العميل. طلب المشوار خطوتا موقع على الأقلّ، وهي اللحظة التي
 * كانت لوحة «أرسل موقعي» تمحو فيها القائمة الدائمة — فيبقى العميل بزرٍّ واحد
 * لا زرّ دعم ولا لغة، وهو نفسه من قد لا يقرأ العربية.
 */
describe("زرّ الدعم لا يغيب في أي حالة — بوت العميل", () => {
  const supportLabel = ar("menu.support");
  const RIDER = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const labelsOf = (keyboard: unknown): readonly string[] => {
    const board = keyboard as
      | { kind: string; rows?: string[][]; label?: string; menuRows?: string[][] }
      | null
      | undefined;
    if (board === null || board === undefined) return [];
    if (board.kind === "reply") return (board.rows ?? []).flat();
    if (board.kind === "request_location" || board.kind === "request_contact") {
      return [board.label ?? "", ...(board.menuRows ?? []).flat()];
    }
    return [];
  };

  it("طلب موقع الانطلاق يُبقي زرّ الدعم معروضاً", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    const asked = await handleRiderUpdate(text("/ride"), d);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("مسار التوصيل كذلك — لا فرق بين خدمة وخدمة في الوصول إلى الدعم", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    const asked = await handleRiderUpdate(text("/delivery"), d);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("عنوان نصّي مكان الموقع يُرفض والقائمة باقية على جهازه", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(text("حي الصفا"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
  });

  it("‏/support من غير مسجَّل يردّ بالقائمة لا بنصّ عارٍ", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    const replies = await handleRiderUpdate(text("/support"), d);
    expect(replies[0]?.text).toBe(ar("support.not_registered"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  /** ضغطة واحدة وسط انتظار الموقع: لا تُقرأ نصّاً فتُرفض بـ«الموقع مطلوب». */
  it("زرّ الدعم وسط انتظار الموقع يفتح الدعم لا يُرفض كعنوان", async () => {
    const d = build({
      riders: riderDirectory(RIDER),
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });
    await handleRiderUpdate(text("/ride"), d);
    const pressed = await handleRiderUpdate(text(supportLabel), d);
    expect(pressed[0]?.text).toBe(ar("support.ask_message"));
    expect(pressed[0]?.text).not.toBe(ar("rider.location_required"));
  });
});
