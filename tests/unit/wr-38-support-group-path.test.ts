/**
 * الغرض: `WR-38` — حارسُ انحدارٍ على مستوى المصدرِ: بطاقةُ الدعمِ تُوجَّهُ حصراً إلى
 *   قروبِ الدعمِ (`cities.telegram_support_group_id`) لا إلى قروبِ التصعيدِ ولا قروبِ
 *   غيرِ المشتركينَ. يقرأُ آخرَ تعريفٍ للدالتينِ في ملفاتِ الهجراتِ (الأحدثُ حاكمٌ)،
 *   ويتحقّقُ من وجودِ قيدَيِ العزلِ في القاعدةِ، ومن أنَّ طبقةَ التطبيقِ تنشرُ البطاقةَ
 *   على قروبِ السياقِ وحده (لا مصدرَ آخرَ للمجموعةِ في الكودِ).
 * الحالة: اختبار فعلي — قراءةُ مصدرٍ، بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسّ قروباتِ المدنِ أو مسارَ الدعمِ.
 * ملاحظات مستقبلية: عضويةُ القروباتِ الفعليةِ في تيليجرامَ خارجَ الكودِ — قرارُ مالكٍ.
 */
import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "supabase", "migrations");

async function migrationFiles(): Promise<string[]> {
  const names = await readdir(MIGRATIONS_DIR);
  return names.filter((n) => n.endsWith(".sql")).sort();
}

/** آخرُ ملفٍّ يعرّفُ الدالةَ — التعريفُ الأحدثُ حاكمٌ وقتَ التشغيلِ. */
async function latestFunctionDefinition(fn: string): Promise<string> {
  const files = await migrationFiles();
  let latest = "";
  for (const name of files) {
    const content = await readFile(join(MIGRATIONS_DIR, name), "utf-8");
    if (
      content.includes(`create or replace function ${fn}(`) ||
      content.includes(`create or replace function public.${fn}(`)
    ) {
      latest = content;
    }
  }
  expect(latest, `لا تعريفَ للدالةِ ${fn} في الهجراتِ`).not.toBe("");
  return latest;
}

describe("WR-38 — بطاقةُ الدعمِ تُوجَّهُ إلى قروبِ الدعمِ حصراً", () => {
  it("آخرُ تعريفٍ لـ `open_support_ticket` يقرأُ قروبَ الدعمِ من `cities.telegram_support_group_id` فقط", async () => {
    const sql = await latestFunctionDefinition("open_support_ticket");
    expect(sql).toContain("select telegram_support_group_id into v_group from cities");
    expect(sql).not.toContain("v_group := telegram_escalation_group_id");
    expect(sql).not.toContain("v_group := telegram_unsubscribed_drivers_group_id");
  });

  it("آخرُ تعريفٍ لـ `get_support_ticket_context` يعرضُ قروبَ الدعمِ (`group_id` من `telegram_support_group_id`) فقط", async () => {
    const sql = await latestFunctionDefinition("get_support_ticket_context");
    expect(sql).toMatch(/'group_id',\s*v_city\.telegram_support_group_id/);
    expect(sql).not.toContain("'group_id', v_city.telegram_escalation_group_id");
    expect(sql).not.toContain("'group_id', v_city.telegram_unsubscribed_drivers_group_id");
  });

  it("قيدا العزلِ موجودانِ في الهجراتِ: تطابقُ القروباتِ مرفوضٌ على مستوى القاعدةِ", async () => {
    const files = await migrationFiles();
    const all = await Promise.all(
      files.map((name) => readFile(join(MIGRATIONS_DIR, name), "utf-8")),
    );
    const merged = all.join("\n");
    expect(merged).toContain("cities_group_ids_distinct");
    expect(merged).toContain("cities_group_ids_distinct_unsubscribed_support");
    // القيدُ يفرضُ الاستقلالَ بينَ الثلاثةِ (دعم/تصعيد/غيرُ المشتركينَ)
    expect(merged).toContain("telegram_support_group_id <> telegram_escalation_group_id");
    expect(merged).toContain("telegram_support_group_id <> telegram_unsubscribed_drivers_group_id");
  });

  it("طبقةُ التطبيقِ تنشرُ بطاقةَ النزاعِ على قروبِ السياقِ وحده — لا مصدرَ آخرَ للمجموعةِ", async () => {
    const source = await Bun.file(
      join(
        import.meta.dir,
        "..",
        "..",
        "packages",
        "application",
        "dispute",
        "post-dispute-card.ts",
      ),
    ).text();
    expect(source).toContain("groupId === null");
    expect(source).toMatch(/publish\(\{[^}]*groupId/);
    expect(source).not.toContain("escalation");
    expect(source).not.toContain("unsubscribed");
  });
});
