/**
 * الغرض: اختبار الذاكرة ثلاثية الطبقات وحلقة التعلّم اليدوية: أن القصيرة **تفنى**
 *   فعلاً، وأن المتوسطة تنسى الأقدم عند الحدّ، وأن لا شيء يدخل الطويلة إلا بموافقة
 *   إنسان مُسمّى.
 * الحالة: اختبار وحدة فعلي — القسم د من أمر الطبقة المعزولة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على memory/ أو learning/
 * ملاحظات مستقبلية: عند نقل التخزين من ملفات إلى قاعدة تبقى هذه الاختبارات كما هي
 *   لأنها تختبر السلوك عبر `FileStore` لا عبر نظام الملفات.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApprovalFlow } from "../../packages/agent-core/learning/approvalFlow.ts";
import { createCandidateStore } from "../../packages/agent-core/learning/candidateStore.ts";
import { createLongTermMemory } from "../../packages/agent-core/memory/longTerm.ts";
import { createMediumTermMemory } from "../../packages/agent-core/memory/mediumTerm.ts";
import { createShortTermMemory } from "../../packages/agent-core/memory/shortTerm.ts";
import { createFileStore } from "../../packages/agent-core/memory/storage.ts";
import type { LearningCandidate } from "../../packages/agent-core/schemas.ts";

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "agent-core-"));
  return {
    store: createFileStore(root, () => undefined),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const NOW = () => new Date("2026-01-01T00:00:00.000Z");

function candidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    candidateId: "keyword:subscription_issue:موقوف",
    candidateType: "keyword",
    status: "pending",
    subject: "موقوف",
    label: "subscription_issue",
    supportCount: 5,
    rationale: "تكرّر في تذاكر مقبولة",
    createdAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

describe("الذاكرة قصيرة المدى", () => {
  it("تحفظ أثناء المعالجة وتُفرَّغ بالإفناء — لا تخزين بعدها إطلاقاً", () => {
    const memory = createShortTermMemory();
    memory.set("classification", "subscription_issue");
    memory.note("طابقت كلمة");
    expect(memory.get("classification")).toBe("subscription_issue");
    expect(memory.notes().length).toBe(1);

    memory.dispose();

    // ⚠️ هذا هو الفرق بين «قصيرة المدى» كخاصية معمارية و«قصيرة المدى» كوعد توثيقي.
    expect(memory.get("classification")).toBeUndefined();
    expect(memory.notes()).toEqual([]);
    expect(memory.entries()).toEqual({});
  });
});

describe("الذاكرة متوسّطة المدى", () => {
  it("تحفظ ثم تُقرأ", () => {
    const { store, cleanup } = tempStore();
    const memory = createMediumTermMemory(store, 5000);
    memory.append({
      traceId: "t-1",
      eventType: "support_ticket_opened",
      agentId: "support-ticket-agent",
      classification: "subscription_issue",
      status: "suggested",
      confidence: 0.8,
      matchedKeywords: ["اشتراك"],
      tokens: ["اشتراكي", "منتهي"],
      textLength: 20,
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(memory.all().length).toBe(1);
    cleanup();
  });

  it("نافذة متدحرجة: الأقدم يُنسى عند بلوغ الحدّ", () => {
    const { store, cleanup } = tempStore();
    const memory = createMediumTermMemory(store, 3);
    for (let index = 0; index < 10; index += 1) {
      memory.append({
        traceId: `t-${index}`,
        eventType: "support_ticket_opened",
        agentId: "support-ticket-agent",
        classification: "general_inquiry",
        status: "suggested",
        confidence: 0.6,
        matchedKeywords: [],
        tokens: [],
        textLength: 5,
        recordedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    const all = memory.all();
    expect(all.length).toBeLessThanOrEqual(3);
    // الباقي هو الأحدث لا الأقدم
    expect(all.at(-1)?.traceId).toBe("t-9");
    cleanup();
  });

  it("⚠️ لا تحفظ نصّ التذكرة الخام — الطول فقط", () => {
    const { store, cleanup } = tempStore();
    const memory = createMediumTermMemory(store, 100);
    memory.append({
      traceId: "t-1",
      eventType: "support_ticket_opened",
      agentId: "support-ticket-agent",
      classification: "ride_dispute",
      status: "suggested",
      confidence: 0.7,
      matchedKeywords: [],
      tokens: [],
      textLength: 99,
      recordedAt: "2026-01-01T00:00:00.000Z",
    });
    const entry = memory.all()[0];
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {})).not.toContain("text");
    cleanup();
  });
});

describe("الذاكرة طويلة المدى", () => {
  it("تبدأ ببذرة معرفة فلا يبدأ الوكيل أعمى", () => {
    const { store, cleanup } = tempStore();
    const memory = createLongTermMemory(store, NOW);
    expect(memory.keywords().length).toBeGreaterThan(0);
    cleanup();
  });

  it("المخزَّن يغلب البذرة عند التعارض", () => {
    const { store, cleanup } = tempStore();
    const first = createLongTermMemory(store, NOW);
    const seeded = first.keywords()[0];
    expect(seeded).toBeDefined();
    if (seeded !== undefined) {
      first.upsertKeyword({ ...seeded, weight: 0.11 });
      const reopened = createLongTermMemory(store, NOW);
      const found = reopened.keywords().find((entry) => entry.keyword === seeded.keyword);
      expect(found?.weight).toBe(0.11);
    }
    cleanup();
  });

  it("تنجو من إعادة الفتح: فقدانها عودة لحالة بلا معرفة سابقة لا كسر", () => {
    const { store, cleanup } = tempStore();
    createLongTermMemory(store, NOW).upsertEntity({
      name: "الرياض",
      kind: "city",
      aliases: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(createLongTermMemory(store, NOW).entities().length).toBe(1);
    cleanup();
  });
});

describe("⚠️ حلقة التعلّم — الموافقة البشرية", () => {
  it("المرشَّح يبقى معلَّقاً حتى يفصل فيه إنسان", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    candidates.upsert(candidate());
    expect(candidates.pending().length).toBe(1);
    // لا شيء دخل الذاكرة الطويلة بعد
    const memory = createLongTermMemory(store, NOW);
    expect(memory.keywords().some((entry) => entry.keyword === "موقوف")).toBe(false);
    cleanup();
  });

  it("⚠️ لا اعتماد بلا اسم من اعتمده — حتى لو المرشَّح سليم", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    candidates.upsert(candidate());
    const flow = createApprovalFlow(candidates, createLongTermMemory(store, NOW), NOW);
    expect(flow.approve(candidate().candidateId, "   ").ok).toBe(false);
    expect(flow.approve(candidate().candidateId, "").ok).toBe(false);
    cleanup();
  });

  it("الاعتماد باسمٍ يكتب في الذاكرة الطويلة فعلاً", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    candidates.upsert(candidate());
    const memory = createLongTermMemory(store, NOW);
    const flow = createApprovalFlow(candidates, memory, NOW);

    const outcome = flow.approve(candidate().candidateId, "نورة");
    expect(outcome.ok).toBe(true);
    expect(memory.keywords().some((entry) => entry.keyword === "موقوف")).toBe(true);
    // الحالة تنتقل إلى applied لا approved: الفرق بين قرارٍ وقع وكتابةٍ نجحت.
    expect(candidates.byId(candidate().candidateId)?.status).toBe("applied");
    expect(candidates.byId(candidate().candidateId)?.decidedBy).toBe("نورة");
    cleanup();
  });

  it("⚠️ نوع غير منفَّذ يُرفض ولو وافق مراجع — policy لا تمرّ", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    const policyCandidate = candidate({
      candidateId: "policy:x",
      candidateType: "policy",
      subject: "ارفع العتبة",
    });
    candidates.upsert(policyCandidate);
    const flow = createApprovalFlow(candidates, createLongTermMemory(store, NOW), NOW);
    expect(flow.approve("policy:x", "نورة").ok).toBe(false);
    cleanup();
  });

  it("المرفوض لا يُحيا مجدّداً بتكراره", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    candidates.upsert(candidate());
    const flow = createApprovalFlow(candidates, createLongTermMemory(store, NOW), NOW);
    flow.reject(candidate().candidateId, "نورة", "كلمة عامّة");

    candidates.upsert(candidate({ supportCount: 99 }));
    expect(candidates.pending().length).toBe(0);
    expect(candidates.byId(candidate().candidateId)?.status).toBe("rejected");
    cleanup();
  });

  it("لا يُفصل في مرشَّح مرّتين", () => {
    const { store, cleanup } = tempStore();
    const candidates = createCandidateStore(store);
    candidates.upsert(candidate());
    const flow = createApprovalFlow(candidates, createLongTermMemory(store, NOW), NOW);
    expect(flow.approve(candidate().candidateId, "نورة").ok).toBe(true);
    expect(flow.approve(candidate().candidateId, "نورة").ok).toBe(false);
    cleanup();
  });
});
