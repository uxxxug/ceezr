/**
 * الغرض: قياسُ حارسِ سجلِّ التحوُّلِ (`W-9` · ADR 0088). **وكلُّ حالةٍ تزرعُ
 *   العطبَ وتقيسُ الإخفاقَ**: حارسٌ لا يُقاسُ مسارُه الأحمرُ يُقرأُ أخضرَ لأنَّه
 *   لا يعملُ.
 * الحالة: منفّذ فعلياً — `W-9` (زيادةٌ داخلَ حدودِ `B-5`).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على المصفوفةِ أو على المُنفِّذِ.
 * ملاحظات مستقبلية: لا عددَ يُثبَّتُ ههنا.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type CutoverInputs,
  cutoverProblems,
  defaultInputs,
  renderDoc,
  typescriptFiles,
} from "../../scripts/check-cutover-plan.ts";
import { deriveCutoverPlan } from "../../scripts/lib/wasla-cutover-plan.ts";

const EXECUTOR_PATH = "scripts/rehearse-cutover.ts";
const REAL_ROADMAP = readFileSync("ROADMAP.md", "utf8");
const REAL_EXECUTOR = readFileSync(EXECUTOR_PATH, "utf8");
const STEPS = deriveCutoverPlan();

function healthy(): CutoverInputs {
  return {
    roadmapText: REAL_ROADMAP,
    docText: renderDoc(STEPS),
    executorSource: REAL_EXECUTOR,
    steps: STEPS,
    sources: [{ file: EXECUTOR_PATH, text: REAL_EXECUTOR }],
  };
}

describe("الحارسُ أخضرُ على المستودعِ كما هوَ", () => {
  it("لا مشكلةَ في المُدخلِ الحقيقيِّ الكاملِ", () => {
    expect(cutoverProblems(defaultInputs())).toEqual([]);
  });

  it("ويمسحُ ملفّاتِ TypeScript فعلاً — لا قائمةً مكتوبةً", () => {
    const files = typescriptFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(EXECUTOR_PATH);
  });
});

describe("خطوةٌ بلا عكسٍ أو بمِسبارٍ يكتبُ تُخفِقُ", () => {
  it("عكسٌ فارغٌ ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [{ ...first, rollback: { ...first.rollback, action: "  " } }, ...STEPS.slice(1)];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "خطوةٌ بلا عكسٍ",
      ),
    ).toBe(true);
  });

  it("وعكسٌ يُشيرُ إلى خطوةٍ أخرى ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [
      { ...first, rollback: { ...first.rollback, inverseOf: "9.999-elsewhere" } },
      ...STEPS.slice(1),
    ];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "عكسٌ يُشيرُ إلى غيرِ خطوتِه",
      ),
    ).toBe(true);
  });

  it("ومِسبارٌ يكتبُ ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [
      { ...first, probe: { ...first.probe, statement: "delete from public.orders" } },
      ...STEPS.slice(1),
    ];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "مِسبارٌ ليسَ للقراءةِ وحدَها",
      ),
    ).toBe(true);
  });

  it("ومِسبارٌ بلا قراءةٍ لـ«تمَّت» ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [{ ...first, probe: { ...first.probe, readsAs: "" } }, ...STEPS.slice(1)];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "مِسبارٌ بلا قراءةٍ لـ«تمَّت»",
      ),
    ).toBe(true);
  });
});

describe("الرتبةُ وترتيبُ الاسترجاعِ يُقاسانِ", () => {
  it("فراغٌ في الرتبةِ ⇒ إخفاقٌ", () => {
    const steps = STEPS.map((step, index) => (index === 1 ? { ...step, order: 99 } : step));
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "فراغٌ في الرتبةِ",
      ),
    ).toBe(true);
  });

  it("ورتبةٌ مكرَّرةٌ ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    const second = STEPS[1];
    if (first === undefined || second === undefined) throw new Error("لا خطوتَينِ");
    const steps = [first, { ...second, order: 1 }, ...STEPS.slice(2)];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "رتبةٌ مكرَّرةٌ",
      ),
    ).toBe(true);
  });

  it("وموجةٌ متأخِّرةٌ قبلَ أسبقَ منها ⇒ إخفاقٌ", () => {
    const steps = STEPS.slice()
      .sort((left, right) => right.wave - left.wave)
      .map((step, index) => ({ ...step, order: index + 1 }));
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "موجةٌ متأخِّرةٌ قبلَ أسبقَ منها",
      ),
    ).toBe(true);
  });
});

describe("السجلُّ مُشتَقٌّ: الاتجاهانِ مقيسانِ", () => {
  it("خطوةٌ لجدولٍ ليسَ في المصفوفةِ ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [
      ...STEPS,
      { ...first, id: "6.099-ghost", table: "ghost", order: STEPS.length + 1 },
    ];
    const problems = cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) });
    expect(problems.some((problem) => problem.check === "خطوةٌ بلا صفٍّ في المصفوفةِ")).toBe(true);
  });

  it("وصفٌّ مُهاجِرٌ بلا خطوةٍ ⇒ إخفاقٌ", () => {
    const steps = STEPS.slice(1).map((step, index) => ({ ...step, order: index + 1 }));
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "صفٌّ مُهاجِرٌ بلا خطوةِ تحوُّلٍ",
      ),
    ).toBe(true);
  });

  it("وحاجزٌ غيرُ مُعلَنٍ في جداولِ الخارطةِ ⇒ إخفاقٌ", () => {
    const first = STEPS[0];
    if (first === undefined) throw new Error("لا خطوةَ");
    const steps = [{ ...first, blockedBy: ["B-97"] }, ...STEPS.slice(1)];
    expect(
      cutoverProblems({ ...healthy(), steps, docText: renderDoc(steps) }).some(
        (problem) => problem.check === "حاجزٌ غيرُ مُعلَنٍ في سجلِّ الحواجزِ",
      ),
    ).toBe(true);
  });
});

describe("الرفضُ يبقى حيّاً، والمُنفِّذُ لا يكتبُ", () => {
  it("خارطةٌ تُغلِقُ حواجزَ التمرينِ ⇒ إخفاقٌ «الرفضُ لم يعُدْ حيّاً» لا مرورٌ صامتٌ", () => {
    const closed = REAL_ROADMAP.replaceAll(
      /^\| (B-5|B-3|B-1|DEP-CORE-007) \|/gmu,
      (line) => `${line} **CLOSED** by commit \`abc1234\` |`,
    );
    const problems = cutoverProblems({ ...healthy(), roadmapText: closed });
    expect(problems.some((problem) => problem.check === "الرفضُ لم يعُدْ حيّاً")).toBe(true);
  });

  it("ومُنفِّذٌ يحملُ كلمةَ كتابةٍ ⇒ إخفاقٌ", () => {
    expect(
      cutoverProblems({
        ...healthy(),
        executorSource: `${REAL_EXECUTOR}\nawait sql.unsafe("delete from public.orders");\n`,
      }).some((problem) => problem.check === "المُنفِّذُ يحملُ كلمةَ كتابةٍ"),
    ).toBe(true);
  });

  it("ومُنفِّذٌ لا يمرُّ بالرفضِ ⇒ إخفاقٌ", () => {
    expect(
      cutoverProblems({ ...healthy(), executorSource: "console.log('تمَّ التمرينُ');" }).some(
        (problem) => problem.check === "المُنفِّذُ لا يمرُّ بالرفضِ",
      ),
    ).toBe(true);
  });

  it("وملفٌّ آخرَ يبني حالةَ التمرينِ بنفسِه ⇒ إخفاقٌ", () => {
    const base = healthy();
    expect(
      cutoverProblems({
        ...base,
        sources: [
          ...base.sources,
          { file: "packages/x/y.ts", text: 'const s = "READ_ONLY_PROBED";' },
        ],
      }).some((problem) => problem.check === "حالةُ التمرينِ تُبنى خارجَ مصدرِها"),
    ).toBe(true);
  });
});

describe("الوثيقةُ مُولَّدةٌ لا مكتوبةٌ", () => {
  it("وثيقةٌ غائبةٌ ⇒ إخفاقٌ", () => {
    expect(
      cutoverProblems({ ...healthy(), docText: null }).some(
        (problem) => problem.check === "الوثيقةُ غائبةٌ",
      ),
    ).toBe(true);
  });

  it("ووثيقةٌ حُرِّرَت يداً ⇒ إخفاقٌ", () => {
    expect(
      cutoverProblems({ ...healthy(), docText: renderDoc(STEPS).replace("مرفوضٌ", "جرى") }).some(
        (problem) => problem.check === "الوثيقةُ لا تطابقُ الاشتقاقَ",
      ),
    ).toBe(true);
  });

  it("والوثيقةُ تُعلِنُ صريحاً أنَّه لا تمرينَ جرى، وتحملُ كلَّ خطوةٍ وعكسَها", () => {
    const doc = renderDoc(STEPS);
    expect(doc).toContain("لا تُحرَّرْ يداً");
    expect(doc).toContain("ولا تمرينَ جرى");
    for (const step of STEPS) {
      expect(doc).toContain(`\`${step.id}\``);
      expect(doc).toContain(step.probe.statement);
    }
  });
});
