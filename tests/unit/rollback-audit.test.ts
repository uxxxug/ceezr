/**
 * الغرض: إثباتُ أنّ حاجزَ مسارِ العودة **يسقط** حيثُ يجب أن يسقط. وحاجزٌ لم
 *   يُبرهَن سقوطُه ليس حاجزاً بل زينةٌ خضراء: فلكلِّ قاعدةٍ في
 *   `check-rollback-safety.ts` مِسبارٌ يخالفها وحدَه، ويُنتظَر منه بلاغٌ. ثمّ
 *   لكلِّ قاعدةِ قراءةٍ في `rollback-audit.ts` مِسبارٌ يُثبِت أنّها تُصيب هدفَها
 *   ولا تُصيب ما جاورَه.
 * الحالة: منفّذ فعلياً — البند `OPS-010` (ADR 0047).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ في `scripts/lib/rollback-audit.ts` أو في
 *   السجلِّ `scripts/lib/rollback-registry.ts` أو في `docs/rollback.md`.
 * ملاحظات مستقبلية: **السلبيُّ الكاذبُ المُعلَنُ مُثبَّتٌ ههنا بقصدٍ** (حذفٌ يُبنى
 *   بنصٍّ مُركَّبٍ لا يُكتشَف، وتغييرُ نوعِ وسيطٍ مع بقاءِ عددِه لا يُكتشَف). ومن
 *   يُدخِل مُحلِّلاً نحوياً حقيقياً سيُسقِط ذلك الاختبارَ فيقرأ سببَه لا يظنّه سهواً.
 *
 * وما لا يفعله: لا يلمس قاعدةً ولا يُطبِّق هجرةً — ذلك في
 * `scripts/rollback-schema-drill.ts` ولا مُشغِّلَ له إلّا في CI.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type AuditInput,
  auditRollbackSafety,
  readMigrations,
} from "../../scripts/check-rollback-safety.ts";
import { blankSqlComments } from "../../scripts/lib/blank-comments.ts";
import {
  countArguments,
  createdBy,
  findRollbackRisks,
  narrowingChanges,
  riskTag,
  type SchemaChange,
  stubbedFunctions,
  uniqueRiskTags,
} from "../../scripts/lib/rollback-audit.ts";
import {
  declarationTag,
  ROLLBACK_DECLARATIONS,
  type RollbackDeclaration,
} from "../../scripts/lib/rollback-registry.ts";
import { lossesBetween } from "../../scripts/rollback-schema-drill.ts";

const DOC = readFileSync("docs/rollback.md", "utf8");
const RENDER = readFileSync("render.yaml", "utf8");

function change(kind: SchemaChange["kind"], target: string): SchemaChange {
  return { migration: "0001_x.sql", kind, target, line: 1 };
}

/** مدخلٌ صالحٌ يُشتقُّ منه كلُّ مِسبارٍ بتغييرِ حقلٍ واحدٍ — فيُعزَل سببُ السقوط. */
const VALID: RollbackDeclaration = {
  migration: "0001_x.sql",
  change: "drop_function:f(1)",
  why: "سببٌ مكتوبٌ بطولٍ يكفي لأن يُقرأ وحدَه بلا الرجوعِ إلى نصِّ الهجرةِ نفسِها.",
  breaksPreviousRelease: false,
  rollbackPath: "code-only",
  coupledDeploy: false,
  owner: "منفّذ المستودع",
  criticalPath: null,
  documentedIn: null,
};

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    risks: [change("drop_function", "f(1)")],
    declarations: [VALID],
    migrationFiles: ["0001_x.sql"],
    rollbackDoc: DOC,
    renderFile: RENDER,
    ...overrides,
  };
}

describe("تفريغُ تعليقاتِ SQL", () => {
  it("يُفرِّغ `--` ويُبقي عددَ الأسطرِ وأطوالَها", () => {
    const source = "drop table a;\n-- drop table b;\ndrop table c;";
    const blanked = blankSqlComments(source);
    expect(blanked.split("\n").length).toBe(3);
    expect(blanked.split("\n")[1]).toBe(" ".repeat("-- drop table b;".length));
    expect(blanked).toContain("drop table a;");
  });

  it("لا يُفرِّغ ما في جسدٍ مُحدَّدٍ بعلامتَي دولارٍ — وفيه DDL يُنفَّذ فعلاً", () => {
    const source = "do $$\nbegin\n  execute 'revoke all on function f() from public';\nend\n$$;";
    expect(blankSqlComments(source)).toContain("revoke all on function f() from public");
  });

  it("يُبقي التعليقَ داخلَ الجسدِ كما هو، فلا تُبتلَع أسطرٌ", () => {
    const source = "do $$\n-- تعليقٌ داخلَ جسدٍ\nselect 1;\n$$;";
    expect(blankSqlComments(source)).toContain("-- تعليقٌ داخلَ جسدٍ");
  });
});

describe("عدُّ الوسائط", () => {
  it("لا وسائطَ = صفرٌ", () => expect(countArguments("")).toBe(0));
  it("مسافةٌ وحدَها = صفرٌ", () => expect(countArguments("  \n ")).toBe(0));
  it("ثلاثةُ أنواعٍ = ثلاثةٌ", () => expect(countArguments("uuid, text, jsonb")).toBe(3));
  it("قوسٌ داخليٌّ لا يُقسِّم", () => expect(countArguments("numeric(10,2), text")).toBe(2));
  it("قيمةٌ افتراضيةٌ لا تُقسِّم", () =>
    expect(countArguments("p_city uuid, p_days integer default 2")).toBe(2));
});

describe("ما أنشأته هجرةٌ", () => {
  it("يقرأ الجدولَ والعمودَ والدالّةَ والسياسةَ والمُشغِّلَ ومنحَ المخطّط", () => {
    const created = createdBy(`
      create table if not exists orders (id uuid);
      alter table orders add column if not exists city_id uuid;
      create or replace function f(a uuid, b text) returns jsonb language sql as $$ select '{}'::jsonb $$;
      create policy "orders_read" on orders for select using (true);
      create trigger orders_touch before update on orders for each row execute function f();
      grant usage on schema public to anon;
    `);
    expect([...created.tables]).toEqual(["orders"]);
    expect([...created.columns]).toEqual(["orders.city_id"]);
    expect([...created.functions]).toEqual(["f(2)"]);
    expect([...created.policies]).toEqual(["orders.orders_read"]);
    expect([...created.triggers]).toEqual(["orders.orders_touch"]);
    expect([...created.schemaGrants]).toEqual(["public"]);
  });
});

describe("قراءةُ التضييق", () => {
  const cases: readonly (readonly [string, SchemaChange["kind"], string])[] = [
    ["drop table orders;", "drop_table", "orders"],
    ["drop view v_orders;", "drop_view", "v_orders"],
    ["drop type order_state;", "drop_type", "order_state"],
    ["truncate table orders;", "truncate", "orders"],
    ["alter table orders drop column city_id;", "drop_column", "orders.city_id"],
    ["alter table orders alter column city_id set not null;", "set_not_null", "orders.city_id"],
    [
      "alter table orders alter column price set data type numeric;",
      "set_data_type",
      "orders.price",
    ],
    ["alter table orders alter column price drop default;", "drop_default", "orders.price"],
    ["drop function if exists f(uuid, text);", "drop_function", "f(2)"],
    ['drop policy if exists "orders_read" on orders;', "drop_policy", "orders.orders_read"],
    ["drop trigger if exists orders_touch on orders;", "drop_trigger", "orders.orders_touch"],
    ["revoke usage on schema public from anon;", "revoke_schema", "public"],
    ["revoke all on function f(uuid) from public;", "revoke_function", "f(1)"],
    ["revoke select on table orders from anon;", "revoke_table", "orders"],
  ];
  for (const [sql, kind, target] of cases) {
    it(`يُصيب ${kind}`, () => {
      const found = narrowingChanges("0001_x.sql", sql);
      expect(found.map((item) => `${item.kind}:${item.target}`)).toContain(`${kind}:${target}`);
    });
  }

  it("لا يقرأ ما في تعليقٍ — والتعليقُ يذكر الممنوعَ نصّاً ولا يُنفِّذه", () => {
    expect(narrowingChanges("0001_x.sql", "-- لا حذف: لا drop table ولا drop column")).toEqual([]);
  });

  it("يقرأ رقمَ السطرِ صحيحاً بعدَ تعليقٍ", () => {
    const found = narrowingChanges("0001_x.sql", "-- تعليقٌ\n\ndrop table orders;");
    expect(found[0]?.line).toBe(3);
  });
});

describe("الدالّةُ الموقوفةُ لا المحذوفة", () => {
  it("تُصاب دالّةٌ جسدُها يبدأ برفعِ خطأٍ", () => {
    const sql = `create or replace function g(a text) returns jsonb language plpgsql as $body$
      begin
        raise exception 'موقوفة: استخدم النسخةَ الجديدةَ';
      end;
      $body$;`;
    expect(stubbedFunctions(sql).map((item) => item.target)).toEqual(["g(1)"]);
  });

  it("لا تُصاب دالّةٌ ترفع الخطأَ بعدَ شرطٍ — وذلك تحقُّقٌ مشروعٌ لا إيقافٌ", () => {
    const sql = `create or replace function g(a text) returns jsonb language plpgsql as $body$
      begin
        if a is null then raise exception 'مدخلٌ ناقصٌ'; end if;
        return '{}'::jsonb;
      end;
      $body$;`;
    expect(stubbedFunctions(sql)).toEqual([]);
  });
});

describe("مجموعةُ الخطرِ تحتاج ما قبلَ الهجرةِ لا الهجرةَ وحدَها", () => {
  it("ما أُنشئ وضُيِّق في الهجرةِ نفسِها ليس خطراً — لا نسخةَ سابقةً تعرفه", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: `create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
              revoke all on function f(uuid) from public;`,
      },
    ]);
    expect(risks).toEqual([]);
  });

  it("تضييقٌ على كائنٍ من هجرةٍ أسبقَ خطرٌ", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: "create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;",
      },
      { file: "0002_b.sql", sql: "revoke all on function f(uuid) from public;" },
    ]);
    expect(risks.map(riskTag)).toEqual(["0002_b.sql::revoke_function:f(1)"]);
  });

  it("حذفٌ ثمّ إنشاءٌ بالتوقيعِ نفسِه ليس خطراً — إعادةُ تعريفٍ مُتساوية", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: "create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;",
      },
      {
        file: "0002_b.sql",
        sql: `drop function if exists f(uuid);
              create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;`,
      },
    ]);
    expect(risks).toEqual([]);
  });

  it("حذفٌ ثمّ إنشاءٌ بتوقيعٍ مختلفٍ خطرٌ — النداءُ القديمُ يفشل", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: "create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;",
      },
      {
        file: "0002_b.sql",
        sql: `drop function if exists f(uuid);
              create or replace function f(a uuid, b integer) returns jsonb language sql as $$ select '{}'::jsonb $$;`,
      },
    ]);
    expect(risks.map(riskTag)).toEqual(["0002_b.sql::drop_function:f(1)"]);
  });

  it("الترتيبُ بالاسمِ لا بترتيبِ الإدخالِ — وهو ترتيبُ التطبيقِ في CI والإنتاج", () => {
    const risks = findRollbackRisks([
      { file: "0002_b.sql", sql: "drop table orders;" },
      { file: "0001_a.sql", sql: "create table orders (id uuid);" },
    ]);
    expect(risks.map(riskTag)).toEqual(["0002_b.sql::drop_table:orders"]);
  });

  it("السلبيُّ الكاذبُ المُعلَنُ: حذفٌ يُبنى بنصٍّ مُركَّبٍ لا يُكتشَف", () => {
    const risks = findRollbackRisks([
      { file: "0001_a.sql", sql: "create table orders (id uuid);" },
      { file: "0002_b.sql", sql: "do $$ begin execute 'drop ta' || 'ble orders'; end $$;" },
    ]);
    expect(risks).toEqual([]);
  });

  it("السلبيُّ الكاذبُ المُعلَنُ: تغييرُ نوعِ وسيطٍ مع بقاءِ عددِه لا يُكتشَف", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: "create or replace function f(a uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;",
      },
      {
        file: "0002_b.sql",
        sql: `drop function if exists f(uuid);
              create or replace function f(a text) returns jsonb language sql as $$ select '{}'::jsonb $$;`,
      },
    ]);
    expect(risks).toEqual([]);
  });

  it("وسومُ الخطرِ بلا تكرارٍ: ثلاثةُ أدوارٍ في ثلاثةِ أسطرٍ خطرٌ واحدٌ", () => {
    const tags = uniqueRiskTags([
      change("revoke_function", "f(1)"),
      change("revoke_function", "f(1)"),
      change("revoke_function", "f(1)"),
    ]);
    expect(tags).toEqual(["0001_x.sql::revoke_function:f(1)"]);
  });
});

describe("الحاجزُ يسقط حيثُ يجب", () => {
  it("لا مخالفةَ في المدخلِ الصالح", () => {
    expect(auditRollbackSafety(input())).toEqual([]);
  });

  it("تضييقٌ غيرُ مُعلَنٍ يسقط", () => {
    const violations = auditRollbackSafety(input({ declarations: [] }));
    expect(violations.some((line) => line.includes("غيرُ مُعلَنٍ"))).toBe(true);
  });

  it("مدخلٌ ميّتٌ بلا تضييقٍ يقابله يسقط", () => {
    const violations = auditRollbackSafety(input({ risks: [] }));
    expect(violations.some((line) => line.includes("ولا تضييقَ يقابله"))).toBe(true);
  });

  it("مدخلٌ مكرّرٌ يسقط", () => {
    const violations = auditRollbackSafety(input({ declarations: [VALID, VALID] }));
    expect(violations.some((line) => line.includes("مدخلٌ مكرّرٌ"))).toBe(true);
  });

  it("كسرُ نسخةٍ سابقةٍ مع مسارٍ آمنٍ يسقط — فلا يُوسَم الكسرُ آمناً", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            coupledDeploy: true,
            documentedIn: "أمرُ العودة",
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("لا يُوسَم آمناً"))).toBe(true);
  });

  it("كسرٌ بلا نشرٍ مقرونٍ يسقط", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            rollbackPath: "forward-only",
            coupledDeploy: false,
            documentedIn: "أمرُ العودة",
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("بلا نشرٍ مقرونٍ"))).toBe(true);
  });

  it("كسرٌ بلا إجراءٍ موثَّقٍ يسقط", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            rollbackPath: "forward-only",
            coupledDeploy: true,
            documentedIn: null,
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("ولا إجراءَ موثَّقاً"))).toBe(true);
  });

  it("عنوانٌ مُشارٌ إليه ولا وجودَ له في الوثيقةِ يسقط", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            rollbackPath: "forward-only",
            coupledDeploy: true,
            documentedIn: "عنوانٌ لا وجودَ له",
          },
        ],
      }),
    );
    expect(violations.some((line) => line.includes("ينقصه العنوانُ"))).toBe(true);
  });

  it("عنوانٌ ميّتٌ لتغييرٍ لا يكسر شيئاً يسقط", () => {
    const violations = auditRollbackSafety(
      input({ declarations: [{ ...VALID, documentedIn: "أمرُ العودة" }] }),
    );
    expect(violations.some((line) => line.includes("عنوانٌ موثَّقٌ لتغييرٍ لا يكسر"))).toBe(true);
  });

  it("سببٌ أقصرُ من أن يُقرأ وحدَه يسقط", () => {
    const violations = auditRollbackSafety(
      input({ declarations: [{ ...VALID, why: "لأنّه لازمٌ" }] }),
    );
    expect(violations.some((line) => line.includes("أقصرُ من أن يُقرأ"))).toBe(true);
  });

  it("مدخلٌ يشير إلى ملفِّ هجرةٍ معدومٍ يسقط", () => {
    const violations = auditRollbackSafety(input({ migrationFiles: [] }));
    expect(violations.some((line) => line.includes("ولا ملفَّ هجرةٍ بهذا الاسمِ"))).toBe(true);
  });

  it("لا وثيقةَ عودةٍ يسقط", () => {
    const violations = auditRollbackSafety(input({ rollbackDoc: null }));
    expect(violations.some((line) => line.includes("لا وثيقةَ عودةٍ"))).toBe(true);
  });

  it("قسمٌ ناقصٌ في الوثيقةِ يسقط", () => {
    const violations = auditRollbackSafety(input({ rollbackDoc: DOC.replace("أمرُ العودة", "س") }));
    expect(violations.some((line) => line.includes("ينقصه القسمُ"))).toBe(true);
  });

  it("وثيقةٌ بلا أمرِ عودةٍ حرفيٍّ تسقط", () => {
    const violations = auditRollbackSafety(
      input({ rollbackDoc: DOC.replaceAll("render rollback", "أعِد النشرَ") }),
    );
    expect(violations.some((line) => line.includes("لا أمرَ عودةٍ حرفياً"))).toBe(true);
  });

  it("نشرٌ مقرونٌ مع نشرٍ تلقائيٍّ يسقط", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            rollbackPath: "forward-only",
            coupledDeploy: true,
            documentedIn: "أمرُ العودة",
          },
        ],
        renderFile: RENDER.replaceAll("autoDeploy: false", "autoDeploy: true"),
      }),
    );
    expect(violations.some((line) => line.includes("ليس `false`"))).toBe(true);
  });

  it("نشرٌ مقرونٌ بلا وصفِ نشرٍ يسقط", () => {
    const violations = auditRollbackSafety(
      input({
        declarations: [
          {
            ...VALID,
            breaksPreviousRelease: true,
            rollbackPath: "forward-only",
            coupledDeploy: true,
            documentedIn: "أمرُ العودة",
          },
        ],
        renderFile: null,
      }),
    );
    expect(violations.some((line) => line.includes("لم يُقرأ"))).toBe(true);
  });
});

describe("السحبُ الجامعُ — أوسعُ تضييقٍ وأقلُّه ظهوراً", () => {
  it("`revoke … on all functions in schema public` خطرٌ وإن لم تُنشئْ هجرةٌ شيئاً قبلَه", () => {
    const risks = findRollbackRisks([
      { file: "0001_a.sql", sql: "revoke execute on all functions in schema public from public;" },
    ]);
    expect(risks.map((risk) => `${risk.kind}:${risk.target}`)).toEqual([
      "revoke_all_in_schema:functions:public",
    ]);
  });

  it("كلُّ صنفٍ من الكائناتِ خطرٌ مستقلٌّ لا خطرٌ واحدٌ", () => {
    const risks = findRollbackRisks([
      {
        file: "0001_a.sql",
        sql: `revoke all on all tables in schema public from public;
              revoke all on all sequences in schema public from public;`,
      },
    ]);
    expect(risks.map((risk) => risk.target).sort()).toEqual(["sequences:public", "tables:public"]);
  });

  it("`revoke usage on schema public` خطرٌ بلا منحٍ سابقٍ: المنحُ من PostgreSQL نفسِه", () => {
    const risks = findRollbackRisks([
      { file: "0001_a.sql", sql: "revoke usage on schema public from public;" },
    ]);
    expect(risks.map((risk) => `${risk.kind}:${risk.target}`)).toEqual(["revoke_schema:public"]);
  });

  it("`revoke usage on schema` لمخطّطٍ آخرَ لم يُمنَحْ ليس خطراً", () => {
    const risks = findRollbackRisks([
      { file: "0001_a.sql", sql: "revoke usage on schema analytics from anon;" },
    ]);
    expect(risks).toEqual([]);
  });

  it("السحبُ الجامعُ في المستودعِ الحقيقيِّ مُعلَنٌ للهجرتَين معاً", () => {
    const declared = ROLLBACK_DECLARATIONS.filter((entry) =>
      entry.change.startsWith("revoke_all_in_schema:"),
    );
    const migrations = new Set(declared.map((entry) => entry.migration));
    expect(migrations).toEqual(
      new Set([
        "20260809000000_phase_3_close_postgrest_surface.sql",
        "20260809001000_phase_3_close_postgrest_surface_fix.sql",
      ]),
    );
  });

  it("التصحيحُ وحدَه يُعلَن كاسراً، والمحاولةُ الأولى لا — والتمرينُ قاس لها صفراً", () => {
    const byMigration = (file: string): readonly boolean[] =>
      ROLLBACK_DECLARATIONS.filter(
        (entry) => entry.migration === file && entry.change.includes("public"),
      ).map((entry) => entry.breaksPreviousRelease);
    expect(
      byMigration("20260809000000_phase_3_close_postgrest_surface.sql").every(
        (breaks) => breaks === false,
      ),
    ).toBe(true);
    expect(
      byMigration("20260809001000_phase_3_close_postgrest_surface_fix.sql").every(
        (breaks) => breaks === true,
      ),
    ).toBe(true);
  });
});

describe("السجلُّ يقابل المستودعَ كما هو اليومَ", () => {
  it("مجموعةُ الخطرِ والسجلُّ متطابقان في الاتجاهَين", () => {
    const risks = findRollbackRisks(readMigrations(process.cwd()));
    const riskTags = [...uniqueRiskTags(risks)].sort();
    const declaredTags = ROLLBACK_DECLARATIONS.map(declarationTag).sort();
    expect(declaredTags).toEqual(riskTags);
  });

  it("الحاجزُ أخضرُ على المستودعِ الحقيقيِّ — وبلا مخالفةٍ واحدةٍ", () => {
    const migrations = readMigrations(process.cwd());
    const violations = auditRollbackSafety({
      risks: findRollbackRisks(migrations),
      declarations: ROLLBACK_DECLARATIONS,
      migrationFiles: migrations.map((migration) => migration.file),
      rollbackDoc: DOC,
      renderFile: RENDER,
    });
    expect(violations).toEqual([]);
  });
});

describe("قراءةُ الفقدِ بين صورتَي كاتالوج", () => {
  it("غيابُ وسمٍ فقدٌ", () => {
    expect(lossesBetween(new Set(["table:orders"]), new Set())).toEqual(["غاب: table:orders"]);
  });

  it("`notnull` معكوسٌ: ظهورُه على عمودٍ قائمٍ تضييقٌ", () => {
    const before = new Set(["table:orders", "column:orders.city_id"]);
    const after = new Set([...before, "notnull:orders.city_id"]);
    expect(lossesBetween(before, after)).toEqual(["ضاق: notnull:orders.city_id"]);
  });

  it("جدولٌ جديدٌ بأعمدةٍ مُلزَمةٍ ليس تضييقاً: لا نسخةَ سابقةً تعرفُه", () => {
    const after = new Set([
      "table:orders",
      "column:orders.id",
      "notnull:orders.id",
      "column:orders.city_id",
      "notnull:orders.city_id",
    ]);
    expect(lossesBetween(new Set(), after)).toEqual([]);
  });

  /**
   * حدٌّ مُعلَنٌ لا سهوٌ: عمودٌ مُلزَمٌ جديدٌ على جدولٍ قائمٍ **قد** يكسر إدراجاً
   * من نسخةٍ سابقةٍ لا تعرفُه إن لم يكن له افتراضٌ. ولا يُعَدُّ فقداً ههنا إبقاءً
   * على مطابقةِ التمرينِ للحاجزِ الساكنِ (وهو لا يرى `add column`)؛ والحدُّ مكتوبٌ
   * في `docs/rollback.md` §«ما لا يُغطّيه هذا المسار».
   */
  it("عمودٌ مُلزَمٌ يُضاف إلى جدولٍ قائمٍ لا يُعَدُّ فقداً — حدٌّ مُعلَنٌ", () => {
    const before = new Set(["table:orders", "column:orders.id"]);
    const after = new Set([...before, "column:orders.city_id", "notnull:orders.city_id"]);
    expect(lossesBetween(before, after)).toEqual([]);
  });

  it("`notnull` معكوسٌ: غيابُه توسيعٌ لا فقدٌ", () => {
    expect(lossesBetween(new Set(["notnull:orders.city_id"]), new Set())).toEqual([]);
  });

  it("صورتان متساويتان بلا فقدٍ", () => {
    const one = new Set(["table:orders", "notnull:orders.id"]);
    expect(lossesBetween(one, new Set(one))).toEqual([]);
  });
});
