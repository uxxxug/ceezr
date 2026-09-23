/**
 * الغرض: سالبةٌ لكلِّ قاعدةٍ في حَكَمِ `scripts/lib/support-volume-budget.ts` (`ح-7`).
 *   الحَكَمُ نقيٌّ، فكلُّ قاعدةٍ تُكسَرُ بحقائقَ مبذورةٍ ويُوكَّدُ أنَّها تُلتقَطُ.
 *
 * الحالة: اختبار وحدة فعلي — يشغّل الحَكَمَ عينَه.
 * ينتمي إلى: tests/unit
 * يحرسُ: `scripts/lib/support-volume-budget.ts`
 * الحاكم: `docs/adr/0180-eco-006-measures-system-tickets-only-not-support-rate.md`
 */

import { describe, expect, it } from "bun:test";
import {
  JUDGE_RULE_NAMES,
  type JudgeInputs,
  judgeSupportVolume,
  MEASURED_TRANSITION_ACTIONS,
  summarizeSupportVolume,
  supportTicketBudget,
} from "../../scripts/lib/support-volume-budget.ts";

const PROFILE = { lifecycleTransitionCount: 5 };

const green: JudgeInputs = {
  facts: {
    measured: true,
    supportTicketsCreated: 0,
    lifecycleTransitions: MEASURED_TRANSITION_ACTIONS.length,
  },
  profile: PROFILE,
  supportTicketsBudget: supportTicketBudget(PROFILE),
};

function rulesOf(inputs: JudgeInputs): string[] {
  return judgeSupportVolume(inputs).map((v) => v.rule);
}

describe("support-volume-budget — سالبةٌ لكلِّ قاعدةِ حكمٍ (ح-7)", () => {
  it("الحقائقُ الخضراءُ لا تُنتِجُ مخالفاتٍ", () => {
    expect(judgeSupportVolume(green)).toEqual([]);
  });

  it("facts.measured: قياسٌ لم يجرِ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, measured: false } })).toContain(
      "facts.measured",
    );
  });

  it("counts.sane: فرقٌ سالبٌ يصلُ الحَكَمَ خاماً فيُكشَفُ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, supportTicketsCreated: -1 } })).toContain(
      "counts.sane",
    );
  });

  it("counts.sane: عددُ انتقالاتٍ غيرُ صحيحٍ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, lifecycleTransitions: 2.5 } })).toContain(
      "counts.sane",
    );
  });

  it("tickets.within-budget: تذاكرُ فوقَ السقفِ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, supportTicketsCreated: 6 } })).toContain(
      "tickets.within-budget",
    );
  });

  it("budget.derived: سقفٌ مكتوبٌ لا مُشتَقٌّ", () => {
    expect(rulesOf({ ...green, supportTicketsBudget: 99 })).toContain("budget.derived");
  });

  it("transitions.observed: صفرُ انتقالاتٍ = مسارٌ لم يُشغَّلْ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, lifecycleTransitions: 0 } })).toContain(
      "transitions.observed",
    );
  });

  it("transitions.observed: انتقالاتٌ فوقَ ما تسمحُ به الآلةُ المُعلَنةُ", () => {
    expect(rulesOf({ ...green, facts: { ...green.facts, lifecycleTransitions: 6 } })).toContain(
      "transitions.observed",
    );
  });

  it("كلُّ قاعدةِ حكمٍ مُسمّاةٌ لها سالبةٌ في هذا الملفِّ", () => {
    expect([...JUDGE_RULE_NAMES].map(String).sort()).toEqual(
      [
        "budget.derived",
        "counts.sane",
        "facts.measured",
        "tickets.within-budget",
        "transitions.observed",
      ].sort(),
    );
  });

  it("الملخّصُ لا يدّعي معدَّلَ دعمٍ ولا تكلفةً ولا يذكرُ REQ-09", () => {
    const summary = summarizeSupportVolume(green.facts);
    expect(summary).toContain("لا يُدَّعى معدَّلُ دعمٍ");
    expect(summary).not.toContain("REQ-09");
  });
});
