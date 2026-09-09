/**
 * # قواعدُ سلامةِ الهجراتِ — ولكلِّ قاعدةٍ برهانُ سقوطٍ
 *
 * حاجزٌ أخضرُ وهو أعمى أسوأُ من لا حاجزٍ، وقد وقعَ ذلكَ في هذا المستودعِ
 * مرّتَينِ (ADR 0045 §٧ · ADR 0046 §٨). فكلُّ قاعدةٍ ههنا **تسقطُ على نصٍّ
 * مخالفٍ** ثمَّ **تمرُّ على النصِّ المُصحَّحِ**، والقاسمةُ تُقاسُ على أجسامِ دوالَّ
 * حقيقيّةٍ فيها فاصلةٌ منقوطةٌ داخلَ اقتباسٍ بالدولارِ.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationFiles, stampOf } from "../../scripts/check-migration-safety.ts";
import {
  LEGACY_MIGRATIONS,
  MIGRATION_SAFETY_CUTOFF,
} from "../../scripts/lib/migration-baseline.ts";
import {
  declaredPhase,
  isConcurrentIndex,
  judgeMigration,
  planFor,
  type SafetyCode,
  splitStatements,
} from "../../scripts/lib/migration-safety.ts";

/** الرموزُ وحدَها — النصُّ العربيُّ للقارئِ البشريِّ لا للتوكيدِ. */
function codesOf(sql: string): SafetyCode[] {
  return judgeMigration(sql).map((finding) => finding.code);
}

const HEADER = "-- migration-phase: expand\n";

describe("قاسمةُ العباراتِ — الفاصلةُ المنقوطةُ خارجَ الاقتباسِ وحدَها تفصلُ", () => {
  test("جسمُ دالّةٍ بفواصلَ منقوطةٍ داخلَ `$$` عبارةٌ واحدةٌ لا سبعٌ", () => {
    const sql = `create or replace function f() returns void as $$
begin
  perform 1;
  perform 2;
end;
$$ language plpgsql;`;
    const statements = splitStatements(sql);
    expect(statements.length).toBe(1);
    expect(statements[0]?.text).toContain("language plpgsql");
  });

  test("وسمُ دولارٍ مُسمّىً (`$fn$`) يُحترَمُ كذلك", () => {
    const sql = `create function g() returns int as $fn$ begin return 1; end; $fn$ language plpgsql;
select 1;`;
    expect(splitStatements(sql).length).toBe(2);
  });

  test("فاصلةٌ منقوطةٌ داخلَ نصٍّ مقتبسٍ لا تفصلُ، و`''` هَربٌ لا نهايةٌ", () => {
    const sql = `insert into t (v) values ('a;b') on conflict do nothing;
insert into t (v) values ('it''s; fine') on conflict do nothing;`;
    expect(splitStatements(sql).length).toBe(2);
  });

  test("التعليقُ السطريُّ والكتليُّ لا يفصلانِ ولا يُحسَبانِ عبارةً", () => {
    const sql = `-- تعليقٌ فيه ; فاصلةٌ
/* وكتليٌّ فيه ; كذلك */
select 1;`;
    const statements = splitStatements(sql);
    expect(statements.length).toBe(1);
  });

  test("رقمُ السطرِ يُحفَظُ لكلِّ عبارةٍ فيُقرأُ الحكمُ في موضعِه", () => {
    const sql = "select 1;\n\nselect 2;\n";
    const statements = splitStatements(sql);
    expect(statements[0]?.line).toBe(1);
    expect(statements[1]?.line).toBe(3);
  });
});

describe("الطورُ مُصرَّحٌ بصيغةٍ حرفيّةٍ", () => {
  test("غيابُ التصريحِ مخالفةٌ", () => {
    expect(codesOf("select 1;")).toContain("PHASE_MISSING");
  });

  test("طورٌ غيرُ معروفٍ مخالفةٌ — ولا يُقبَلُ توسيعُ القائمةِ بتعليقٍ في هجرةٍ", () => {
    expect(codesOf("-- migration-phase: whenever\nselect 1;")).toContain("PHASE_UNKNOWN");
  });

  test("التصريحُ الصحيحُ يُقرأُ ولا يُخالِفُ", () => {
    expect(declaredPhase("-- migration-phase: contract\n").known).toBe("contract");
    expect(codesOf(`${HEADER}select 1;`)).toEqual([]);
  });
});

describe("١) الفهرسُ يُنشأُ متزامناً وفي ملفٍّ وحدَه", () => {
  test("`create index` بلا `concurrently` تسقطُ", () => {
    const codes = codesOf(`${HEADER}create index if not exists t_v_idx on t (v);`);
    expect(codes).toContain("INDEX_NOT_CONCURRENT");
  });

  test("المتزامنُ في طورِه ووحدَه يمرُّ", () => {
    const sql =
      "-- migration-phase: index\ncreate index concurrently if not exists t_v_idx on t (v);";
    expect(codesOf(sql)).toEqual([]);
    expect(isConcurrentIndex(sql)).toBe(true);
    expect(planFor(sql).transactional).toBe(false);
  });

  test("متزامنٌ معَ عبارةٍ أخرى يسقطُ — لأنَّ المعاملةَ تمنعُه", () => {
    const sql =
      "-- migration-phase: index\ncreate index concurrently if not exists a_idx on a (v);\ncreate index concurrently if not exists b_idx on b (v);";
    expect(codesOf(sql)).toContain("CONCURRENT_INDEX_NOT_ALONE");
  });

  test("متزامنٌ في طورٍ غيرِ `index` يسقطُ — فالمُطبِّقُ يُغلِّفُه بمعاملةٍ", () => {
    const sql = `${HEADER}create index concurrently if not exists t_v_idx on t (v);`;
    expect(codesOf(sql)).toContain("CONCURRENT_INDEX_WRONG_PHASE");
  });
});

describe("٢) القيدُ يُضافُ `not valid` ويُصادَقُ لاحقاً", () => {
  test("قيدُ تحقُّقٍ بلا `not valid` يسقطُ", () => {
    const sql = `${HEADER}alter table t add constraint t_v_check check (v > 0);`;
    expect(codesOf(sql)).toContain("CONSTRAINT_NOT_VALID_MISSING");
  });

  test("مفتاحٌ أجنبيٌّ بلا `not valid` يسقطُ كذلك", () => {
    const sql = `${HEADER}alter table t add constraint t_c_fkey foreign key (c) references cities (id);`;
    expect(codesOf(sql)).toContain("CONSTRAINT_NOT_VALID_MISSING");
  });

  test("`not valid` يمرُّ، و`validate constraint` في طورِ التصديقِ يمرُّ", () => {
    expect(
      codesOf(`${HEADER}alter table t add constraint t_v_check check (v > 0) not valid;`),
    ).toEqual([]);
    expect(
      codesOf("-- migration-phase: validate\nalter table t validate constraint t_v_check;"),
    ).toEqual([]);
  });
});

describe("٣) `set not null` ممنوعةٌ — مسحٌ كاملٌ تحتَ قفلٍ حاجزٍ", () => {
  test("تسقطُ حيثُ وقعَت", () => {
    expect(codesOf(`${HEADER}alter table t alter column v set not null;`)).toContain(
      "SET_NOT_NULL_FORBIDDEN",
    );
  });

  test("والبديلُ المُعتمَدُ يمرُّ", () => {
    expect(
      codesOf(
        `${HEADER}alter table t add constraint t_v_not_null check (v is not null) not valid;`,
      ),
    ).toEqual([]);
  });
});

describe("٤) الحذفُ وإعادةُ التسميةِ في طورِ `contract` وحدَه", () => {
  test("حذفُ عمودٍ في طورِ التوسيعِ يسقطُ", () => {
    expect(codesOf(`${HEADER}alter table t drop column if exists v;`)).toContain(
      "DESTRUCTIVE_OUTSIDE_CONTRACT",
    );
  });

  test("وفي طورِ التقليصِ يمرُّ", () => {
    expect(codesOf("-- migration-phase: contract\nalter table t drop column if exists v;")).toEqual(
      [],
    );
  });

  test("إعادةُ التسميةِ محكومةٌ بالحكمِ نفسِه", () => {
    expect(codesOf(`${HEADER}alter table t rename column a to b;`)).toContain(
      "DESTRUCTIVE_OUTSIDE_CONTRACT",
    );
  });
});

describe("٥) الاسترجاعُ شرطٌ: المُطبِّقُ يُعيدُ كلَّ ملفٍّ في كلِّ تشغيلٍ", () => {
  test("`create table` بلا `if not exists` تسقطُ", () => {
    expect(codesOf(`${HEADER}create table t (id uuid primary key);`)).toContain("NOT_IDEMPOTENT");
  });

  test("`drop` بلا `if exists` تسقطُ", () => {
    expect(codesOf("-- migration-phase: contract\ndrop table t;")).toContain("NOT_IDEMPOTENT");
  });

  test("`insert` بلا `on conflict` ولا `where not exists` تسقطُ — البذرُ يتضاعفُ", () => {
    expect(codesOf(`${HEADER}insert into cities (code) values ('MED');`)).toContain(
      "NOT_IDEMPOTENT",
    );
  });

  test("و`on conflict` يمرُّ، و`where not exists` يمرُّ", () => {
    expect(
      codesOf(`${HEADER}insert into cities (code) values ('MED') on conflict do nothing;`),
    ).toEqual([]);
    expect(
      codesOf(
        `${HEADER}insert into cities (code) select 'MED' where not exists (select 1 from cities where code = 'MED');`,
      ),
    ).toEqual([]);
  });
});

describe("٦) المعاملةُ يملكُها المُطبِّقُ لا الملفُّ", () => {
  test("`begin` مكتوبةٌ في الهجرةِ تسقطُ", () => {
    expect(codesOf(`${HEADER}begin;\nselect 1;\ncommit;`)).toContain("EXPLICIT_TRANSACTION");
  });

  test("وخُطّةُ التطبيقِ: ما سوى طورِ الفهرسِ معاملةٌ واحدةٌ", () => {
    const plan = planFor(`${HEADER}select 1;\nselect 2;`);
    expect(plan.transactional).toBe(true);
    expect(plan.statements.length).toBe(2);
  });
});

describe("النجاحُ الكاذبُ مسدودٌ: النصُّ المقتبسُ لا يُصنَعُ منه حكمٌ", () => {
  test("كلمةُ `drop table` داخلَ نصٍّ أو تعليقٍ لا تُعَدُّ حذفاً", () => {
    const sql = `${HEADER}insert into audit_log (note) values ('drop table t') on conflict do nothing;
-- create index on t (v)
select 1;`;
    expect(codesOf(sql)).toEqual([]);
  });

  test("جسمُ دالّةٍ فيه `set not null` نصّاً لا يُعَدُّ مخالفةً", () => {
    const sql = `${HEADER}create or replace function f() returns text as $$
begin
  return 'alter table t alter column v set not null';
end;
$$ language plpgsql;`;
    expect(codesOf(sql)).toEqual([]);
  });
});

describe("سلامةُ الدَّينِ المُعلَنِ — سقفٌ لا يعلو", () => {
  test("ثمانٌ وسبعونَ هجرةً مُعلَنةً بالعددِ نفسِه لا تزيدُ", () => {
    expect(LEGACY_MIGRATIONS.length).toBe(78);
  });

  test("ولا اسمَ مكرَّراً في القائمةِ", () => {
    expect(new Set(LEGACY_MIGRATIONS).size).toBe(LEGACY_MIGRATIONS.length);
  });

  test("وكلُّ مُعلَنٍ تاريخُه قبلَ حدِّ التقادمِ", () => {
    for (const name of LEGACY_MIGRATIONS) {
      const stamp = stampOf(name);
      expect(stamp).not.toBeNull();
      expect(stamp === null ? "" : stamp < MIGRATION_SAFETY_CUTOFF).toBe(true);
    }
  });

  test("وكلُّ مُعلَنٍ له ملفٌّ قائمٌ — لا مُدخلَ ميّتاً يُعفي ملفّاً مستقبليّاً", () => {
    const onDisk = new Set(migrationFiles());
    for (const name of LEGACY_MIGRATIONS) expect(onDisk.has(name)).toBe(true);
  });

  test("وكلُّ ملفٍّ قبلَ الحدِّ مُعلَنٌ — لا هجرةَ تُفلِتُ بلا حكمٍ ولا إعلانٍ", () => {
    const declared = new Set<string>(LEGACY_MIGRATIONS);
    for (const file of migrationFiles()) {
      const stamp = stampOf(file);
      if (stamp !== null && stamp < MIGRATION_SAFETY_CUTOFF) expect(declared.has(file)).toBe(true);
    }
  });

  test("والقاسمةُ تقرأُ الهجراتَ القائمةَ كلَّها بلا سقوطٍ ولا عبارةٍ فارغةٍ", () => {
    for (const file of migrationFiles()) {
      const sql = readFileSync(join("supabase/migrations", file), "utf8");
      const statements = splitStatements(sql);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) expect(statement.text.trim().length).toBeGreaterThan(0);
    }
  });
});
