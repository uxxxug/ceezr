/**
 * الغرض: قياسُ **سلوكِ** حارسِ لوحةِ الإدارةِ ورمزِ `CSRF` على PostgreSQL حقيقيٍّ
 *   — لا وجودِه نصّاً. الضابطُ `SEC-09` من سِجلِّ `F8-08`.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-16.
 * ينتمي إلى: tests/integration
 * الحاكم: `ADR 0134` · `ADR 0133` (سِجلُّ الضوابطِ) · `ADR 0132`
 *
 * ## لِمَ لا يكفي أنَّ الحارسَ مُركَّبٌ نصّاً
 *
 * `check-object-authorization.ts` يُثبِتُ أنَّ ستَّةَ مساراتٍ إداريّةٍ مُستثناةٌ
 * بصنفِ `admin-guard`، أي أنَّ `app.use("*", createAdminGuard(...))` **مكتوبٌ**.
 * وذاكَ إثباتُ تركيبٍ لا إثباتُ رفضٍ. والفرقُ بينَهما هوَ الفرقُ بينَ قُفلٍ
 * مُعلَّقٍ على البابِ وقُفلٍ مُغلَقٍ.
 *
 * وثلاثةُ أعطابٍ حقيقيّةٍ تعبُرُ الفحصَ النصِّيَّ سليمةً:
 *   ١. جلسةٌ **مُبطَلةٌ** أو **منقضيةٌ** ما زالَت كعكتُها في المتصفِّحِ.
 *   ٢. مستخدِمٌ **نُزِعَت عنهُ صفةُ المسؤولِ** أو **حُظِرَ** وجلستُه قائمةٌ.
 *   ٣. كتابةٌ برمزِ `CSRF` مفقودٍ أو مزوَّرٍ.
 *
 * وفي الثالثِ خاصّةً: الردُّ قد يقولُ «مرفوضٌ» **وقد كتبَ**. فالقياسُ ههنا
 * **بالأثرِ**: لقطةُ الحالةِ قبلَ النداءِ تُساوي ما بعدَه (`ADR 0132`).
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

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ حارسِ اللوحةِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

/** رمزُ إعادةِ التوجيهِ إلى صفحةِ الدخولِ — شكلُ الرفضِ في نمطِ الصفحةِ. */
const SEE_OTHER = 303;
/** رفضُ `CSRF` نصّاً لا تحويلاً: الكتابةُ لا تُغفَرُ بإعادةِ توجيهٍ. */
const FORBIDDEN = 403;

describeIf("حارسُ لوحةِ الإدارةِ ورمزُ CSRF مقيسانِ بالسلوكِ (SEC-09)", () => {
  let sql: Sql;
  let cityId: string;

  const TG_ADMIN = 900000991;
  const TG_RIDER = 900000992;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'MKK'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ على قاعدةِ الاختبارِ");
    cityId = id;
  });

  /**
   * النزعُ **بترتيبِ التبعيّةِ**: `open_admin_session` تكتبُ في `audit_log`،
   * و`audit_log_actor_user_id_fkey` يمنعُ حذفَ المستخدِمِ قبلَ أثرِه. وذاكَ قيدٌ
   * **صحيحٌ** أوقعَه المخطَّطُ الحقيقيُّ في أوّلِ جريةٍ — ولم يُطفَأ بـ`cascade`
   * على جدولٍ مشتركٍ، بل نُزِعَ الأثرُ بمعرِّفِ فاعلِه وحدَه.
   */
  const purge = async (): Promise<void> => {
    await sql`
      delete from audit_log where actor_user_id in (
        select id from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_RIDER}::bigint)
      )
    `;
    await sql`
      delete from admin_sessions where user_id in (
        select id from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_RIDER}::bigint)
      )
    `;
    await sql`delete from users where telegram_id in (${TG_ADMIN}::bigint, ${TG_RIDER}::bigint)`;
  };

  afterAll(async () => {
    await purge();
    await sql.end({ timeout: 5 });
  });

  /**
   * لا `truncate` لجدولِ `users`: هذا الملفُّ يعملُ إلى جانبِ غيرِه على قاعدةٍ
   * واحدةٍ، ومَن يقتلعُ جدولاً مشتركاً يُسقِطُ ملفّاً آخرَ ثمَّ يُقرأُ سقوطُه
   * انحداراً. فالبذرُ **بمعرِّفاتٍ خاصّةٍ** والنزعُ بها.
   */
  beforeEach(async () => {
    await purge();
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${TG_ADMIN}::bigint, 'مسؤولُ القياسِ', '+966500000991', 'ar', 'admin'),
             (${cityId}, ${TG_RIDER}::bigint, 'راكبُ القياسِ',  '+966500000992', 'ar', 'rider')
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
      }),
    );
    return app;
  };

  /** يفتحُ جلسةً حقيقيّةً بالدالّةِ نفسِها التي يستعملُها الإنتاجُ، ويُعيدُ رمزَها. */
  const openSession = async (telegramId: number): Promise<{ token: string; hash: string }> => {
    const token = generateSessionToken();
    const hash = sha256Hex(token);
    const result = await createAdminAuthPort(sql).openSession(
      await userIdOf(telegramId),
      hash,
      "قياسُ SEC-09",
    );
    if (!result.ok || !result.value.ok) {
      throw new Error(`تعذَّرَ فتحُ الجلسةِ: ${JSON.stringify(result)}`);
    }
    return { token, hash };
  };

  const get = async (app: Hono, path: string, cookie?: string): Promise<Response> =>
    await app.fetch(
      new Request(`http://localhost${path}`, {
        redirect: "manual",
        ...(cookie === undefined ? {} : { headers: { cookie } }),
      }),
    );

  it("جلسةٌ حقيقيّةٌ تفتحُ اللوحةَ — وإلّا كانَ القياسُ التاليَ بلا معنى", async () => {
    // الطرفُ الموجَبُ أوّلاً: حاجزٌ يرفضُ كلَّ شيءٍ يمرُّ بكلِّ سالبةٍ وهوَ معطوبٌ.
    const { token } = await openSession(TG_ADMIN);
    const response = await get(buildApp(), "/admin", `${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(200);
  });

  it("جلسةٌ مُبطَلةٌ تُرَدُّ وإن كانَت كعكتُها سليمةً حرفاً", async () => {
    const { token, hash } = await openSession(TG_ADMIN);
    await sql`update admin_sessions set revoked_at = now() where token_hash = ${hash}`;

    const response = await get(buildApp(), "/admin", `${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(SEE_OTHER);
  });

  it("جلسةٌ منقضيةٌ تُرَدُّ — والوقتُ يُزوَّرُ في القاعدةِ لا يُنتظَرُ", async () => {
    const { token, hash } = await openSession(TG_ADMIN);
    await sql`update admin_sessions set expires_at = now() - interval '1 second' where token_hash = ${hash}`;

    const response = await get(buildApp(), "/admin", `${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(SEE_OTHER);
  });

  it("مَن نُزِعَت عنهُ صفةُ المسؤولِ يُرَدُّ **وتُبطَلُ جلستُه** لا تُترَكُ حيّةً", async () => {
    // ردٌّ بلا إبطالٍ يُبقي المفتاحَ في يدِ مَن سُحِبَت صفتُه: تُعادُ إليهِ
    // الصفةُ لحظةً لأيِّ سببٍ فتعملُ الكعكةُ القديمةُ من جديدٍ.
    const { token, hash } = await openSession(TG_ADMIN);
    await sql`update users set role = 'rider' where telegram_id = ${TG_ADMIN}::bigint`;

    const response = await get(buildApp(), "/admin", `${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(SEE_OTHER);

    const rows = await sql<{ revoked_at: Date | null }[]>`
      select revoked_at from admin_sessions where token_hash = ${hash}
    `;
    expect(rows[0]?.revoked_at).not.toBeNull();
  });

  it("مسؤولٌ محظورٌ يُرَدُّ — والحظرُ لا يمرُّ عبرَ جلسةٍ سابقةٍ", async () => {
    const { token } = await openSession(TG_ADMIN);
    await sql`update users set is_blocked = true where telegram_id = ${TG_ADMIN}::bigint`;

    const response = await get(buildApp(), "/admin", `${ADMIN_SESSION_COOKIE}=${token}`);
    expect(response.status).toBe(SEE_OTHER);
  });

  it("راكبٌ لا تُفتَحُ لهُ جلسةُ لوحةٍ أصلاً: `NOT_ADMIN` من القاعدةِ لا من الطبقةِ", async () => {
    // الرفضُ في `open_admin_session` نفسِها (`security definer`)، فلو نُسِيَ
    // فحصُ الدورِ في الطبقةِ يوماً لم يُفتَح البابُ.
    const result = await createAdminAuthPort(sql).openSession(
      await userIdOf(TG_RIDER),
      sha256Hex(generateSessionToken()),
      "قياسُ SEC-09",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ok).toBe(false);
      if (!result.value.ok) expect(result.value.error).toBe("NOT_ADMIN");
    }

    const sessions = await sql<{ id: string }[]>`
      select s.id from admin_sessions s
        join users u on u.id = s.user_id
       where u.telegram_id = ${TG_RIDER}::bigint
    `;
    expect(sessions).toHaveLength(0);
  });

  it("بلا كعكةٍ: اللوحةُ تُحوِّلُ إلى الدخولِ ولا تُعيدُ ٢٠٠ ولا ٥٠٠", async () => {
    expect((await get(buildApp(), "/admin")).status).toBe(SEE_OTHER);
    expect((await get(buildApp(), "/admin/drivers")).status).toBe(SEE_OTHER);
    expect((await get(buildApp(), "/admin/settings")).status).toBe(SEE_OTHER);
  });

  it("كتابةٌ برمزِ CSRF مزوَّرٍ تُرفَضُ **ولا تُغيِّرُ صفّاً**", async () => {
    const { token } = await openSession(TG_ADMIN);
    const riderId = await userIdOf(TG_RIDER);
    const before = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderId}::uuid
    `;
    expect(before[0]?.is_blocked).toBe(false);

    const form = new FormData();
    form.set("csrf", "0".repeat(64));
    form.set("blocked", "true");
    const response = await buildApp().fetch(
      new Request(`http://localhost/admin/users/${riderId}/blocked`, {
        method: "POST",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
        body: form,
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(FORBIDDEN);

    // وهذا هوَ التوكيدُ الذي يُهِمُّ: الردُّ قد يكذبُ، والصفُّ لا يكذبُ.
    const after = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderId}::uuid
    `;
    expect(after[0]?.is_blocked).toBe(false);
  });

  it("كتابةٌ بلا رمزِ CSRF أصلاً تُرفَضُ **ولا تُغيِّرُ صفّاً**", async () => {
    const { token } = await openSession(TG_ADMIN);
    const riderId = await userIdOf(TG_RIDER);

    const form = new FormData();
    form.set("blocked", "true");
    const response = await buildApp().fetch(
      new Request(`http://localhost/admin/users/${riderId}/blocked`, {
        method: "POST",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
        body: form,
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(FORBIDDEN);

    const after = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderId}::uuid
    `;
    expect(after[0]?.is_blocked).toBe(false);
  });

  it("كتابةٌ **بلا جلسةٍ** تُرفَضُ ولا تُغيِّرُ صفّاً وإن حملَت رمزاً", async () => {
    // الحارسُ يسبقُ `requireCsrf`: فلو انعكسَ الترتيبُ يوماً لَصارَ الرمزُ
    // وحدَه مفتاحاً، وهوَ مُشتَقٌّ من بصمةِ جلسةٍ — أي لا جلسةَ لا رمزَ.
    const riderId = await userIdOf(TG_RIDER);
    const form = new FormData();
    form.set("csrf", "0".repeat(64));
    form.set("blocked", "true");

    const response = await buildApp().fetch(
      new Request(`http://localhost/admin/users/${riderId}/blocked`, {
        method: "POST",
        body: form,
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(SEE_OTHER);

    const after = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderId}::uuid
    `;
    expect(after[0]?.is_blocked).toBe(false);
  });

  it("والكتابةُ الصحيحةُ تنفُذُ: الحاجزُ يمنعُ الباطلَ لا كلَّ شيءٍ", async () => {
    // بلا هذا التوكيدِ يمرُّ حارسٌ يرفضُ كلَّ كتابةٍ — أخضرَ ومعطوباً.
    const { token, hash } = await openSession(TG_ADMIN);
    const riderId = await userIdOf(TG_RIDER);

    const form = new FormData();
    form.set("csrf", sha256Hex(`${hash}:csrf`));
    form.set("blocked", "true");
    const response = await buildApp().fetch(
      new Request(`http://localhost/admin/users/${riderId}/blocked`, {
        method: "POST",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
        body: form,
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(SEE_OTHER);

    const after = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${riderId}::uuid
    `;
    expect(after[0]?.is_blocked).toBe(true);
  });
});
