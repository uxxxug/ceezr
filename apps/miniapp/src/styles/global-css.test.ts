/**
 * الغرض: `UI-CSS-01` — حارسُ بنيةِ `global.css`. دمجٌ متعارضٌ (DEC-36 × DEC-37) ترك ثمانيَ
 *   كتلٍ مفتوحةً، فصارت كلُّ قاعدةٍ بعدَها «متداخلةً» (CSS Nesting) تحتَ `.sup__faq .rf …`
 *   ولم تُطابِق شيئاً: نصفُ الأنماطِ (التسجيلُ، الطلبُ، السائقُ…) لم يُطبَّق وظهرَ التطبيقُ بلا تصميمٍ.
 *   البناءُ لم يُخفِق لأنَّ التداخلَ صالحٌ نحوياً — فالحارسُ هنا.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/styles
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: إن اعتُمِدَ التداخلُ عمداً يوماً فليُستثنَ صراحةً هنا لا أن يُحذَفَ الحارسُ.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "global.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("global.css", () => {
  it("الأقواسُ متوازنةٌ", () => {
    let depth = 0;
    for (const ch of css) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("لا قاعدةَ متداخلةً داخلَ قاعدةٍ عاديّةٍ (التداخلُ مسموحٌ داخلَ @ فقط)", () => {
    const stack: string[] = [];
    let buffer = "";
    const nested: string[] = [];
    for (const ch of css) {
      if (ch === "{") {
        const prelude = buffer.trim();
        const parent = stack[stack.length - 1];
        if (parent !== undefined && !parent.startsWith("@") && !prelude.startsWith("@")) {
          nested.push(`${parent} → ${prelude}`.slice(0, 120));
        }
        stack.push(prelude.split(/[;}]/).pop()?.trim() ?? prelude);
        buffer = "";
      } else if (ch === "}") {
        stack.pop();
        buffer = "";
      } else if (ch === ";") {
        buffer = "";
      } else {
        buffer += ch;
      }
    }
    expect(nested).toEqual([]);
  });
});
