/**
 * الغرض: سالبةٌ لكلِّ قاعدةٍ في `scripts/check-support-volume-budget.ts` (`ح-7`).
 *   كلُّ اختبارٍ يكسرُ قاعدةً واحدةً ويُوكِّدُ أنَّ الحاجزَ يلتقطُها — فالحاجزُ
 *   الذي لا يُكسَرُ لا يحرسُ شيئاً.
 *
 * الحالة: اختبار وحدة فعلي — يشغّل الحاجزَ عينَه لا نسخةً منه.
 * ينتمي إلى: tests/unit
 * يحرسُ: `scripts/check-support-volume-budget.ts`
 * الحاكم: `docs/adr/0179-support-tickets-per-ride-are-counted-not-estimated.md` ·
 *   `docs/adr/0180-eco-006-measures-system-tickets-only-not-support-rate.md`
 */

import { describe, expect, it } from "bun:test";
import {
  type AuditInputs,
  auditSupportVolumeBudget,
  GUARD_RULE_NAMES,
  REQUIRED_SYSTEM_TRANSITIONS,
} from "../../scripts/check-support-volume-budget.ts";
import { JUDGE_RULE_NAMES } from "../../scripts/lib/support-volume-budget.ts";

/** مدخلاتٌ خضراءُ: تُطابِقُ ملفَّ القياسِ الحقيقيَّ في كلِّ ما يفحصُه الحاجزُ. */
const GREEN_SOURCE = `
import { judgeSupportVolume } from "../../scripts/lib/support-volume-budget.ts";
import { SUPPORT_TICKET_TYPES } from "../../packages/domain/support/ticket-types.ts";

describe("ECO-006", () => {
  it("counts support_tickets on the wire", async () => {
    const ticketsBefore = await sql\`select count(*) from support_tickets\`;
    await sql\`select claim_ride(\${orderId}::uuid, \${driverId}::uuid) as result\`;
    await sql\`select driver_mark_arrived(\${tg}::bigint, \${orderId}::uuid) as result\`;
    await sql\`select driver_start_ride(\${tg}::bigint, \${orderId}::uuid) as result\`;
    await sql\`select driver_complete_ride(\${tg}::bigint, \${orderId}::uuid) as result\`;
    const ticketsAfter = await sql\`select count(*) from support_tickets\`;
    const lifecycleTransitions = await sql\`select count(*) from audit_log where entity_id = \${orderId}\`;
    const facts = { measured: true, supportTicketsCreated: ticketsAfter - ticketsBefore, lifecycleTransitions };
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

  it("guard.no-clamping: القياسُ يُطهِّرُ الفرقَ بـMath.max", () => {
    const source = GREEN_SOURCE.replace(
      "supportTicketsCreated: ticketsAfter - ticketsBefore",
      "supportTicketsCreated: Math.max(0, ticketsAfter - ticketsBefore)",
    );
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.no-clamping")).toBe(true);
  });

  it("guard.transitions-measured: الانتقالاتُ منسوخةٌ من الثابتِ", () => {
    const source = GREEN_SOURCE.replace(
      "lifecycleTransitions };",
      "lifecycleTransitions: RIDE_RESOURCE_PROFILE.lifecycleTransitionCount };",
    );
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.transitions-measured")).toBe(true);
  });

  it("guard.transitions-measured: لا عدَّ من audit_log", () => {
    const source = GREEN_SOURCE.replace("from audit_log", "from other_log");
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.transitions-measured")).toBe(true);
  });

  it("guard.real-transitions: قفزٌ يدويٌّ بالحالةِ", () => {
    const source = `${GREEN_SOURCE}\nawait sql\`update orders set status = 'in_progress'\`;`;
    const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
    expect(problems.some((p) => p.rule === "guard.real-transitions")).toBe(true);
  });

  for (const fn of REQUIRED_SYSTEM_TRANSITIONS) {
    it(`guard.real-transitions: نداءُ ${fn} غائبٌ`, () => {
      const source = GREEN_SOURCE.replace(`select ${fn}(`, "select other_fn(");
      const problems = auditSupportVolumeBudget({ ...greenInputs, measurementSource: source });
      expect(problems.some((p) => p.rule === "guard.real-transitions")).toBe(true);
    });
  }

  it("GUARD_RULE_NAMES لكلُّ قاعدةٍ اسمٌ فريدٌ", () => {
    const names = GUARD_RULE_NAMES.map((n) => n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("JUDGE_RULE_NAMES لكلُّ قاعدةٍ اسمٌ فريدٌ", () => {
    const names = JUDGE_RULE_NAMES.map((n) => n);
    expect(new Set(names).size).toBe(names.length);
  });
});
