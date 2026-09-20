/**
 * الغرض: قياسُ **الأثرِ التدقيقيِّ بالأثرِ** على PostgreSQL حقيقيٍّ — أنَّ فعلَ
 *   الفاعلِ المُتسلِّطِ يُخلِّفُ صفّاً واحداً بمعناهُ الصحيحِ عندَ النجاحِ، وأنَّ
 *   **الرفضَ لا يُخلِّفُ شيئاً**. الضابطُ `SEC-12` من سِجلِّ `F8-08`.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-16.
 * ينتمي إلى: tests/integration
 * الحاكم: `ADR 0136` · `ADR 0133` (سِجلُّ الضوابطِ) · `ADR 0132`
 *
 * ## لِمَ لا يكفي حاجزُ النصِّ
 *
 * `check-audit-actions.ts` يُثبِتُ أنَّ `insert into audit_log` **مكتوبٌ** في كلِّ
 * دالَّةٍ مُتسلِّطةٍ باسمِ فعلٍ مُعلَنٍ. وذاكَ إثباتُ كتابةٍ في **الملفِّ** لا إثباتُ
 * صفٍّ في **الجدولِ**. وثلاثةُ أعطابٍ تعبُرُ الفحصَ النصِّيَّ سليمةً:
 *
 *   ١. **الرفضُ يُخلِّفُ أثراً**: فرعٌ يكتبُ ثمَّ يرجعُ بالخطأِ، فيُقرأُ السِجلُّ
 *      أفعالاً لم تقعْ. **وسِجلٌّ يعدُّ المحاولاتِ أفعالاً أسوأُ من لا سِجلٍّ**،
 *      لأنَّهُ يُتَّهَمُ بهِ بريءٌ.
 *   ٢. **النجاحُ يُخلِّفُ أثراً بمدينةِ الفاعلِ لا بمدينةِ الحادثةِ**: فتُقرأُ
 *      الأفعالُ بمكانِ جالسِها لا بمكانِ أثرِها. ولذا يُبذَرُ الفاعلُ ههنا في
 *      **مدينةٍ غيرِ مدينةِ البلاغِ** قصداً — وبلا ذلكَ يمرُّ العطبُ لأنَّ
 *      المدينتَينِ واحدةٌ فيتساوى الصحيحُ والخطأُ.
 *   ٣. **الأثرُ لا يُميِّزُ الفعلَ**: اسمٌ واحدٌ لفعلَينِ، أو حمولةٌ لا تحملُ القرارَ
 *      فيُستنتَجُ من التجاورِ الزمنيِّ — ومَن استنتجَ من التجاورِ قرأَ صُدفةً.
 *
 * والقياسُ في كلِّ حالةٍ **بلقطةِ عدَدٍ قبلَ النداءِ وبعدَه** (`ADR 0132`): الكتابةُ
 * تُحكَمُ بأثرِها لا بما يرجعُ بهِ النداءُ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ الأثرِ التدقيقيِّ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

interface AuditRow {
  readonly action: string;
  readonly city_id: string;
  readonly actor_user_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly payload: Record<string, unknown>;
}

describeIf("الأثرُ التدقيقيُّ مقيسٌ بالأثرِ لا بالنصِّ (SEC-12)", () => {
  let sql: Sql;
  /** مدينةُ **البلاغِ**. */
  let incidentCityId: string;
  /** مدينةُ **الفاعلِ** — مختلفةٌ قصداً. */
  let actorCityId: string;

  const TG_ADMIN = 900000981;
  const TG_REPORTER = 900000982;
  const TG_RIDER = 900000983;

  let adminId = "";
  let reporterId = "";
  let riderId = "";
  let incidentId = "";

  const telegramIds = [TG_ADMIN, TG_REPORTER, TG_RIDER];

  /**
   * النزعُ **بترتيبِ التبعيّةِ**: الأثرُ يُنزَعُ بمعرِّفِ فاعلِه، ثمَّ البلاغاتُ،
   * ثمَّ الطلباتُ، ثمَّ المستخدِمونَ. ولا `truncate` لجدولٍ مشتركٍ: هذا الملفُّ
   * يعملُ إلى جانبِ غيرِه على قاعدةٍ واحدةٍ، ومَن يقتلعُ جدولاً مشتركاً يُسقِطُ
   * ملفّاً آخرَ ثمَّ يُقرأُ سقوطُه انحداراً.
   */
  const purge = async (): Promise<void> => {
    await sql`
      delete from audit_log where actor_user_id in (
        select id from users where telegram_id = any(${telegramIds}::bigint[])
      )
    `;
    await sql`
      delete from safety_incidents where reporter_user_id in (
        select id from users where telegram_id = any(${telegramIds}::bigint[])
      )
    `;
    await sql`
      delete from orders where rider_id in (
        select id from riders where user_id in (
          select id from users where telegram_id = any(${telegramIds}::bigint[])
        )
      )
    `;
    await sql`
      delete from riders where user_id in (
        select id from users where telegram_id = any(${telegramIds}::bigint[])
      )
    `;
    await sql`delete from users where telegram_id = any(${telegramIds}::bigint[])`;
  };

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ code: string; id: string }[]>`
      select code, id from cities where code in ('MKK', 'RUH')
    `;
    const incident = cities.find((city) => city.code === "MKK")?.id;
    const actor = cities.find((city) => city.code === "RUH")?.id;
    if (incident === undefined || actor === undefined) {
      throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ على قاعدةِ الاختبارِ");
    }
    incidentCityId = incident;
    actorCityId = actor;
  });

  afterAll(async () => {
    await purge();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await purge();
    const users = await sql<{ id: string; telegram_id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${actorCityId},    ${TG_ADMIN}::bigint,    'مسؤولُ الأثرِ', '+966500000981', 'ar', 'admin'),
             (${incidentCityId}, ${TG_REPORTER}::bigint, 'مُبلِّغُ الأثرِ', '+966500000982', 'ar', 'rider'),
             (${incidentCityId}, ${TG_RIDER}::bigint,    'راكبُ الأثرِ',  '+966500000983', 'ar', 'rider')
      returning id, telegram_id
    `;
    const byTelegram = new Map(users.map((row) => [String(row.telegram_id), row.id]));
    adminId = byTelegram.get(String(TG_ADMIN)) ?? "";
    reporterId = byTelegram.get(String(TG_REPORTER)) ?? "";
    riderId = byTelegram.get(String(TG_RIDER)) ?? "";
    if (adminId === "" || reporterId === "" || riderId === "") throw new Error("تعذّرَ البذرُ");

    // `orders.rider_id` يشيرُ إلى `riders` لا إلى `users` — مقيسٌ من قيدِ
    // `orders_rider_id_fkey` في أوّلِ جريةٍ، فيُبذَرُ ملفُّ الراكبِ أوّلاً.
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${incidentCityId}, ${reporterId}::uuid)
      returning id
    `;
    const riderProfileId = riders[0]?.id;
    if (riderProfileId === undefined) throw new Error("تعذّرَ زرعُ ملفِّ الراكبِ");

    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${incidentCityId}, ${riderProfileId}::uuid, 'transport', 'searching',
              st_setsrid(st_makepoint(39.826, 21.389), 4326)::geography)
      returning id
    `;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("تعذّرَ زرعُ الطلبِ");

    const incidents = await sql<{ id: string }[]>`
      insert into safety_incidents (city_id, order_id, reporter_role, reporter_user_id, status)
      values (${incidentCityId}, ${orderId}::uuid, 'rider', ${reporterId}::uuid, 'open')
      returning id
    `;
    const id = incidents[0]?.id;
    if (id === undefined) throw new Error("تعذّرَ زرعُ البلاغِ");
    incidentId = id;
  });

  /** عددُ صفوفِ الأثرِ لفاعلي القياسِ — لقطةٌ تُقارَنُ قبلَ النداءِ وبعدَه. */
  const auditCount = async (): Promise<number> => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_log where actor_user_id = any(
        select id from users where telegram_id = any(${telegramIds}::bigint[])
      )
    `;
    return Number(rows[0]?.n ?? "-1");
  };

  const auditRows = async (): Promise<readonly AuditRow[]> =>
    await sql<AuditRow[]>`
      select action, city_id::text, actor_user_id::text, entity_type, entity_id::text, payload
        from audit_log
       where actor_user_id = any(
         select id from users where telegram_id = any(${telegramIds}::bigint[])
       )
       order by created_at, action
    `;

  const claim = async (telegramId: number): Promise<Record<string, unknown>> => {
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select claim_safety_incident(${incidentId}::uuid, ${telegramId}::bigint) as result
    `;
    return rows[0]?.result ?? {};
  };

  const resolve = async (
    telegramId: number,
    decision: string,
    decisionReason: string = "resolved",
  ): Promise<Record<string, unknown>> => {
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select resolve_safety_incident(${incidentId}::uuid, ${telegramId}::bigint, ${decision}, ${decisionReason})
             as result
    `;
    return rows[0]?.result ?? {};
  };

  it("١) استلامُ البلاغِ يُخلِّفُ صفّاً واحداً باسمِ فعلٍ يُميِّزُه", async () => {
    const before = await auditCount();
    expect(await claim(TG_ADMIN)).toEqual({ ok: true });
    expect(await auditCount()).toBe(before + 1);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("safety.incident_claimed");
    expect(rows[0]?.entity_type).toBe("safety_incident");
    expect(rows[0]?.entity_id).toBe(incidentId);
    expect(rows[0]?.actor_user_id).toBe(adminId);
  });

  it("٢) الصفُّ يُنسَبُ إلى مدينةِ **البلاغِ** لا مدينةِ الفاعلِ", async () => {
    // الفاعلُ مبذورٌ في RUH والبلاغُ في MKK. ولو نُسِبَ الأثرُ للفاعلِ لقُرِئَت
    // أفعالُ مكّةَ في الرياضِ — وهوَ عطبٌ لا يُخفِقُ شيئاً غيرَ هذا التوكيدِ.
    expect(actorCityId).not.toBe(incidentCityId);
    await claim(TG_ADMIN);
    const rows = await auditRows();
    expect(rows[0]?.city_id).toBe(incidentCityId);
  });

  it("٣) فاعلٌ غيرُ مُصرَّحٍ لهُ: رفضٌ **ولا أثرَ** — والسِجلُّ لا يعدُّ المحاولاتِ", async () => {
    const before = await auditCount();
    expect(await claim(TG_RIDER)).toEqual({ ok: false, error: "ACTOR_NOT_AUTHORIZED" });
    expect(await auditCount()).toBe(before);
  });

  it("٤) استلامٌ مكرَّرٌ: رفضٌ ولا صفَّ ثانياً — فلا يُقرأُ فعلٌ لم يقعْ", async () => {
    await claim(TG_ADMIN);
    const after = await auditCount();
    const second = await claim(TG_ADMIN);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("INCIDENT_ALREADY_CLAIMED");
    expect(await auditCount()).toBe(after);
  });

  it("٥) قرارٌ غيرُ مشروعٍ: رفضٌ ولا أثرَ", async () => {
    await claim(TG_ADMIN);
    const after = await auditCount();
    expect(await resolve(TG_ADMIN, "delete_everything")).toEqual({
      ok: false,
      error: "INVALID_DECISION",
    });
    expect(await auditCount()).toBe(after);
  });

  it("٥ب) سببٌ مفقودٌ: رفضٌ ولا أثرَ (`PD-021`)", async () => {
    await claim(TG_ADMIN);
    const after = await auditCount();
    expect(await resolve(TG_ADMIN, "close", "")).toEqual({
      ok: false,
      error: "DECISION_REASON_REQUIRED",
    });
    expect(await auditCount()).toBe(after);
  });

  it("٦) إغلاقٌ بقرارِ `close`: صفٌّ يحملُ القرارَ في حمولتِه لا استنتاجاً", async () => {
    await claim(TG_ADMIN);
    expect(await resolve(TG_ADMIN, "close")).toEqual({
      ok: true,
      decision: "close",
      decision_reason: "resolved",
    });
    const rows = await auditRows();
    expect(rows.map((row) => row.action)).toEqual([
      "safety.incident_claimed",
      "safety.incident_resolved",
    ]);
    const resolved = rows.find((row) => row.action === "safety.incident_resolved");
    expect(resolved?.payload.decision).toBe("close");
    expect(resolved?.payload.reporter_blocked).toBe(false);
    expect(resolved?.city_id).toBe(incidentCityId);
  });

  it("٧) `block_reporter` يُخلِّفُ **أثرَينِ**: القرارُ وحظرُ المُبلِّغِ", async () => {
    await claim(TG_ADMIN);
    expect(await resolve(TG_ADMIN, "block_reporter")).toEqual({
      ok: true,
      decision: "block_reporter",
      decision_reason: "resolved",
    });
    const actions = (await auditRows()).map((row) => row.action);
    expect(actions).toContain("safety.incident_resolved");
    // الحظرُ لهُ أثرُه المستقلُّ، والقرارُ الذي أمرَ بهِ لهُ أثرُه. وقبلَ هجرةِ
    // 20260916210000 كانَ الأوّلُ وحدَه موجوداً: حظرٌ بلا سببٍ مكتوبٍ.
    expect(actions).toContain("admin.user_blocked_changed");
    const resolved = (await auditRows()).find((row) => row.action === "safety.incident_resolved");
    expect(resolved?.payload.reporter_blocked).toBe(true);
    const blocked = await sql<{ is_blocked: boolean }[]>`
      select is_blocked from users where id = ${reporterId}::uuid
    `;
    expect(blocked[0]?.is_blocked).toBe(true);
  });

  it("٨) إغلاقٌ بلا استلامٍ: رفضٌ ولا أثرَ — والحالةُ لم تتغيَّرْ", async () => {
    const before = await auditCount();
    expect(await resolve(TG_ADMIN, "close")).toEqual({
      ok: false,
      error: "INCIDENT_NOT_CLAIMED_BY_ACTOR",
    });
    expect(await auditCount()).toBe(before);
    const rows = await sql<{ status: string }[]>`
      select status from safety_incidents where id = ${incidentId}::uuid
    `;
    expect(rows[0]?.status).toBe("open");
  });

  it("٩) إغلاقٌ مكرَّرٌ بعدَ الإغلاقِ: رفضٌ ولا صفَّ ثالثاً", async () => {
    await claim(TG_ADMIN);
    await resolve(TG_ADMIN, "close");
    const after = await auditCount();
    expect(await resolve(TG_ADMIN, "close")).toEqual({
      ok: false,
      error: "INCIDENT_ALREADY_CLOSED",
    });
    expect(await auditCount()).toBe(after);
  });
});
