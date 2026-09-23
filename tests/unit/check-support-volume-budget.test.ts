/**
 * الغرض: سالبةٌ لكلِّ قاعدةٍ في `scripts/check-support-volume-budget.ts` (`ح-7`).
 *   كلُّ اختبارٍ يكسرُ قاعدةً واحدةً ويُوكِّدُ أنَّ الحاجزَ يلتقطُها — فالحاجزُ
 *   الذي لا يُكسَرُ لا يحرسُ شيئاً.
 *
 * الحالة: اختبار وحدة فعلي — يشغّل الحاجزَ عينَه لا نسخةً منه.
 * ينتمي إلى: tests/unit
 * يحرسُ: `scripts/check-support-volume-budget.ts`
 * الحاكم: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md`
 */

import { describe, expect, it } from "bun:test";
import {
  type AuditInputs,
  auditSupportVolumeBudget,
  GUARD_RULE_NAMES,
} from "../../scripts/check-support-volume-budget.ts";
import { JUDGE_RULE_NAMES } from "../../scripts/lib/support-volume-budget.ts";

/** مدخلاتٌ خضراءُ: تُطابِقُ ملفَّ القياسِ الحقيقيَّ في كلِّ ما يفحصُه الحاجزُ. */
const GREEN_SOURCE = `
import { judgeSupportVolume } from "../../scripts/lib/support-volume-budget.ts";
import { SUPPORT_TICKET_TYPES } from "../../packages/domain/support/ticket-types.ts";

describe("ECO-006", () => {
  it("counts support_tickets on the wire", async () => {
    const ticketsBefore = await countRows("support_tickets");
    // ... ride lifecycle ...
    const ticketsAfter = await countRows("support_tickets");
    const facts = { measured: true, supportTicketsCreated: ticketsAfter - ticketsBefore, lifecycleTransitions: 5 };
    const violations = judgeSupportVolume({ facts, profile: { lifecycleTransitionCount: 5 }, supportTicketsBudget: 5 });
    expect(violations).toEqual([]);
  });
});
`.trim();

const GREEN_PACKAGE = '{"ci": "bun run scripts/check-support-volume-budget.ts"}';

const greenInputs: AuditInputs = {
  measurementSource: GREEN_SOURCE,
  packageJson: GREEN_PACKAGE,
  supportTicketsBudget: 5,
  judgeRuleCount: JUDGE_RULE_NAMES.length,
};

describe("check-support-volume-budget — سالبةٌ لكلِّ قاعدةٍ (ح-7)", () => {
  it("المدخلاتُ الخضراءُ لا تُنتِجُ مخالفاتٍ", () => {
    expect(auditSupportVolumeBudget(greenInputs)).toEqual([]);
  });

  it("guard.measurement-present: غيابُ ملفِّ القياسِ", () => {
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: null });
    expect(problems.some((p) => p.rule === "guard.measurement-present")).toBe(true);
  });

  it("guard.judge-imported: الحَكَمُ غيرُ مستورَدٍ", () => {
    const source = GREEN_SOURCE.replace(
      'from "../../scripts/lib/support-volume-budget.ts"',
      'from "../../scripts/lib/other-budget.ts"',
    );
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.judge-imported")).toBe(true);
  });

  it("guard.judge-imported: رمزُ judgeSupportVolume غائبٌ", () => {
    const source = GREEN_SOURCE.replaceAll("judgeSupportVolume", "judgeOther");
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.judge-imported")).toBe(true);
  });

  it("guard.support-tickets-counted: support_tickets غيرُ معدودٍ", () => {
    const source = GREEN_SOURCE.replaceAll("support_tickets", "other_table");
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.support-tickets-counted")).toBe(true);
  });

  it("guard.types-source: SUPPORT_TICKET_TYPES غائبٌ", () => {
    const source = GREEN_SOURCE.replace("SUPPORT_TICKET_TYPES", "OTHER_TYPES");
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.types-source")).toBe(true);
  });

  it("guard.assertion-intact: التأكيدُ مُفرَّغٌ", () => {
    const source = GREEN_SOURCE.replace(
      /expect\(\s*violations\s*\)\.toEqual\(\[\]\)/,
      "expect(violations).toBeDefined()",
    );
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.assertion-intact")).toBe(true);
  });

  it("guard.assertion-intact: measured: true غائبٌ", () => {
    const source = GREEN_SOURCE.replace("measured: true", "measured: false");
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.assertion-intact")).toBe(true);
  });

  it("guard.budget-sane: سقفٌ غيرُ صالحٍ", () => {
    const problems = auditSupportVolumeBudget({ ...greenInputs, supportTicketsBudget: 0 });
    expect(problems.some((p) => p.rule === "guard.budget-sane")).toBe(true);
  });

  it("guard.budget-sane: سقفٌ سالبٌ", () => {
    const problems = auditSupportVolumeBudget({ ...greenInputs, supportTicketsBudget: -1 });
    expect(problems.some((p) => p.rule === "guard.budget-sane")).toBe(true);
  });

  it("guard.budget-sane: حكمٌ بلا قاعدةٍ", () => {
    const problems = auditSupportVolumeBudget({ ...greenInputs, judgeRuleCount: 0 });
    expect(problems.some((p) => p.rule === "guard.budget-sane")).toBe(true);
  });

  it("guard.self-enforced: الحاجزُ غيرُ موصولٍ في ci", () => {
    const problems = auditSupportVolumeBudget({
      ...greenInputs,
      packageJson: '{"ci": "bun run scripts/check-other.ts"}',
    });
    expect(problems.some((p) => p.rule === "guard.self-enforced")).toBe(true);
  });

  it("GUARD_RULE_NAMES لكلُّ قاعدةٍ اسمٌ فريدٌ", () => {
    const names = GUARD_RULE_NAMES.map((n) => n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("JUDGE_RULE_NAMES لكلُّ قاعدةٍ اسمٌ فريدٌ", () => {
    const names = JUDGE_RULE_NAMES.map((n) => n);
    expect(new Set(names).size).toBe(names.length);
  });
});
