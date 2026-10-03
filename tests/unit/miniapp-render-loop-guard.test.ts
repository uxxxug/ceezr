/**
 * الغرض: حاجزُ `UI-LOOP-02` — لا قيمةَ افتراضيّةً تُولَدُ في كلِّ رسمٍ (دالّةٌ سهميّةٌ
 *   أو كائنٌ أو مصفوفةٌ حرفيّةٌ) في معاملاتِ مكوِّنٍ ثمَّ تدخلُ تبعيّاتِ خطّافٍ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * لِمَ: شاشةُ «عروضي» عندَ السائقِ كانَت تومضُ بينَ «يقرأ لوح عروضك» و«تعذّر قراءة
 * لوح العروض» بلا توقّفٍ (فيديو المالكِ 2026-10-03). السببُ `now = () => Date.now()`
 * في تبعيّاتِ `load` المُنادى من `useEffect` — هويّةٌ جديدةٌ في كلِّ رسمٍ فحلقةٌ.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../apps/miniapp/src");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

const UNSTABLE_DEFAULT = /^\s+(\w+)\s*=\s*(?:\([^)]*\)\s*=>|\{\}|\[\]|new \w+\()/gm;

export function unstableDefaultsInDeps(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(UNSTABLE_DEFAULT)) {
    const name = match[1] ?? "";
    const inDeps = new RegExp(`[}\\]]\\s*,\\s*\\[[^\\]]*\\b${name}\\b[^\\]]*\\]\\s*\\)`);
    if (inDeps.test(source)) found.push(name);
  }
  return found;
}

describe("UI-LOOP-02 — لا هويّةَ تُولَدُ في كلِّ رسمٍ داخلَ تبعيّاتِ خطّافٍ", () => {
  test("الحاجزُ يُسقِطُ النمطَ الذي أومضَ الشاشةَ", () => {
    const bad = `export function S({\n  now = () => Date.now(),\n}) {\n  const load = useCallback(async () => {}, [now]);\n}`;
    expect(unstableDefaultsInDeps(bad)).toEqual(["now"]);
  });

  test("لا مخالفةَ في شاشاتِ التطبيقِ المصغَّرِ", () => {
    const violations = tsxFiles(ROOT).flatMap((file) =>
      unstableDefaultsInDeps(readFileSync(file, "utf8")).map(
        (name) => `${file.slice(ROOT.length + 1)}: ${name}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
