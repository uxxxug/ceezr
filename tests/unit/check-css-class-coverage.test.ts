/**
 * الغرض: إثباتُ أنَّ حاجزَ تغطيةِ أصنافِ العرضِ **يُخفِقُ فعلاً** على كلِّ افتراقٍ
 *   يدّعي منعَه (`UX-021` · `ADR 0105`) — لا أنَّه يمرُّ على المستودعِ كما هوَ
 *   اليومَ. وحاجزٌ بلا حالةٍ سالبةٍ اطمئنانٌ مُشترى بلا ثمنٍ، وهوَ أخطرُ من
 *   غيابِه لأنَّه يُقرأُ إنفاذاً وهوَ نصٌّ (`ح-7`).
 * الحالة: اختبار فعلي — القرارُ النقيُّ يُستدعى على مُدخلاتٍ مُصنَّعةٍ لكلِّ قاعدةٍ،
 *   ثمَّ على المستودعِ الحقيقيِّ في آخرِ الملفِّ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI — خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ — قاعدةٌ بلا حالةٍ
 *   سالبةٍ ههنا لا تُحسَبُ مفروضةً.
 * ملاحظات مستقبلية: المُدخلاتُ المُصنَّعةُ ههنا صغيرةٌ بقصدٍ؛ والحكمُ على
 *   المستودعِ كما هوَ يبقى في آخرِ وصفٍ كي يُكشَفَ أيُّ انحرافٍ لاحقٍ في CI.
 */

import { describe, expect, it } from "bun:test";
import { readRepository } from "../../scripts/check-css-class-coverage.ts";
import {
  type CoverageInput,
  coverageProblems,
  extractEmittedClasses,
  extractStyledClasses,
  namingProblem,
  RETAINED_RULES,
  type RetainedRule,
} from "../../scripts/lib/css-class-coverage.ts";

const STYLESHEET = "apps/miniapp/src/styles/global.css";
const SURFACE = "apps/miniapp/src/surfaces/rider/home/Screen.tsx";

const EMIT_RH = `const a = <p className="rh" />;\n`;

function input(css: string, source: string): CoverageInput {
  // `retained: []` لأنَّ المُدخلاتِ مُصنَّعةٌ: سجلُّ المستودعِ يحرسُ قواعدَ ورقتِه
  // الحقيقيّةِ، ومقابلتُه بورقةٍ مُصنَّعةٍ تُنتِجُ خرقاً صادقاً لا علاقةَ له بالمقيسِ.
  return { stylesheets: { [STYLESHEET]: css }, sources: { [SURFACE]: source }, retained: [] };
}

/** ورقةٌ فيها قاعدةٌ زالَ مُصدِرُها. */
function retiredCss(): string {
  return `.rh { display: flex; }\n.rh__gone { color: red; }\n`;
}

/** مدخلُ سجلٍّ مُصنَّعٌ، مكتملُ البيانِ إلّا ما يُنقَضُ في الحالةِ السالبةِ. */
function entry(overrides: Partial<RetainedRule> = {}): RetainedRule {
  return {
    className: "rh__gone",
    reason: "زالَ مُصدِرُها بقرارٍ منشورٍ لا بسهوٍ.",
    owner: "منفّذ المستودع",
    supersededBy: "ADR 0000 §1",
    ...overrides,
  };
}

/** أصغرُ حالةٍ سليمةٍ: صنفٌ يُصدَرُ وله قاعدةٌ، وقاعدةٌ ليسَ لها غيرُه. */
function healthy(): CoverageInput {
  return input(`.rh { display: flex; }\n`, `const a = <p className="rh" />;\n`);
}

describe("الحالةُ السليمةُ", () => {
  it("لا خرقَ حينَ يتقابلُ المُصدَرُ والمُحدِّدُ", () => {
    expect(coverageProblems(healthy())).toEqual([]);
  });
});

describe("القاعدة ١ — لا صنفَ يُصدِرُه العرضُ بلا قاعدةٍ", () => {
  it("صنفٌ في نصٍّ حرفيٍّ بلا مُحدِّدٍ يُسقِطُ الحاجزَ", () => {
    const problems = coverageProblems(
      input(`.rh { display: flex; }\n`, `const a = <p className="rh rh__city" />;\n`),
    );
    expect(problems.some((text) => text.includes("rh__city"))).toBe(true);
  });

  it("صنفٌ في قالبٍ ساكنٍ بلا مُحدِّدٍ يُسقِطُ الحاجزَ: القالبُ ليسَ مَهرباً", () => {
    const problems = coverageProblems(
      input(`.rh { display: flex; }\n`, "const a = <p className={`rh rh__title`} />;\n"),
    );
    expect(problems.some((text) => text.includes("rh__title"))).toBe(true);
  });

  it("صنفٌ في فرعِ شرطٍ داخلَ إحلالٍ بلا مُحدِّدٍ يُسقِطُ الحاجزَ", () => {
    const problems = coverageProblems(
      input(
        `.rh { display: flex; }\n.rh__service { border: 0; }\n`,
        'const a = <p className={`rh__service${on ? " rh__service--on" : ""}`} />;\n',
      ),
    );
    expect(problems.some((text) => text.includes("rh__service--on"))).toBe(true);
  });

  it("أرقامٌ في قيمِ الإعلاناتِ لا تُقرأُ مُحدِّداتِ أصنافٍ", () => {
    const styled = extractStyledClasses(`.rh { font-size: 0.85rem; border: 1px solid #05f; }\n`);
    expect([...styled.keys()]).toEqual(["rh"]);
  });

  it("مُحدِّدٌ في جوفِ قاعدةٍ عندَ (@media) يُقرأُ، وشرطُها لا يُقرأُ صنفاً", () => {
    const styled = extractStyledClasses(
      `@media (min-width: 30rem) {\n  .rh__map { min-block-size: 8rem; }\n}\n`,
    );
    expect([...styled.keys()]).toEqual(["rh__map"]);
  });

  it("تعليقاتُ CSS لا تُقرأُ مُحدِّداتٍ، ولا تُزيحُ أرقامَ الأسطرِ", () => {
    const styled = extractStyledClasses(`/* .rh__ghost { a: b; } */\n.rh { display: flex; }\n`);
    expect([...styled.keys()]).toEqual(["rh"]);
    expect(styled.get("rh")).toBe(2);
  });
});

describe("القاعدة ٢ — لا قاعدةَ بلا مُصدِرٍ إلّا مُسجَّلةً بسببٍ ومالكٍ", () => {
  it("قاعدةٌ لا يُصدِرُها عرضٌ ولا سجلَّ لها تُسقِطُ الحاجزَ", () => {
    const problems = coverageProblems(input(retiredCss(), EMIT_RH));
    expect(problems.some((text) => text.includes("rh__gone"))).toBe(true);
  });

  it("مدخلٌ مكتملُ البيانِ يُبرِّرُ البقاءَ — والحذفُ ممنوعٌ (ح-1)", () => {
    expect(coverageProblems({ ...input(retiredCss(), EMIT_RH), retained: [entry()] })).toEqual([]);
  });

  it("مدخلٌ بلا سببٍ يُسقِطُ الحاجزَ: سجلٌّ بلا بيانٍ بابُ إسكاتٍ لا سجلُّ تدقيقٍ", () => {
    const problems = coverageProblems({
      ...input(retiredCss(), EMIT_RH),
      retained: [entry({ reason: "   " })],
    });
    expect(problems.some((text) => text.includes("بلا سببٍ"))).toBe(true);
  });

  it("مدخلٌ بلا مالكٍ يُسقِطُ الحاجزَ: بيانٌ لا يُسألُ عنه أحدٌ", () => {
    const problems = coverageProblems({
      ...input(retiredCss(), EMIT_RH),
      retained: [entry({ owner: "" })],
    });
    expect(problems.some((text) => text.includes("بلا مالكٍ"))).toBe(true);
  });

  it("مدخلٌ لا يُسمّي ما أحلَّه يُسقِطُ الحاجزَ: زوالُ مُصدِرٍ بلا قرارٍ رأيٌ", () => {
    const problems = coverageProblems({
      ...input(retiredCss(), EMIT_RH),
      retained: [entry({ supersededBy: " " })],
    });
    expect(problems.some((text) => text.includes("أحلَّه"))).toBe(true);
  });

  it("مدخلٌ لقاعدةٍ لا وجودَ لها يُسقِطُ الحاجزَ: حرسٌ على معدومٍ", () => {
    const problems = coverageProblems({ ...healthy(), retained: [entry()] });
    expect(problems.some((text) => text.includes("يحرسُ معدوماً"))).toBe(true);
  });

  it("مدخلٌ لقاعدةٍ **مُصدَرةٍ** يُسقِطُ الحاجزَ: لا يحتمي بالسجلِّ ما لا يحتاجُه", () => {
    const problems = coverageProblems({
      ...input(retiredCss(), `const a = <p className="rh rh__gone" />;\n`),
      retained: [entry()],
    });
    expect(problems.some((text) => text.includes("يُرفَعُ المدخلُ"))).toBe(true);
  });

  it("السجلُّ الحقيقيُّ مكتملُ البيانِ: لا مدخلَ بلا سببٍ ومالكٍ وما أحلَّه", () => {
    expect(RETAINED_RULES.length).toBeGreaterThan(0);
    expect(RETAINED_RULES.every((rule) => rule.reason.trim().length > 0)).toBe(true);
    expect(RETAINED_RULES.every((rule) => rule.owner.trim().length > 0)).toBe(true);
    expect(RETAINED_RULES.every((rule) => rule.supersededBy.trim().length > 0)).toBe(true);
  });
});

describe("القاعدة ٣ — لا تعبيرَ صنفٍ من مصدرٍ لا يراهُ الحاجزُ", () => {
  it("صنفٌ من خاصيّةٍ خارجيّةٍ يُسقِطُ الحاجزَ: ما يُصدَرُ خارجُ كلِّ قياسٍ", () => {
    const problems = coverageProblems(
      input(`.rh { display: flex; }\n`, "const a = <p className={`rh ${props.extra}`} />;\n"),
    );
    expect(problems.some((text) => text.includes("لا يُحَلُّ ساكناً"))).toBe(true);
  });

  it("جدولُ أصنافٍ في الملفِّ نفسِه يُقرأُ ولا يُعَدُّ مُبهَماً", () => {
    const source = [
      'const LINES = [{ modifier: "sk__line--title" }];',
      "const a = LINES.map((line) => <span className={`sk__line ${line.modifier}`} />);",
    ].join("\n");
    const emission = extractEmittedClasses(SURFACE, source);
    expect(emission.opaque).toEqual([]);
    expect(emission.classes.map((item) => item.className)).toContain("sk__line--title");
  });
});

describe("القاعدة ٤ — التسميةُ المُعلَنةُ وبادئةٌ مُسجَّلةٌ", () => {
  it("بادئةٌ غيرُ مُعلَنةٍ تُسقِطُ الحاجزَ", () => {
    expect(namingProblem("zz__thing")).not.toBeNull();
    const problems = coverageProblems(
      input(`.zz__thing { color: red; }\n`, `const a = <p className="zz__thing" />;\n`),
    );
    expect(problems.some((text) => text.includes("DECLARED_BLOCKS"))).toBe(true);
  });

  it("اسمٌ خارجَ التسميةِ يُسقِطُ الحاجزَ: خطأٌ إملائيٌّ لا يُقرأُ قاعدةً جديدةً", () => {
    expect(namingProblem("rh__City")).not.toBeNull();
    expect(namingProblem("rh___city")).not.toBeNull();
    expect(namingProblem("rh__city")).toBeNull();
    expect(namingProblem("rh__place-kind")).toBeNull();
    expect(namingProblem("app-frame__action")).toBeNull();
  });
});

describe("المستودعُ الحقيقيُّ", () => {
  it("لا خرقَ في المستودعِ كما هوَ: الحاجزُ يُقرأُ على الشِّفرةِ لا على مُصنَّعٍ", () => {
    expect(coverageProblems(readRepository())).toEqual([]);
  });
});
