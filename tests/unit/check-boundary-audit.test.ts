/**
 * الغرض: إثباتُ أنَّ حاجزَ جردِ الحدودِ (`W-1`) **يُسقِطُ** فعلاً عندَ كلِّ صنفٍ من
 *   الخللِ الذي يزعمُ منعَه: جدولٌ جديدٌ بلا تصنيفٍ، ووثيقةٌ مُحرَّرةٌ بيدٍ فافترقَت
 *   عن السجلِّ، ووثيقةٌ فُقِدَت علامتا التوليدِ منها. وحاجزٌ لا يُختبَرُ سقوطُه
 *   حاجزٌ مزعومٌ: الأخضرُ عندَه لا يشهدُ بشيءٍ لأنَّه لا يعرفُ أن يحمَرَّ.
 * الحالة: اختبارُ وحدةٍ فعليٌّ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على scripts/check-boundary-audit.ts
 * ملاحظات مستقبلية: إن أُضيفَ نوعُ تحقُّقٍ جديدٌ في الحاجزِ فتُضافُ ههنا حالتاه:
 *   نصٌّ سليمٌ يُقبَلُ، ونصٌّ مختلٌّ يُرفَضُ بالتفصيلِ المتوقَّعِ.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  auditProblems,
  generatedSlice,
  type MigrationFile,
  renderInventoryTable,
  tablesInSchema,
  withGeneratedBlock,
} from "../../scripts/check-boundary-audit.ts";
import { declaredMigrations } from "../../scripts/lib/migration-sources.ts";
import {
  DISPOSITIONS,
  WASLA_BOUNDARY_INVENTORY,
  WASLA_COLUMN_CONCERNS,
} from "../../scripts/lib/wasla-boundary-registry.ts";

const AUDIT_DOC = "docs/wasla/boundary-audit.md";

// الجردُ يقرأُ **المُعلَنَ** لا المُطبَّقَ وحدَه (ADR 0095): جدولٌ مؤجَّلٌ يبقى
// مُصنَّفاً، وإلّا صارَ التأجيلُ محوَ تصنيفٍ.
function realMigrations(): MigrationFile[] {
  return declaredMigrations().map(({ file, sql }) => ({ file, sql }));
}

const realDoc = () => readFileSync(AUDIT_DOC, "utf8");
const details = (problems: { detail: string }[]) => problems.map((p) => p.detail).join(" | ");

describe("جردُ حدودِ WASLA — الحالةُ القائمةُ", () => {
  test("المخطَّطُ والسجلُّ والوثيقةُ متطابقةٌ اليومَ (بلا مخالفةٍ واحدةٍ)", () => {
    expect(auditProblems(realMigrations(), realDoc())).toEqual([]);
  });

  test("السجلُّ يُصنِّفُ كلَّ جدولٍ في المخطَّطِ مرّةً واحدةً لا أكثرَ", () => {
    const schema = tablesInSchema(realMigrations());
    const classified = WASLA_BOUNDARY_INVENTORY.map((e) => e.table);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...schema].sort()).toEqual([...classified].sort());
  });

  test("كلُّ وجهةٍ في السجلِّ من القائمةِ المُغلَقةِ", () => {
    for (const entry of WASLA_BOUNDARY_INVENTORY) expect(DISPOSITIONS).toContain(entry.disposition);
    for (const concern of WASLA_COLUMN_CONCERNS)
      expect(DISPOSITIONS).toContain(concern.disposition);
  });
});

describe("جردُ حدودِ WASLA — يُسقِطُ عندَ الخللِ", () => {
  test("جدولٌ جديدٌ في هجرةٍ بلا تصنيفٍ يُسقِطُ الحاجزَ — وهذه هي الثغرةُ الأصلُ", () => {
    const files: MigrationFile[] = [
      ...realMigrations(),
      {
        file: "99999999999999_probe.sql",
        sql: "create table probe_unclassified (id uuid primary key, city_id uuid not null);",
      },
    ];
    const problems = auditProblems(files, realDoc());
    expect(problems.some((p) => p.where === "probe_unclassified")).toBe(true);
    expect(details(problems)).toContain("بلا تصنيفٍ في جردِ الحدودِ");
  });

  test("مُدخلٌ في السجلِّ بلا جدولٍ في المخطَّطِ يُسقِطُ الحاجزَ (مُدخلٌ ميّتٌ)", () => {
    const first = WASLA_BOUNDARY_INVENTORY[0];
    if (first === undefined) throw new Error("السجلُّ فارغٌ — وهذا وحدَه خللٌ");
    const files = realMigrations().map((f) => ({
      file: f.file,
      // إخفاءُ إنشاءِ الجدولِ الأوّلِ من نصِّ الهجراتِ يُحاكي حذفَه من المخطَّطِ.
      sql: f.sql.replaceAll(
        new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?${first.table}\\s*\\(`, "gi"),
        "create table probe_renamed_away (",
      ),
    }));
    const problems = auditProblems(files, realDoc());
    expect(problems.some((p) => p.where === first.table && p.detail.includes("مُدخلٌ ميّتٌ"))).toBe(
      true,
    );
  });

  test("عمودٌ مُصرَّحٌ في جردِ الأعمدةِ ولا وجودَ له في الهجراتِ يُسقِطُ الحاجزَ", () => {
    const concern = WASLA_COLUMN_CONCERNS[0];
    if (concern === undefined) throw new Error("جردُ الأعمدةِ فارغٌ");
    const files = realMigrations().map((f) => ({
      file: f.file,
      sql: f.sql.replaceAll(concern.column, "probe_column_gone"),
    }));
    const problems = auditProblems(files, realDoc());
    expect(
      problems.some(
        (p) => p.where === `${concern.table}.${concern.column}` && p.detail.includes("لا وجودَ له"),
      ),
    ).toBe(true);
  });

  test("وثيقةٌ حُرِّرَت بيدٍ فافترقَت عن السجلِّ تُسقِطُ الحاجزَ", () => {
    const tampered = withGeneratedBlock(
      realDoc(),
      `${renderInventoryTable()}\n| 99 | \`probe_hand_written\` | يدويٌّ | MOVE | \`KEEP\` | أُضيفَ بيدٍ |`,
    );
    const problems = auditProblems(realMigrations(), tampered);
    expect(problems.some((p) => p.where === AUDIT_DOC)).toBe(true);
    expect(details(problems)).toContain("لا يطابقُ السجلَّ");
  });

  test("وثيقةٌ بلا علامتَي التوليدِ تُسقِطُ الحاجزَ ولا تُقرأُ فارغةً فتَمُرَّ", () => {
    const problems = auditProblems(realMigrations(), "# وثيقةٌ بلا علاماتٍ\n");
    expect(problems.some((p) => p.where === AUDIT_DOC)).toBe(true);
    expect(details(problems)).toContain("بلا علامتَي التوليدِ");
  });

  test("علامتا التوليدِ منقلبتا الترتيبِ لا تُقرأانِ كتلةً صحيحةً", () => {
    const doc = `<!-- END GENERATED: boundary-inventory -->\nx\n<!-- BEGIN GENERATED: boundary-inventory -->`;
    expect(generatedSlice(doc)).toBeNull();
    expect(auditProblems(realMigrations(), doc).some((p) => p.where === AUDIT_DOC)).toBe(true);
  });

  test("تجاهُلُ الوثيقةِ (docText=null) لا يُخفي مخالفةَ الشمولِ", () => {
    const files: MigrationFile[] = [
      ...realMigrations(),
      { file: "99999999999999_probe.sql", sql: "create table probe_two (id uuid primary key);" },
    ];
    expect(auditProblems(files, null).some((p) => p.where === "probe_two")).toBe(true);
    expect(auditProblems(realMigrations(), null)).toEqual([]);
  });
});
