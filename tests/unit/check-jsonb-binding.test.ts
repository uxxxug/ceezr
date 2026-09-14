/**
 * الغرض: قياسُ حاجزِ `jsonb` **بنصوصٍ مزروعةٍ** — لكلِّ حكمٍ سالبةٌ تُسقِطُه
 *   وموجبةٌ يمرُّ بها. وأهمُّ حالةٍ ههنا هيَ **السطرُ الذي أسقطَ CI بالفعلِ**:
 *   لو مرَّ لَما كانَ الحاجزُ حاجزاً.
 * الحالة: منفّذ فعلياً — يعملُ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun run ci` و .github/workflows/ci.yml
 * يُتوقع أن يستخدمه لاحقاً: أيُّ بديلٍ رابعٍ مشروعٍ يُضافُ إلى القاعدةِ.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ مسحُ القرصِ**: مَسحُ `scripts/check-jsonb-binding.ts` غلافٌ،
 *    والحكمُ في المكتبةِ الخالصةِ.
 * ــ **لا يُقاسُ سلوكُ السائقِ نفسِه**: ترميزُ `postgres.js` مرّتَينِ سلوكٌ خارجيٌّ
 *    مُوثَّقٌ، وقياسُه يحتاجُ قاعدةً — ودليلُه في `docs/evidence`.
 */
import { describe, expect, it } from "bun:test";
import {
  describeJsonbViolation,
  jsonbViolationsIn,
  PLANTED_NEGATIVE_FILES,
} from "../../scripts/lib/jsonb-binding.ts";

describe("حاجزُ `jsonb`: مُعامِلٌ لا يُربَطُ بـ`::jsonb` مباشرةً", () => {
  it("السالبةُ التي أسقطَت CI فعلاً: إعادةُ إعدادٍ بـ`${value_text}::jsonb`", () => {
    const planted = [
      "await sql`",
      "  update platform_settings set value = ${before.value_text}::jsonb",
      "   where city_id = ${cityId} and key = 'driver_position_max_age_seconds'",
      "`;",
    ].join("\n");
    const found = jsonbViolationsIn("tests/integration/planted.test.ts", planted);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
    expect(found[0]?.expression).toBe("${before.value_text}::jsonb");
  });

  it("السالبةُ الثانيةُ: `${JSON.stringify(x)}::jsonb` — العطبُ الأصليُّ في المستودَعِ", () => {
    const planted = "const q = sql`select f(${JSON.stringify(filters)}::jsonb)`;";
    expect(jsonbViolationsIn("packages/x.ts", planted)).toHaveLength(1);
  });

  it("الموجبةُ الأولى: `sql.json(x)::jsonb` يمرُّ — السائقُ يُرمِّزُ مرّةً واحدةً", () => {
    const clean = "const q = sql`select ingest(${sql.json(envelope as never)}::jsonb)`;";
    expect(jsonbViolationsIn("packages/x.ts", clean)).toHaveLength(0);
  });

  it("الموجبةُ الثانيةُ: `${x}::text::jsonb` يمرُّ — نوعُ المُعامِلِ مُثبَّتٌ نصّاً", () => {
    const clean = "const q = sql`update t set v = ${saved.value_text}::text::jsonb`;";
    expect(jsonbViolationsIn("packages/x.ts", clean)).toHaveLength(0);
  });

  it("الموجبةُ الثالثةُ: `to_jsonb(${x}::int)` يمرُّ — القاعدةُ تُرمِّزُ", () => {
    const clean = "const q = sql`update t set v = to_jsonb(${seconds}::int)`;";
    expect(jsonbViolationsIn("packages/x.ts", clean)).toHaveLength(0);
  });

  it("الفراغُ بينَ المُعامِلِ والتحويلِ لا يُنجي: `${x} :: jsonb` خرقٌ", () => {
    expect(jsonbViolationsIn("packages/x.ts", "sql`set v = ${x} :: jsonb`")).toHaveLength(1);
  });

  it("التعليقُ الذي يُحذِّرُ من النمطِ **ليسَ خرقاً** — وإلّا حُذِفَ الدرسُ ليخضرَّ الحاجزُ", () => {
    const lesson = [
      "/**",
      " * تحذيرٌ: المرشّحات تُمرَّر بـ`sql.json(...)` لا بـ`${JSON.stringify(filters)}::jsonb`.",
      " */",
      "// ولا بـ`${value}::jsonb` كذلك.",
    ].join("\n");
    expect(jsonbViolationsIn("packages/x.ts", lesson)).toHaveLength(0);
  });

  it("خرقانِ في سطرَينِ يُعَدّانِ اثنَينِ — لا يُطوى أحدُهما", () => {
    const planted = ["sql`set a = ${a}::jsonb`;", "sql`set b = ${b}::jsonb`;"].join("\n");
    const found = jsonbViolationsIn("packages/x.ts", planted);
    expect(found).toHaveLength(2);
    expect(found.map((v) => v.line)).toEqual([1, 2]);
  });

  it("الرسالةُ تذكرُ الملفَّ والسطرَ والأبدالَ الثلاثةَ — رسالةٌ غامضةٌ تُهمَل", () => {
    const [violation] = jsonbViolationsIn("tests/x.test.ts", "sql`set v = ${x}::jsonb`");
    if (violation === undefined) throw new Error("لا خرقَ — والسالبةُ مزروعةٌ");
    const message = describeJsonbViolation(violation);
    expect(message).toContain("tests/x.test.ts:1");
    expect(message).toContain("sql.json(x)::jsonb");
    expect(message).toContain("to_jsonb(x::نوع)");
    expect(message).toContain("::text::jsonb");
  });

  it("الاستثناءُ موضِعٌ واحدٌ — ملفُّ السالباتِ وحدَه، ولا يتّسِعُ بلا قَودٍ", () => {
    expect([...PLANTED_NEGATIVE_FILES]).toEqual(["tests/unit/check-jsonb-binding.test.ts"]);
  });

  it("المستثنى يُستثنى بمسارِه هوَ لا بنصِّه: نفسُ النصِّ في ملفٍّ آخرَ خرقٌ", () => {
    const planted = "sql`set v = ${x}::jsonb`";
    expect(jsonbViolationsIn("tests/unit/check-jsonb-binding.test.ts", planted)).toHaveLength(0);
    expect(jsonbViolationsIn("tests/unit/other.test.ts", planted)).toHaveLength(1);
  });
});
