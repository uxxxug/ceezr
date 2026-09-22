/**
 * الغرض: قياسُ مسارِ استردادِ الحسابِ بمراجعةٍ إداريّةٍ صريحةٍ وسجلِّ قرارٍ كاملٍ
 *   على PostgreSQL حقيقيٍّ (`SEC-20`).
 * الحالة: منفّذ فعلياً — 2026-09-23.
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-20` · `ADR 0080` (سجلُّ أفعالِ التدقيقِ) · `ح-7` · `ح-8`.
 *
 * ## ما يُقاسُ ههنا
 *
 * ثمانِ حالاتٍ تُقيسُ الأثرَ لا الرّدَّ:
 * ١. تقديمُ طلبٍ بملخّصِ أدلّةٍ فارغٍ ⇒ `EMPTY_EVIDENCE_SUMMARY`
 * ٢. تقديمُ طلبٍ بـ`telegram_id` مستعمَلٍ لحسابٍ آخرَ ⇒ `TELEGRAM_ID_IN_USE`
 * ٣. تقديمُ طلبٍ صحيحٍ ⇒ `ok: true` ويُنشَأُ صفٌّ
 * ٤. مراجعةُ طلبٍ بفاعلٍ غيرِ مسؤولٍ ⇒ `NOT_ADMIN`
 * ٥. مراجعةُ طلبٍ بقرارٍ مكرَّرٍ ⇒ `ALREADY_REVIEWED`
 * ٦. موافقةٌ مع `claimant_telegram_id` تُحدِّثُ `users.telegram_id`
 * ٧. رفضٌ لا يُحدِّثُ `users.telegram_id`
 * ٨. سجلُّ `audit_log` يكتبُ الفاعلَ والسببَ والوقتَ
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ مسارِ استردادِ الحسابِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

describeIf("SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    await sql`begin`;
    // بذرُ مدينةٍ ومستخدمين
    await sql`insert into cities (id, code, name_ar, name_en, country_code, centroid, radius_meters)
      values ('11111111-0000-0000-0000-000000000001', 'TST', 'مدينة اختبار', 'Test City', 'SA',
              st_setsrid(st_makepoint(46.6753, 24.7136), 4326), 30000)
      on conflict do nothing`;
    await sql`insert into cities (id, code, name_ar, name_en, country_code, centroid, radius_meters)
      values ('11111111-0000-0000-0000-000000000002', 'TST2', 'مدينة ثانية', 'Test City 2', 'SA',
              st_setsrid(st_makepoint(46.6753, 24.7136), 4326), 30000)
      on conflict do nothing`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 111111, 'rider', 'مستخدم هدف', 'ar', false)
      on conflict do nothing`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 222222, 'rider', 'مستخدم آخر', 'ar', false)
      on conflict do nothing`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 333333, 'admin', 'مسؤول', 'ar', false)
      on conflict do nothing`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 444444, 'rider', 'غير مسؤول', 'ar', false)
      on conflict do nothing`;
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  it("١. يرفضُ تقديمَ طلبٍ بملخّصِ أدلّةٍ فارغٍ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000001'::uuid,
        null::text, ''::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("EMPTY_EVIDENCE_SUMMARY");
  });

  it("٢. يرفضُ telegram_id مستعمَلًا لحسابٍ آخرَ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000001'::uuid,
        '222222'::text, 'أدلة كافية'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("TELEGRAM_ID_IN_USE");
  });

  it("٣. يقبلُ تقديمَ طلبٍ صحيحٍ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000001'::uuid,
        '999999'::text, 'أدلة على الملكية'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; request_id: string };
    expect(result.ok).toBe(true);
    expect(result.request_id).toBeTruthy();
  });

  it("٤. يرفضُ مراجعةَ طلبٍ بفاعلٍ غيرِ مسؤولٍ", async () => {
    // أنشِئ طلبًا جديدًا
    const submitRows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000002'::uuid,
        '888888'::text, 'أدلة'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    const rows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        '22222222-0000-0000-0000-000000000004'::uuid,
        'approved'::account_recovery_status,
        'identity_verified'::account_recovery_decision_reason
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_ADMIN");
  });

  it("٥. يرفضُ قرارًا مكرَّرًا على طلبٍ مراجَعٍ", async () => {
    // أنشِئ طلبًا وراجِعْه
    const submitRows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000002'::uuid,
        '777777'::text, 'أدلة'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    // راجِعْه بالموافقة
    const reviewRows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        '22222222-0000-0000-0000-000000000003'::uuid,
        'approved'::account_recovery_status,
        'identity_verified'::account_recovery_decision_reason
      ) as result
    `;
    expect((reviewRows[0]?.result as { ok: boolean } | undefined)?.ok).toBe(true);

    // كرِّر المراجعة
    const dupRows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        '22222222-0000-0000-0000-000000000003'::uuid,
        'rejected'::account_recovery_status,
        'insufficient_evidence'::account_recovery_decision_reason
      ) as result
    `;
    const result = dupRows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ALREADY_REVIEWED");
  });

  it("٦. الموافقةُ مع claimant_telegram_id تُحدِّثُ users.telegram_id", async () => {
    const submitRows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000001'::uuid,
        '555555'::text, 'أدلة على الملكية'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        '22222222-0000-0000-0000-000000000003'::uuid,
        'approved'::account_recovery_status,
        'identity_verified'::account_recovery_decision_reason
      ) as result
    `;

    const userRows = await sql<{ telegram_id: string | null }[]>`
      select telegram_id from users where id = '22222222-0000-0000-0000-000000000001'::uuid
    `;
    expect(String(userRows[0]?.telegram_id)).toBe("555555");
  });

  it("٧. الرفضُ لا يُحدِّثُ users.telegram_id", async () => {
    const submitRows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        '11111111-0000-0000-0000-000000000001'::uuid,
        '22222222-0000-0000-0000-000000000002'::uuid,
        '666666'::text, 'أدلة غير كافية'::text,
        '22222222-0000-0000-0000-000000000003'::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        '22222222-0000-0000-0000-000000000003'::uuid,
        'rejected'::account_recovery_status,
        'insufficient_evidence'::account_recovery_decision_reason
      ) as result
    `;

    const userRows = await sql<{ telegram_id: string | null }[]>`
      select telegram_id from users where id = '22222222-0000-0000-0000-000000000002'::uuid
    `;
    expect(String(userRows[0]?.telegram_id)).toBe("222222"); // unchanged
  });

  it("٨. سجلُّ audit_log يكتبُ الفاعلَ والسببَ والوقتَ", async () => {
    const auditRows = await sql<
      {
        actor_user_id: string;
        action: string;
        payload: unknown;
        created_at: string;
      }[]
    >`
      select actor_user_id, action, payload, created_at
      from audit_log
      where action in ('admin.account_recovery_approved', 'admin.account_recovery_rejected')
        and actor_user_id = '22222222-0000-0000-0000-000000000003'::uuid
      order by created_at desc
      limit 5
    `;
    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      const payload = row.payload as Record<string, unknown>;
      expect(payload.reason).toBeTruthy();
      expect(payload.request_id).toBeTruthy();
      expect(row.created_at).toBeTruthy();
    }
  });
});
