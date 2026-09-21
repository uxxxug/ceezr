/**
 * الغرض: قياسُ **سجلِّ قرارِ إبطالِ جلساتِ Mini App** على PostgreSQL حقيقيٍّ
 *   (`SEC-18-ب`): أنَّ الإبطالَ الناجحَ يُخلِّفُ صفّاً واحداً بمدينةِ **الهدفِ** لا
 *   بمدينةِ الفاعلِ، وفيهِ السببُ والفاعلُ، وأنَّ **الرفضَ لا يُخلِّفُ شيئاً** —
 *   لا لغيرِ الإداريِّ ولا لسببٍ خارجَ المعجمِ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22.
 * ينتمي إلى: tests/integration
 * الحاكم: ADR 0174 · `ADR 0136` (الأثرُ يُقاسُ بالأثرِ) · `ADR 0080`
 *
 * ## ولِمَ يُبذَرُ الفاعلُ في مدينةٍ غيرِ مدينةِ الهدفِ
 *
 * لأنَّ العطبَ الشائعَ أن يُكتَبَ الأثرُ بمدينةِ **جالسِ اللوحةِ** لا بمدينةِ
 * **الحادثةِ**، فتُقرأُ الأفعالُ بمكانِ فاعلِها. ولو تساوَت المدينتانِ في البذرِ
 * لتساوى الصحيحُ والخطأُ ومرَّ العطبُ سليماً.
 *
 * ## وما لا يُقاسُ ههنا — مُسمّىً لا مسكوتاً عنه
 *
 * **الإنفاذُ لا يُقاسُ في هذا الملفِّ**: هو عتبةٌ في Redis تُقاسُ في
 * `tests/unit/session-revocation-user-epoch.test.ts` وفي محوّلِ Redis. وههنا
 * يُقاسُ **سجلُّ القرارِ** وحدَه. ولا يُدَّعى أنَّ الصفَّ يُنشِئُ إبطالاً.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

import { SESSION_REVOCATION_REASONS } from "../../packages/application/identity/session-revocation-reasons.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ سجلِّ قرارِ الإبطالِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

interface RevokeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly telegram_id?: string;
  readonly reason?: string;
}

describeIf("سجلُّ قرارِ إبطالِ جلساتِ Mini App (SEC-18-ب)", () => {
  let sql: Sql;
  let targetCityId = "";
  let actorCityId = "";

  const TG_ADMIN = 900000991;
  const TG_TARGET = 900000992;
  const TG_IMPOSTOR = 900000993;

  let adminId = "";
  let targetId = "";
  let impostorId = "";

  const telegramIds = [TG_ADMIN, TG_TARGET, TG_IMPOSTOR];

  const purge = async (): Promise<void> => {
    await sql`
      delete from audit_log where actor_user_id in (
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
    const target = cities.find((city) => city.code === "MKK")?.id;
    const actor = cities.find((city) => city.code === "RUH")?.id;
    if (target === undefined || actor === undefined) {
      throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ على قاعدةِ الاختبارِ");
    }
    targetCityId = target;
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
      values (${actorCityId},  ${TG_ADMIN}::bigint,    'مسؤولُ الإبطالِ', '+966500000991', 'ar', 'admin'),
             (${targetCityId}, ${TG_TARGET}::bigint,   'هدفُ الإبطالِ',   '+966500000992', 'ar', 'rider'),
             (${targetCityId}, ${TG_IMPOSTOR}::bigint, 'مُدَّعي الصفةِ',  '+966500000993', 'ar', 'rider')
      returning id, telegram_id
    `;
    const byTelegram = new Map(users.map((row) => [String(row.telegram_id), row.id]));
    adminId = byTelegram.get(String(TG_ADMIN)) ?? "";
    targetId = byTelegram.get(String(TG_TARGET)) ?? "";
    impostorId = byTelegram.get(String(TG_IMPOSTOR)) ?? "";
    if (adminId === "" || targetId === "" || impostorId === "") throw new Error("تعذّرَ البذرُ");
  });

  const auditCount = async (): Promise<number> => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_log where actor_user_id = any(
        select id from users where telegram_id = any(${telegramIds}::bigint[])
      )
    `;
    return Number(rows[0]?.n ?? "-1");
  };

  const revoke = async (actor: string, target: string, reason: string): Promise<RevokeResult> => {
    const rows = await sql<{ result: RevokeResult }[]>`
      select admin_revoke_miniapp_sessions(
        ${actor}::uuid, ${target}::uuid, ${reason}::text
      ) as result
    `;
    const value = rows[0]?.result;
    if (value === undefined) throw new Error("لا نتيجةَ منَ الدالّةِ");
    return value;
  };

  it("١) الإبطالُ الناجحُ يُخلِّفُ صفّاً واحداً بمدينةِ الهدفِ وفيهِ السببُ والفاعلُ", async () => {
    const before = await auditCount();
    const result = await revoke(adminId, targetId, "stolen_device");

    expect(result.ok).toBe(true);
    // مُعرِّفُ تيليجرام يُردُّ لأنَّ مفتاحَ الإنفاذِ في Redis هو، لا `users.id`.
    expect(result.telegram_id).toBe(String(TG_TARGET));

    expect(await auditCount()).toBe(before + 1);
    const rows = await sql<
      {
        action: string;
        city_id: string;
        actor_user_id: string;
        entity_type: string;
        entity_id: string;
        payload: Record<string, unknown>;
      }[]
    >`
      select action, city_id::text, actor_user_id::text, entity_type, entity_id::text, payload
        from audit_log
       where actor_user_id = ${adminId}::uuid
       order by created_at desc limit 1
    `;
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.action).toBe("admin.miniapp_sessions_revoked");
    // مدينةُ **الهدفِ** لا مدينةُ الفاعلِ — والمدينتانِ مختلفتانِ قصداً في البذرِ.
    expect(row.city_id).toBe(targetCityId);
    expect(row.actor_user_id).toBe(adminId);
    expect(row.entity_type).toBe("user");
    expect(row.entity_id).toBe(targetId);
    // القرارُ في الحمولةِ لا يُستنتَجُ من التجاورِ الزمنيِّ.
    expect(row.payload.reason).toBe("stolen_device");
  });

  it("٢) سببٌ خارجَ المعجمِ يُرفَضُ ولا يُخلِّفُ أثراً", async () => {
    const before = await auditCount();
    const result = await revoke(adminId, targetId, "because-i-said-so");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_REASON");
    expect(await auditCount()).toBe(before);
  });

  it("٣) غيرُ الإداريِّ يُرفَضُ ولا يُخلِّفُ أثراً", async () => {
    const before = await auditCount();
    const result = await revoke(impostorId, targetId, "stolen_device");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_ADMIN");
    expect(await auditCount()).toBe(before);
  });

  it("٤) الإداريُّ المحجوبُ يُرفَضُ — الصفةُ لا تكفي بلا نفاذٍ", async () => {
    await sql`update users set is_blocked = true where id = ${adminId}::uuid`;
    const before = await auditCount();
    const result = await revoke(adminId, targetId, "stolen_device");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_ADMIN");
    expect(await auditCount()).toBe(before);
  });

  it("٥) هدفٌ غيرُ موجودٍ يُرفَضُ ولا يُخلِّفُ أثراً", async () => {
    const before = await auditCount();
    const result = await revoke(adminId, "00000000-0000-0000-0000-000000000000", "user_request");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("USER_NOT_FOUND");
    expect(await auditCount()).toBe(before);
  });

  it("٦) كلُّ سببٍ في المعجمِ مقبولٌ فعلاً على القاعدةِ لا في الشيفرةِ وحدَها", async () => {
    for (const reason of SESSION_REVOCATION_REASONS) {
      const result = await revoke(adminId, targetId, reason);
      expect(result.ok).toBe(true);
      expect(result.reason).toBe(reason);
    }
  });
});
