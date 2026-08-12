/**
 * الغرض: المرحلة ٦ — إثبات النقل اللحظي على قاعدة حقيقية، من رسالة السائق إلى
 *   العميل والعمليات معاً.
 *
 *   الاختبارات هنا تقيس ما لا تقيسه الوحدات:
 *
 *   (١) **الجلسة صارت في القاعدة** لا في خريطة العملية: رسالة موقعٍ واحدة من بوت
 *       السائق تُنتج صفّاً في `tracking_sessions`. وهذا دليل إغلاق R-10/R-15 —
 *       لأن `handleLocation` كانت لا تفتح جلسةً قط، والوقائع كانت تضيع بإعادة النشر.
 *   (٢) **لا ماسح دوري**: جلسةٌ تجاوزت سقفها تُغلق `EXPIRED` وتُستبدل عند أول
 *       إصلاحة تالية (R-14).
 *   (٣) **فهرس الجلسة الواحدة** يمنع جلستين مفتوحتين لسائق — على القاعدة نفسها
 *       لا في المنطق.
 *   (٤) **الدفع إلى العميل يذهب لصاحب الرحلة وحده**: القناة تُحقَن فتُلتقط
 *       الوجهة، ويُقارَن معرّف محادثتها بمعرّف تلغرام لصاحب الرحلة، ويُثبَت أنّ
 *       راكباً آخر في نفس المدينة لا يُدفع إليه شيء.
 *   (٥) **مجرى العمليات محميّ**: بلا جلسة لوحة ⇒ ٤٠١، ومعها ⇒ لقطةٌ تحمل السائق.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على مسار الموقع أو على جدول الجلسات
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createAdminLiveRoutes } from "../../apps/gateway/src/routes/admin-live.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { LivePosition } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_806;
const RIDER_CHAT = 220_806;
const OTHER_RIDER_CHAT = 221_806;
const ADMIN_TELEGRAM = 990_806;
const UNAUTHORIZED = 401;
const HTTP_OK = 200;
const SEE_OTHER = 303;

const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
/** على بُعد ~٧٠٠ متر: يتجاوز حدّ الحركة في المُرحِّل ولا يُنتج سرعةً مستحيلة. */
const JEDDAH_MOVED = { latitude: 21.5534, longitude: 39.1751 };

const config: AppConfig = {
  env: "test",
  port: 3991,
  supabaseUrl: "https://local.test.supabase.co",
  databaseUrl: DATABASE_URL ?? "postgres://invalid",
  supabaseServiceKey: "local-test",
  redisUrl: "http://localhost",
  redisToken: "local-test",
  sessionStore: "memory",
  driverBotToken: "driver-token",
  riderBotToken: "rider-token",
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN_TELEGRAM),
  translationProvider: "none" as const,
  translationApiKey: null,
  translationContactEmail: null,
  runWorkerInGateway: false,
  // المرحلة ١٠: حقول الخريطة. `none` هو الافتراضي في الضبط الحقيقي، فالاختبارات
  // تعبّر عن نفس الحال: لا خريطة، ولا مفتاح، ولا نمط.
  mapProvider: "none",
  mapStyleUrl: null,
  mapTilesPublicKey: null,
};

interface LiveCall {
  readonly op: "start" | "update" | "stop";
  readonly chatId: string;
}

let sql: Sql;
let app: ReturnType<typeof createServer>;
let adminApp: Hono;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let liveCalls: LiveCall[];
let adminCodes: string[];

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
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const callback = (chatId: number, data: string) => ({
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});
const location = (chatId: number, at: { latitude: number; longitude: number }, agoSeconds = 0) =>
  message(chatId, {
    location: { ...at, horizontal_accuracy: 8 },
    date: Math.floor(Date.now() / 1000) - agoSeconds,
  });

interface SessionRow {
  readonly id: string;
  readonly trip_id: string | null;
  readonly last_fix_at: string | null;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
}

async function sessionsOf(driverId: string): Promise<readonly SessionRow[]> {
  return sql<SessionRow[]>`
    select id, trip_id, last_fix_at, ended_at, end_reason
      from tracking_sessions where driver_id = ${driverId}
     order by started_at asc
  `;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** دخول المسؤول بدورةٍ كاملة: الكعكة الناتجة صالحة لأي موجّه يقرأ نفس الجدول. */
async function adminCookie(): Promise<string> {
  adminCodes = [];
  const requested = await adminApp.fetch(
    new Request("http://localhost/admin/login/code", {
      method: "POST",
      headers: { "user-agent": "integration-test" },
      body: form({ telegram_id: String(ADMIN_TELEGRAM) }),
      redirect: "manual",
    }),
  );
  expect(requested.status).toBe(SEE_OTHER);
  const delivered = adminCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز دخول");
  const code = delivered.match(/[0-9]{6}/)?.[0];
  if (code === undefined) throw new Error(`لا رمز في الرسالة: ${delivered}`);

  const verified = await adminApp.fetch(
    new Request("http://localhost/admin/login/verify", {
      method: "POST",
      headers: { "user-agent": "integration-test" },
      body: form({ telegram_id: String(ADMIN_TELEGRAM), code }),
      redirect: "manual",
    }),
  );
  expect(verified.status).toBe(SEE_OTHER);
  const header = verified.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة");
  const value = header.split(";")[0];
  if (value === undefined) throw new Error("كعكة بلا قيمة");
  return value;
}

/**
 * يقرأ أوّل حدثٍ من مجرى SSE ثم يقطعه. القطع ضروري: الحلقة تعمل إلى أن يُقطع
 * المجرى، ومن تركها معلّقة أوقف الاختبار إلى مهلته.
 */
async function firstSseEvent(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) throw new Error("مجرى بلا جسم");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (let guard = 0; guard < 50; guard += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.includes("\n\n")) return buffer;
    }
  } finally {
    await reader.cancel();
  }
  throw new Error(`لم يصل حدث من المجرى: ${buffer}`);
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("النقل اللحظي على قاعدة حقيقية — المرحلة ٦", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterEach(async () => {
    await container.close();
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    await sql`update cities set is_active = true where id = ${cityId}`;

    liveCalls = [];
    adminCodes = [];
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];

    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: {
        start: async (chatId: string, _position: LivePosition, _live: number) => {
          liveCalls.push({ op: "start", chatId });
          return `msg-${liveCalls.length}`;
        },
        update: async (chatId: string) => {
          liveCalls.push({ op: "update", chatId });
          return true;
        },
        stop: async (chatId: string) => {
          liveCalls.push({ op: "stop", chatId });
          return true;
        },
      },
    });

    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });

    const auth = createAdminAuthPort(container.sql);
    adminApp = new Hono();
    adminApp.route(
      "/admin/api/live",
      createAdminLiveRoutes({ sql: container.sql, auth, bus: container.tracking.bus }),
    );
    adminApp.route(
      "/admin",
      createAdminUiRoutes({
        sql: container.sql,
        auth,
        codeSender: {
          send: async (_chatId, body) => {
            adminCodes.push(body);
            return true;
          },
        },
      }),
    );
  });

  async function registerDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "فهد الغامدي"));
    await post("driver", contact(DRIVER_CHAT, "0501110806"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1806"));
    await post("driver", text(DRIVER_CHAT, "1000001806"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001806"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    return driverId;
  }

  async function seedAdmin(): Promise<void> {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول النظام', '+966500000801', 'ar', 'admin')
    `;
  }

  /** راكبٌ ورحلةٌ جارية مُسنَدة إلى السائق — البرهان الذي يُبنى عليه الدفع. */
  async function seedAssignedTrip(
    driverId: string,
    chat: number,
  ): Promise<{ readonly tripId: string; readonly riderId: string }> {
    const fullName = `راكب ${chat}`;
    const phone = `+9665${chat}`;
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${fullName}, ${phone}, 'ar', 'rider')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${userId}::uuid) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status,
                          pickup, dropoff, pickup_label, dropoff_label)
      values (${cityId}, ${riderId}::uuid, ${driverId}::uuid, 'transport', 'in_progress',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
      returning id
    `;
    const tripId = orders[0]?.id;
    if (tripId === undefined) throw new Error("تعذّر إنشاء الرحلة");
    return { tripId, riderId };
  }

  it("رسالة موقعٍ واحدة تفتح جلسة تتبّع في القاعدة", async () => {
    /**
     * هذا هو إغلاق R-15. قبله كانت `handleLocation` تكتب الموقع القانوني ولا
     * تفتح جلسةً قط: الجلسة كانت آلةً في المجال بلا مسارٍ يُشغّلها، فكل ما
     * يُبنى عليها (الحياة، الانقطاع، التتبّع) كان بلا مصدر.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.ended_at).toBeNull();
    expect(rows[0]?.last_fix_at).not.toBeNull();
  });

  it("إصلاحتان متتاليتان تُقدّمان الجلسة نفسها ولا تفتحان ثانية", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH, 60));
    const afterFirst = await sessionsOf(driverId);
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(afterFirst[0]?.id);
    expect(rows[0]?.last_fix_at).not.toBe(afterFirst[0]?.last_fix_at);
  });

  it("جلسة تجاوزت سقفها تُغلق EXPIRED وتُستبدل بلا ماسحٍ دوري", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    // تقديم البداية إلى ما قبل السقف (١٢ ساعة) بلا مؤقّت: أول إصلاحة تالية هي الماسح.
    await sql`
      update tracking_sessions
         set started_at = now() - interval '13 hours',
             last_fix_at = now() - interval '13 hours'
       where driver_id = ${driverId} and ended_at is null
    `;

    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(2);
    expect(rows[0]?.end_reason).toBe("EXPIRED");
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[1]?.ended_at).toBeNull();
  });

  it("القاعدة نفسها تمنع جلستين مفتوحتين لسائق واحد", async () => {
    /**
     * الفهرس الفريد الجزئي لا المنطق. المنطق يُصيب في المسار المتوقّع؛ والفهرس
     * يُصيب في سباق رسالتَي موقعٍ متزامنتين — وهي الحال التي تُنتج سائقاً
     * مرسوماً مرّتين على خريطة العمليات إلى الأبد.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    let rejected = false;
    try {
      await sql`insert into tracking_sessions (driver_id) values (${driverId}::uuid)`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("رحلةٌ جارية تُربَط بالجلسة، وموقع السائق يُدفع إلى صاحبها وحده", async () => {
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    // راكبٌ آخر في نفس المدينة بلا إسناد: وجوده هو الاختبار — لا يُدفع إليه شيء.
    await seedAssignedTrip(driverId, OTHER_RIDER_CHAT);
    await sql`update orders set assigned_driver_id = null, status = 'searching'
               where rider_id <> ${mine.riderId}::uuid`;

    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows[0]?.trip_id).toBe(mine.tripId);

    expect(liveCalls.length).toBe(1);
    expect(liveCalls[0]).toEqual({ op: "start", chatId: String(RIDER_CHAT) });
  });

  it("سائقٌ بلا رحلة مُسنَدة لا يُدفع موقعه إلى أيّ عميل", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows[0]?.trip_id).toBeNull();
    // جلسة تتبّعٍ بلا رحلة حالةٌ مشروعة (سائق متاح للمطابقة) لا خطأ — ولا مستقبِل لها.
    expect(liveCalls.length).toBe(0);
  });

  it("إنهاء الرحلة يُغلق جلستها في القاعدة ويوقف بثّ الموقع عن العميل", async () => {
    /**
     * المنفذ هو نفسه المركّب في حوار التقييم (`deps.tracking.onTripEnded`)،
     * ويُستدعى هنا مباشرةً لأن المقيس في هذا الاختبار هو SQL الإغلاق
     * ومسار الإيقاف لا حوار السائق — ومسار الرحلة الكامل مقيسٌ في
     * `full-ride.test.ts`. وأن الحوار يمرّ بهذا المنفذ مضمونٌ بالمُترجِم لا
     * بالاختبار: `tracking` حقلٌ في `RatingDialogDependencies` يُمرّر في الحاوية.
     */
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    expect(liveCalls.map((c) => c.op)).toEqual(["start"]);

    await container.tracking.live.onTripEnded(mine.tripId, "TRIP_COMPLETED");

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.end_reason).toBe("TRIP_COMPLETED");
    expect(rows[0]?.ended_at).not.toBeNull();
    // وإيقاف البثّ لا تركُه ينتهي وحده: خريطةٌ حيّة بعد الرحلة تتبّعٌ بلا سند.
    expect(liveCalls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(liveCalls[1]?.chatId).toBe(String(RIDER_CHAT));
  });

  it("مجرى العمليات يُرفض بلا جلسة لوحة", async () => {
    const response = await adminApp.fetch(
      new Request("http://localhost/admin/api/live/drivers", {
        headers: { "user-agent": "integration-test" },
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(UNAUTHORIZED);
  });

  it("مجرى العمليات يفتح لقطةً تحمل السائق المُتتبَّع", async () => {
    await seedAdmin();
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    const cookie = await adminCookie();

    const response = await adminApp.fetch(
      new Request("http://localhost/admin/api/live/drivers", {
        headers: { "user-agent": "integration-test", cookie },
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const payload = await firstSseEvent(response);
    expect(payload).toContain("event: snapshot");
    expect(payload).toContain(driverId);
  });
});
