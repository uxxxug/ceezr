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

/**
 * قاعدةُ مُعرِّفاتَ فريدةٌ لكلِّ تشغيلٍ: القاعدةُ في CI دائمةٌ بينَ الملفّاتِ،
 * و`users.telegram_id` فريدٌ قيدًا. المُعرِّفُ الأصلُ الثابتُ (`111111` مثلًا)
 * يحرثُ سابقًا ناجحًا فيجعلُ الزرعَ يفشلُ بقيدِ التفرّدِ في جولةٍ تاليةً أو
 * على قاعدةٍ غيرِ نظيفةٍ — وهذا نمطُ `RUN_BASE` في
 * `subscription-cancel-upgrade.test.ts`.
 */
const RUN_BASE = 3_900_000_000 + (Date.now() % 800_000_000);
const TG = {
  target: RUN_BASE + 1,
  other: RUN_BASE + 2,
  admin: RUN_BASE + 3,
  notAdmin: RUN_BASE + 4,
} as const;

/** مُعرِّفاتُ UUID ثابتةٌ داخلَ المعاملةِ: لا تُزرعُ إلا مرةً واحدةً ثم تُتراجَعُ. */
const UUIDS = {
  city: "33333333-0000-0000-0000-000000000001",
  city2: "33333333-0000-0000-0000-000000000002",
  target: "44444444-0000-0000-0000-000000000001",
  other: "44444444-0000-0000-0000-000000000002",
  admin: "44444444-0000-0000-0000-000000000003",
  notAdmin: "44444444-0000-0000-0000-000000000004",
} as const;

describeIf("SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ", () => {
  let sql: Sql;

  beforeAll(async () => {
    // تجمُّعُ اتصالٍ واحد: المعاملةُ المفتوحةُ في هذا beforeAll والتراجعُ في
    // afterAll يمرّانِ على الاتصالِ نفسِهِ — على تجمُّعٍ أوسعَ يرفضُ postgres.js
    // العبارةَ الخامَ بـ`UNSAFE_TRANSACTION` (قِيسَ هذا فعلاً في جولةِ CI
    // 35794705603). وهذا نمطُ `max: 1` المُستعمَلُ في ملفاتِ التكاملِ الأخرى.
    sql = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    await sql`begin`;
    // بذرُ مدينتَينِ — الأعمدةُ الفعليةُ لجدولِ cities في المخطَّطِ: لا
    // country_code ولا centroid ولا radius_meters (جولةُ CI 35794705603
    // أسقطَتِ البذرةَ القديمةَ بـ`42703`). والمدنُ معطَّلةٌ عمدًا: الاستردادُ
    // لا يقرأُ تفعيلَ المدينةِ ولا يستعيرُه.
    await sql`insert into cities (id, code, name_ar, name_en, is_active)
      values (${UUIDS.city}, 'RC1', 'مدينة اختبار الاسترداد', 'Recovery Test City', false)`;
    await sql`insert into cities (id, code, name_ar, name_en, is_active)
      values (${UUIDS.city2}, 'RC2', 'مدينة ثانية للاسترداد', 'Recovery Test City 2', false)`;
    // بذرُ أربعةِ مستخدمينَ بمعرِّفاتَ فريدةٍ لكلِّ تشغيلٍ — telegram_id فريدٌ قيدًا
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.target}, ${UUIDS.city}, ${TG.target}, 'rider', 'مستخدم هدف', 'ar', false)`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.other}, ${UUIDS.city}, ${TG.other}, 'rider', 'مستخدم آخر', 'ar', false)`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.admin}, ${UUIDS.city}, ${TG.admin}, 'admin', 'مسؤول', 'ar', false)`;
    await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
      values (${UUIDS.notAdmin}, ${UUIDS.city}, ${TG.notAdmin}, 'rider', 'غير مسؤول', 'ar', false)`;
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  it("١. يرفضُ تقديمَ طلبٍ بملخّصِ أدلّةٍ فارغٍ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        ${UUIDS.city}::uuid,
        ${UUIDS.target}::uuid,
        null::text, ''::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("EMPTY_EVIDENCE_SUMMARY");
  });

  it("٢. يرفضُ telegram_id مستعمَلًا لحسابٍ آخرَ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        ${UUIDS.city}::uuid,
        ${UUIDS.target}::uuid,
        ${TG.other}::text, 'أدلة كافية'::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const result = rows[0]?.result as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("TELEGRAM_ID_IN_USE");
  });

  it("٣. يقبلُ تقديمَ طلبٍ صحيحٍ", async () => {
    const rows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        ${UUIDS.city}::uuid,
        ${UUIDS.target}::uuid,
        ${RUN_BASE + 101}::text, 'أدلة على الملكية'::text,
        ${UUIDS.admin}::uuid
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
        ${UUIDS.city}::uuid,
        ${UUIDS.other}::uuid,
        ${RUN_BASE + 102}::text, 'أدلة'::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    const rows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        ${UUIDS.notAdmin}::uuid,
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
        ${UUIDS.city}::uuid,
        ${UUIDS.other}::uuid,
        ${RUN_BASE + 103}::text, 'أدلة'::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    // راجِعْه بالموافقة
    const reviewRows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        ${UUIDS.admin}::uuid,
        'approved'::account_recovery_status,
        'identity_verified'::account_recovery_decision_reason
      ) as result
    `;
    expect((reviewRows[0]?.result as { ok: boolean } | undefined)?.ok).toBe(true);

    // كرِّر المراجعة
    const dupRows = await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        ${UUIDS.admin}::uuid,
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
        ${UUIDS.city}::uuid,
        ${UUIDS.target}::uuid,
        ${RUN_BASE + 104}::text, 'أدلة على الملكية'::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        ${UUIDS.admin}::uuid,
        'approved'::account_recovery_status,
        'identity_verified'::account_recovery_decision_reason
      ) as result
    `;

    const userRows = await sql<{ telegram_id: string | null }[]>`
      select telegram_id from users where id = ${UUIDS.target}::uuid
    `;
    expect(String(userRows[0]?.telegram_id)).toBe(String(RUN_BASE + 104)); // حُدِّثَ إلى مُعرِّفِ المُطالبِ
  });

  it("٧. الرفضُ لا يُحدِّثُ users.telegram_id", async () => {
    // قِيسِ الحالَ قبلَ الرفضِ لا افترِضْهُ: الحالةُ ٥ قبلَها وافقتْ على طلبٍ
    // لنفسِ المستخدمِ فبدَّلَت مُعرِّفَهُ — فلو اُفترِضَت القيمةُ الأصلُ لخفقَ
    // القياسُ بغيرِ علاقةٍ بما يقيسُ.
    const beforeRows = await sql<{ telegram_id: string | null }[]>`
      select telegram_id from users where id = ${UUIDS.other}::uuid
    `;
    const before = String(beforeRows[0]?.telegram_id);
    expect(before).not.toBe(String(RUN_BASE + 105));

    const submitRows = await sql<{ result: unknown }[]>`
      select submit_account_recovery_request(
        ${UUIDS.city}::uuid,
        ${UUIDS.other}::uuid,
        ${RUN_BASE + 105}::text, 'أدلة غير كافية'::text,
        ${UUIDS.admin}::uuid
      ) as result
    `;
    const requestId = (submitRows[0]?.result as { request_id: string } | undefined)?.request_id;
    if (!requestId) throw new Error("no request_id returned");

    await sql<{ result: unknown }[]>`
      select review_account_recovery_request(
        ${requestId}::uuid,
        ${UUIDS.admin}::uuid,
        'rejected'::account_recovery_status,
        'insufficient_evidence'::account_recovery_decision_reason
      ) as result
    `;

    const userRows = await sql<{ telegram_id: string | null }[]>`
      select telegram_id from users where id = ${UUIDS.other}::uuid
    `;
    expect(String(userRows[0]?.telegram_id)).toBe(before); // unchanged
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
        and actor_user_id = ${UUIDS.admin}::uuid
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
