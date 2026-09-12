/**
 * الغرض: قياسُ حارسِ سجلِّ الحواجزِ (`W-8` زيادةٌ ثانيةٌ / ADR 0087). **وكلُّ
 *   حالةٍ ههنا تزرعُ العطبَ وتقيسُ الإخفاقَ**: حارسٌ لا يُقاسُ مسارُه الأحمرُ
 *   يُقرأُ أخضرَ لأنَّه لا يعملُ، لا لأنَّ الحالَ سليمٌ.
 * الحالة: منفّذ فعلياً — `W-8`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على جداولِ الحواجزِ أو على مُصدِرِ
 *   الإشهادِ.
 * ملاحظات مستقبلية: لا شيءَ ههنا يُثبِّتُ عدداً من الحواجزِ، كي لا يُخفِقَ
 *   الاختبارُ عندَ إغلاقِ حاجزٍ إغلاقاً مشروعاً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type BlockerInputs,
  blockerProblems,
  defaultInputs,
  ROADMAP_ID_EXEMPTIONS,
  renderDoc,
  SYNTHETIC_ID_EXEMPTIONS,
  typescriptFiles,
} from "../../scripts/check-blocker-registry.ts";
import { parseBlockers } from "../../scripts/lib/wasla-blockers.ts";

const LIB_PATH = "scripts/lib/wasla-migration-dry-run.ts";
const SELF_FILE = "scripts/check-blocker-registry.ts";
const REAL_ROADMAP = readFileSync("ROADMAP.md", "utf8");
const REAL_LIB = readFileSync(LIB_PATH, "utf8");
const REAL_SELF = readFileSync(SELF_FILE, "utf8");

/** مُدخلٌ سليمٌ مصغَّرٌ: خارطةٌ حقيقيّةٌ، ووثيقةٌ مُشتَقّةٌ، وملفّانِ يُمسَحانِ. */
function healthyInputs(): BlockerInputs {
  return {
    roadmapText: REAL_ROADMAP,
    docText: renderDoc(parseBlockers(REAL_ROADMAP)),
    libSource: REAL_LIB,
    sources: [
      { file: LIB_PATH, text: REAL_LIB },
      { file: SELF_FILE, text: REAL_SELF },
      { file: "tests/unit/wasla-blockers.test.ts", text: "isIssuedAttestation as unknown as" },
    ],
    syntheticExemptions: [],
    roadmapExemptions: ROADMAP_ID_EXEMPTIONS,
  };
}

describe("الحارسُ أخضرُ على المستودعِ كما هوَ", () => {
  it("لا مشكلةَ في المُدخلِ الحقيقيِّ الكاملِ", () => {
    expect(blockerProblems(defaultInputs())).toEqual([]);
  });

  it("ويمسحُ ملفّاتِ TypeScript فعلاً — لا قائمةً مكتوبةً", () => {
    const files = typescriptFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(LIB_PATH);
    expect(files.every((file) => file.endsWith(".ts") || file.endsWith(".tsx"))).toBe(true);
  });
});

describe("معرّفٌ في الشيفرةِ بلا صفٍّ في الخارطةِ يُخفِقُ", () => {
  it("ملفٌّ يذكرُ معرّفاً مُختلَقاً بلا إعفاءٍ ⇒ إخفاقٌ", () => {
    const inputs: BlockerInputs = {
      ...healthyInputs(),
      sources: [
        ...healthyInputs().sources,
        { file: "packages/x/y.ts", text: "// محجوبٌ بـDEP-CORE-998" },
      ],
    };
    const problems = blockerProblems(inputs);
    expect(problems.some((problem) => problem.detail.includes("DEP-CORE-998"))).toBe(true);
  });

  it("والإعفاءُ الاصطناعيُّ يُمرِّرُ الملفَّ المُعلَنَ وحدَه لا كلَّ ملفٍّ", () => {
    const base = healthyInputs();
    const exemption = {
      id: "B-98",
      file: "packages/x/y.ts",
      reason: "معرّفٌ مُختلَقٌ يُزرَعُ ليقيسَ أنَّ حارساً آخرَ يرفضُه، وهذا سببٌ مكتوبٌ للمراجعةِ.",
    } as const;
    const seeded = { file: "packages/x/y.ts", text: "// B-98" };
    const other = { file: "packages/x/z.ts", text: "// B-98" };
    expect(
      blockerProblems({
        ...base,
        sources: [...base.sources, seeded],
        syntheticExemptions: [exemption],
      }),
    ).toEqual([]);
    expect(
      blockerProblems({
        ...base,
        sources: [...base.sources, seeded, other],
        syntheticExemptions: [exemption],
      }).some((problem) => problem.detail.includes("z.ts")),
    ).toBe(true);
  });

  it("وإعفاءٌ بسببٍ أقصرَ من أن يُراجَعَ يُخفِقُ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [...base.sources, { file: "packages/x/y.ts", text: "// B-98" }],
      syntheticExemptions: [{ id: "B-98", file: "packages/x/y.ts", reason: "لأنَّه كذا" }],
    });
    expect(problems.some((problem) => problem.check.includes("بلا سببٍ مقروءٍ"))).toBe(true);
  });

  it("وإعفاءٌ ميّتٌ (الملفُّ لم يعُدْ يذكرُ المعرّفَ) يُخفِقُ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [...base.sources, { file: "packages/x/y.ts", text: "// لا معرّفَ ههنا" }],
      syntheticExemptions: [
        {
          id: "B-98",
          file: "packages/x/y.ts",
          reason: "إعفاءٌ كانَ يقيسُ رفضَ معرّفٍ مُختلَقٍ، وسببُه مكتوبٌ بطولٍ يُراجَعُ.",
        },
      ],
    });
    expect(problems.some((problem) => problem.check.includes("ميّتٌ"))).toBe(true);
  });

  it("وإعفاءٌ لملفٍّ غيرِ موجودٍ في المسحِ يُخفِقُ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      syntheticExemptions: [
        {
          id: "B-98",
          file: "packages/gone/away.ts",
          reason: "ملفٌّ حُذِفَ، وإعفاؤُه يُعفي ما لا وجودَ لهُ — والسببُ مكتوبٌ بطولٍ يُراجَعُ.",
        },
      ],
    });
    expect(problems.some((problem) => problem.check.includes("غيرِ موجودٍ"))).toBe(true);
  });
});

describe("الطرفُ الثاني: معرّفٌ في الخارطةِ بلا صفٍّ يُفكَّكُ", () => {
  it("خارطةٌ تذكرُ معرّفاً في نصٍّ بلا جدولٍ ولا إعفاءٍ ⇒ إخفاقٌ", () => {
    const problems = blockerProblems({
      ...healthyInputs(),
      roadmapText: `${REAL_ROADMAP}\n\nنصٌّ يذكرُ B-98 بلا صفٍّ.\n`,
      docText: renderDoc(parseBlockers(REAL_ROADMAP)),
    });
    expect(problems.some((problem) => problem.detail.includes("B-98"))).toBe(true);
  });

  it("وإعفاءُ خارطةٍ ميّتٌ (المعرّفُ لم يعُدْ مذكوراً) يُخفِقُ", () => {
    const problems = blockerProblems({
      ...healthyInputs(),
      roadmapExemptions: [
        {
          id: "O-98",
          reason: "تعليمةٌ رُفِعَت من الخارطةِ، فإعفاؤُها يُخفي التغيُّرَ — والسببُ مكتوبٌ بطولٍ يُراجَعُ.",
        },
      ],
    });
    expect(problems.some((problem) => problem.check.includes("إعفاءُ خارطةٍ ميّتٌ"))).toBe(true);
  });
});

describe("الإغلاقُ بلا دليلٍ يُرفَضُ", () => {
  const closedWithout = [
    "## Cross-repository dependencies on CORE, recorded 2026-09-11",
    "",
    "| # | What is missing in CORE | What it blocks here |",
    "|---|---|---|",
    "| DEP-CORE-007 | ~~No shared CORE environment~~ — **CLOSED** | nothing |",
    "",
    "## Next",
  ].join("\n");

  it("«مُغلَقٌ» بلا التزامٍ ولا تاريخٍ ⇒ إخفاقٌ", () => {
    const problems = blockerProblems({
      ...healthyInputs(),
      roadmapText: closedWithout,
      docText: renderDoc(parseBlockers(closedWithout)),
    });
    expect(problems.some((problem) => problem.check === "إغلاقٌ بلا دليلٍ")).toBe(true);
  });

  it("والإغلاقُ بالتزامٍ يمرُّ — فالحاجزُ يقيسُ الدليلَ لا الكلمةَ", () => {
    const withProof = closedWithout.replace("**CLOSED**", "**CLOSED** by CORE `d2c38e3`");
    const problems = blockerProblems({
      ...healthyInputs(),
      roadmapText: withProof,
      docText: renderDoc(parseBlockers(withProof)),
    });
    expect(problems.some((problem) => problem.check === "إغلاقٌ بلا دليلٍ")).toBe(false);
  });

  it("وصفٌّ بلا أثرٍ مكتوبٍ يُخفِقُ", () => {
    const empty = [
      "## Blockers",
      "",
      "| # | Blocker | Impact | What unblocks it |",
      "|---|---|---|---|",
      "| B-5 | No production release approval |  | owner |",
      "",
      "## Next",
    ].join("\n");
    const problems = blockerProblems({
      ...healthyInputs(),
      roadmapText: empty,
      docText: renderDoc(parseBlockers(empty)),
    });
    expect(problems.some((problem) => problem.check.includes("فارغٍ"))).toBe(true);
  });
});

describe("مُصدِرُ الإشهادِ واحدٌ، وسبيلٌ ثانٍ يُخفِقُ", () => {
  it("مكتبةٌ بلا وَسمٍ ⇒ إخفاقٌ", () => {
    const problems = blockerProblems({ ...healthyInputs(), libSource: "export const x = 1;" });
    expect(problems.some((problem) => problem.check.includes("وَسمُ الإشهادِ مفقودٌ"))).toBe(true);
    expect(problems.some((problem) => problem.check.includes("مُصدِرُ الإشهادِ مفقودٌ"))).toBe(true);
  });

  it("وملفُّ اختبارٍ يزرعُ الرموزَ سلاسلَ **لا** يُخفِقُ — وهذا استثناءٌ بسببٍ لا تخفيفٌ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [
        ...base.sources,
        {
          file: "tests/unit/seeded.test.ts",
          text: "CORE_ATTESTATION_BRAND · export function issueCoreAttestation",
        },
        { file: "tests/unit/wasla-blockers.test.ts", text: "isIssuedAttestation as unknown as" },
      ],
    });
    expect(problems).toEqual([]);
  });

  it("لكنَّ الاستثناءَ يسقطُ إن لم يبقَ ملفُّ قياسِ التلفيقِ يقيسُ الرفضَ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [
        { file: LIB_PATH, text: REAL_LIB },
        { file: SELF_FILE, text: REAL_SELF },
        { file: "tests/unit/wasla-blockers.test.ts", text: "// لا قياسَ ههنا" },
      ],
    });
    expect(problems.some((problem) => problem.check.includes("لم يعُدْ يقيسُ"))).toBe(true);
  });

  it("وملفٌّ آخرَ يُعرِّفُ مُصدِراً ثانياً ⇒ إخفاقٌ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [
        ...base.sources,
        { file: "packages/x/y.ts", text: "export function issueCoreAttestation() {}" },
      ],
    });
    expect(problems.some((problem) => problem.check === "مُصدِرُ إشهادٍ ثانٍ")).toBe(true);
  });

  it("وملفٌّ آخرَ يذكرُ الوَسمَ ⇒ إخفاقٌ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [...base.sources, { file: "packages/x/y.ts", text: "CORE_ATTESTATION_BRAND" }],
    });
    expect(problems.some((problem) => problem.check.includes("خارجَ ملفِّه"))).toBe(true);
  });

  it("واستثناءُ الحارسِ نفسِه يسقطُ إن لم يعُدْ يذكرُ الوَسمَ", () => {
    const base = healthyInputs();
    const problems = blockerProblems({
      ...base,
      sources: [
        { file: LIB_PATH, text: REAL_LIB },
        { file: SELF_FILE, text: "// لا شيءَ" },
      ],
    });
    expect(problems.some((problem) => problem.check.includes("لم يعُدْ لهُ سببٌ"))).toBe(true);
  });
});

describe("الوثيقةُ مُولَّدةٌ لا مكتوبةٌ", () => {
  it("وثيقةٌ غائبةٌ ⇒ إخفاقٌ", () => {
    expect(
      blockerProblems({ ...healthyInputs(), docText: null }).some((problem) =>
        problem.check.includes("غائبةٌ"),
      ),
    ).toBe(true);
  });

  it("ووثيقةٌ حُرِّرَت يداً ⇒ إخفاقٌ", () => {
    const tampered = renderDoc(parseBlockers(REAL_ROADMAP)).replace("**مفتوحٌ**", "مُغلَقٌ");
    expect(
      blockerProblems({ ...healthyInputs(), docText: tampered }).some((problem) =>
        problem.check.includes("لا تطابقُ"),
      ),
    ).toBe(true);
  });

  it("والوثيقةُ المُشتَقّةُ تحملُ كلَّ معرّفٍ مُفكَّكٍ وحالتَه", () => {
    const blockers = parseBlockers(REAL_ROADMAP);
    const doc = renderDoc(blockers);
    for (const blocker of blockers) expect(doc).toContain(`\`${blocker.id}\``);
    expect(doc).toContain("لا تُحرَّرْ يداً");
  });

  it("والإعفاءاتُ المُعلَنةُ في الحارسِ ليست فارغةً — وإلّا فلا مِعيارَ يُقاسُ", () => {
    expect(SYNTHETIC_ID_EXEMPTIONS.length).toBeGreaterThan(0);
    for (const exemption of SYNTHETIC_ID_EXEMPTIONS) {
      expect(exemption.reason.trim().length).toBeGreaterThan(20);
    }
  });
});
