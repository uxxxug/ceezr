/**
 * الغرض: PD-080 — فحصُ تكاملٍ يقارنُ `pg_enum` بـ`SUPPORT_TICKET_TYPES` في كلا
 *   الاتجاهَين: لا قيمةَ في القاعدةِ بلا مقابلٍ في الشيفرةِ، ولا صنفاً في الشيفرةِ
 *   بلا قيمةٍ في القاعدةِ. أوّلُ افتراقٍ يُسقِطُ البناءَ.
 * الحالة: منفّذ فعلياً — 2026-09-21 (PD-080).
 * ينتمي إلى: tests/integration
 * يُشغَّل من: CI — خطوةُ تكاملٍ على PostgreSQL حقيقي.
 *
 * ## لماذا فحصُ تكاملٍ لا فحصُ وحدةٍ
 *
 * `pg_enum` يُقرَأُ من القاعدةِ لا من الشيفرةِ، فلا سبيلَ إلى مقارنتِه بلا
 * اتصالٍ. والقائمةُ في `ticket-types.ts` مكتوبةٌ يدويّاً — فالانفصالُ عن القاعدةِ
 * خطأٌ صامتٌ لا يكشفُه أحدٌ حتى يصطدمَ به راكبٌ في شاشةٍ.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SUPPORT_TICKET_TYPES } from "../../packages/domain/support/ticket-types.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
} else {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL });
  });
  afterAll(async () => {
    await sql.end();
  });
}

describeIf("PD-080 — مواءمةُ `support_ticket_type` بين القاعدةِ والشيفرةِ", () => {
  it("كلُّ قيمةٍ في `pg_enum` موجودةٌ في `SUPPORT_TICKET_TYPES`", async () => {
    const rows = await sql<{ label: string }[]>`
      select e.enumlabel::text as label
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'support_ticket_type'
       order by e.enumsortorder
    `;
    const dbLabels = rows.map((r) => r.label);
    const codeLabels = SUPPORT_TICKET_TYPES as readonly string[];
    const orphans = dbLabels.filter((label) => !codeLabels.includes(label));
    expect(orphans, `قيمٌ في القاعدةِ بلا مقابلٍ في الشيفرةِ: ${orphans.join(", ")}`).toEqual([]);
  });

  it("كلُّ صنفٍ في `SUPPORT_TICKET_TYPES` موجودٌ في `pg_enum`", async () => {
    const rows = await sql<{ label: string }[]>`
      select e.enumlabel::text as label
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'support_ticket_type'
       order by e.enumsortorder
    `;
    const dbLabels = new Set(rows.map((r) => r.label));
    const codeLabels = SUPPORT_TICKET_TYPES as readonly string[];
    const missing = codeLabels.filter((label) => !dbLabels.has(label));
    expect(missing, `أصنافٌ في الشيفرةِ بلا قيمةٍ في القاعدةِ: ${missing.join(", ")}`).toEqual([]);
  });

  it("القائمتانِ متطابقتانِ في العددِ وفي الترتيبِ", async () => {
    const rows = await sql<{ label: string }[]>`
      select e.enumlabel::text as label
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'support_ticket_type'
       order by e.enumsortorder
    `;
    const dbLabels = rows.map((r) => r.label);
    const codeLabels = [...SUPPORT_TICKET_TYPES];
    expect(dbLabels).toEqual(codeLabels);
  });
});
