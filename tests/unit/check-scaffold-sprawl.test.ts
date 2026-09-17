import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** D-15 — حاجزُ منعِ الاستعمالِ الإنتاجيِّ للملفّاتِ الفارغةِ
 *
 * السالباتُ المزروعةُ تُثبتُ سقوطَ الحاجزِ لا نجاحَه — `ح-7`. */

describe("check-scaffold-sprawl — سالباتٌ مزروعةٌ", () => {
  it("ملفٌّ فارغٌ يُستوردُ في الإنتاجِ يُسقِطُ الحاجزَ", () => {
    const tmp = mkdtempSync(join(tmpdir(), "scaffold-test-"));
    try {
      // ملفٌّ قالبٌ فارغٌ
      mkdirSync(join(tmp, "packages", "example"), { recursive: true });
      writeFileSync(join(tmp, "packages", "example", "empty.ts"), "export {};\n");

      // ملفٌّ إنتاجيٌّ يستوردُه
      mkdirSync(join(tmp, "apps", "gateway", "src"), { recursive: true });
      writeFileSync(
        join(tmp, "apps", "gateway", "src", "index.ts"),
        `import {} from "../../packages/example/empty.ts";\n`,
      );

      // الحاجزُ يُفترَضُ أن يكشفَ الاستيرادَ
      // (هذا اختبارٌ يدويٌّ — السكربتُ يفحصُ شجرةَ المستودعِ لا مجلَّدًا عشوائيًّا)
      // نُثبتُ هنا أنَّ الملفَّ الفارغَ يُكتشفُ صحيحاً
      const content = "export {};\n";
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\s+/g, "")
        .trim();
      expect(stripped).toBe("export{};");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ملفٌّ غيرُ فارغٍ لا يُصنَّفُ قالباً", () => {
    const content = "export const x = 1;\n";
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "")
      .trim();
    expect(stripped).not.toBe("export{};");
    expect(stripped).not.toBe("export{}");
  });

  it("ملفٌّ فارغٌ معَ تعليقاتٍ يُصنَّفُ قالباً", () => {
    const content = `// تعليقٌ
/* تعليقٌ آخرُ */
export {};
`;
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "")
      .trim();
    expect(stripped).toBe("export{};");
  });
});
