/**
 * الغرض: إثباتُ أنَّ الهيكلَ الساكنَ في `index.html` لا يحملُ `elementtiming` ولا
 *   نصًّا — فهو ليسَ نقطةَ قياسِ سطحِ الراكبِ ولا عنصرَ LCP (`DEC-19` · `F1-09` · `ح-7`).
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src (اختبارُ المستندِ الثابتِ)
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(import.meta.dirname, "..", "index.html"), "utf-8");

describe("الهيكلُ الساكنُ في index.html (DEC-19 / F1-09)", () => {
  it("يحوي هيكلًا ساكنًا داخل #root قبل تحميل الشيفرة", () => {
    expect(HTML).toContain("sk-preboot");
  });

  it("لا يحمل الهيكلُ `elementtiming` — ليس نقطةَ قياسٍ", () => {
    // الهيكلُ الساكنُ ليسَ سطحَ الراكبِ، فلا ينبغي أن يُقاسَ.
    const rootMatch = HTML.match(/<div id="root">([\s\S]*?)<\/div>/);
    expect(rootMatch).not.toBeNull();
    expect(rootMatch?.[1]).not.toContain("elementtiming");
  });

  it("يبدأُ التقديمَ الساكنَ بـ `__waslahPreboot`", () => {
    expect(HTML).toContain("__waslahPreboot");
  });

  it("يمنعُ طلبَ favicon.ico برابطٍ فارغٍ", () => {
    expect(HTML).toContain('rel="icon"');
  });
});
