/**
 * الغرض: قياسُ سجلِّ الموافقاتِ على قاعدةٍ حقيقيّةٍ (`F2-01`) — أنَّ الدالّةَ
 *   الذرّيّةَ تستنبطُ المدينةَ من صفِّ المستخدمِ لا من الطلبِ، وأنَّ إعادةَ
 *   الإرسالِ لا تُنشئُ صفّاً ثانياً ولا تُحرِّكُ الختمَ، وأنَّ العمودَ `city_id`
 *   ملزَمٌ ومرتبطٌ بـ`cities` فعلاً، وأنَّ `RLS` مفعَّلٌ، وأنَّ الموافقةَ القديمةَ
 *   **تبقى** حينَ تُسجَّلُ موافقةٌ على إصدارٍ جديدٍ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلُّ هجرةٍ تمسُّ هذا الجدولَ.
 * ملاحظات مستقبلية: سحبُ الموافقةِ (إن أُقِرَّ) يُقاسُ ههنا أيضاً بصفٍّ ثالثٍ
 *   يُضافُ لا بحذفِ صفٍّ — حذفُ الصفِّ يمحو أنَّ الموافقةَ كانت.
 *
 * ═══ ما لا يُقاسُ ههنا ═══
 * سياسةُ `RLS` تُقاسُ **وجوداً وتفعيلاً** لا أثراً: الاتصالُ في هذا الاختبارِ
 * بمالكِ القاعدةِ، والمالكُ يتخطّى `RLS` أصلاً. وقياسُ الأثرِ يحتاجُ دورَ
 * `service_role`/`anon` كما في Supabase، وذاكَ ما يقيسُه
 * `tests/integration/database-privilege-surface.test.ts` لسائرِ الجداولِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  DECLARED_CONSENT_DOCUMENTS,
  findDeclaredDocument,
} from "../../packages/domain/consent/consent-documents.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const SEED_TELEGRAM_ID = 900_000_881;
const OTHER_TELEGRAM_ID = 900_000_882;
const ABSENT_TELEGRAM_ID = 900_000_883;

const TERMS = findDeclaredDocument("terms_of_service");
if (TERMS === undefined) throw new Error("سجلُّ الوثائقِ ناقصٌ");

let userId = "";
let userCityId = "";
let otherCityId = "";

interface RecordOutcome {
  readonly ok?: boolean;
  readonly status?: string;
  readonly error?: string;
  readonly accepted_at?: string;
}

async function record(
  telegramId: number,
  kind: string,
  version: string,
  acceptedAt: string,
): Promise<RecordOutcome> {
  const [row] = await sql<{ result: RecordOutcome }[]>`
    select record_user_consent(${telegramId}::bigint, ${kind}::text, ${version}::text,
                               ${acceptedAt}::timestamptz) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  const [user] = await sql<{ id: string; city_id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select c.id, ${SEED_TELEGRAM_ID}, 'rider', 'راكب اختبار الموافقات', '+966500000881'
      from cities c
     order by c.code
     limit 1
    returning id, city_id
  `;
  if (user === undefined) throw new Error("تعذّر زرع المستخدم: لا مدن في القاعدة");
  userId = user.id;
  userCityId = user.city_id;

  // مستخدمٌ ثانٍ في مدينةٍ **مختلفةٍ** إن وُجدَت — به يُقاسُ أنَّ المدينةَ تُستنبَطُ
  // من صفِّ صاحبِها لا من ثابتٍ ولا من أوّلِ مدينةٍ في الجدولِ.
  const [other] = await sql<{ id: string; city_id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select c.id, ${OTHER_TELEGRAM_ID}, 'rider', 'راكب اختبار الموافقات ٢', '+966500000882'
      from cities c
     where c.id <> ${userCityId}
     order by c.code
     limit 1
    returning id, city_id
  `;
  otherCityId = other?.city_id ?? "";
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`
    delete from user_consents
     where user_id in (
       select id from users where telegram_id in (${SEED_TELEGRAM_ID}, ${OTHER_TELEGRAM_ID})
     )
  `;
  await sql`delete from users where telegram_id in (${SEED_TELEGRAM_ID}, ${OTHER_TELEGRAM_ID})`;
  await sql.end();
});

describeIf("سجلُّ الموافقاتِ على قاعدةٍ حقيقيّةٍ", () => {
  it("١) `city_id` موجودٌ، not null، ومرتبطٌ بـ`cities` بمفتاحٍ أجنبيٍّ", async () => {
    const [column] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'user_consents'
         and column_name = 'city_id'
    `;
    expect(column?.is_nullable).toBe("NO");
    expect(column?.data_type).toBe("uuid");

    const [reference] = await sql<{ foreign_table: string }[]>`
      select ccu.table_name as foreign_table
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
       where tc.table_name = 'user_consents'
         and tc.constraint_type = 'FOREIGN KEY'
         and kcu.column_name = 'city_id'
    `;
    expect(reference?.foreign_table).toBe("cities");
  });

  it("٢) `RLS` مفعَّلٌ على الجدولِ ولسياستِه صفٌّ مُعلَنٌ", async () => {
    const [table] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class where relname = 'user_consents'
    `;
    expect(table?.relrowsecurity).toBe(true);

    const policies = await sql<{ policyname: string }[]>`
      select policyname from pg_policies
       where schemaname = 'public' and tablename = 'user_consents'
    `;
    expect(policies.length).toBeGreaterThan(0);
  });

  it("٣) قيدُ `kind` يقبلُ المُعلَنَ ويردُّ ما ليسَ مُعلَناً", async () => {
    for (const document of DECLARED_CONSENT_DOCUMENTS) {
      const outcome = await record(
        SEED_TELEGRAM_ID,
        document.kind,
        document.version,
        "2026-09-12T10:00:00Z",
      );
      expect(outcome.ok).toBe(true);
    }

    let rejected = false;
    try {
      await sql`
        insert into user_consents (city_id, user_id, kind, version, accepted_at)
        values (${userCityId}, ${userId}, 'cookie_banner', '2026-09-12', now())
      `;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("٤) الدالّةُ تستنبطُ المدينةَ من صفِّ المستخدمِ — ولا تُمرَّرُ إليها أصلاً", async () => {
    const rows = await sql<{ city_id: string }[]>`
      select city_id from user_consents where user_id = ${userId}
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.city_id === userCityId)).toBe(true);

    if (otherCityId === "") {
      // مدينةٌ ثانيةٌ غيرُ موجودةٍ في هذه القاعدةِ: يُقالُ ذلكَ ولا يُدَّعى قياسٌ.
      console.warn("⚠️  لا مدينةَ ثانيةً في القاعدةِ — تعدُّدُ المدنِ غيرُ مقيسٍ في هذه الجولةِ.");
      return;
    }
    const outcome = await record(
      OTHER_TELEGRAM_ID,
      TERMS.kind,
      TERMS.version,
      "2026-09-12T10:05:00Z",
    );
    expect(outcome.ok).toBe(true);
    const [second] = await sql<{ city_id: string }[]>`
      select c.city_id
        from user_consents c
        join users u on u.id = c.user_id
       where u.telegram_id = ${OTHER_TELEGRAM_ID}
    `;
    expect(second?.city_id).toBe(otherCityId);
    expect(second?.city_id).not.toBe(userCityId);
  });

  it("٥) إعادةُ الإرسالِ: `already_recorded` بلا صفٍّ ثانٍ وبلا تحريكِ الختمِ", async () => {
    const first = await record(SEED_TELEGRAM_ID, TERMS.kind, TERMS.version, "2026-09-12T10:00:00Z");
    const again = await record(SEED_TELEGRAM_ID, TERMS.kind, TERMS.version, "2027-01-01T00:00:00Z");

    expect(again.ok).toBe(true);
    expect(again.status).toBe("already_recorded");
    expect(again.accepted_at).toBe(first.accepted_at);

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from user_consents
       where user_id = ${userId} and kind = ${TERMS.kind} and version = ${TERMS.version}
    `;
    expect(count?.n).toBe(1);
  });

  it("٦) موافقةٌ على إصدارٍ جديدٍ تُضافُ ولا تمحو القديمَ", async () => {
    const newer = "2099-01-01";
    const outcome = await record(SEED_TELEGRAM_ID, TERMS.kind, newer, "2026-09-12T11:00:00Z");
    expect(outcome.status).toBe("recorded");

    const versions = await sql<{ version: string }[]>`
      select version from user_consents
       where user_id = ${userId} and kind = ${TERMS.kind}
       order by version
    `;
    expect(versions.map((v) => v.version)).toContain(TERMS.version);
    expect(versions.map((v) => v.version)).toContain(newer);
  });

  it("٧) مستخدمٌ لا صفَّ له: `USER_NOT_FOUND` ولا صفَّ يُنشَأُ", async () => {
    const outcome = await record(
      ABSENT_TELEGRAM_ID,
      TERMS.kind,
      TERMS.version,
      "2026-09-12T10:00:00Z",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("USER_NOT_FOUND");

    const [count] = await sql<{ n: number }[]>`select count(*)::int as n from users
       where telegram_id = ${ABSENT_TELEGRAM_ID}`;
    expect(count?.n).toBe(0);
  });

  it("٨) `list_user_consents` تعيدُ صفوفَ صاحبِها وحدَه", async () => {
    const rows = await sql<{ kind: string; version: string; accepted_at: string }[]>`
      select kind, version, accepted_at from list_user_consents(${SEED_TELEGRAM_ID}::bigint)
    `;
    expect(rows.length).toBeGreaterThan(0);

    const owned = await sql<{ n: number }[]>`
      select count(*)::int as n from user_consents where user_id = ${userId}
    `;
    expect(rows.length).toBe(owned[0]?.n ?? -1);

    const absent = await sql<{ kind: string }[]>`
      select kind from list_user_consents(${ABSENT_TELEGRAM_ID}::bigint)
    `;
    expect(absent.length).toBe(0);
  });

  /**
   * ٩) سطحُ الصلاحياتِ — وهذا الموجَبُ **أضافَه عطلٌ كشفَه CI لا القياسُ
   * المحلّيُّ**: الدالّتانِ `security definer`، و`execute` مُمنوحٌ لـ`public`
   * افتراضاً عندَ الإنشاءِ في PostgreSQL، فبقيَتا في الدورةِ الأولى قابلتَينِ
   * للتنفيذِ من `anon` و`authenticated` — أي ثقبانِ يتجاوزانِ RLS ويكتبانِ
   * موافقةً باسمِ أيِّ معرّفٍ. وأسقطَ ذلكَ اختبارَ سطحِ الصلاحياتِ العامَّ
   * واختبارَ الفحصِ الهجوميِّ في CI. والسحبُ صريحٌ في الهجرةِ، ويُقاسُ ههنا
   * **على الدالّتَينِ بالاسمِ** أيضاً كي يُقرأَ الموجَبُ في مكانِ البندِ لا في
   * حارسٍ عامٍّ وحدَه.
   */
  it("٩) لا `anon` ولا `authenticated` ينفِّذُ دالّتَي الموافقةِ", async () => {
    const rows = await sql<{ sig: string; anon_exec: boolean; auth_exec: boolean }[]>`
      select p.oid::regprocedure::text as sig,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('record_user_consent', 'list_user_consents')
       order by 1
    `;
    // وجودُهما شرطُ صحّةِ الاختبارِ: قائمةٌ فارغةٌ تجعلُه يمرُّ زوراً.
    expect(rows.length).toBe(2);
    expect(rows.filter((r) => r.anon_exec || r.auth_exec).map((r) => r.sig)).toEqual([]);
  });
});
