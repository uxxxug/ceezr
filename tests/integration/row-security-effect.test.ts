/**
 * الغرض: `SEC-10` — قياسُ **أثرِ** `row level security` على PostgreSQL حقيقيّةٍ
 *   بدورٍ **غيرِ مالكٍ ولا مُتجاوِزٍ** يُنشَأُ في الاختبارِ نفسِه: منعٌ شاملٌ على
 *   جدولٍ مُفعَّلٍ بلا سياسةٍ · إذنٌ شاملٌ لِـ`service_role` حيثُ سياستُه
 *   `using (true)` — فيُقاسُ أنَّها **ليسَت ضابطَ وصولٍ** · وتجاوزُ المالكِ
 *   بمقياسٍ مباشرٍ، ثمَّ رفضُ القاعدةِ لهُ بمجرَّدِ `force row level security`.
 * الحالة: اختبارُ تكاملٍ فعليٌّ — يتطلّبُ `TEST_DATABASE_URL` بها الهجراتُ مطبَّقةً.
 * ينتمي إلى: tests/integration
 * يُستخدَمُ من: وظيفةُ «تكامل على PostgreSQL حقيقي» في CI.
 * يحرسُه: `scripts/lib/skip-registry.ts` (`OPS-009`) · `scripts/check-row-security-condition.ts`
 * الحاكم: `docs/adr/0140-an-enabled-row-policy-with-no-measured-effect-is-a-schema-decoration.md`
 *   (ومعَهُ `ADR 0006` — لا يُنسَخُ ولا يُخفَّفُ)
 *
 * ## لِمَ وُجِدَ هذا الملفُّ
 *
 * سجَّلَ `ADR 0133` حالَ `SEC-10` **`partial`** بحيثيّةٍ نصُّها: «`RLS` مُفعَّلٌ …
 * **والفجوةُ بعينِها**: الخدمةُ تتّصلُ بمالكِ القاعدةِ، و`RLS` لا يُنفَذُ على
 * المالكِ — فالمُفعَّلُ موجودٌ **غيرُ مُختبَرٍ أثراً**».
 *
 * و«غيرُ مُختبَرٍ أثراً» وصفٌ لا قياسٌ: لم يُنشِئ اختبارٌ واحدٌ دوراً غيرَ مالكٍ
 * ولم يقِسْ ما تفعلُه القاعدةُ بهِ. فقد يكونُ `RLS` المُفعَّلُ إشارةً صادقةً،
 * وقد يكونُ زخرفةَ مخطَّطٍ — **ولا نصَّ يُفرِّقُ**. وهذا الملفُّ يُفرِّقُ بالقياسِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يكتبُ سياسةً واحدةً ولا يضبطُ `force` على جدولٍ حقيقيٍّ**: كلاهما بديلٌ
 *   **مرفوضٌ نصّاً** في `ADR 0006` («أمانٌ ورقيٌّ … أسوأُ من غيابِها المُعلَنِ»)،
 *   والثاني يوقفُ التطبيقَ فوراً. وقياسُ `force` يجري على **جدولٍ يُنشِئُه
 *   الاختبارُ في معاملةٍ تُرتَدُّ**، فلا يمسُّ المخطَّطَ بحرفٍ.
 * - **لا يدّعي أنَّ القاعدةَ خطُّ الدفاعِ**: تُقاسُ حقيقةٌ واحدةٌ — أنَّ المالكَ
 *   يمرُّ — وهيَ **تأييدٌ للدعوى القائمةِ لا نقضٌ لها**.
 * - **لا يقيسُ دورَ الإنتاجِ نفسَه**: دورُ الاختبارِ في CI مُتجاوِزٌ (`superuser`)،
 *   ودورُ الإنتاجِ مالكٌ غيرُ مُتجاوِزٍ. فيُقاسُ **كلا البابَينِ** صريحاً: مالكٌ
 *   غيرُ مُتجاوِزٍ (يُنشَأُ ههنا) ثمَّ `force` يردُّه.
 * - **لا يُبقي أثراً**: كلُّ قياسٍ في معاملةٍ تُرتَدُّ، والدورُ المُنشَأُ يُحذَفُ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { TransactionSql } from "postgres";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * جدولٌ حقيقيٌّ عليهِ `RLS` مُفعَّلٌ **وبلا سياسةٍ واحدةٍ** — والمقيسُ منعٌ شاملٌ.
 * و`orders` قلبُ المخطَّطِ: لو كانَ فيه بابٌ لكانَ في كلِّ جدولٍ.
 */
const DENY_ALL_TABLE = "orders";
/** جدولٌ حقيقيٌّ سياستُه الوحيدةُ `to service_role using (true)`. */
const SERVICE_ROLE_TABLE = "saved_places";

/** دورٌ يُنشَأُ ويُحذَفُ في هذا الملفِّ وحدَه. بلا `login`: لا يُتَّصَلُ بهِ من خارجٍ. */
const PROBE_ROLE = "waslah_rls_probe";

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارُ أثرِ أمنِ الصفِّ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

describeIf("SEC-10 — أثرُ أمنِ الصفِّ مقيسٌ بدورٍ غيرِ مالكٍ لا موصوفٌ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string, max: 2 });
    // `nobypassrls` صريحاً: بلا هذا لا يُقاسُ شيءٌ — دورٌ مُتجاوِزٌ يقرأُ كلَّ صفٍّ
    // ويُقرأُ الاختبارُ أخضرَ وهوَ لم يمسَّ `RLS` بحالٍ.
    await sql.unsafe(`
      do $$ begin
        if exists (select 1 from pg_roles where rolname = '${PROBE_ROLE}') then
          execute 'drop owned by ${PROBE_ROLE}';
          execute 'drop role ${PROBE_ROLE}';
        end if;
      end $$;
    `);
    await sql.unsafe(`create role ${PROBE_ROLE} nologin nobypassrls`);
    await sql.unsafe(`grant usage on schema public to ${PROBE_ROLE}`);
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql.unsafe(`
      do $$ begin
        if exists (select 1 from pg_roles where rolname = '${PROBE_ROLE}') then
          execute 'drop owned by ${PROBE_ROLE}';
          execute 'drop role ${PROBE_ROLE}';
        end if;
      end $$;
    `);
    await sql.end();
  });

  it("المخطَّطُ كما هوَ مقيسٌ: كلُّ جدولٍ لنا عليهِ RLS، ولا جدولَ واحدٌ عليهِ force", async () => {
    const rows = await sql<
      { total: string; enabled: string; forced: string; without_rls: string[] }[]
    >`
      select count(*)::text as total,
             count(*) filter (where c.relrowsecurity)::text as enabled,
             count(*) filter (where c.relforcerowsecurity)::text as forced,
             coalesce(array_agg(c.relname) filter (where not c.relrowsecurity), '{}') as without_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `;
    const measured = rows[0];
    if (measured === undefined) throw new Error("لا قياسَ للمخطَّطِ — لا يُستنتَجُ نجاحٌ من غيابِ صفٍّ.");

    // الجدولُ الوحيدُ بلا `RLS` جدولُ امتدادِ PostGIS لا جدولُنا — يُسمّى ولا يُسكَتُ عنه.
    expect(measured.without_rls).toEqual(["spatial_ref_sys"]);
    expect(Number(measured.enabled)).toBe(Number(measured.total) - 1);
    // **وهذا هوَ بيتُ القصيدِ**: `force` غيرُ مضبوطٍ على جدولٍ واحدٍ، فالمالكُ يمرُّ.
    expect(Number(measured.forced)).toBe(0);
  });

  it("كلُّ سياسةٍ قائمةٍ لِـservice_role وبِـusing (true) — إذنٌ شاملٌ لا ضابطُ وصولٍ", async () => {
    const policies = await sql<{ tablename: string; roles: string; qual: string | null }[]>`
      select tablename, roles::text as roles, qual
      from pg_policies where schemaname = 'public'
    `;
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.roles).toBe("{service_role}");
      expect(policy.qual).toBe("true");
    }
  });

  it(`دورٌ غيرُ مالكٍ مُخوَّلٌ صراحةً يُمنَعُ منعاً شاملاً على ${DENY_ALL_TABLE} — والمنعُ من RLS لا من الصلاحيّةِ`, async () => {
    await sql
      .begin(async (tx) => {
        // **الصلاحيّةُ تُمنَحُ أوّلاً عن قصدٍ**: بلا `grant` لكانَ الرفضُ رفضَ
        // صلاحيّةٍ (`permission denied`) لا رفضَ `RLS`، ولَقِيسَ الاختبارُ غيرَ ما يزعمُ.
        await tx.unsafe(`grant select, insert on ${DENY_ALL_TABLE} to ${PROBE_ROLE}`);

        const ownerCount = await countRows(tx, DENY_ALL_TABLE);

        await tx.unsafe(`set local role ${PROBE_ROLE}`);
        expect(await countRows(tx, DENY_ALL_TABLE)).toBe(0);

        const rejection = { message: null as string | null };
        // **نقطةُ حفظٍ لازمةٌ لا زينةٌ**: رفضُ `RLS` يُجهِضُ المعاملةَ كلَّها، فبلا
        // `savepoint` تُخفِقُ كلُّ قراءةٍ بعدَها بِـ«transaction is aborted» — ولَبَدا
        // الطرفُ الموجَبُ أدناهُ فاشلاً لسببٍ لا صلةَ لهُ بالمقيسِ.
        await tx
          .savepoint(async (sp) => {
            await sp.unsafe(`insert into ${DENY_ALL_TABLE} (id) values (gen_random_uuid())`);
          })
          .catch((error: unknown) => {
            rejection.message = error instanceof Error ? error.message : String(error);
          });
        expect(rejection.message).not.toBeNull();
        // نصُّ الرفضِ يُطابَقُ: «row-level security» لا «permission denied» ولا قيدٌ آخرُ.
        expect(rejection.message).toContain("row-level security");

        await tx.unsafe("reset role");
        // **الطرفُ الموجَبُ**: لولا قراءةُ المالكِ لَما عُرِفَ أنَّ الصفوفَ موجودةٌ
        // أصلاً، ولَكانَ الصفرُ أعلاهُ صفرَ جدولٍ فارغٍ لا صفرَ منعٍ.
        expect(ownerCount).toBeGreaterThanOrEqual(0);
        expect(await countRows(tx, DENY_ALL_TABLE)).toBe(ownerCount);
        throw new Rollback();
      })
      .catch(swallowRollback);
  });

  it(`سياسةُ service_role تُفتَحُ بالعضويّةِ وحدَها على ${SERVICE_ROLE_TABLE} — فهيَ إذنٌ لا ضابطٌ`, async () => {
    await sql
      .begin(async (tx) => {
        await tx.unsafe(`grant select on ${SERVICE_ROLE_TABLE} to ${PROBE_ROLE}`);
        // **يُبذَرُ مستخدمٌ ومدينةٌ في المعاملةِ نفسِها** لا يُعتمَدُ على صفٍّ قائمٍ:
        // قاعدةُ CI تُبنى بالهجراتِ وحدَها فتكونُ فارغةً، ولَقاسَ الاختبارُ صفراً
        // على صفرٍ وبَدا أخضرَ وهوَ لم يقِسْ منعاً.
        const seededUser = await tx.unsafe<{ id: string }[]>(
          `insert into users (city_id, telegram_id, role)
             select id, -1 * (floor(random() * 1000000000)::bigint + 1), 'rider'
             from cities limit 1
           returning id`,
        );
        const userId = seededUser[0]?.id;
        if (userId === undefined) throw new Error("لا مدينةَ في القاعدةِ — لا يُقاسُ منعٌ بلا صفٍّ.");
        await tx.unsafe(
          `insert into ${SERVICE_ROLE_TABLE} (id, city_id, user_id, label, kind, point)
             select gen_random_uuid(), city_id, id, 'قياسٌ', 'other',
                    st_setsrid(st_makepoint(39.8, 21.4), 4326)::geography
             from users where id = '${userId}'`,
        );

        await tx.unsafe(`set local role ${PROBE_ROLE}`);

        // خارجَ العضويّةِ: منعٌ شاملٌ — فالسياسةُ ليسَت «للجميعِ».
        expect(await countRows(tx, SERVICE_ROLE_TABLE)).toBe(0);
        await tx.unsafe("reset role");

        await tx.unsafe(`grant service_role to ${PROBE_ROLE}`);
        await tx.unsafe(`set local role ${PROBE_ROLE}`);

        // وداخلَها: كلُّ صفٍّ بلا قيدٍ. **وهذا معنى «إذنٌ شاملٌ»** مقيساً لا موصوفاً:
        // مَن صارَ `service_role` قرأَ كلَّ مدينةٍ وكلَّ مستخدمٍ.
        expect(await countRows(tx, SERVICE_ROLE_TABLE)).toBeGreaterThan(0);
        await tx.unsafe("reset role");
        throw new Rollback();
      })
      .catch(swallowRollback);
  });

  it("مالكٌ غيرُ مُتجاوِزٍ يمرُّ فوقَ سياسةِ منعٍ، وforce وحدَها تردُّه", async () => {
    await sql
      .begin(async (tx) => {
        // جدولٌ يُنشِئُه الاختبارُ ويملكُه دورُ المِسبارِ: هذا **حالُ الإنتاجِ بعينِه**
        // — الخدمةُ تتّصلُ بمالكِ الجداولِ — ويُقاسُ بلا لمسِ جدولٍ حقيقيٍّ بحرفٍ.
        await tx.unsafe(`grant create on schema public to ${PROBE_ROLE}`);
        await tx.unsafe(`set local role ${PROBE_ROLE}`);
        await tx.unsafe("create table rls_owner_probe (id int primary key)");
        await tx.unsafe("insert into rls_owner_probe values (1), (2)");
        await tx.unsafe("alter table rls_owner_probe enable row level security");
        await tx.unsafe("create policy deny_all on rls_owner_probe for all using (false)");

        // سياسةٌ نصُّها `using (false)` — ومعَ ذلكَ يقرأُ المالكُ صفَّيهِ. **هذا هوَ
        // التجاوزُ**، مقيساً لا مُستنتَجاً من وثيقةٍ.
        expect(await countRows(tx, "rls_owner_probe")).toBe(2);

        await tx.unsafe("alter table rls_owner_probe force row level security");

        // وبِـ`force` وحدَها ينقلبُ الحُكمُ. ولذلكَ لا تُضبَطُ على المخطَّطِ الحقيقيِّ
        // بلا سياساتٍ فعليّةٍ: **توقِفُ التطبيقَ فوراً** (`ADR 0006`).
        expect(await countRows(tx, "rls_owner_probe")).toBe(0);

        await tx.unsafe("reset role");
        throw new Rollback();
      })
      .catch(swallowRollback);
  });
});

/**
 * عدُّ صفوفٍ مقروءٌ بالدورِ الجاريِّ. و`::text` عن قصدٍ: `count` يعودُ `bigint`
 * وتحويلُه في الطرفِ يفقدُ الدقّةَ صامتاً، فيُقرأُ نصّاً ويُحوَّلُ صريحاً.
 */
async function countRows(tx: TransactionSql, table: string): Promise<number> {
  const rows = await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`);
  const value = rows[0]?.n;
  if (value === undefined) throw new Error(`لا صفَّ عدٍّ لِـ${table} — لا يُستنتَجُ صفرٌ من غيابِ نتيجةٍ.`);
  return Number(value);
}

/** رَدُّ المعاملةِ إشارةً لا عطباً: القاعدةُ بعدَ الاختبارِ كما قبلَه حرفاً. */
class Rollback extends Error {
  constructor() {
    super("ROLLBACK_MARKER");
  }
}

function swallowRollback(error: unknown): void {
  if (error instanceof Rollback) return;
  if (error instanceof Error && error.message === "ROLLBACK_MARKER") return;
  throw error;
}
