/**
 * الغرض: قياسُ **سلوكِ** البابِ الموازي للإدارةِ (break-glass) على PostgreSQL
 *   حقيقيٍّ — لا وجودِه نصّاً. الضابطُ `SEC-21` (ADR 0176).
 * الحالة: منفّذٌ فعليّاً — 2026-09-23.
 * ينتمي إلى: tests/integration
 * الحاكم: `ADR 0176` · `ADR 0132` (القياسُ بالأثرِ) · `ح-7`
 *
 * ## ما الذي يُقاسُ ههنا ولِمَ
 *
 * التشفيرُ نفسُهُ (scrypt · RFC 6238 · AES-GCM) مُقاسٌ بمتجهاتِ المعيارِ في
 * `tests/unit/break-glass-crypto.test.ts`. وههنا يُقاسُ ما لا يظهرُ إلّا على
 * قاعدةٍ حقيقيّةٍ: ذرّيّةُ الإتمامِ، ووسمُ الجلسةِ بالأصلِ (`origin`)، وبوّابةُ
 * «التسجيلُ من تيليجرامَ فحسبُ»، والإقفالُ بعدَ خمسِ محاولاتٍ، ورفضُ إعادةِ
 * استعمالِ الرمزِ، ووحدةُ الردِّ العامِّ بينَ الاسمِ المجهولِ وكلمةِ السرِّ
 * الخاطئةِ، والأثرُ التدقيقيُّ بلا أسرارٍ ولا أسماءٍ منتحَلةٍ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import {
  ADMIN_SESSION_COOKIE,
  createAdminAuthPort,
  generateSessionToken,
  sha256Hex,
} from "../../apps/gateway/src/admin/auth.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  totpCode,
  totpCounterAt,
} from "../../packages/infrastructure/identity/break-glass-crypto.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ البابِ الموازي مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const SEE_OTHER = 303;
const HTML_UNPROCESSABLE = 422;
const TOTP_KEY = "dGVzdC1icmVhay1nbGFzcy10b3RwLWtleS0zMi1ieXRlcy1sb25n";
const LOGIN_NAME = "bg-ops-measurer";

describeIf("البابُ الموازي للإدارةِ مقيسًا بالسلوكِ (SEC-21)", () => {
  let sql: Sql;
  let cityId: string;

  const TG_ADMIN = 900001071;
  const TG_SECOND = 900001072;
  const TG_RIDER = 900001073;

  const purge = async (): Promise<void> => {
    await sql`
      delete from audit_log where actor_user_id in (
        select id from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_SECOND}::bigint, ${TG_RIDER}::bigint)
      )
    `;
    await sql`
      delete from admin_sessions where user_id in (
        select id from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_SECOND}::bigint, ${TG_RIDER}::bigint)
      )
    `;
    await sql`
      delete from admin_break_glass_credentials where user_id in (
        select id from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_SECOND}::bigint, ${TG_RIDER}::bigint)
      )
    `;
    await sql`
      delete from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_SECOND}::bigint, ${TG_RIDER}::bigint)
    `;
  };

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ على قاعدةِ الاختبارِ");
    cityId = id;
  });

  afterAll(async () => {
    await purge();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await purge();
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${TG_ADMIN}::bigint, 'مسؤولُ البابِ', '+966500001071', 'ar', 'admin'),
             (${cityId}, ${TG_SECOND}::bigint, 'مسؤولٌ ثانٍ', '+966500001072', 'ar', 'admin'),
             (${cityId}, ${TG_RIDER}::bigint, 'راكبٌ لا بابَ له', '+966500001073', 'ar', 'rider')
    `;
  });

  const userIdOf = async (telegramId: number): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      select id from users where telegram_id = ${telegramId}::bigint
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`لم يُبذَر المستخدِمُ ${telegramId}`);
    return id;
  };

  const buildApp = (): Hono => {
    const app = new Hono();
    app.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth: createAdminAuthPort(sql),
        codeSender: { send: async () => true },
        breakGlassTotpKey: TOTP_KEY,
      }),
    );
    return app;
  };

  const openTelegramSession = async (telegramId: number): Promise<string> => {
    const token = generateSessionToken();
    const result = await createAdminAuthPort(sql).openSession(
      await userIdOf(telegramId),
      sha256Hex(token),
      "قياسُ SEC-21",
    );
    if (!result.ok || !result.value.ok) throw new Error(`تعذَّرَ فتحُ الجلسةِ`);
    return token;
  };

  const postForm = async (
    app: Hono,
    path: string,
    fields: Record<string, string>,
    cookie?: string,
  ): Promise<Response> => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return await app.fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        redirect: "manual",
        body: form,
        ...(cookie === undefined ? {} : { headers: { cookie } }),
      }),
    );
  };

  const enrollViaHttp = async (
    telegramId: number,
    password: string,
    loginName: string = LOGIN_NAME,
  ): Promise<{ secret: string; app: Hono; cookie: string }> => {
    const app = buildApp();
    const sessionToken = await openTelegramSession(telegramId);
    const cookie = `${ADMIN_SESSION_COOKIE}=${sessionToken}`;
    const csrf = sha256Hex(`${sha256Hex(sessionToken)}:csrf`);
    const response = await postForm(
      app,
      "/admin/break-glass",
      { login_name: loginName, password, csrf },
      cookie,
    );
    const html = await response.text();
    if (response.status !== 200)
      throw new Error(`فشلَ التسجيلُ (${response.status}): ${html.slice(0, 400)}`);
    const match = /secret=([A-Z2-7]+)/.exec(html);
    if (match === null || match[1] === undefined) {
      throw new Error("لم يُعرَض رابطُ otpauth في صفحةِ التسجيل");
    }
    return { secret: match[1], app, cookie: sessionToken };
  };

  const currentCode = (secret: string): string =>
    totpCode(secret, totpCounterAt(Math.floor(Date.now() / 1000)));

  it("التسجيلُ من جلسةِ تيليجرامَ يُنشئ الاعتمادَ ويُدقِّقُ الأثرَ", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    expect(secret.length).toBe(32);

    const rows = await sql<{ action: string; payload: Record<string, unknown> }[]>`
      select action, payload from audit_log
      where action in ('admin.break_glass_enrolled', 'admin.break_glass_login_rejected')
        and actor_user_id = ${await userIdOf(TG_ADMIN)}::uuid
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.action).toBe("admin.break_glass_enrolled");
    expect(rows[0]?.payload).toMatchObject({ login_name: LOGIN_NAME, rotated: false });
  });

  it("التدويرُ: نداءُ التسجيلِ مرّةً ثانيةً يستبدلُ السرَّينِ ويُصفِّرُ العدّادِ", async () => {
    await enrollViaHttp(TG_ADMIN, "first-password-123");
    const { secret } = await enrollViaHttp(TG_ADMIN, "second-password-456");
    const rows = await sql<{ rotated: boolean }[]>`
      select (payload->>'rotated')::boolean as rotated from audit_log
      where action = 'admin.break_glass_enrolled' and actor_user_id = ${await userIdOf(TG_ADMIN)}::uuid
      order by created_at asc
    `;
    expect(rows.length).toBe(2);
    expect(rows[1]?.rotated).toBe(true);
    // العدّادُ مُصفَّرٌ: الرمزُ الحاليُّ من السرِّ الجديدِ يفتحُ البابَ
    const app = buildApp();
    const response = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "second-password-456",
      totp_code: currentCode(secret),
    });
    expect(response.status).toBe(SEE_OTHER);
  });

  it("الدخولُ منَ البابِ يفتحُ جلسةً موسومةً origin=break_glass وتعملُ كجلسةِ إدارةٍ", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const app = buildApp();
    const response = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: currentCode(secret),
    });
    expect(response.status).toBe(SEE_OTHER);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    const token = /waslah_admin=([^;]+)/.exec(setCookie ?? "")?.[1];
    expect(token).toBeDefined();

    const session = await sql<{ origin: string }[]>`
      select origin from admin_sessions where token_hash = ${sha256Hex(token ?? "")}::text
    `;
    expect(session[0]?.origin).toBe("break_glass");

    // الجلسةُ تعملُ أمامَ الحارسِ — والرسمُ البيانيُّ: صفحةُ اللوحةِ تُفتحُ
    const opened = await app.fetch(
      new Request("http://localhost/admin", {
        redirect: "manual",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      }),
    );
    expect(opened.status).toBe(200);

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where action = 'admin.break_glass_session_opened' and actor_user_id = ${await userIdOf(TG_ADMIN)}::uuid
    `;
    expect(audit[0]?.n).toBe(1);
  });

  it("رمزُ TOTP لا يُستعمَلُ مرّتَينِ: الإعادةُ مرفوضةٌ وعدّادُ الفشلِ لا يُعدُّها", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const app = buildApp();
    const code = currentCode(secret);
    const first = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: code,
    });
    expect(first.status).toBe(SEE_OTHER);
    const replay = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: code,
    });
    expect(replay.status).toBe(HTML_UNPROCESSABLE);
    // الإعادةُ رفضٌ لكن لا عدَّادَ فشلٍ عليها ولا إقفالًا: العدُّ للفشلِ لا للنجاحِ المُكرَّرِ
    const cred = await sql<{ failed_attempts: number }[]>`
      select failed_attempts from admin_break_glass_credentials where login_name = ${LOGIN_NAME}::text
    `;
    expect(cred[0]?.failed_attempts).toBe(0);
  });

  it("خمسُ محاولاتٍ فاشلةٍ تُقفِلُ البابَ ربعَ ساعةٍ وتُدقِّقُ الرفضَ", async () => {
    await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const app = buildApp();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await postForm(app, "/admin/login/break-glass", {
        login_name: LOGIN_NAME,
        password: "wrong-password-attempt",
        totp_code: "123456",
      });
      expect(response.status).toBe(HTML_UNPROCESSABLE);
    }
    const cred = await sql<{ failed_attempts: number; locked_until: Date | null }[]>`
      select failed_attempts, locked_until from admin_break_glass_credentials where login_name = ${LOGIN_NAME}::text
    `;
    expect(cred[0]?.failed_attempts).toBe(5);
    expect(cred[0]?.locked_until).not.toBeNull();
    expect(new Date(cred[0]?.locked_until ?? 0).getTime()).toBeGreaterThan(Date.now());

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where action = 'admin.break_glass_login_rejected' and actor_user_id = ${await userIdOf(TG_ADMIN)}::uuid
    `;
    expect(audit[0]?.n).toBe(5);
  });

  it("الاسمُ المجهولُ يُجابُ بالردِّ نفسِهِ ولا يُنتحِلُ مستخدمًا في التدقيقِ", async () => {
    const app = buildApp();
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where action like 'admin.break_glass%'
    `;
    const response = await postForm(app, "/admin/login/break-glass", {
      login_name: "ghost-admin-name",
      password: "whatever-password-1",
      totp_code: "000000",
    });
    expect(response.status).toBe(HTML_UNPROCESSABLE);
    const text = await response.text();
    expect(text).toContain("اعتمادٌ غيرُ صحيحٍ");

    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where action like 'admin.break_glass%'
    `;
    expect(after[0]?.n).toBe(before[0]?.n);
    // ولا صفَّ اعتمادٍ وُلدَ للاسمِ المجهولِ
    const ghost = await sql<{ n: number }[]>`
      select count(*)::int as n from admin_break_glass_credentials where login_name = 'ghost-admin-name'
    `;
    expect(ghost[0]?.n).toBe(0);
  });

  it("غيرُ المسؤولِ لا يصلُ إلى صفحةِ التسجيلِ أصلاً (الحارسُ يردُّه قبلَ الدالّةِ)", async () => {
    // `open_admin_session` نفسُها ترفضُ فتحَ جلسةِ إدارةٍ لغيرِ المسؤولِ — فالحارسُ
    // هو الخطُّ الأولُ والدالّةُ الخطُّ الأخيرُ، وبينَهما لا ثغرةَ. القياسُ هنا
    // لخطِّ الحارسِ: غيرُ المسؤولِ يُحوَّلُ إلى الدخولِ ولا يبلغُ نموذجَ البابِ.
    const app = buildApp();
    const response = await app.fetch(
      new Request("http://localhost/admin/break-glass", { redirect: "manual" }),
    );
    expect(response.status).toBe(SEE_OTHER);
    // والراكبُ لا يملكُ جلسةً أصلًا ليجربَ بها: فتحُها له مرفوضٌ من القاعدةِ
    const attempted = await createAdminAuthPort(sql).openSession(
      await userIdOf(TG_RIDER),
      sha256Hex(generateSessionToken()),
      "محاولةُ راكبٍ",
    );
    expect(attempted.ok === true && attempted.value.ok).toBe(false);
  });

  it("جلسةُ البابِ نفسِهِ لا تُنشئُ بابًا موازيًا (إثباتُ الهويّةِ الأولُ تيليجرام)", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const app = buildApp();
    const login = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: currentCode(secret),
    });
    expect(login.status).toBe(SEE_OTHER);
    const breakToken =
      /waslah_admin=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";

    // الآنَ جرّبِ التسجيلَ من جلسةِ البابِ — الرفضُ أصيلٌ منَ القاعدةِ
    const csrf = sha256Hex(`${sha256Hex(breakToken)}:csrf`);
    const enroll = await postForm(
      app,
      "/admin/break-glass",
      { login_name: "second-door", password: "another-strong-pw", csrf },
      `${ADMIN_SESSION_COOKIE}=${breakToken}`,
    );
    expect(enroll.status).toBe(HTML_UNPROCESSABLE);
    const cred = await sql<{ n: number }[]>`
      select count(*)::int as n from admin_break_glass_credentials where login_name = 'second-door'
    `;
    expect(cred[0]?.n).toBe(0);
  });

  it("مسؤولٌ زالَ عنهُ الدورُ لا يفتحُ البابَ باعتمادِهِ القديمِ", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    await sql`update users set role = 'rider' where telegram_id = ${TG_ADMIN}::bigint`;
    const app = buildApp();
    const response = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: currentCode(secret),
    });
    expect(response.status).toBe(HTML_UNPROCESSABLE);
    // والرفضُ لا يُدقَّقُ كفشلِ دخولٍ: مالكُ الاعتمادِ لم يعُدْ مسؤولًا فعدُّهُ موتٌ لا حياةٌ
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where action = 'admin.break_glass_login_rejected' and actor_user_id = ${await userIdOf(TG_ADMIN)}::uuid
    `;
    expect(audit[0]?.n).toBe(0);
  });

  it("الاسمُ محجوزٌ لمسؤولٍ آخرَ لا يُسرَقُ بالتسجيلِ", async () => {
    await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1", "taken-name");
    const sessionToken = await openTelegramSession(TG_SECOND);
    const app = buildApp();
    const csrf = sha256Hex(`${sha256Hex(sessionToken)}:csrf`);
    const response = await postForm(
      app,
      "/admin/break-glass",
      { login_name: "taken-name", password: "second-password-99", csrf },
      `${ADMIN_SESSION_COOKIE}=${sessionToken}`,
    );
    expect(response.status).toBe(HTML_UNPROCESSABLE);
    const rows = await sql<{ user_id: string }[]>`
      select user_id::text as user_id from admin_break_glass_credentials where login_name = 'taken-name'
    `;
    expect(rows[0]?.user_id).toBe(await userIdOf(TG_ADMIN));
  });

  it("التعطيلُ يُطفئ البابَ والاعتمادُ لا يُحذفُ (الأثرُ يبقى)", async () => {
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const sessionToken = await openTelegramSession(TG_ADMIN);
    const app = buildApp();
    const csrf = sha256Hex(`${sha256Hex(sessionToken)}:csrf`);
    const disable = await postForm(
      app,
      "/admin/break-glass/disable",
      { csrf },
      `${ADMIN_SESSION_COOKIE}=${sessionToken}`,
    );
    expect(disable.status).toBe(SEE_OTHER);

    const cred = await sql<{ is_active: boolean }[]>`
      select is_active from admin_break_glass_credentials where login_name = ${LOGIN_NAME}::text
    `;
    expect(cred[0]?.is_active).toBe(false);

    const login = await postForm(app, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: currentCode(secret),
    });
    expect(login.status).toBe(HTML_UNPROCESSABLE);

    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where action = 'admin.break_glass_disabled'
    `;
    expect(audit[0]?.n).toBe(1);
  });

  it("صفحةُ الدخولِ تعرضُ البابَ بوصلٍ صريحٍ، والرسمُ بلا مفتاحِ تشفيرٍ يوحَّدُ رفضُهُ", async () => {
    const app = buildApp();
    const page = await app.fetch(new Request("http://localhost/admin/login?break=1"));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("/admin/login/break-glass");

    // بلا مفتاحِ: رفضٌ موحَّدٌ لا 500 — البابُ يُطرَقُ فلا يُفتَحُ ولا تسقطُ الخدمةُ
    const appNoKey = new Hono();
    appNoKey.route(
      "/admin",
      createAdminUiRoutes({
        sql,
        auth: createAdminAuthPort(sql),
        codeSender: { send: async () => true },
        breakGlassTotpKey: null,
      }),
    );
    const { secret } = await enrollViaHttp(TG_ADMIN, "waseelah-strong-pw-1");
    const rejected = await postForm(appNoKey, "/admin/login/break-glass", {
      login_name: LOGIN_NAME,
      password: "waseelah-strong-pw-1",
      totp_code: currentCode(secret),
    });
    expect(rejected.status).toBe(HTML_UNPROCESSABLE);
  });
});
