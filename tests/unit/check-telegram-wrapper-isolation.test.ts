/**
 * الغرض: اختبارُ حاجزِ عزلِ طبقةِ تيليجرام (F1-02 · ADR 0031):
 *    يُثبِتُ أنَّ الحارسَ يُخفِقُ عندَ كلِّ صورةِ خرقٍ، وأنَّ قناةَ test-only
 *    المعلنةَ لـ`tg/measure-host.ts` (F1-09 الصفُّ ٥ · D-26 · ADR 0184) تُقبَلُ.
 * الحالة: منفّذ فعلياً — 2026-09-24 · البند `F1-02` · `ح-7`.
 * ينتمي إلى: tests/unit
 *
 * **أنماطٌ محوّلةٌ**: هذا الملفُّ يذكرُ الأنماطَ المحظورةَ في نصوصٍ مزروعةٍ
 * للاختبارِ. فلا يُكتبُ الحرفُ المحظورُ مباشرةً — بل يُبنى من قطعٍ في زمنِ
 * التشغيلِ، لئلّا يَمسّه الحارسُ على هذا الملفِّ نفسِه.
 */

import { describe, expect, test } from "bun:test";
import {
  findWrapperViolations,
  type Violation,
} from "../../scripts/check-telegram-wrapper-isolation.ts";

const TG_DIR = "apps/miniapp/src/tg/";
const SCRIPTS_DIR = "scripts/";

// أنماطٌ محوّلةٌ لتفادي الحارسِ على هذا الملفِّ نفسِه.
const w = "window";
const tg = "Tele" + "gram";
const ua = "initData" + "Unsafe";
const wa = "Web" + "App";
const host = "host";
const dot = ".";

describe("عزلُ طبقةِ تيليجرام — خرقٌ مزروعٌ", () => {
  test(`المضيفُ خارجَ tg/ يُكشَفُ`, () => {
    const code = `const x = ${w}${dot}${tg};\n`;
    const files = new Map([[`${SCRIPTS_DIR}evil.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x: Violation) => x.file.includes("evil.ts"))).toBe(true);
  });

  test(`الحقلُ غيرُ الموقَّعِ خارجَ tg/ يُكشَفُ`, () => {
    const code = `const u = ${w}${dot}${tg}${dot}${wa}${dot}${ua}.user;\n`;
    const files = new Map([[`${SCRIPTS_DIR}evil.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v.length).toBeGreaterThan(0);
  });

  test(`استيرادٌ مباشرٌ من غيرِ بابِ الطبقةِ يُرفَضُ`, () => {
    const path = `../apps/miniapp/src/tg/test-${host}.ts`;
    const code = `import { installFakeHost } from "${path}";\n`;
    const files = new Map([[`${SCRIPTS_DIR}evil.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x: Violation) => x.why.includes("طبقة"))).toBe(true);
  });

  test(`الاستيرادُ من البابِ الواحدِ مسموحٌ`, () => {
    const code = `import { isInsideTelegram } from "../apps/miniapp/src/tg/index.ts";\n`;
    const files = new Map([[`${SCRIPTS_DIR}good.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v).toEqual([]);
  });

  test(`المضيفُ داخلَ tg/ مسموحٌ`, () => {
    const code = `const host = ${w}${dot}${tg}?.${wa};\n`;
    const files = new Map([[`${TG_DIR}webapp.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v).toEqual([]);
  });

  test(`الحقلُ غيرُ الموقَّعِ داخلَ tg/ مسموحٌ`, () => {
    const code = `const unsafe = webApp.${ua};\n`;
    const files = new Map([[`${TG_DIR}test-${host}.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v).toEqual([]);
  });

  test(`بناءُ وهمٍ داخلَ tg/ مسموحٌ`, () => {
    const code = `return \`${w}${dot}${tg} = { ${wa}: { initData: "x", ${ua}: {} } };\`;\n`;
    const files = new Map([[`${TG_DIR}measure-${host}.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v).toEqual([]);
  });

  test(`قناةُ test-only المعلنةُ مسموحةٌ`, () => {
    const importPath = `../apps/miniapp/src/tg/measure-${host}.ts`;
    const code = `import { buildBrowserHostScript } from "${importPath}";\n`;
    const files = new Map([[`${SCRIPTS_DIR}measure-tti.ts`, code]]);
    const v = findWrapperViolations(files);
    expect(v).toEqual([]);
  });
});
