/**
 * الغرض: إثبات أن استخراج أسماء الجداول المُفعَّلة عليها RLS يتحقّق من العضوية اسماً
 *   باسم، لا من مجرّد وجود حلقة foreach في مكان ما من الهجرات. الصيغة القديمة كانت
 *   تمنح نجاحاً كاذباً لأي جدول مستقبلي يُنسى تفعيل RLS عليه.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على scripts/check-migrations.ts
 * ملاحظات مستقبلية: لو أُضيف مصدر ثالث لتفعيل RLS (مثلاً دالّة تُنشئ جدولاً وتفعّله)
 *   يُضاف هنا نمطه وحالتاه: يُقبل اسمه صريحاً، ويُرفض إن كان مبنياً بجمع نصوص.
 */

import { describe, expect, test } from "bun:test";
import { findTableBlocks, tablesWithRlsEnabled } from "../../scripts/check-migrations.ts";

const set = (sql: string) => [...tablesWithRlsEnabled(sql)].sort();
const tableNames = (sql: string) => findTableBlocks(sql).map((b) => b.name);

describe("استخراج جداول RLS من نصّ الهجرات", () => {
  test("يلتقط الأمر المباشر باسمه", () => {
    expect(set("alter table orders enable row level security;")).toEqual(["orders"]);
  });

  test("يلتقط الأمر المباشر بصيغة if exists وبمسافات متعدّدة", () => {
    const sql = `alter table if exists   support_tickets
                   enable   row  level  security ;`;
    expect(set(sql)).toEqual(["support_tickets"]);
  });

  test("يلتقط كل اسم في مصفوفة حلقة التفعيل ولا شيء غيره", () => {
    const sql = `
      do $$
      declare t text;
      begin
        foreach t in array array['cities','users','orders'] loop
          execute format('alter table %I enable row level security', t);
        end loop;
      end $$;
    `;
    expect(set(sql)).toEqual(["cities", "orders", "users"]);
  });

  test("جدول خارج المصفوفة لا يُحتسب — هذه هي الثغرة التي كانت قائمة", () => {
    const sql = `
      create table probe_forgotten (id uuid primary key, city_id uuid not null);
      do $$
      declare t text;
      begin
        foreach t in array array['cities','users'] loop
          execute format('alter table %I enable row level security', t);
        end loop;
      end $$;
    `;
    const names = tablesWithRlsEnabled(sql);
    expect(names.has("probe_forgotten")).toBe(false);
    expect(names.has("cities")).toBe(true);
  });

  test("حلقة لا تُفعّل RLS لا تُحتسب مهما كان في مصفوفتها", () => {
    // هذه صيغة حلقة منح الصلاحيات على الدوالّ، وهي موجودة فعلاً في الهجرات.
    const sql = `
      do $$
      declare f text;
      begin
        foreach f in array array['claim_ride(uuid,uuid)','expire_stale_offers()'] loop
          execute format('revoke all on function %s from public', f);
        end loop;
      end $$;
    `;
    expect(set(sql)).toEqual([]);
  });

  test("حلقة تُفعّل RLS بأسماء مبنيّة لا حرفيّة لا تُحتسب: فاحص ساكن لا يعرف قيمتها", () => {
    const sql = `
      do $$
      declare t text;
      begin
        foreach t in array array_agg(tablename) from pg_tables loop
          execute format('alter table %I enable row level security', t);
        end loop;
      end $$;
    `;
    expect(set(sql)).toEqual([]);
  });

  test("الأمر المباشر والحلقة يتجمّعان بلا تكرار", () => {
    const sql = `
      do $$
      declare t text;
      begin
        foreach t in array array['users','orders'] loop
          execute format('alter table %I enable row level security', t);
        end loop;
      end $$;
      alter table orders enable row level security;
      alter table ratings enable row level security;
    `;
    expect(set(sql)).toEqual(["orders", "ratings", "users"]);
  });

  test("نصّ بلا تفعيل إطلاقاً يعطي مجموعة فارغة لا مجموعة مفترضة", () => {
    expect(set("create table x (id uuid); select 1;")).toEqual([]);
  });

  test("يلتقط الأمر المباشر ولو كان الاسم مؤهّلاً أو مقتبساً", () => {
    expect(set("alter table public.orders enable row level security;")).toEqual(["orders"]);
    expect(set('alter table "ratings" enable row level security;')).toEqual(["ratings"]);
  });
});

describe("استخراج تعريفات الجداول", () => {
  test("يلتقط الجدول ولو كان اسمه مؤهّلاً بمخطّط أو مقتبساً", () => {
    // جدولٌ لا يراه المستخرج لا يُفحص city_id له ولا RLS — يمرّ بنجاحٍ كاذب.
    expect(tableNames("create table public.foo (id uuid);")).toEqual(["foo"]);
    expect(tableNames('create table if not exists "bar" (id uuid);')).toEqual(["bar"]);
    expect(tableNames('create table public . "baz" (id uuid);')).toEqual(["baz"]);
  });

  test("يقرأ جسم الجدول كاملاً مع الأقواس المتداخلة", () => {
    const blocks = findTableBlocks(
      "create table t (id uuid, amount numeric(10, 2), city_id uuid not null references cities(id));",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toContain("numeric(10, 2)");
    expect(blocks[0]?.body).toContain("references cities(id)");
  });

  test("الجدول المؤهّل بمخطّط وبلا city_id لم يعد يمرّ صامتاً", () => {
    const blocks = findTableBlocks("create table public.sneaky (id uuid, note text);");
    expect(blocks).toHaveLength(1);
    expect(/\bcity_id\b/.test(blocks[0]?.body ?? "")).toBe(false);
  });
});
