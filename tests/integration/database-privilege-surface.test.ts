/**
 * الغرض: حراسة دائمة على سطح الصلاحيات في قاعدة البيانات، بقياسه من القاعدة
 *   نفسها لا بقراءة ملفات الهجرات. سبب وجود هذا الملف أن المرحلة ١ كشفت أن
 *   ملف هجرة كامل (`20260811160000_payment_rls_policies`) كُتب على افتراض أن
 *   RLS مُفعَّل، ولم يكن مُفعَّلاً، فبقيت سياساته خاملة بلا أن يفشل شيء. ولأن
 *   PostgreSQL يمنح PUBLIC صلاحية تنفيذ كل دالة جديدة تلقائياً، فكل هجرة
 *   قادمة تُنشئ دالة `security definer` تُعيد فتح الثقب صامتةً ما لم يمنعها
 *   اختبار يقيس الحالة الفعلية.
 *
 *   الاختبارات الثلاثة أدناه تصف الثلاث طبقات التي يجب أن تبقى قائمة معاً:
 *     الطبقة ١: RLS مُفعَّل على كل جدول من جداولنا.
 *     الطبقة ٢: لا دالة من دوالّنا قابلة للتنفيذ من anon أو authenticated.
 *     الطبقة ٣: لا USAGE على مخطط public لأيٍّ من الدورين.
 *   سقوط أي طبقة وحدها لا يعني اختراقاً فورياً، لكنه يعني أن الحماية صارت
 *   معلّقة على نقطة واحدة — وهذا بالضبط ما لا يجوز في نظام يمسّ المال والموقع.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكل هجرة تضيف جدولاً أو دالة
 * ملاحظات مستقبلية: دوال الامتدادات (postgis) مستثناة عمداً عبر pg_depend،
 *   وسحب التنفيذ منها يكسر التطبيق. لا توسّع المرشِّح ليشملها.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** الجداول التي لا نملكها ولا نستطيع تفعيل RLS عليها من دور غير خارق. */
const EXTENSION_TABLES = new Set(["spatial_ref_sys"]);

describeIf("سطح صلاحيات قاعدة البيانات", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("الطبقة ١: كل جدول من جداولنا عليه RLS مُفعَّل", async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity = false
      order by c.relname
    `;

    const unprotected = rows
      .map((row) => row.relname)
      .filter((name) => !EXTENSION_TABLES.has(name));

    // رسالة الفشل تسمّي الجداول كي لا يضطر أحد إلى التنقيب عن السبب.
    expect(unprotected).toEqual([]);
  });

  it("الطبقة ٢: لا دالة من دوالّنا قابلة للتنفيذ من anon أو authenticated", async () => {
    const rows = await sql<{ sig: string; anon_exec: boolean; auth_exec: boolean }[]>`
      select
        p.oid::regprocedure::text as sig,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (
          select 1 from pg_depend d
          where d.objid = p.oid
            and d.classid = 'pg_proc'::regclass
            and d.deptype = 'e'
        )
      order by 1
    `;

    // وجود دوال أصلاً شرط لصحة الاختبار: قائمة فارغة تجعله يمرّ زوراً.
    expect(rows.length).toBeGreaterThan(0);

    const reachable = rows.filter((row) => row.anon_exec || row.auth_exec).map((row) => row.sig);
    expect(reachable).toEqual([]);
  });

  it("الطبقة ٣: لا USAGE على مخطط public لدور anon ولا authenticated", async () => {
    const [row] = await sql<{ anon_usage: boolean; auth_usage: boolean }[]>`
      select
        has_schema_privilege('anon', 'public', 'USAGE') as anon_usage,
        has_schema_privilege('authenticated', 'public', 'USAGE') as auth_usage
    `;

    expect(row?.anon_usage).toBe(false);
    expect(row?.auth_usage).toBe(false);
  });

  it("سياسات جداول المال قائمة ونافذة معاً — لا سياسة على جدول بلا RLS", async () => {
    const rows = await sql<{ tablename: string; rls: boolean; policies: number }[]>`
      select
        c.relname as tablename,
        c.relrowsecurity as rls,
        (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname in ('payment_transactions', 'ledger_entries', 'webhook_events', 'db_backups')
      order by c.relname
    `;

    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect({ table: row.tablename, rls: row.rls }).toEqual({ table: row.tablename, rls: true });
      expect({ table: row.tablename, hasPolicies: row.policies > 0 }).toEqual({
        table: row.tablename,
        hasPolicies: true,
      });
    }
  });
});
