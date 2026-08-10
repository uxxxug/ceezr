/**
 * الغرض: لوحة الإدارة كاملةً على قاعدة PostgreSQL فعلية: دورة الدخول من طلب
 *   الرمز إلى الجلسة، ثم الصفحات الثماني بواجهة HTTP حقيقية، ثم الأفعال الكتابية
 *   الثلاثة عبر دوالّها الذرّية — وأهمّ من ذلك حدودها: من ليس مسؤولاً لا يصله
 *   رمز، ورمز خاطئ متكرّر يُقفل، وسحب الصفة يُسقط الجلسة في الطلب التالي.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مصادقة اللوحة
 * ملاحظات مستقبلية: عند إضافة صفحة تُضاف إلى قائمة الصفحات المفحوصة هنا.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_MAX_PER_WINDOW,
  type AdminAuthPort,
  createAdminAuthPort,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { createAdminApiRoutes } from "../../apps/gateway/src/routes/admin-api.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ADMIN_TELEGRAM = "770001";
const OTHER_TELEGRAM = "770002";
const DRIVER_TELEGRAM = "770003";

let sql: Sql;
let auth: AdminAuthPort;
let app: Hono;
let cityId: string;
let cityGroupsId: string;
let adminUserId: string;
let sentCodes: { chatId: string; text: string }[];

/** يلتقط الرمز من نصّ الرسالة كما يقرأه المسؤول فعلاً، لا من القاعدة. */
function extractCode(text: string): string {
  const match = text.match(/[0-9]{6}/);
  if (match === null) throw new Error(`لا رمز في الرسالة: ${text}`);
  return match[0];
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function request(
  path: string,
  init: { method?: string; body?: FormData; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": "integration-test" };
  if (init.cookie !== undefined) headers.cookie = init.cookie;
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: "manual",
    }),
  );
}

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة في الاستجابة");
  const value = header.split(";")[0];
  if (value === undefined) throw new Error("كعكة جلسة بلا قيمة");
  return value;
}

/** دورة دخول كاملة كما يمرّ بها المسؤول: طلب رمز، قراءته، ثم إدخاله. */
async function login(telegramId: string): Promise<string> {
  sentCodes = [];
  const requested = await request("/admin/login/code", {
    method: "POST",
    body: form({ telegram_id: telegramId }),
  });
  const SEE_OTHER = 303;
  expect(requested.status).toBe(SEE_OTHER);
  const delivered = sentCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز");
  const verified = await request("/admin/login/verify", {
    method: "POST",
    body: form({ telegram_id: telegramId, code: extractCode(delivered.text) }),
  });
  expect(verified.status).toBe(SEE_OTHER);
  return cookieFrom(verified);
}

async function csrfFrom(cookie: string, path: string): Promise<string> {
  const page = await request(path, { cookie });
  const html = await page.text();
  const match = html.match(/name="csrf" value="([0-9a-f]{64})"/);
  if (match?.[1] === undefined) throw new Error(`لا رمز CSRF في ${path}`);
  return match[1];
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("لوحة الإدارة على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    const cityGroups = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
    const cityGroupsRecord = cityGroups[0]?.id;
    if (cityGroupsRecord === undefined) throw new Error("لم تُطبَّق هجرة بذر مدينة مكة");
    cityGroupsId = cityGroupsRecord;
    auth = createAdminAuthPort(sql);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    // مكة مخصّصة لاختبارات قروبات المدن كي لا تتداخل مع مدينة جدة التي تستخدمها
    // اختبارات المسارات التشغيلية الأخرى في نفس قاعدة PostgreSQL.
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where id = ${cityGroupsId}
    `;

    const admins = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول النظام', '+966500000001', 'ar', 'admin')
      returning id
    `;
    const created = admins[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء المسؤول");
    adminUserId = created;

    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${OTHER_TELEGRAM}::bigint, 'راكب عادي', '+966500000002', 'ar', 'rider')
    `;

    sentCodes = [];
    app = new Hono();
    // الأخصّ أولاً: /admin/api قبل /admin كما في index.ts
    app.route("/admin/api", createAdminApiRoutes({ sql, auth }));
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth,
        codeSender: {
          send: async (chatId, text) => {
            sentCodes.push({ chatId, text });
            return true;
          },
        },
      }),
    );
  });

  // -------------------------------------------------------------------------
  // الدخول
  // -------------------------------------------------------------------------

  it("يرسل الرمز إلى محادثة المسؤول وحده ويفتح جلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect(sentCodes[0]?.chatId).toBe(ADMIN_TELEGRAM);
    // الرمز لا يُخزَّن نصّاً: ما في القاعدة بصمة لا يُستدلّ منها عليه
    const stored = await sql<{ code_hash: string }[]>`select code_hash from admin_login_codes`;
    expect(stored[0]?.code_hash).not.toBe(extractCode(sentCodes[0]?.text ?? ""));

    const overview = await request("/admin", { cookie });
    expect(overview.status).toBe(200);
    expect(await overview.text()).toContain("نظرة عامة");
  });

  it("لا يُرسَل رمز لمن ليس مسؤولاً، ولا يُكشف له أنه ليس مسؤولاً", async () => {
    const rejected = await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: OTHER_TELEGRAM }),
    });
    const UNPROCESSABLE = 422;
    expect(rejected.status).toBe(UNPROCESSABLE);
    expect(sentCodes.length).toBe(0);

    const missing = await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: "999999999" }),
    });
    expect(missing.status).toBe(UNPROCESSABLE);
    // نفس نصّ الرفض حرفاً بحرف: من يجرّب معرّفات لا يفرّق بين «غير موجود» و«ليس مسؤولاً»
    const reason = /notice--error">([^<]+)</;
    const first = (await rejected.text()).match(reason)?.[1];
    const second = (await missing.text()).match(reason)?.[1];
    expect(first).toBeDefined();
    expect(second).toBe(first ?? "");
  });

  it("رمز جديد يُبطِل السابق فلا يصلح رمزان معاً", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const first = extractCode(sentCodes[0]?.text ?? "");
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });

    const stale = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(first));
    expect(stale.ok && stale.value.ok).toBe(false);
  });

  it("محاولات خاطئة متتالية تُقفل الرمز ولو أُدخل الصحيح بعدها", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const correct = extractCode(sentCodes[0]?.text ?? "");

    for (let attempt = 0; attempt < ADMIN_CODE_MAX_ATTEMPTS; attempt += 1) {
      const wrong = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex("000000"));
      expect(wrong.ok && wrong.value.ok).toBe(false);
    }

    const late = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(correct));
    expect(late.ok && late.value.ok).toBe(false);
  });

  it("طلب الرمز محدود بعدد في النافذة", async () => {
    for (let index = 0; index < ADMIN_CODE_MAX_PER_WINDOW; index += 1) {
      const allowed = await auth.issueCode(ADMIN_TELEGRAM, sha256Hex(`code-${index}`));
      expect(allowed.ok && allowed.value.ok).toBe(true);
    }
    const blocked = await auth.issueCode(ADMIN_TELEGRAM, sha256Hex("code-extra"));
    expect(blocked.ok && !blocked.value.ok && blocked.value.error).toBe("RATE_LIMITED");
  });

  it("الرمز يُستهلك مرّة واحدة", async () => {
    await request("/admin/login/code", {
      method: "POST",
      body: form({ telegram_id: ADMIN_TELEGRAM }),
    });
    const code = extractCode(sentCodes[0]?.text ?? "");
    const first = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(first.ok && first.value.ok).toBe(true);
    const second = await auth.consumeCode(ADMIN_TELEGRAM, sha256Hex(code));
    expect(second.ok && second.value.ok).toBe(false);
  });

  it("بلا كعكة: الصفحة تُحوَّل إلى الدخول والواجهة تُجيب 401", async () => {
    const SEE_OTHER = 303;
    const UNAUTHORIZED = 401;
    const page = await request("/admin/drivers");
    expect(page.status).toBe(SEE_OTHER);
    expect(page.headers.get("location")).toBe("/admin/login");

    const api = await request("/admin/api/overview");
    expect(api.status).toBe(UNAUTHORIZED);
  });

  it("الخروج يُبطل الجلسة فوراً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const SEE_OTHER = 303;
    const out = await request("/admin/logout", { method: "POST", cookie });
    expect(out.status).toBe(SEE_OTHER);

    const after = await request("/admin", { cookie });
    expect(after.status).toBe(SEE_OTHER);
  });

  it("سحب صفة المسؤول يُسقط الجلسة في الطلب التالي لا بعد ساعات", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    expect((await request("/admin", { cookie })).status).toBe(200);

    await sql`update users set role = 'rider' where id = ${adminUserId}`;

    const SEE_OTHER = 303;
    expect((await request("/admin", { cookie })).status).toBe(SEE_OTHER);
  });

  // -------------------------------------------------------------------------
  // الصفحات الثماني
  // -------------------------------------------------------------------------

  it("الصفحات الثماني كلّها تُقدَّم بنجاح لجلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const paths = [
      "/admin",
      "/admin/live-orders",
      "/admin/drivers",
      "/admin/heatmap",
      "/admin/disputes",
      "/admin/ratings",
      "/admin/attendance",
      "/admin/settings",
    ];
    for (const path of paths) {
      const response = await request(path, { cookie });
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
      const html = await response.text();
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("مسؤول النظام");
    }
  });

  it("واجهة JSON تعيد نماذج القراءة نفسها", async () => {
    const cookie = await login(ADMIN_TELEGRAM);

    const overview = await request("/admin/api/overview", { cookie });
    expect(overview.status).toBe(200);
    const body = (await overview.json()) as { ok: boolean; counters: { searchingOrders: number } };
    expect(body.ok).toBe(true);
    expect(typeof body.counters.searchingOrders).toBe("number");

    const orders = await request("/admin/api/live-orders", { cookie });
    expect(((await orders.json()) as { ok: boolean }).ok).toBe(true);

    const cities = await request("/admin/api/cities", { cookie });
    const cityList = (await cities.json()) as { cities: { code: string }[] };
    expect(cityList.cities.map((city) => city.code)).toContain("JED");
  });

  it("البحث الموحَّد يجد شخصاً باسمه وبمعرّف تلغرامه", async () => {
    const cookie = await login(ADMIN_TELEGRAM);

    const byName = await request(`/admin/api/search?q=${encodeURIComponent("راكب")}`, { cookie });
    const named = (await byName.json()) as { groups: { title: string; items: unknown[] }[] };
    expect(named.groups[0]?.items.length).toBeGreaterThan(0);

    const byId = await request(`/admin/api/search?q=${OTHER_TELEGRAM}`, { cookie });
    const found = (await byId.json()) as { groups: { items: { detail: string }[] }[] };
    expect(found.groups[0]?.items[0]?.detail).toContain(OTHER_TELEGRAM);

    const empty = await request("/admin/api/search?q=", { cookie });
    expect(((await empty.json()) as { groups: unknown[] }).groups.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // الأفعال الكتابية
  // -------------------------------------------------------------------------

  async function createDriver(): Promise<{ driverId: string; userId: string }> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${DRIVER_TELEGRAM}::bigint, 'سائق قيد التوثيق', '+966500000003', 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}, 'pending', 'sedan', 'ABC-1234')
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`
      insert into driver_availability (city_id, driver_id, is_available)
      values (${cityId}, ${driverId}, true)
    `;
    return { driverId, userId };
  }

  it("توثيق سائق يُسجَّل في سجلّ التدقيق ويظهر أثره في الصفحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    const SEE_OTHER = 303;
    const response = await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf, status: "verified" }),
    });
    expect(response.status).toBe(SEE_OTHER);

    const rows = await sql<{ verification_status: string }[]>`
      select verification_status::text from drivers where id = ${driverId}
    `;
    expect(rows[0]?.verification_status).toBe("verified");

    const audits = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${driverId}
    `;
    expect(audits.length).toBeGreaterThan(0);
  });

  it("سحب التوثيق يُنزل السائق عن الإتاحة في نفس العملية", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf, status: "suspended" }),
    });

    const rows = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(rows[0]?.is_available).toBe(false);
  });

  it("حظر مستخدم يُبطل جلساته ويُنزله عن الإتاحة، والمسؤول لا يحظر نفسه", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId, userId } = await createDriver();
    const csrf = await csrfFrom(cookie, "/admin/drivers");

    await request(`/admin/users/${userId}/blocked`, {
      method: "POST",
      cookie,
      body: form({ csrf, blocked: "1" }),
    });

    const users = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${userId}
    `;
    expect(users[0]?.is_blocked).toBe(true);
    const availability = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(availability[0]?.is_available).toBe(false);

    // حظر النفس مرفوض في القاعدة نفسها: لا اعتماد على إخفاء الزرّ في الواجهة
    await request(`/admin/users/${adminUserId}/blocked`, {
      method: "POST",
      cookie,
      body: form({ csrf, blocked: "1" }),
    });
    const self = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${adminUserId}
    `;
    expect(self[0]?.is_blocked).toBe(false);
    expect((await request("/admin", { cookie })).status).toBe(200);
  });

  it("تعديل إعداد يُغيّر القيمة، ويرفض النوع الخاطئ، ويرفع صفة «مبدئي»", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityId}`);

    // الإعداد مبذور لا مُنشأ في beforeEach، فنُعيده إلى حاله المبدئي
    // كي لا يعتمد الاختبار على أثر تشغيل سابق غيّره.
    await sql`
      update platform_settings set value = '0.01'::jsonb, is_provisional = true
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    const before = await sql<{ is_provisional: boolean }[]>`
      select is_provisional from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(before[0]?.is_provisional).toBe(true);

    await request(`/admin/settings/${cityId}/admin_heatmap_cell_degrees`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: "0.02" }),
    });
    const after = await sql<{ value: number; is_provisional: boolean }[]>`
      select (value #>> '{}')::float8 as value, is_provisional from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(after[0]?.value).toBeCloseTo(0.02);
    expect(after[0]?.is_provisional).toBe(false);

    await request(`/admin/settings/${cityId}/admin_heatmap_cell_degrees`, {
      method: "POST",
      cookie,
      body: form({ csrf, value: '"نصّ لا رقم"' }),
    });
    const unchanged = await sql<{ value: number }[]>`
      select (value #>> '{}')::float8 as value from platform_settings
       where city_id = ${cityId} and key = 'admin_heatmap_cell_degrees'
    `;
    expect(unchanged[0]?.value).toBeCloseTo(0.02);
  });

  it("فعل كتابي بلا رمز CSRF مرفوض ولو كانت الجلسة صالحة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    const FORBIDDEN = 403;

    const response = await request(`/admin/drivers/${driverId}/verification`, {
      method: "POST",
      cookie,
      body: form({ csrf: "0".repeat(64), status: "verified" }),
    });
    expect(response.status).toBe(FORBIDDEN);

    const rows = await sql<{ verification_status: string }[]>`
      select verification_status::text from drivers where id = ${driverId}
    `;
    expect(rows[0]?.verification_status).toBe("pending");
  });

  it("حفظ قروبات مدينة من الواجهة يكتب bigint السالب ويُفعّلها مع أثر تدقيق", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);

    const response = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000001",
        escalation_group_id: "-1009000000002",
        unsubscribed_drivers_group_id: "-1009000000003",
      }),
    });
    expect(response.status).toBe(303);

    const rows = await sql<
      {
        is_active: boolean;
        support: string | null;
        escalation: string | null;
        unsubscribed: string | null;
      }[]
    >`
      select is_active, telegram_support_group_id::text as support,
             telegram_escalation_group_id::text as escalation,
             telegram_unsubscribed_drivers_group_id::text as unsubscribed
        from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({
      is_active: true,
      support: "-1009000000001",
      escalation: "-1009000000002",
      unsubscribed: "-1009000000003",
    });
    const audits = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${cityGroupsId}::uuid
    `;
    expect(audits.map((audit) => audit.action)).toContain("admin.city_group_ids_updated");

    const page = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    const html = await page.text();
    expect(html).toContain("-1009000000001");
    expect(html).toContain("مفعّلة وجاهزة");
    expect(html).toContain("طريقة الحصول على معرّف القروب");
  });

  it("الحفظ الجزئي يبقي المدينة غير مفعّلة ولا يظهرها كمدينة جاهزة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);

    const response = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000101",
        escalation_group_id: "",
        unsubscribed_drivers_group_id: "",
      }),
    });
    expect(response.status).toBe(303);
    const rows = await sql<{ is_active: boolean; support: string | null }[]>`
      select is_active, telegram_support_group_id::text as support from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({ is_active: false, support: "-1009000000101" });

    const page = await request(`/admin/settings?city=${cityGroupsId}`, { cookie });
    expect(await page.text()).toContain("غير جاهزة: حقول قروبات ناقصة");
  });

  it("يرفض القيم غير الصالحة والمكررة ويحمي حفظ القروبات بـ CSRF والجلسة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const csrf = await csrfFrom(cookie, `/admin/settings?city=${cityGroupsId}`);
    const invalid = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "ليس-رقماً",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(invalid.status).toBe(422);

    const duplicate = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf,
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000201",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(duplicate.status).toBe(422);

    const csrfRejected = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      cookie,
      body: form({
        csrf: "0".repeat(64),
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(csrfRejected.status).toBe(403);
    const anonymous = await request(`/admin/settings/${cityGroupsId}/group-ids`, {
      method: "POST",
      body: form({
        csrf,
        support_group_id: "-1009000000201",
        escalation_group_id: "-1009000000202",
        unsubscribed_drivers_group_id: "-1009000000203",
      }),
    });
    expect(anonymous.status).toBe(303);

    const rows = await sql<{ is_active: boolean; support: string | null }[]>`
      select is_active, telegram_support_group_id::text as support from cities where id = ${cityGroupsId}
    `;
    expect(rows[0]).toEqual({ is_active: false, support: null });
  });

  it("الخريطة الحرارية تعدّ الطلب والعرض على شبكة واحدة", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();

    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      select ${cityId}, id from users where telegram_id = ${OTHER_TELEGRAM}::bigint
      returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    await sql`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                          pickup_label, dropoff_label)
      values (${cityId}, ${riderId}, 'transport', 'searching',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
    `;
    await sql`
      update drivers set last_location = st_point(39.1755, 21.5475)::geography,
                         last_location_at = now()
       where id = ${driverId}
    `;

    const response = await request(`/admin/api/heatmap?city=${cityId}&hours=6`, { cookie });
    const grid = (await response.json()) as { totalDemand: number; totalSupply: number };
    expect(grid.totalDemand).toBe(1);
    expect(grid.totalSupply).toBe(1);

    const page = await request(`/admin/heatmap?city=${cityId}`, { cookie });
    expect(page.status).toBe(200);
  });

  it("ملخّص الحضور يحتسب من بقي متاحاً حتى الآن لا صفراً", async () => {
    const cookie = await login(ADMIN_TELEGRAM);
    const { driverId } = await createDriver();
    await sql`
      insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
      values (${cityId}, ${driverId}, true, 'bot', now() - interval '2 hours')
    `;

    const page = await request("/admin/attendance", { cookie });
    const html = await page.text();
    expect(html).toContain("سائق قيد التوثيق");
    // ساعتان متّصلتان حتى الآن: لا يجوز أن تُقرأ صفراً لأنه لم يُطفئ بعد
    expect(html).not.toMatch(/سائق قيد التوثيق[\s\S]{0,400}0 ثانية/);
  });
});
