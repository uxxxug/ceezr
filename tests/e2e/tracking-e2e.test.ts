/**
 * الغرض: المرحلة ٧ — التتبّع من الطرف إلى الطرف في **سياقٍ واحد** وعلى قاعدة حقيقية.
 *
 *   المرحلة ٦ أثبتت كل حلقةٍ على حدة: الجلسة تُفتح، والحدث يُنشر، والدفع يذهب
 *   لصاحب الرحلة. وما لم تُثبته أنّ الحلقات تصحّ **متصلةً** عبر عمر رحلةٍ كاملة:
 *   سائقٌ يبدأ يومه متاحاً بلا رحلة، ثم يُسنَد، ثم ينقطع ويعود، ثم يُنهي، ثم
 *   يُرسل موقعه بعد النهاية. والعيوب التي تهمّ تجارياً تقع في المفاصل بين
 *   الحلقات لا داخلها.
 *
 *   ولذلك لا يُبذَر هنا صفُّ طلبٍ باليد: الرحلة تُنشأ من بوت العميل، ويُسندها
 *   السائق بالقبول الذرّي، ويبدؤها ويُنهيها بأزراره. فما يُقاس هو **المسار**
 *   الذي سيسلكه المستخدم، لا تركيبٌ يشبهه.
 *
 *   الأسئلة الخمسة التي يُجيبها هذا الملف:
 *
 *   (١) هل تُربط الرحلة بجلسةٍ **قائمة** فُتحت قبلها؟ (المفصل الأول: التوافر
 *       ثم الإسناد — وأخطر عيبٍ محتمل أن يفتح الإسناد جلسةً ثانية.)
 *   (٢) هل يُطابق ما تراه العمليات ما خُزِّن في المصدر القانوني؟ (اللقطة تُقرأ
 *       من القاعدة، فتُقارَن بها لا بحدثٍ في الذاكرة.)
 *   (٣) هل ينقطع السائق ويعود **في نفس الجلسة**، ويُقرأ منقطعاً بينهما؟
 *   (٤) هل تتوقّف خريطة العميل عند نهاية الرحلة، **ولا تعود** بإصلاحةٍ متأخّرة
 *       تصل بعدها؟ (وهذا أخطر تسريبٍ في المسار كلّه.)
 *   (٥) هل تنفصل خريطتا رحلتين متزامنتين انفصالاً تامّاً؟
 *
 * الحالة: اختبار من الطرف إلى الطرف — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/e2e
 * يُتوقع أن يستخدمه لاحقاً: CI، وكل تعديل على مسار الموقع أو الجلسة أو الناقل
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { listLiveDriverPositions } from "../../apps/gateway/src/admin/queries.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createAdminLiveRoutes } from "../../apps/gateway/src/routes/admin-live.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { LivePosition } from "../../packages/application/tracking/customer-live-relay.ts";
import { DEFAULT_SESSION_POLICY, sessionStateAt } from "../../packages/domain/tracking/session.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "e2e-secret";
const DRIVER_CHAT = 130_807;
const DRIVER2_CHAT = 131_807;
const RIDER_CHAT = 230_807;
const RIDER2_CHAT = 231_807;
const ADMIN_TELEGRAM = 991_807;
const HTTP_OK = 200;
const SEE_OTHER = 303;

/** جدة: نقطة الانطلاق، ثم على بُعد ~٧٠٠ م، ثم ~١٤٠٠ م — حركةٌ معقولة لسيارة. */
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };
const DRIVER_MOVED = { latitude: 21.5534, longitude: 39.1751 };
const DRIVER_MOVED_MORE = { latitude: 21.5597, longitude: 39.1751 };
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1901 };
/** سائق الرحلة الثانية في نفس المدينة — الفصل يجب أن يكون بالرحلة لا بالمكان. */
const DRIVER2_AT = { latitude: 21.5488, longitude: 39.1795 };

const config: AppConfig = {
  env: "test",
  port: 3989,
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
  maplibreSri: null,
};

interface LiveCall {
  readonly op: "start" | "update" | "stop";
  readonly chatId: string;
  readonly position: LivePosition | null;
}

let sql: Sql;
let app: ReturnType<typeof createServer>;
let adminApp: Hono;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let liveCalls: LiveCall[];
let adminCodes: string[];
let driverSent: SentMessage[];
let riderSent: SentMessage[];

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
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, {
    location: { ...at, horizontal_accuracy: 8 },
    date: Math.floor(Date.now() / 1000),
  });

interface SessionRow {
  readonly id: string;
  readonly driver_id: string;
  readonly city_id: string;
  readonly trip_id: string | null;
  readonly started_at: string;
  readonly last_fix_at: string | null;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
}

async function sessionsOf(driverId: string): Promise<readonly SessionRow[]> {
  return sql<SessionRow[]>`
    select id, driver_id, city_id, trip_id, started_at, last_fix_at, ended_at, end_reason
      from tracking_sessions where driver_id = ${driverId}
     order by ended_at asc nulls last, started_at asc
  `;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function adminCookie(): Promise<string> {
  adminCodes = [];
  const requested = await adminApp.fetch(
    new Request("http://localhost/admin/login/code", {
      method: "POST",
      headers: { "user-agent": "e2e-test" },
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
      headers: { "user-agent": "e2e-test" },
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

/** يقرأ أوّل حدثٍ من مجرى SSE ثم يقطعه — تركُه معلّقاً يُوقف الاختبار إلى مهلته. */
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

describeIf("التتبّع من الطرف إلى الطرف — المرحلة ٧", () => {
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
    driverSent = [];
    riderSent = [];

    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: {
        start: async (chatId: string, position: LivePosition) => {
          liveCalls.push({ op: "start", chatId, position });
          return `msg-${liveCalls.length}`;
        },
        update: async (chatId: string, _messageId: string, position: LivePosition) => {
          liveCalls.push({ op: "update", chatId, position });
          return true;
        },
        stop: async (chatId: string) => {
          liveCalls.push({ op: "stop", chatId, position: null });
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

  /**
   * سائقٌ حقيقي مسجَّل ومُتحقَّق ومتاح — بلا موقعٍ بعد.
   *
   * `code` خمسة أرقام: تُبنى منها الهوية (عشرة أرقام) واللوحة والهاتف. والصيغ
   * ليست تجميلاً — مُقيِّم التسجيل يرفض هويةً ليست عشرة أرقام، فأي اختصارٍ هنا
   * يُفشل التسجيل بصمتٍ ويظهر لاحقاً كـ«لا سائق» في توكيدٍ بعيد عن سببه.
   */
  async function readyDriver(chat: number, name: string, code: string): Promise<string> {
    await post("driver", text(chat, "/start"));
    await post("driver", text(chat, name));
    await post("driver", contact(chat, `05${code}${code.slice(0, 3)}`));
    await post("driver", callback(chat, `city:${cityId}`));
    await post("driver", callback(chat, "service:transport"));
    await post("driver", callback(chat, "vehicle:sedan"));
    await post("driver", text(chat, `أ ب ج ${code.slice(1)}`));
    await post("driver", text(chat, `10${code}${code.slice(0, 3)}`));
    await post("driver", photo(chat, `vphoto_${code}`));

    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chat}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined)
      throw new Error(`لم يُسجَّل السائق ${chat}: ${JSON.stringify(driverSent.map((m) => m.text))}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await post("driver", text(chat, "/available"));
    return driverId;
  }

  async function readyRider(chat: number, name: string, code: string): Promise<void> {
    await post("rider", text(chat, "/start"));
    await post("rider", text(chat, name));
    await post("rider", contact(chat, `05${code}${code.slice(0, 3)}`));
    await post("rider", callback(chat, `city:${cityId}`));
  }

  /** طلبٌ حقيقي من بوت العميل، ويُعاد معرّفه من القاعدة لا من رسالة. */
  async function requestRide(
    chat: number,
    from: { latitude: number; longitude: number },
  ): Promise<string> {
    await post("rider", text(chat, "/ride"));
    await post("rider", location(chat, from));
    await post("rider", location(chat, DROPOFF));
    const rows = await sql<{ id: string }[]>`
      select o.id from orders o join riders r on r.id = o.rider_id
        join users u on u.id = r.user_id
       where u.telegram_id = ${chat} order by o.created_at desc limit 1
    `;
    const orderId = rows[0]?.id;
    if (orderId === undefined) throw new Error(`لم يُنشأ طلب للراكب ${chat}`);
    return orderId;
  }

  async function seedAdmin(): Promise<void> {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول النظام', '+966500000807', 'ar', 'admin')
    `;
  }

  it("رحلةٌ كاملة في سياق واحد: التوافر ثم الإسناد ثم النهاية على جلسةٍ واحدة", async () => {
    /**
     * هذا هو المفصل الذي لا تراه اختبارات الوحدات: الجلسة تُفتح **قبل** أن توجد
     * رحلة (السائق متاحٌ يُرسل موقعه للمطابقة)، ثم تُربط بالرحلة عند الإسناد.
     *
     * والعيب المحتمل الذي يقيسه التوكيد الأول أنّ الإسناد يفتح جلسةً ثانية —
     * فيصير للسائق تاريخان في نفس الدقيقة: واحدٌ بلا رحلة وآخر بها. ولو وقع
     * لانكسر كل حسابٍ لزمن الاتصال، ولرأت العمليات السائق مرّتين على الخريطة.
     */
    const driverId = await readyDriver(DRIVER_CHAT, "فهد المسار", "13081");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));

    const beforeTrip = await sessionsOf(driverId);
    expect(beforeTrip).toHaveLength(1);
    expect(beforeTrip[0]?.trip_id).toBeNull();
    expect(beforeTrip[0]?.city_id).toBe(cityId);
    // لا بثّ لأحد: لا رحلة ⇒ لا عميل له حقّ الرؤية. وهذا التوكيد هو التصريح نفسه.
    expect(liveCalls).toHaveLength(0);
    const sessionId = beforeTrip[0]?.id;

    await readyRider(RIDER_CHAT, "سالم الحربي", "23081");
    const orderId = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderId}`));

    // الإصلاحة التالية تربط الرحلة بـ**نفس** الجلسة ولا تفتح غيرها
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    const duringTrip = await sessionsOf(driverId);
    expect(duringTrip).toHaveLength(1);
    expect(duringTrip[0]?.id).toBe(sessionId);
    expect(duringTrip[0]?.trip_id).toBe(orderId);
    expect(duringTrip[0]?.ended_at).toBeNull();

    // وخريطة العميل بدأت الآن — عند أوّل إصلاحةٍ بعد الإسناد لا قبله
    const started = liveCalls.filter((call) => call.op === "start");
    expect(started).toHaveLength(1);
    expect(started[0]?.chatId).toBe(String(RIDER_CHAT));
    expect(started[0]?.position?.lat).toBeCloseTo(DRIVER_MOVED.latitude, 5);

    // النهاية تُغلق الجلسة في القاعدة وتُوقف الخريطة — الاثنان معاً أو لا شيء
    await post("driver", callback(DRIVER_CHAT, `ride:complete:${orderId}`));
    const afterTrip = await sessionsOf(driverId);
    expect(afterTrip).toHaveLength(1);
    expect(afterTrip[0]?.ended_at).not.toBeNull();
    expect(afterTrip[0]?.end_reason).toBe("TRIP_COMPLETED");
    expect(liveCalls.filter((call) => call.op === "stop")).toHaveLength(1);
    expect(container.tracking.bus.subscriberCount).toBeGreaterThan(0);
  });

  it("ما تراه العمليات هو ما خُزِّن في المصدر القانوني — لا نسخة موازية", async () => {
    /**
     * اللقطة تُقرأ من القاعدة، فالتوكيد الصحيح أن تُقارَن **بالقاعدة نفسها**:
     * `drivers.last_location` هو المصدر القانوني (ADR-0015)، وأي فرقٍ بينه وبين
     * ما يُعرض يعني أن اللوحة صارت مصدراً ثانياً للحقيقة.
     */
    await seedAdmin();
    const driverId = await readyDriver(DRIVER_CHAT, "فهد المرئي", "13082");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await readyRider(RIDER_CHAT, "سالم المرئي", "23082");
    const orderId = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderId}`));
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));

    const canonical = await sql<{ lat: string; lng: string; quality: string }[]>`
      select st_y(last_location::geometry) as lat, st_x(last_location::geometry) as lng,
             last_location_quality as quality
        from drivers where id = ${driverId}
    `;
    const snapshot = await listLiveDriverPositions(container.sql, cityId);
    const row = snapshot.find((item) => item.driverId === driverId);
    expect(row).toBeDefined();
    expect(row?.lat).toBeCloseTo(Number(canonical[0]?.lat), 6);
    expect(row?.lng).toBeCloseTo(Number(canonical[0]?.lng), 6);
    expect(row?.quality).toBe(canonical[0]?.quality);
    expect(row?.tripId).toBe(orderId);
    expect(row?.tripStatus).toBe("in_progress");
    expect(row?.driverName).toBe("فهد المرئي");

    // ومجرى المشغّل يحمل نفس السائق — لا مسار قراءةٍ ثانٍ للشاشة
    const cookie = await adminCookie();
    const stream = await adminApp.fetch(
      new Request("http://localhost/admin/api/live/drivers", {
        headers: { "user-agent": "e2e-test", cookie },
        redirect: "manual",
      }),
    );
    expect(stream.status).toBe(HTTP_OK);
    const payload = await firstSseEvent(stream);
    expect(payload).toContain("event: snapshot");
    expect(payload).toContain(driverId);
    expect(payload).toContain(orderId);
  });

  it("ينقطع السائق ثم يعود: يُقرأ منقطعاً بينهما، ويعود في نفس الجلسة", async () => {
    /**
     * الانقطاع ليس حدثاً يُرسله أحد — هو **غياب** إصلاحة. ولذلك يُقاس بإرجاع
     * مؤشّر الحداثة في القاعدة، لا بانتظار نصف دقيقة في اختبار.
     *
     * والسؤال الحقيقي هنا ليس «هل يُقرأ STALE» (تلك وحدةٌ مُختبَرة)، بل: هل
     * تُشقّ العودةُ جلسةً ثانية؟ ولو شقّتها لصار كل انقطاعٍ في تغطيةٍ ضعيفة —
     * وهو واقع الطرق — يُنتج جلسةً جديدة، فيصير «زمن الاتصال» عدداً بلا معنى.
     */
    const driverId = await readyDriver(DRIVER_CHAT, "فهد المنقطع", "13083");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    const opened = await sessionsOf(driverId);
    const sessionId = opened[0]?.id;
    expect(sessionId).toBeDefined();

    const staleSeconds = DEFAULT_SESSION_POLICY.staleAfterSeconds + 10;
    await sql`
      update tracking_sessions
         set last_fix_at = now() - make_interval(secs => ${staleSeconds}),
             started_at = started_at - make_interval(secs => ${staleSeconds})
       where id = ${sessionId ?? ""}
    `;

    const gone = await sessionsOf(driverId);
    const goneRow = gone[0];
    if (goneRow === undefined) throw new Error("اختفت الجلسة");
    const stateWhileGone = sessionStateAt(
      {
        driverId: goneRow.driver_id,
        tripId: goneRow.trip_id,
        startedAtMs: new Date(goneRow.started_at).getTime(),
        lastFixAtMs: goneRow.last_fix_at === null ? null : new Date(goneRow.last_fix_at).getTime(),
        endedAtMs: null,
        endReason: null,
      },
      Date.now(),
      DEFAULT_SESSION_POLICY,
    );
    expect(stateWhileGone).toBe("STALE");
    // ومازالت مفتوحةً في القاعدة: الانقطاع حكمٌ محسوب لا صفٌّ يُغلق
    expect(goneRow.ended_at).toBeNull();

    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    const back = await sessionsOf(driverId);
    expect(back).toHaveLength(1);
    expect(back[0]?.id).toBe(sessionId);
    const resumed = sessionStateAt(
      {
        driverId,
        tripId: null,
        startedAtMs: new Date(back[0]?.started_at ?? 0).getTime(),
        lastFixAtMs: new Date(back[0]?.last_fix_at ?? 0).getTime(),
        endedAtMs: null,
        endReason: null,
      },
      Date.now(),
      DEFAULT_SESSION_POLICY,
    );
    expect(resumed).toBe("ACTIVE");
  });

  it("إصلاحةٌ متأخّرة تصل بعد نهاية الرحلة لا تُعيد خريطة العميل", async () => {
    /**
     * أخطر تسريبٍ في المسار كلّه. السائق يُنهي الرحلة ثم يبقى متاحاً ويُرسل
     * موقعه — وهذا هو السلوك الطبيعي لا الشاذّ. فإن بقيت الجلسة مربوطةً بالرحلة
     * المنتهية، أو بقي اشتراك العميل قائماً، **لَتابع العميلُ سائقه إلى رحلة
     * شخصٍ آخر**.
     *
     * والقياس هنا على الأثر الظاهر لا على الحالة الداخلية: لا `start` ثانٍ في
     * محادثة العميل بعد النهاية، والجلسة الجديدة بلا رحلة.
     */
    const driverId = await readyDriver(DRIVER_CHAT, "فهد المتأخّر", "13084");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await readyRider(RIDER_CHAT, "سالم المتأخّر", "23084");
    const orderId = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderId}`));
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    expect(liveCalls.filter((call) => call.op === "start")).toHaveLength(1);

    await post("driver", callback(DRIVER_CHAT, `ride:complete:${orderId}`));
    liveCalls = [];

    // إصلاحتان بعد النهاية: واحدة تفتح جلسةً جديدة، والثانية تتقدّم فيها
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED_MORE));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));

    expect(liveCalls).toHaveLength(0);

    const sessions = await sessionsOf(driverId);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.end_reason).toBe("TRIP_COMPLETED");
    // الجلسة الجديدة مفتوحةٌ وبلا رحلة: الرحلة المنتهية لا تُورَّث
    expect(sessions[1]?.ended_at).toBeNull();
    expect(sessions[1]?.trip_id).toBeNull();

    // ولا صفّ في القاعدة يربط السائق بالرحلة المنتهية وهو مفتوح
    const leaking = await sql<{ count: string }[]>`
      select count(*) as count from tracking_sessions
       where trip_id = ${orderId} and ended_at is null
    `;
    expect(Number(leaking[0]?.count)).toBe(0);
  });

  it("رحلتان متزامنتان في نفس المدينة: خريطة كل عميل سائقه وحده", async () => {
    /**
     * الفصل يجب أن يكون **بالرحلة** لا بالمكان ولا بترتيب الوصول. ولذلك
     * السائقان في نفس المدينة وعلى بُعد مئات الأمتار، والإصلاحات تتناوب بينهما:
     * لو كان الحصر بالمدينة أو بآخر حدث لكشفه التناوب فوراً.
     */
    const driverA = await readyDriver(DRIVER_CHAT, "فهد الأول", "13085");
    const driverB = await readyDriver(DRIVER2_CHAT, "سعد الثاني", "13181");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await post("driver", location(DRIVER2_CHAT, DRIVER2_AT));

    await readyRider(RIDER_CHAT, "سالم الأول", "23085");
    await readyRider(RIDER2_CHAT, "ماجد الثاني", "23181");

    /**
     * الطلب الأول يُبثّ على السائقين معاً، فيظفر به من يقبل أولاً (القبول
     * الذرّي). ثم يُنشأ الطلب الثاني فيصله السائق الآخر وحده — لأن الأول صار
     * مشغولاً. وهذا ترتيبٌ مقصود: هو الوحيد الذي يُنتج رحلتين متزامنتين عبر
     * المسار الحقيقي بلا بذر صفوفٍ باليد.
     */
    const orderA = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderA}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderA}`));

    const orderB = await requestRide(RIDER2_CHAT, DRIVER2_AT);
    await post("driver", callback(DRIVER2_CHAT, `offer:accept:${orderB}`));
    await post("driver", callback(DRIVER2_CHAT, `ride:start:${orderB}`));

    const assigned = await sql<{ id: string; assigned_driver_id: string }[]>`
      select id, assigned_driver_id from orders where id in (${orderA}, ${orderB})
    `;
    expect(assigned.find((row) => row.id === orderA)?.assigned_driver_id).toBe(driverA);
    expect(assigned.find((row) => row.id === orderB)?.assigned_driver_id).toBe(driverB);

    liveCalls = [];
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    await post("driver", location(DRIVER2_CHAT, DRIVER2_AT));

    const toRiderA = liveCalls.filter((call) => call.chatId === String(RIDER_CHAT));
    const toRiderB = liveCalls.filter((call) => call.chatId === String(RIDER2_CHAT));
    expect(toRiderA).toHaveLength(1);
    expect(toRiderB).toHaveLength(1);
    expect(toRiderA[0]?.position?.lat).toBeCloseTo(DRIVER_MOVED.latitude, 5);
    expect(toRiderB[0]?.position?.lat).toBeCloseTo(DRIVER2_AT.latitude, 5);
    expect(liveCalls).toHaveLength(2);

    // وإنهاء إحدى الرحلتين لا يُوقف خريطة الأخرى
    liveCalls = [];
    await post("driver", callback(DRIVER_CHAT, `ride:complete:${orderA}`));
    const stops = liveCalls.filter((call) => call.op === "stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]?.chatId).toBe(String(RIDER_CHAT));

    const sessionsB = await sessionsOf(driverB);
    expect(sessionsB).toHaveLength(1);
    expect(sessionsB[0]?.ended_at).toBeNull();
    expect(sessionsB[0]?.trip_id).toBe(orderB);
  });

  it("حدثٌ لسائقٍ غير سائق الرحلة يُسقَط ولا يصل خريطة العميل", async () => {
    /**
     * هذا الاختبار كُتِب بعد قياسٍ لا قبله. اختبار «رحلتان متزامنتان» أعلاه لا
     * يشهد لحَرَس الهويّة في المُرحِّل: أُبطِل الحَرَس يدوياً (`target.driverId
     * !== event.driverId`) فبقي الاختبار ناجحاً — لأن البثّ مُفهرسٌ بالرحلة وكل
     * حدثٍ يحمل رحلته، فالتوجيه هناك صحيحٌ بالبنية لا بالحَرَس.
     *
     * والحالة التي يُغلقها الحَرَس سباقٌ لا يُنتجه المسار الطبيعي: حدثٌ نُشِر
     * وسائقُه سائق الرحلة، ثم أُعيد الإسناد قبل استهلاكه. فيُحاكى بالنشر
     * المباشر على الناقل — وهو المستوى الصحيح للمحاكاة إذ لا واجهةَ تُنتج هذا
     * التعارض. والبديل (تركه بلا اختبار) سطرُ أمانٍ يُحذف يوماً بلا أن يصرخ شيء.
     */
    const driverA = await readyDriver(DRIVER_CHAT, "فهد المُسنَد", "13087");
    const driverB = await readyDriver(DRIVER2_CHAT, "سعد الدخيل", "13187");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await post("driver", location(DRIVER2_CHAT, DRIVER2_AT));

    await readyRider(RIDER_CHAT, "سالم المُسنَد", "23087");
    const orderId = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderId}`));

    // لا بثّ مفتوحٌ بعد لهذه الرحلة: الحَرَس يُفحص في مسار الفتح لا التحديث.
    liveCalls = [];
    expect(container.tracking.relay.openBroadcasts).toBe(0);
    expect(driverA).not.toBe(driverB);

    await container.tracking.bus.publish({
      type: "location_updated",
      driverId: driverB,
      tripId: orderId,
      position: { lat: DRIVER2_AT.latitude, lng: DRIVER2_AT.longitude },
      cityId,
      timestamp: new Date(),
    });

    expect(liveCalls).toHaveLength(0);
    expect(container.tracking.relay.openBroadcasts).toBe(0);

    // وإصلاحةُ السائق الحقيقي بعده تفتح الخريطة على إحداثياته هو
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    expect(liveCalls).toHaveLength(1);
    expect(liveCalls[0]?.op).toBe("start");
    expect(liveCalls[0]?.chatId).toBe(String(RIDER_CHAT));
    expect(liveCalls[0]?.position?.lat).toBeCloseTo(DRIVER_MOVED.latitude, 5);
  });

  it("إصلاحات متلاحقة لا تُغرِق تلغرام: تعديلٌ واحد بعد الفاصل لا تعديلٌ لكل رسالة", async () => {
    /**
     * الخنق مُختبَرٌ كوحدة بساعةٍ مصنوعة. وما يُقاس هنا شيءٌ آخر: أنه **موصول
     * فعلاً في المسار الحيّ** بساعة النظام. والفرق مهم لأن حدود معدّل تلغرام
     * لا تُحاسب على النية: سائقٌ يُرسل موقعه الحيّ كل ثانية يعني تعديلاً كل
     * ثانية لكل عميل، فيُكتم البوت.
     *
     * ولذلك ينام هذا الاختبار فاصلاً حقيقياً واحداً — لا ساعةٌ مُحقونة: الغرض
     * إثبات التوصيل بزمن التشغيل نفسه.
     */
    const driverId = await readyDriver(DRIVER_CHAT, "فهد المتلاحق", "13086");
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    await readyRider(RIDER_CHAT, "سالم المتلاحق", "23086");
    const orderId = await requestRide(RIDER_CHAT, PICKUP);
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await post("driver", callback(DRIVER_CHAT, `ride:start:${orderId}`));

    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    liveCalls = [];
    // ثلاث إصلاحات متلاحقة، كلٌّ منها يتجاوز حدّ المسافة — والفاصل الزمني وحده يمنعها
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED_MORE));
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED));
    expect(liveCalls).toHaveLength(0);

    await Bun.sleep(5_100);
    await post("driver", location(DRIVER_CHAT, DRIVER_MOVED_MORE));
    const updates = liveCalls.filter((call) => call.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.chatId).toBe(String(RIDER_CHAT));
    expect(updates[0]?.position?.lat).toBeCloseTo(DRIVER_MOVED_MORE.latitude, 5);

    // والموقع القانوني تقدّم مع كل إصلاحة رغم أن التعديل لم يُرسل: الخنق للقناة
    // لا للحقيقة — وهذا هو الفرق الذي لا يجوز أن يختلط.
    const canonical = await sql<{ lat: string }[]>`
      select st_y(last_location::geometry) as lat from drivers where id = ${driverId}
    `;
    expect(Number(canonical[0]?.lat)).toBeCloseTo(DRIVER_MOVED_MORE.latitude, 5);
  } /**
   * مهلةٌ أوسع من الافتراضية بقصد: الاختبار ينام فاصل الخنق الحقيقي، فالمهلة
   * الافتراضية (٥ ثوان) كانت تقطعه قبل التوكيد — أي «فشلٌ» لا يقيس شيئاً.
   */, 20_000);
});
