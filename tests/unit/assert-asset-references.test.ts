/**
 * الغرض: إثباتُ أنَّ حاجزَ مراجعِ الأصولِ (`F1-09` · `D-30`) يرفضُ مرجعاً إلى ملفٍّ محذوفٍ من المُخرَجِ (كالأنماطِ
 *   المُدمَجةِ في المستندِ) ويقبلُ المراجعَ الموجودةَ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { missingAssetReferences } from "../../apps/miniapp/vite/assert-asset-references.ts";

const DEPS = 'const d=["assets/rider-ride-A1.js","assets/shell-B2.js","assets/shell-C3.css"];';

describe("missingAssetReferences (F1-09 · D-30)", () => {
  it("يرفضُ تبعيّةَ أنماطٍ حُذِفَت بعدَ دمجِها في المستندِ", () => {
    const files = new Map<string, string | null>([
      ["assets/rider-home-X.js", DEPS],
      ["assets/rider-ride-A1.js", ""],
      ["assets/shell-B2.js", ""],
    ]);
    expect(missingAssetReferences(files)).toEqual(["assets/rider-home-X.js → assets/shell-C3.css"]);
  });

  it("يقبلُ مراجعَ موجودةً كلَّها، ولا يقرأُ الأصولَ غيرَ البرمجيّةِ", () => {
    const files = new Map<string, string | null>([
      ["assets/rider-home-X.js", DEPS],
      ["assets/rider-ride-A1.js", ""],
      ["assets/shell-B2.js", ""],
      ["assets/shell-C3.css", null],
    ]);
    expect(missingAssetReferences(files)).toEqual([]);
  });
});
