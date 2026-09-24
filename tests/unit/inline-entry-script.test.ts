/**
 * `D-25` — المدخلُ المُدمَجُ في المستندِ يُحَلُّ نسبةً إلى `/` لا إلى `/assets/`، فكلُّ
 * مُعيِّنٍ نسبيٍّ فيهِ **شاشةٌ بيضاءُ**. هذهِ الحالاتُ تزرعُ الافتراقَ وتطلبُ الإخفاقَ (`ح-7`).
 */

import { describe, expect, test } from "bun:test";
import {
  absolutizeEntrySpecifiers,
  InlineEntrySpecifierError,
} from "../../apps/miniapp/vite/inline-entry-script.ts";

const ENTRY = "assets/index-abc.js";
const IMPORTS = ["assets/shell-1.js", "assets/vendor-react-2.js", "assets/identity-3.js"];

describe("absolutizeEntrySpecifiers", () => {
  test("المُعيِّناتُ الثابتةُ تصيرُ مطلقةً تحتَ `/assets/`", () => {
    const code =
      'import{a}from"./shell-1.js";import{b}from"./vendor-react-2.js";import"./identity-3.js";';
    const out = absolutizeEntrySpecifiers(code, ENTRY, IMPORTS, "/");
    expect(out).toBe(
      'import{a}from"/assets/shell-1.js";import{b}from"/assets/vendor-react-2.js";import"/assets/identity-3.js";',
    );
  });

  test("الاستيرادُ الديناميكيُّ بأيِّ علامةِ اقتباسٍ يُطلَقُ كذلكَ", () => {
    const code = "import(`./shell-1.js`);import('./identity-3.js');";
    const out = absolutizeEntrySpecifiers(code, ENTRY, IMPORTS, "/");
    expect(out).toBe("import(`/assets/shell-1.js`);import('/assets/identity-3.js');");
  });

  test("`base` غيرُ الجذرِ يُحترَمُ ولا يُكتَبُ ثابتاً", () => {
    const out = absolutizeEntrySpecifiers('from"./shell-1.js"', ENTRY, IMPORTS, "/app");
    expect(out).toBe('from"/app/assets/shell-1.js"');
  });

  test("تعليقُ خريطةِ المصدرِ يُحذَفُ — يُحَلُّ نسبةً إلى المستندِ فيُضلِّلُ", () => {
    const code = 'import"./shell-1.js";\n//# sourceMappingURL=index-abc.js.map';
    expect(absolutizeEntrySpecifiers(code, ENTRY, IMPORTS, "/")).toBe(
      'import"/assets/shell-1.js";',
    );
  });

  test("مُعيِّنٌ نسبيٌّ لا تعرفُه بياناتُ الحزمةِ ⇒ يُسقِطُ البناءَ لا يمرُّ", () => {
    const code = 'import{a}from"./shell-1.js";import{x}from"./ghost-9.js";';
    expect(() => absolutizeEntrySpecifiers(code, ENTRY, IMPORTS, "/")).toThrow(
      InlineEntrySpecifierError,
    );
  });

  test("مُعيِّنٌ صاعدٌ (`../`) ⇒ يُسقِطُ البناءَ", () => {
    expect(() => absolutizeEntrySpecifiers('import"../x.js"', ENTRY, IMPORTS, "/")).toThrow(
      InlineEntrySpecifierError,
    );
  });

  test("الخطأُ يُسمّي المُعيِّنَ الباقيَ", () => {
    try {
      absolutizeEntrySpecifiers('import"./ghost-9.js"', ENTRY, IMPORTS, "/");
      throw new Error("لم يُرمَ");
    } catch (error) {
      expect(error).toBeInstanceOf(InlineEntrySpecifierError);
      expect((error as InlineEntrySpecifierError).specifiers).toEqual(["./ghost-9.js"]);
    }
  });

  test("شيفرةٌ بلا مُعيِّناتٍ نسبيّةٍ تبقى كما هيَ", () => {
    const code = 'const x = "a/b.js"; fetch("/assets/y.js");';
    expect(absolutizeEntrySpecifiers(code, ENTRY, IMPORTS, "/")).toBe(code);
  });
});
