/**
 * الغرض: إثبات أن الحجب نافذ فعلاً في مسار الإسناد، لا مسجَّل في القاعدة فحسب.
 *   `admin_set_user_blocked` كانت تكتب `users.is_blocked = true`، لكن استعلام
 *   المرشّحين في dispatch لم يكن يجلب العمود أصلاً، و`rejectionReasonFor` لم
 *   تكن تفحصه. فالسائق المحجوب كان يستمرّ في تلقّي العروض وقبولها.
 *   وهذا يُفرغ الحجب من معناه: الإدارة تحجب، والنظام يُسند إليه بعد الحجب.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على شروط أهليّة المرشّحين
 * ملاحظات مستقبلية: عند إضافة حجب آلي بقواعد سمعة، تُضاف هنا تأكيدات على مُسبِّبه.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_001;
const RIDER_CHAT = 220_001;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = {
  env: "test",
  port: 3997,
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
};

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
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

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("نفاذ الحجب في مسار الإسناد", () => {
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
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** سائق نقل متحقَّق ومتاح بموقع داخل نصف قطر البحث. */
  async function readyDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "خالد المطيري"));
    await post("driver", contact(DRIVER_CHAT, "0501110001"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001009"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001009"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await post("driver", text(DRIVER_CHAT, "/available"));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    return driverId;
  }

  async function registerRider(): Promise<void> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
  }

  async function requestRide(): Promise<void> {
    await post("rider", callback(RIDER_CHAT, "svc:transport"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
  }

  const offersFor = (driverId: string) =>
    sql<{ count: string }[]>`select count(*)::text from order_offers where driver_id = ${driverId}`;

  it("خطّ الأساس: السائق غير المحجوب يصله عرض — فالتهيئة سليمة", async () => {
    const driverId = await readyDriver();
    await registerRider();
    await requestRide();

    const rows = await offersFor(driverId);
    // لو فشل هذا فالمشكلة في التهيئة لا في الحجب، والاختبار التالي بلا معنى
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });

  it("السائق المحجوب لا يصله أي عرض", async () => {
    const driverId = await readyDriver();
    await sql`
      update users set is_blocked = true
       where id = (select user_id from drivers where id = ${driverId})
    `;

    await registerRider();
    await requestRide();

    const rows = await offersFor(driverId);
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("الحجب بعد التوافر ينفذ فوراً: لا يُشترط إعادة تسجيل ولا تبديل توافر", async () => {
    const driverId = await readyDriver();
    await registerRider();

    // حُجب بعد أن صار متاحاً وقبل أول طلب — وهذا هو السيناريو الإداري الواقعي
    await sql`
      update users set is_blocked = true
       where id = (select user_id from drivers where id = ${driverId})
    `;
    await requestRide();

    const rows = await offersFor(driverId);
    expect(Number(rows[0]?.count)).toBe(0);

    // والطلب لا يُسنَد إلى أحد: يبقى في البحث أو يفشل، لا يُسنَد لمحجوب
    const orders = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders
    `;
    expect(orders[0]?.assigned_driver_id).toBeNull();
    expect(orders[0]?.status).not.toBe("matched");
  });

  it("رفع الحجب يعيد الأهليّة: العقوبة قابلة للتراجع", async () => {
    const driverId = await readyDriver();
    await sql`
      update users set is_blocked = true
       where id = (select user_id from drivers where id = ${driverId})
    `;
    await sql`
      update users set is_blocked = false
       where id = (select user_id from drivers where id = ${driverId})
    `;

    await registerRider();
    await requestRide();

    const rows = await offersFor(driverId);
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });
});
