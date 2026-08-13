/**
 * الغرض: مسار التوصيل الكامل على قاعدة PostgreSQL فعلية، بنفس عمق full-ride.test.ts:
 *   تسجيل سائق توصيل ← تحقّق ← توافر وموقع ← تسجيل عميل ← /start ← اختيار «توصيل»
 *   ← موقع الاستلام ← موقع التسليم ← وصف الطرد ← طلب service='delivery' في orders
 *   ← عرض مكتوب في order_offers ← قبول ذرّي ← الطلب matched.
 *   ويُثبت العزل: سائق نقل في نفس المدينة وعلى نفس البعد لا يصله عرض التوصيل، والعكس.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مسار التوصيل
 * ملاحظات مستقبلية: عند إضافة بيانات المستلِم تُضاف تأكيدات على أعمدتها هنا.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { NO_TRACKING_OVERRIDES } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const COURIER_CHAT = 110_001;
const TRANSPORT_CHAT = 110_002;
const RIDER_CHAT = 210_001;
// جدة الحقيقية: الاستلام والتسليم وموقعا السائقين كلها داخل نصف قطر البحث
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const COURIER_AT = { latitude: 21.5471, longitude: 39.1751 };
const PARCEL = "صندوق كتب متوسط الحجم";

const config: AppConfig = {
  env: "test",
  port: 3998,
  supabaseUrl: "https://local.test.supabase.co",
  databaseUrl: DATABASE_URL ?? "postgres://invalid",
  supabaseServiceKey: "local-test",
  redisUrl: "http://localhost",
  redisToken: "local-test",
  sessionStore: "memory",
  driverBotToken: "driver-token",
  riderBotToken: "rider-token",
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: "990001",
  translationProvider: "none" as const,
  translationApiKey: null,
  translationContactEmail: null,
  runWorkerInGateway: false,
  // المرحلة ١٠: حقول الخريطة. `none` هو الافتراضي في الضبط الحقيقي، فالاختبارات
  // تعبّر عن نفس الحال: لا خريطة، ولا مفتاح، ولا نمط.
  mapProvider: "none",
  mapStyleUrl: null,
  mapTilesPublicKey: null,
  maplibreSri: null,
  // المرحلة ١٥ — لا مزوّد توجيه في الاختبارات الافتراضية: زمن الوصول يُمتنع صريحاً.
  routingProvider: "none",
  osrmBaseUrl: null,
  tracking: NO_TRACKING_OVERRIDES,
};

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;

async function post(bot: string, update: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const callback = (chatId: number, data: string) => ({
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("مسار التوصيل الكامل على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    await container.close();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = -1001,
             telegram_escalation_group_id = -1002,
             telegram_unsubscribed_drivers_group_id = -1003
       where id = ${cityId}
    `;
    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** يسجّل سائقاً بخدمة محدَّدة، ويجعله متحقَّقاً ومتاحاً بموقع حقيقي. */
  async function readyDriver(
    chatId: number,
    fullName: string,
    phone: string,
    service: "transport" | "delivery",
    at: { latitude: number; longitude: number },
  ): Promise<string> {
    await post("driver", text(chatId, "/start"));
    await post("driver", text(chatId, fullName));
    await post("driver", contact(chatId, phone));
    await post("driver", callback(chatId, `city:${cityId}`));
    await post("driver", callback(chatId, `service:${service}`));
    await post("driver", callback(chatId, "vehicle:sedan"));
    await post("driver", text(chatId, "أ ب ج 1234"));
    await post("driver", text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post("driver", photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error(`لم يُسجَّل السائق ${chatId}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, at));
    return driverId;
  }

  async function registerRider(): Promise<string> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
    const rows = await sql<{ id: string }[]>`select id from riders limit 1`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل العميل");
    return id;
  }

  /** الحوار الكامل لطلب توصيل من عميل مسجَّل. */
  async function requestDelivery(parcel = PARCEL): Promise<void> {
    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    await post("rider", text(RIDER_CHAT, parcel));
  }

  it("يسجّل سائق توصيل بقدرة delivery واشتراك تجريبي يغطّي التوصيل وحده", async () => {
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );

    const caps = await sql<{ service: string; is_enabled: boolean }[]>`
      select service, is_enabled from driver_capabilities where driver_id = ${courierId}
    `;
    expect(caps).toHaveLength(1);
    expect(caps[0]?.service).toBe("delivery");
    expect(caps[0]?.is_enabled).toBe(true);

    const subs = await sql<{ plan: string; status: string }[]>`
      select plan, status from subscriptions where driver_id = ${courierId}
    `;
    expect(subs[0]?.plan).toBe("delivery");
    expect(subs[0]?.status).toBe("trialing");
  });

  it("يمضي من /start إلى طلب توصيل مُسنَد: الوجهة ووصف الطرد محفوظان في القاعدة", async () => {
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );
    await registerRider();

    driverSent.length = 0;
    riderSent.length = 0;

    // 1) /start لعميل مسجَّل يعرض اختيار الخدمة لا موقع الانطلاق مباشرة
    await post("rider", text(RIDER_CHAT, "/start"));
    expect(riderSent.at(-1)?.text).toBe(ar("rider.ask_service"));
    expect(JSON.stringify(riderSent.at(-1)?.markup)).toContain("svc:delivery");

    await requestDelivery();
    // رسالتان: إعلان البحث ثم عدد من أُخطِر فعلاً — لا وعد مجرّد
    const riderTexts = riderSent.map((m) => m.text);
    expect(riderTexts).toContain(ar("rider.delivery_searching"));
    expect(riderTexts.at(-1)).toBe(ar("rider.drivers_notified", { count: 1 }));

    // 2) الطلب مكتوب بخدمة delivery وبوجهة حقيقية ووصف الطرد في notes
    const orders = await sql<
      {
        id: string;
        service: string;
        status: string;
        notes: string | null;
        plat: number;
        plng: number;
        dlat: number | null;
        dlng: number | null;
        broadcast_round: number;
      }[]
    >`
      select id, service, status, notes,
             st_y(pickup::geometry) as plat, st_x(pickup::geometry) as plng,
             st_y(dropoff::geometry) as dlat, st_x(dropoff::geometry) as dlng,
             broadcast_round
        from orders
    `;
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order?.service).toBe("delivery");
    expect(order?.status).toBe("searching");
    expect(order?.notes).toBe(PARCEL);
    expect(Number(order?.plat)).toBeCloseTo(PICKUP.latitude, 5);
    expect(Number(order?.plng)).toBeCloseTo(PICKUP.longitude, 5);
    // الوجهة ليست null: هذا هو الفرق البنيوي عن النقل
    expect(order?.dlat).not.toBeNull();
    expect(Number(order?.dlat)).toBeCloseTo(DROPOFF.latitude, 5);
    expect(Number(order?.dlng)).toBeCloseTo(DROPOFF.longitude, 5);
    expect(order?.broadcast_round).toBe(1);

    // 3) العرض مكتوب لسائق التوصيل بمسافة محسوبة حقيقية
    const offers = await sql<{ driver_id: string; status: string; distance_km: string }[]>`
      select driver_id, status, distance_km from order_offers
    `;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(courierId);
    expect(offers[0]?.status).toBe("pending");
    expect(Number(offers[0]?.distance_km)).toBeGreaterThan(0);
    expect(Number(offers[0]?.distance_km)).toBeLessThan(1);

    // 4) السائق أُخطر فعلاً بزرّ قبول يحمل معرّف الطلب
    expect(JSON.stringify(driverSent.map((m) => m.markup))).toContain(`offer:accept:${order?.id}`);

    // 5) القبول ذرّي عبر claim_ride: الطلب matched والعرض accepted
    driverSent.length = 0;
    await post("driver", callback(COURIER_CHAT, `offer:accept:${order?.id}`));
    /**
     * وهذا المسار — بخلاف النقل — له مقصدٌ بإحداثية، فتُثبَت النقطتان معاً
     * ويُثبَت تمايزهما: قبل المرحلة ١٢ كانت الاحتياطية نصّاً واحداً لكلتيهما،
     * فيقرأ المندوب سطرين متطابقين. الآن لكلٍّ إحداثيته.
     */
    const acceptTexts = driverSent.filter((m) => m.location === undefined).map((m) => m.text);
    expect(acceptTexts).toHaveLength(2);
    expect(acceptTexts[0]).toBe(ar("driver.offer_accepted"));
    const tripCard = acceptTexts[1] ?? "";
    expect(tripCard).toContain(ar("driver.trip_header"));
    expect(tripCard).toContain(ar("driver.trip_leg_to_pickup"));
    expect(tripCard).toContain(PICKUP.latitude.toFixed(4));
    expect(tripCard).toContain(DROPOFF.latitude.toFixed(4));
    expect(tripCard).not.toContain(ar("driver.trip_destination_unset"));

    // الدبّوس على الانطلاق لا على المقصد: مرحلته الآن إلى نقطة الاستلام
    const pins = driverSent.filter((m) => m.location !== undefined);
    expect(pins).toHaveLength(1);
    expect(pins[0]?.location).toEqual(PICKUP);

    const afterClaim = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders where id = ${order?.id ?? ""}
    `;
    expect(afterClaim[0]?.status).toBe("matched");
    expect(afterClaim[0]?.assigned_driver_id).toBe(courierId);

    const acceptedOffer = await sql<{ status: string }[]>`
      select status from order_offers where order_id = ${order?.id ?? ""}
    `;
    expect(acceptedOffer[0]?.status).toBe("accepted");

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${order?.id ?? ""}
    `;
    expect(audit.map((row) => row.action)).toContain("order.claimed");
  });

  it("عزل الخدمتين: سائق النقل لا يصله عرض توصيل ولو كان الأقرب", async () => {
    // سائق النقل أقرب إلى نقطة الاستلام من سائق التوصيل: لو كانت المسافة هي الفيصل لفاز
    const transportId = await readyDriver(
      TRANSPORT_CHAT,
      "خالد الزهراني",
      "0559876543",
      "transport",
      PICKUP,
    );
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );
    await registerRider();
    await requestDelivery();

    const offers = await sql<{ driver_id: string }[]>`select driver_id from order_offers`;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(courierId);
    expect(offers.map((o) => o.driver_id)).not.toContain(transportId);
  });

  it("عزل الخدمتين بالعكس: سائق التوصيل لا يصله عرض نقل", async () => {
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      PICKUP,
    );
    const transportId = await readyDriver(
      TRANSPORT_CHAT,
      "خالد الزهراني",
      "0559876543",
      "transport",
      COURIER_AT,
    );
    await registerRider();

    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    const orders = await sql<{ service: string }[]>`select service from orders`;
    expect(orders[0]?.service).toBe("transport");
    const offers = await sql<{ driver_id: string }[]>`select driver_id from order_offers`;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(transportId);
    expect(offers.map((o) => o.driver_id)).not.toContain(courierId);
  });

  it("لا يُنشئ طلب توصيل بوصف طرد غير صالح، ولا يترك صفاً يتيماً في القاعدة", async () => {
    await readyDriver(COURIER_CHAT, "أحمد العمري", "0501234567", "delivery", COURIER_AT);
    await registerRider();

    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "أب"));

    expect(riderSent.at(-1)?.text).toBe(ar("rider.parcel_invalid"));
    const orders = await sql<{ id: string }[]>`select id from orders`;
    expect(orders).toHaveLength(0);
    const offers = await sql<{ id: string }[]>`select id from order_offers`;
    expect(offers).toHaveLength(0);

    // ثم يصحّح العميل وصفه فيمضي الطلب في نفس الجلسة بلا إعادة البدء
    await post("rider", text(RIDER_CHAT, "كيس ملابس"));
    const after = await sql<{ service: string; notes: string | null }[]>`
      select service, notes from orders
    `;
    expect(after).toHaveLength(1);
    expect(after[0]?.service).toBe("delivery");
    expect(after[0]?.notes).toBe("كيس ملابس");
  });

  it("لا يقبل /skip في التوصيل: الطلب لا يُنشأ بلا وجهة", async () => {
    await readyDriver(COURIER_CHAT, "أحمد العمري", "0501234567", "delivery", COURIER_AT);
    await registerRider();

    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/skip"));

    expect(riderSent.at(-1)?.text).toBe(ar("rider.delivery_dropoff_required"));
    const orders = await sql<{ id: string }[]>`select id from orders`;
    expect(orders).toHaveLength(0);
  });
});
