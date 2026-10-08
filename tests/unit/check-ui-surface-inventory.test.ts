import { describe, expect, it } from "bun:test";
import {
  evaluateInventory,
  isTestFile,
  SURFACE_INVENTORY,
  type SurfaceGroup,
} from "../../scripts/lib/ui-surface-inventory";

const group: SurfaceGroup = {
  id: "g",
  root: "apps/x",
  ext: ".tsx",
  recursive: true,
  files: ["A.tsx", "b/B.tsx"],
};

describe("evaluateInventory", () => {
  it("مطابقٌ: أخضرُ ويعدُّ الأسطحَ", () => {
    const v = evaluateInventory([group], { g: ["A.tsx", "b/B.tsx"] });
    expect(v.ok).toBe(true);
    expect(v.total).toBe(2);
  });
  it("سالبةٌ: سطحٌ جديدٌ على القرصِ غيرُ مُدرَجٍ يُسقِطُ", () => {
    const v = evaluateInventory([group], { g: ["A.tsx", "b/B.tsx", "C.tsx"] });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("apps/x/C.tsx");
  });
  it("سالبةٌ: سطحٌ في السجلِّ محذوفٌ من القرصِ يُسقِطُ", () => {
    const v = evaluateInventory([group], { g: ["A.tsx"] });
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("غائبٌ عن القرصِ");
  });
  it("سالبةٌ: جذرٌ غيرُ مقروءٍ يُسقِطُ ولا يمرُّ", () => {
    const v = evaluateInventory([group], {});
    expect(v.ok).toBe(false);
  });
  it("سالبةٌ: مجموعةٌ أو ملفٌّ مكرَّرٌ يُسقِطُ", () => {
    const dup = { ...group, files: ["A.tsx", "A.tsx"] };
    expect(evaluateInventory([dup], { g: ["A.tsx"] }).ok).toBe(false);
    expect(evaluateInventory([group, group], { g: ["A.tsx", "b/B.tsx"] }).ok).toBe(false);
  });
  it("public-tracking: يُقاسُ وجودُ الملفِّ لا المجلّدُ كلُّه", () => {
    const pt: SurfaceGroup = { ...group, id: "public-tracking", files: ["public-tracking.ts"] };
    expect(
      evaluateInventory([pt], { "public-tracking": ["public-tracking.ts", "other.ts"] }).ok,
    ).toBe(true);
    expect(evaluateInventory([pt], { "public-tracking": ["other.ts"] }).ok).toBe(false);
  });
});

describe("السجلُّ الملتزَمُ", () => {
  it("الاختباراتُ ليست أسطحاً", () => {
    expect(isTestFile("x.test.tsx")).toBe(true);
    expect(isTestFile("x.tsx")).toBe(false);
  });
  it("لا ملفَّ اختبارٍ في السجلِّ", () => {
    const all = SURFACE_INVENTORY.flatMap((g) => g.files);
    expect(all.some(isTestFile)).toBe(false);
  });
});
