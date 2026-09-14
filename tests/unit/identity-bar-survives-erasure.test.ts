/**
 * الغرض: قياسُ ما يُمكِنُ قياسُه ساكناً من [ADR 0113](../../docs/adr/0113-the-bar-survives-erasure.md)
 *   — **حالةٌ سلبيّةٌ لكلِّ قاعدةٍ** (`ح-7`: قاعدةٌ بلا حالةٍ سلبيّةٍ غيرُ
 *   مُنفَذةٍ). أمّا سلوكُ المُشغِّلَينِ فلا يُقاسُ ههنا بل على قاعدةٍ
 *   حقيقيّةٍ في `tests/integration/identity-bar-survives-erasure.test.ts`.
 * الحالة: منفَّذٌ فعليّاً — `ADR 0113`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ نصُّ الهجرةِ ههنا: **لأنَّ ثلاثاً من قواعدِ هذا القرارِ
 * عدميّةٌ** — «لا يُصفّى بالمدينةِ»، و«لا يُرفَعُ الحظرُ»، و«لا تُفصَحُ
 * التجزئةُ» — والقاعدةُ العدميّةُ لا يُثبِتُها اختبارُ تكاملٍ ناجحٌ: مَن
 * أضافَ `and city_id = ...` غداً يبقى اختبارُ التكاملِ أخضرَ لأنَّ حالاتِه
 * كلَّها في مدينةٍ واحدةٍ. فالحرسُ على العدمِ نصّيٌّ أو لا يكونُ.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { RETENTION_BASES } from "../../packages/domain/privacy/data-rights.ts";
import { TABLE_ERASURE } from "../../packages/shared/config/erasure-policy.ts";
import {
  isPlatformSecretTable,
  PLATFORM_SECRET_DECLARATION_PREFIX,
  PLATFORM_SECRET_TABLES,
  platformSecretDeclaration,
} from "../../packages/shared/config/platform-secret.ts";
import { TABLE_RETENTION } from "../../packages/shared/config/retention-policy.ts";
import { lastDefiningMigration } from "../../scripts/check-erasure-policy.ts";
import { declaredPlatformSecrets } from "../../scripts/check-migrations.ts";

const MIGRATION = "supabase/migrations/20260914200000_identity_bar_survives_erasure.sql";
const INDEX_FILES = [
  "supabase/migrations/20260914200100_identity_marks_phone_hash_index.sql",
  "supabase/migrations/20260914200200_identity_marks_blocked_index.sql",
] as const;
const sql = readFileSync(MIGRATION, "utf8");

describe("صنفُ «سرِّ منصّةٍ» مغلقٌ ومُعلَنٌ بشرطَين", () => {
  test("عضوُه اليومَ واحدٌ ولا سواه", () => {
    expect([...PLATFORM_SECRET_TABLES]).toEqual(["identity_hash_pepper"]);
  });

  test("يقبلُ العضوَ ويردُّ ما ليسَ عضواً", () => {
    expect(isPlatformSecretTable("identity_hash_pepper")).toBe(true);
    // الأثرُ نفسُه **ليسَ** سرَّ منصّةٍ: يحملُ `city_id` ويلزمُه.
    expect(isPlatformSecretTable("identity_marks")).toBe(false);
    expect(isPlatformSecretTable("users")).toBe(false);
    expect(isPlatformSecretTable("")).toBe(false);
  });

  test("الإعلانُ نصٌّ محدَّدٌ لا اسمٌ حرٌّ", () => {
    expect(platformSecretDeclaration("identity_hash_pepper")).toBe(
      `${PLATFORM_SECRET_DECLARATION_PREFIX} identity_hash_pepper`,
    );
  });

  test("الهجرةُ تُعلِنُ سرَّها صريحاً", () => {
    expect([...declaredPlatformSecrets(sql)]).toEqual(["identity_hash_pepper"]);
  });

  test("لا يُقرَأُ إعلانٌ من نصٍّ لا يحملُه — وحالتُه السلبيّةُ", () => {
    expect([...declaredPlatformSecrets("create table x (id uuid);")]).toEqual([]);
    // بادئةٌ مُشابهةٌ لا تُقرَأُ إعلاناً: الحرسُ على البادئةِ حرفاً.
    expect([...declaredPlatformSecrets("-- platform secret: y")]).toEqual([]);
  });
});

describe("الفِلفِلُ مُقفَلٌ في القاعدةِ لا في عُرفٍ", () => {
  test("يُولَدُ من عشوائيّةٍ لا من ثابتٍ مكتوبٍ", () => {
    expect(sql).toContain("gen_random_bytes(32)");
  });

  test("`RLS` مفعَّلةٌ عليه ومِنَحُه مسحوبةٌ", () => {
    expect(sql).toMatch(/alter table[^;]*identity_hash_pepper[^;]*enable row level security/s);
    expect(sql).toMatch(/revoke all on table public\.identity_hash_pepper/);
  });

  test("التجزئةُ `security definer` — وإلّا لَما قرأَت السرَّ أصلاً", () => {
    expect(sql).toMatch(/function public\.identity_hash\(/);
    expect(sql).toMatch(/identity_hash\([\s\S]{0,600}?security definer/);
  });

  test("التجزئةُ مسحوبةٌ من العامِّ فلا تُستعمَلُ مِعجَمَ تخميناتٍ", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.identity_hash\(text\) from public, anon, authenticated/,
    );
  });
});

describe("الأثرُ لا يحملُ هُويّةً مقروءةً", () => {
  test("قيدٌ يردُّ كلَّ ما ليسَ تجزئةً ستّةَ عشريّةً بستّينَ وأربعِ خانةٍ", () => {
    expect(sql).toContain("identity_marks_carry_no_plain_identity");
    expect(sql).toContain("^[0-9a-f]{64}$");
  });

  test("لا عمودَ اسمٍ ولا جوّالٍ ولا معرِّفِ تيليجرامَ صريحٍ في الجدولِ", () => {
    const start = sql.indexOf("create table if not exists public.identity_marks");
    const block = sql.slice(start, start + 2400);
    /**
     * **تُقاسُ تصاريحُ الأعمدةِ لا نصُّ الكتلةِ كلُّه**: الشروحُ في الكتلةِ
     * تُسمّي `telegram_id` لتقولَ إنَّه **لا يُحفَظُ**، فقياسُ النصِّ يُخفِقُ
     * على شرحٍ صادقٍ. والعمودُ ما كانَ في أوّلِ سطرٍ باسمِه ثمَّ نوعُه.
     */
    const columns = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[a-z_]+ +(uuid|text|boolean|integer|timestamptz)\b/.test(line))
      .map((line) => line.split(/ +/)[0]);
    expect(columns).toContain("telegram_hash");
    for (const forbidden of ["full_name", "telegram_username", "phone", "telegram_id"]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

describe("قواعدُ عدميّةٌ لا يُثبِتُها اختبارُ تكاملٍ أخضرُ", () => {
  /**
   * مَن أضافَ تصفيةً بالمدينةِ غداً يبقى اختبارُ التكاملِ أخضرَ — حالاتُه
   * كلُّها في مدينةٍ واحدةٍ — **ويكونُ الانتقالُ من جدّةَ إلى مكّةَ عفواً
   * آليّاً عن كلِّ حظرٍ**. فالحرسُ ههنا نصّيٌّ بالضرورةِ (`ADR 0113 §٢-هـ`).
   */
  test("المطابقةُ لا تُصفّى بالمدينةِ — الحظرُ يَعبُرُ المدنَ", () => {
    const body = sql.slice(sql.indexOf("function public.apply_identity_mark_on_signup"));
    const lookup = body.slice(0, body.indexOf("$$;"));
    expect(lookup).toContain("telegram_hash");
    expect(lookup).not.toMatch(/city_id\s*=/);
  });

  test("الحظرُ يُجمَعُ ولا يُرفَعُ عندَ حذفٍ ثانٍ", () => {
    expect(sql).toMatch(/is_blocked\s*=\s*im\.is_blocked\s+or\s+excluded\.is_blocked/);
  });

  test("التقييماتُ تُجمَعُ ولا تُستبدَلُ", () => {
    expect(sql).toMatch(/rating_sum\s*=\s*im\.rating_sum\s*\+\s*excluded\.rating_sum/);
    expect(sql).toMatch(/erasure_count\s*=\s*im\.erasure_count\s*\+\s*1/);
  });

  test("التجزئةُ نفسُها لا تُفصَحُ في التنزيلِ", () => {
    const start = sql.indexOf("function export_my_data(");
    expect(start).toBeGreaterThan(-1);
    const built = sql.slice(start, sql.indexOf("'identityBar'", start) + 1600);
    expect(built).toContain("'hash_disclosed', false");
    // **المفتاحُ هوَ ما يُفصَحُ**: لا مفتاحَ تجزئةٍ في الكائنِ المبنيِّ ولو
    // كانَ العمودُ مقروءاً داخلَ `where` — القراءةُ للمطابقةِ لا للإفصاحِ.
    expect(built).not.toMatch(/'telegram_hash',|'phone_hash',/);
  });
});

describe("المُشغِّلانِ في القاعدةِ لا في مسارِ تسجيلٍ واحدٍ", () => {
  test("الكتابةُ `before update` — إذ المعرِّفُ لا يبقى بعدَها", () => {
    expect(sql).toMatch(
      /create trigger users_mark_identity_before_erasure\s+before update on public\.users/,
    );
  });

  test("التطبيقُ `before insert` فيَشمُلُ كلَّ مسارٍ يُضافُ غداً", () => {
    expect(sql).toMatch(
      /create trigger users_apply_identity_mark_on_signup\s+before insert on public\.users/,
    );
  });

  test("بذرُ المقامِ `after insert` على `riders` لا `before`", () => {
    expect(sql).toMatch(
      /create trigger riders_seed_carried_standing\s+after insert on public\.riders/,
    );
  });
});

describe("الفهرسةُ في ملفٍّ منفصلٍ — `concurrently` لا تجري في معاملةٍ", () => {
  /**
   * **عبارةٌ واحدةٌ لكلِّ ملفٍّ لا ملفٌّ للفهرسَينِ**: المُطبِّقُ يُرسِلُ
   * الملفَّ متعدِّدَ العباراتِ في معاملةٍ واحدةٍ، و`concurrently` لا تُنفَّذُ
   * فيها (CAP-007). وأوّلُ صياغةٍ جمعَتْهما في ملفٍّ فردَّها الحاجزُ — وهذه
   * الحالةُ تمنعُ رجوعَ ذلكَ.
   */
  test("لكلِّ فهرسٍ ملفُّه، وطورُه `index`، وعبارةٌ واحدةٌ فيه", () => {
    for (const file of INDEX_FILES) {
      expect(existsSync(file)).toBe(true);
      const idx = readFileSync(file, "utf8");
      expect(idx).toContain("-- migration-phase: index");
      /**
       * **يُقاسُ ما يُنفَّذُ لا ما يُشرَحُ.** الشروحُ ههنا تُسمّي
       * `create index concurrently` لتقولَ لِمَ فُصِلَ الملفُّ، وتُسمّي
       * `drop index concurrently` أمرَ عودةٍ ومعَه فاصلتُه — فقياسُ النصِّ
       * الخامِّ يُخفِقُ على ملفٍّ سليمٍ، وحاجزٌ يكذبُ مرّةً يُعطَّلُ.
       */
      const executable = idx
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");
      expect(executable.match(/create index concurrently/g)).toHaveLength(1);
      expect(executable.split(";").filter((part) => part.trim().length > 0)).toHaveLength(1);
    }
  });

  test("ملفُّ التوسيعِ لا يحملُ `concurrently` — وإلّا لَفشِلَ التطبيقُ", () => {
    expect(sql).toContain("-- migration-phase: expand");
    // شرحٌ يُسمّي `concurrently` ليقولَ لِمَ فُصِلَ مقبولٌ؛ **أمرٌ يُنفِّذُها لا**.
    expect(sql).not.toMatch(/^\s*create index concurrently/m);
  });
});

describe("السجلّاتُ تعرفُ الجدولَينِ، والأساسُ مُعلَنٌ في المجالِ", () => {
  test("كلا الجدولَينِ مُصنَّفٌ استبقاءً ومحواً", () => {
    for (const table of ["identity_marks", "identity_hash_pepper"]) {
      expect(TABLE_RETENTION[table]).toBeDefined();
      expect(TABLE_ERASURE[table]).toBeDefined();
    }
  });

  test("الأثرُ يُستبقى بأساسٍ مُعلَنٍ ويُصدَّرُ في قسمٍ", () => {
    const rule = TABLE_ERASURE.identity_marks;
    expect(rule?.disposition).toBe("retain-declared-legal-basis");
    expect(rule?.exportSection).toBe("identityBar");
    expect(rule?.basis).toBeTruthy();
  });

  test("السرُّ ليسَ بيانةَ إنسانٍ فلا يُصدَّرُ ولا يُستبقى بأساسٍ", () => {
    const rule = TABLE_ERASURE.identity_hash_pepper;
    expect(rule?.disposition).toBe("no-personal-data");
    expect(rule?.exportSection).toBeNull();
    expect(rule?.subjects).toEqual([]);
  });

  test("الأساسُ الجديدُ عضوٌ في مجالِ الأسبابِ المغلقِ", () => {
    expect(RETENTION_BASES.blockAndStandingSurviveErasure).toBe(
      "BLOCK_AND_STANDING_SURVIVE_ERASURE",
    );
    expect(sql).toContain("BLOCK_AND_STANDING_SURVIVE_ERASURE");
  });
});

describe("`lastDefiningMigration`: العطبُ الذي كشفَه هذا البناءُ", () => {
  /**
   * الصياغةُ الأولى `find` تُعطي الأقدمَ. **وهيَ الحالةُ السلبيّةُ بعينِها**:
   * لو رجعَ أحدٌ إليها لَقالَ هذا الاختبارُ إنَّ الحاجزَ يقرأُ نصّاً ميّتاً.
   */
  const entries = [
    { file: "a", sql: "create or replace function export_my_data(p uuid) -- قديمٌ" },
    { file: "b", sql: "لا شيءَ ههنا" },
    { file: "c", sql: "create or replace function export_my_data(p uuid) -- نافذٌ" },
  ];

  test("يُعطي آخرَ تعريفٍ لا أوّلَه", () => {
    expect(lastDefiningMigration(entries, "function export_my_data(")?.file).toBe("c");
    expect(entries.find((e) => e.sql.includes("function export_my_data("))?.file).toBe("a");
  });

  test("يردُّ `undefined` إن لم يُعرَّف — لا أوّلَ عنصرٍ", () => {
    expect(lastDefiningMigration(entries, "function nothing_here(")).toBeUndefined();
    expect(lastDefiningMigration([], "function export_my_data(")).toBeUndefined();
  });

  test("تعريفٌ واحدٌ يُعطى وحدَه", () => {
    expect(
      lastDefiningMigration([entries[2]] as typeof entries, "function export_my_data(")?.file,
    ).toBe("c");
  });
});
