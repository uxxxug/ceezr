/**
 * الغرض: قياسُ حاجزِ «الاستعلامُ المُرجَأُ ليسَ وعداً» **بنصوصٍ مزروعةٍ** — لكلِّ
 *   حكمٍ سالبةٌ تُسقِطُه وموجبةٌ يمرُّ بها. وأهمُّ حالةٍ ههنا هيَ **الحالةُ التي
 *   علَّقَت وظيفةَ «تكامل على PostgreSQL حقيقي» بالفعلِ في `F3-07`**: لو مرَّت
 *   لَما كانَ الحاجزُ حاجزاً.
 * الحالة: منفّذ فعلياً — يعملُ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يقيسُ رفضَ دالّةِ قاعدةٍ.
 * الحاكم: docs/adr/0122-a-deferred-query-is-not-a-promise.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ مسحُ القرصِ**: `scripts/check-lazy-query-assertion.ts` غلافٌ،
 *    والحكمُ في المكتبةِ الخالصةِ.
 * ــ **لا يُقاسُ إرجاءُ `postgres.js` نفسُه**: أنَّ وسمَ `sql` لا يُرسِلُ حتّى
 *    يُنادى `then` سلوكٌ خارجيٌّ، ودليلُه تعليقُ الوظيفةِ ساعةً في CI ثمَّ زوالُه
 *    بتمريرِ وعدٍ منطلقٍ.
 * ــ **لا يُقاسُ أنَّ البديلَ يمرُّ في `bun:test`**: ذلكَ يقيسُه
 *    `tests/integration/driver-vehicle.test.ts` على قاعدةٍ حقيقيّةٍ.
 */
import { describe, expect, it } from "bun:test";
import {
  describeLazyQueryViolation,
  lazyQueryViolationsIn,
  PLANTED_NEGATIVE_FILES,
} from "../../scripts/lib/lazy-query-assertion.ts";

const PATH = "tests/integration/planted.test.ts";

describe("حاجزُ الاختبارِ: لا وسمَ قالبٍ مُرجَأً داخلَ `expect(…)`", () => {
  it("السالبةُ التي علَّقَت CI فعلاً: وسمُ `sql` خامّاً مع `rejects`", () => {
    const planted = [
      'it("update_driver_vehicle raises USER_NOT_FOUND", async () => {',
      "  await expect(",
      "    sql`select update_driver_vehicle(${ID}::bigint)`,",
      "  ).rejects.toThrow(/USER_NOT_FOUND/);",
      "});",
    ].join("\n");
    const found = lazyQueryViolationsIn(PATH, planted);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("sql");
    expect(found[0]?.line).toBe(3);
  });

  it("السالبةُ في سطرٍ واحدٍ، وأيُّ وسمٍ لا `sql` وحدَه", () => {
    const planted = "await expect(db.sql`select 1`).resolves.toBeDefined();";
    const found = lazyQueryViolationsIn(PATH, planted);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("db.sql");
    expect(found[0]?.line).toBe(1);
  });

  it("سالبتانِ في ملفٍّ واحدٍ تُحصَيانِ كلتاهما بسطرَيهما", () => {
    const planted = ["expect(sql`a`);", "const x = 1;", "expect(other`b`);"].join("\n");
    const found = lazyQueryViolationsIn(PATH, planted);
    expect(found.map((violation) => violation.line)).toEqual([1, 3]);
  });

  it("الموجبةُ: وعدٌ منطلقٌ من دالّةٍ غيرِ متزامنةٍ يمرُّ", () => {
    const passing = [
      "await expect(updateVehicle(STRANGER, 'sedan', 'T', 2020)).rejects.toThrow(/USER_NOT_FOUND/);",
      "await expect(updateAssets(STRANGER, 'l.png', 'b.png')).rejects.toThrow(/USER_NOT_FOUND/);",
    ].join("\n");
    expect(lazyQueryViolationsIn(PATH, passing)).toEqual([]);
  });

  it("الموجبةُ: `await sql`…`` داخلَ `expect` قد أُرسِلَ فلا يُمنَعُ", () => {
    const passing = "expect(await sql`select 1`).toHaveLength(1);";
    expect(lazyQueryViolationsIn(PATH, passing)).toEqual([]);
  });

  it("الموجبةُ: `await sql`…`` في جسمِ الاختبارِ بلا `expect` لا يُمنَعُ", () => {
    const passing = ["const rows = await sql`select 1`;", "expect(rows).toHaveLength(1);"].join(
      "\n",
    );
    expect(lazyQueryViolationsIn(PATH, passing)).toEqual([]);
  });

  it("الموجبةُ: نداءُ دالّةٍ لا وسمَ قالبٍ لا يُمنَعُ", () => {
    const passing = "await expect(readVehicle(ID)).resolves.toBeNull();";
    expect(lazyQueryViolationsIn(PATH, passing)).toEqual([]);
  });

  it("التعليقُ لا يُحاسَبُ: النمطُ الممنوعُ في تعليقٍ يمرُّ", () => {
    const commented = [
      "// await expect(sql`select 1`).rejects.toThrow();",
      "/* expect(sql`select 2`) */",
      "await expect(updateVehicle(ID)).rejects.toThrow();",
    ].join("\n");
    expect(lazyQueryViolationsIn(PATH, commented)).toEqual([]);
  });

  it("ملفُّ السالباتِ المزروعةِ مُستثنىً بالاسمِ وإلّا أسقطَ نفسَه", () => {
    expect(PLANTED_NEGATIVE_FILES.has("tests/unit/check-lazy-query-assertion.test.ts")).toBe(true);
    for (const file of PLANTED_NEGATIVE_FILES) {
      expect(lazyQueryViolationsIn(file, "expect(sql`select 1`).rejects.toThrow();")).toEqual([]);
    }
  });

  it("الرسالةُ تقولُ الموضعَ والوسمَ والبديلَ لا العيبَ وحدَه", () => {
    const message = describeLazyQueryViolation({ file: PATH, line: 7, tag: "sql" });
    expect(message).toContain(`${PATH}:7`);
    expect(message).toContain("expect(sql`…`)");
    expect(message).toContain("لا يُحسَمُ");
    expect(message).toContain("ADR 0122");
  });
});
