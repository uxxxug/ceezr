/**
 * الغرض: اختبار **كل سياسة** في الطبقة المعزولة — الثقة، والتنفيذ، والقرار،
 *   والتعلّم — وسجلّ الأدوات الذي يجب أن يبقى خالياً من أي أداة تنفيذ.
 * الحالة: اختبار وحدة فعلي — القسم د من أمر الطبقة المعزولة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على policies/ أو tools/
 * ملاحظات مستقبلية: حين يُفتح مستوى أعلى من SUGGEST بأمر صريح، **يجب أن تفشل
 *   اختبارات هنا** — فشلها حينها هو الدليل على أنها كانت تحرس شيئاً فعلاً.
 */

import { describe, expect, it } from "bun:test";
import { evaluateConfidence } from "../../packages/agent-core/policies/confidencePolicy.ts";
import { buildDecision } from "../../packages/agent-core/policies/decisionPolicy.ts";
import {
  currentCeiling,
  enforceExecutionPolicy,
} from "../../packages/agent-core/policies/executionPolicy.ts";
import {
  checkCandidateEligibility,
  isAutoApprovalAllowed,
  isTypeImplemented,
} from "../../packages/agent-core/policies/learningPolicy.ts";
import type {
  AgentProposal,
  EventPayload,
  LearningCandidate,
} from "../../packages/agent-core/schemas.ts";
import { checkPermission } from "../../packages/agent-core/tools/permissions.ts";
import {
  createDefaultToolRegistry,
  createToolRegistry,
} from "../../packages/agent-core/tools/toolRegistry.ts";

function proposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    agentId: "support-ticket-agent",
    classification: "subscription_issue",
    recommendedAction: "راجع حالة الاشتراك.",
    confidence: 0.8,
    requestedToolLevel: "SUGGEST",
    evidence: [{ source: "knowledge:subscription", excerpt: "تفعيل", score: 3 }],
    missingData: [],
    ...overrides,
  };
}

const event: EventPayload = {
  eventId: "ticket-1",
  eventType: "support_ticket_opened",
  occurredAt: "2026-01-01T00:00:00.000Z",
  source: "support_tickets",
  text: "اشتراكي منتهي",
  attributes: {},
};

function candidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    candidateId: "keyword:subscription_issue:تجديد",
    candidateType: "keyword",
    status: "pending",
    subject: "تجديد",
    label: "subscription_issue",
    supportCount: 5,
    rationale: "تكرّر",
    createdAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

describe("سياسة الثقة", () => {
  it("تقبل اقتراحاً واضح الدليل فوق العتبة", () => {
    expect(evaluateConfidence(proposal(), 0.55).sufficient).toBe(true);
  });

  it("ترفض ما دون العتبة", () => {
    expect(evaluateConfidence(proposal({ confidence: 0.3 }), 0.55).sufficient).toBe(false);
  });

  it("تخصم على غياب الدليل — رقمٌ بلا سند ليس ثقة", () => {
    const withEvidence = evaluateConfidence(proposal({ confidence: 0.7 }), 0.55);
    const without = evaluateConfidence(proposal({ confidence: 0.7, evidence: [] }), 0.55);
    expect(without.effectiveConfidence).toBeLessThan(withEvidence.effectiveConfidence);
  });

  it("تخصم على نقص البيانات: اقتراحٌ عن حالة ناقصة اقتراحٌ عن غير ما وقع", () => {
    const complete = evaluateConfidence(proposal({ confidence: 0.7 }), 0.55);
    const incomplete = evaluateConfidence(
      proposal({ confidence: 0.7, missingData: ["لا مرجع طلب"] }),
      0.55,
    );
    expect(incomplete.effectiveConfidence).toBeLessThan(complete.effectiveConfidence);
  });
});

describe("سياسة التنفيذ", () => {
  it("⚠️ السقف SUGGEST — يفشل هذا الاختبار يوم يُرفع بلا أمر صريح", () => {
    expect(currentCeiling()).toBe("SUGGEST");
  });

  it("تمنح SUGGEST لاقتراح يطلبه", () => {
    const verdict = enforceExecutionPolicy(proposal());
    expect(verdict.allowed).toBe(true);
    expect(verdict.grantedLevel).toBe("SUGGEST");
  });

  it("⚠️ ترفض EXECUTE **ولا تخفضه بصمت** — الرفض يُرى والخفض يختفي", () => {
    const verdict = enforceExecutionPolicy(proposal({ requestedToolLevel: "EXECUTE" }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.violation).toBe(true);
    expect(verdict.grantedLevel).toBe("NONE");
  });

  it("لا مسار تجاوز مهما بلغت الثقة", () => {
    const verdict = enforceExecutionPolicy(
      proposal({ requestedToolLevel: "EXECUTE", confidence: 1 }),
    );
    expect(verdict.allowed).toBe(false);
  });
});

describe("سياسة القرار", () => {
  it("تُنتج suggested لاقتراح واثق مسموح", () => {
    const decision = buildDecision({
      traceId: "t-1",
      event,
      proposal: proposal(),
      confidence: evaluateConfidence(proposal(), 0.55),
      execution: enforceExecutionPolicy(proposal()),
      durationMs: 5,
    });
    expect(decision.status).toBe("suggested");
    expect(decision.allowedToolLevel).toBe("SUGGEST");
    expect(decision.recommendedAction).not.toBeNull();
  });

  it("⚠️ انتهاك الصلاحية يحجب القرار **قبل** النظر في الثقة", () => {
    const violating = proposal({ requestedToolLevel: "EXECUTE", confidence: 0.99 });
    const decision = buildDecision({
      traceId: "t-2",
      event,
      proposal: violating,
      confidence: evaluateConfidence(violating, 0.55),
      execution: enforceExecutionPolicy(violating),
      durationMs: 5,
    });
    expect(decision.status).toBe("blocked");
    expect(decision.allowedToolLevel).toBe("NONE");
  });

  it("ثقة ضعيفة تُنتج insufficient_confidence بلا نصّ مقترح", () => {
    const weak = proposal({ confidence: 0.1, evidence: [] });
    const decision = buildDecision({
      traceId: "t-3",
      event,
      proposal: weak,
      confidence: evaluateConfidence(weak, 0.55),
      execution: enforceExecutionPolicy(weak),
      durationMs: 5,
    });
    expect(decision.status).toBe("insufficient_confidence");
    expect(decision.recommendedAction).toBeNull();
  });

  it("لا قرار يتجاوز SUGGEST في أي حال", () => {
    for (const level of ["NONE", "READ", "SUGGEST", "EXECUTE"] as const) {
      const candidateProposal = proposal({ requestedToolLevel: level });
      const decision = buildDecision({
        traceId: "t-4",
        event,
        proposal: candidateProposal,
        confidence: evaluateConfidence(candidateProposal, 0.55),
        execution: enforceExecutionPolicy(candidateProposal),
        durationMs: 1,
      });
      expect(decision.allowedToolLevel).not.toBe("EXECUTE");
    }
  });
});

describe("سياسة التعلّم", () => {
  it("⚠️ الاعتماد الآلي ممنوع — لا استثناء ولا عتبة ثقة تفتحه", () => {
    expect(isAutoApprovalAllowed()).toBe(false);
  });

  it("keyword و entity منفَّذان، policy و code لا", () => {
    expect(isTypeImplemented("keyword")).toBe(true);
    expect(isTypeImplemented("entity")).toBe(true);
    expect(isTypeImplemented("policy")).toBe(false);
    expect(isTypeImplemented("code")).toBe(false);
  });

  it("يقبل مرشَّحاً بدعم كافٍ", () => {
    expect(checkCandidateEligibility(candidate(), 3, new Set()).eligible).toBe(true);
  });

  it("يرفض دعماً دون العتبة: مرّةٌ واحدة صدفة لا نمط", () => {
    expect(checkCandidateEligibility(candidate({ supportCount: 1 }), 3, new Set()).eligible).toBe(
      false,
    );
  });

  it("يرفض كلمة موجودة أصلاً في الذاكرة", () => {
    expect(checkCandidateEligibility(candidate(), 3, new Set(["تجديد"])).eligible).toBe(false);
  });

  it("يرفض الكلمات الوظيفية القصيرة — تتكرّر بلا أن تدلّ", () => {
    expect(checkCandidateEligibility(candidate({ subject: "ما" }), 3, new Set()).eligible).toBe(
      false,
    );
  });

  it("يرفض الأرقام المجرّدة: رقم طلبٍ ليس معرفة عامّة", () => {
    expect(checkCandidateEligibility(candidate({ subject: "123456" }), 3, new Set()).eligible).toBe(
      false,
    );
  });
});

describe("سجلّ الأدوات والصلاحيات", () => {
  it("⚠️ السجلّ الافتراضي **فارغ** — لا أداة EXECUTE واحدة مسجَّلة", () => {
    expect(createDefaultToolRegistry().size()).toBe(0);
    expect(createDefaultToolRegistry().list()).toEqual([]);
  });

  it("⚠️ التسجيل نفسه يرفض أي أداة فوق السقف", () => {
    const registry = createToolRegistry();
    const registered = registry.register({
      id: "activate_subscription",
      description: "تفعيل اشتراك",
      level: "EXECUTE",
      requiredArguments: [],
      invoke: async () => ({ ok: true, output: "", reason: "" }),
    });
    expect(registered.registered).toBe(false);
    expect(registered.reason).not.toBe("");
    expect(registry.size()).toBe(0);
  });

  it("الصلاحيات ترفض افتراضاً: وكيلٌ بلا أدوات مسموحة لا ينفّذ شيئاً", () => {
    expect(
      checkPermission("support-ticket-agent", "activate_subscription", "SUGGEST").granted,
    ).toBe(false);
  });

  it("وكيل مجهول مرفوض قطعاً", () => {
    expect(checkPermission("unknown-agent", "anything", "READ").granted).toBe(false);
  });
});
