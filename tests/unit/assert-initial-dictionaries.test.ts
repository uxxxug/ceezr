/**
 * الغرض: إثباتُ أنَّ حاجزَ الحِملِ الأوّلِ (`F1-09` · `D-29` · `ADR 0186`) يتتبّعُ الاستيرادَ الثابتَ
 *   بالتعدّي من المدخلِ، فيرفضُ قاموساً غيرَ افتراضيٍّ في أيِّ حزمةٍ منه ويقبلُه في حزمةٍ مؤجَّلةٍ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type ChunkGraphNode,
  initialDictionaryViolations,
} from "../../apps/miniapp/vite/assert-initial-dictionaries.ts";

const ROOT = "/repo/packages/shared/i18n/miniapp";

function graph(shellModules: string[]): ChunkGraphNode[] {
  return [
    {
      fileName: "index.js",
      isEntry: true,
      imports: ["shell.js"],
      moduleIds: ["/repo/src/main.tsx"],
    },
    { fileName: "shell.js", isEntry: false, imports: ["react.js"], moduleIds: shellModules },
    {
      fileName: "react.js",
      isEntry: false,
      imports: [],
      moduleIds: ["/repo/node_modules/react/index.js"],
    },
    { fileName: "en.js", isEntry: false, imports: [], moduleIds: [`${ROOT}/en.json`] },
    { fileName: "ur.js", isEntry: false, imports: [], moduleIds: [`${ROOT}/ur.json`] },
  ];
}

describe("initialDictionaryViolations (F1-09 · D-29)", () => {
  it("يقبلُ القاموسَ الافتراضيَّ في الحِملِ الأوّلِ والبقيّةَ مؤجَّلةً", () => {
    expect(initialDictionaryViolations(graph([`${ROOT}/core.ts`, `${ROOT}/ar.json`]))).toEqual([]);
  });

  it("يرفضُ قاموساً غيرَ افتراضيٍّ في حزمةٍ مستورَدةٍ بالتعدّي", () => {
    const violations = initialDictionaryViolations(graph([`${ROOT}/core.ts`, `${ROOT}/en.json`]));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("en.json");
  });

  it("يرفضُ المدخلَ المتزامنَ `index.ts` لأنَّه يستوردُ القاموسَينِ ثابتاً", () => {
    expect(initialDictionaryViolations(graph([`${ROOT}/index.ts`]))).toHaveLength(1);
  });

  it("لا يعدُّ الحزمةَ المؤجَّلةَ من الحِملِ الأوّلِ", () => {
    const chunks = graph([`${ROOT}/core.ts`]);
    expect(initialDictionaryViolations(chunks)).toEqual([]);
  });
});
