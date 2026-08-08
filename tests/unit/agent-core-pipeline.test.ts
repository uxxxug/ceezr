/**
 * الغرض: اختبار المسار الكامل داخل الطبقة — من `EventPayload` إلى `DecisionResult`
 *   عبر البوّابة — و**اختبار العزل الإلزامي**: أن التعطيل يعني غياباً تامّاً لا فرعاً
 *   معطّلاً.
 * الحالة: اختبار وحدة فعلي — القسم د من أمر الطبقة المعزولة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على gateway.ts أو core.ts
 * ملاحظات مستقبلية: عند إضافة وكيل ثانٍ تُضاف حالاته هنا، ويبقى اختبار العزل كما هو
 *   لأنه عن **الطبقة** لا عن وكيل بعينه.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCoreConfig } from "../../packages/agent-core/config.ts";
import { DEFAULT_CONFIG, loadConfig } from "../../packages/agent-core/config.ts";
import { createAgentCore } from "../../packages/agent-core/gateway.ts";
import type { EventPayload } from "../../packages/agent-core/schemas.ts";

const KNOWLEDGE_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "packages",
  "agent-core",
  "knowledge_base",
);

function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "agent-core-pipeline-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function enabledConfig(root: string): AgentCoreConfig {
  return {
    ...DEFAULT_CONFIG,
    enabled: true,
    persistenceEnabled: true,
    runtimeRoot: root,
    knowledgeRoot: KNOWLEDGE_ROOT,
  };
}

let counter = 0;
function nextCount(): number {
  counter += 1;
  return counter;
}
const deterministicTraceId = () => `trace-${nextCount()}`;

function ticket(text: string, attributes: EventPayload["attributes"] = {}): EventPayload {
  return {
    eventId: `ticket-${counter}`,
    eventType: "support_ticket_opened",
    occurredAt: "2026-01-01T00:00:00.000Z",
    source: "support_tickets",
    text,
    attributes,
  };
}

describe("⚠️ اختبار العزل الإلزامي — الطبقة معطَّلة", () => {
  it("الافتراض هو التعطيل: لا تعمل الطبقة إلا بقرار صريح", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(false);
    expect(loadConfig({}).enabled).toBe(false);
    // لا شيء غير النصّ الحرفي "true" يُفعّلها — لا "1" ولا "TRUE" ولا "yes"
    expect(loadConfig({ AGENT_CORE_ENABLED: "1" }).enabled).toBe(false);
    expect(loadConfig({ AGENT_CORE_ENABLED: "yes" }).enabled).toBe(false);
    expect(loadConfig({ AGENT_CORE_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(loadConfig({ AGENT_CORE_ENABLED: "true" }).enabled).toBe(true);
  });

  it("⚠️ معطَّلة: تعود بقرار فارغ ولا تقرأ ولا تكتب ولا تُنشئ مجلّداً", () => {
    const { root, cleanup } = tempRoot();
    const before = readdirSync(root);

    const core = createAgentCore({
      config: { ...enabledConfig(root), enabled: false },
      newTraceId: deterministicTraceId,
    });

    expect(core.enabled).toBe(false);
    // المجلّد كما تُرك: **لا أثر واحد** على النظام.
    expect(readdirSync(root)).toEqual(before);
    expect(existsSync(join(root, "memory"))).toBe(false);
    expect(existsSync(join(root, "experience"))).toBe(false);
    cleanup();
  });

  it("⚠️ معطَّلة: `process` تعود فوراً بقرار «معطَّلة» بلا صلاحية ولا اقتراح", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({
      config: { ...enabledConfig(root), enabled: false },
      newTraceId: deterministicTraceId,
    });

    const decision = await core.process(ticket("اشتراكي منتهي وما أقدر أستقبل طلبات"));

    expect(decision.status).not.toBe("suggested");
    expect(decision.recommendedAction).toBeNull();
    expect(decision.allowedToolLevel).toBe("NONE");
    // ولا سطر كُتب
    expect(readdirSync(root)).toEqual([]);
    cleanup();
  });

  it("⚠️ معطَّلة: كل الأبواب الأخرى مغلقة أيضاً — لا باب خلفي", () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({
      config: { ...enabledConfig(root), enabled: false },
      newTraceId: deterministicTraceId,
    });

    expect(core.recordOutcome("t", "accepted", null)).toBe(false);
    expect(core.generateCandidates()).toEqual([]);
    expect(core.listPendingCandidates()).toEqual([]);
    expect(core.approveCandidate("x", "نورة").ok).toBe(false);
    expect(core.rejectCandidate("x", "نورة", "").ok).toBe(false);
    expect(core.evaluate().verdict).toBe("insufficient_data");
    expect(readdirSync(root)).toEqual([]);
    cleanup();
  });
});

describe("المسار الكامل — الطبقة مفعّلة", () => {
  it("مشكلة اشتراك: تُصنَّف ويُقترح ردّ بمستوى SUGGEST", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });

    const decision = await core.process(
      ticket("اشتراكي انتهت باقته ودفعت تجديد ولين الحين ما تفعّل", {
        ticket_type: "subscription",
      }),
    );

    expect(decision.status).toBe("suggested");
    expect(decision.classification).toBe("subscription_issue");
    expect(decision.recommendedAction).not.toBeNull();
    // ⚠️ **أهمّ توكيد في هذا الملف**: لا شيء فوق SUGGEST يخرج من الطبقة.
    expect(decision.allowedToolLevel).toBe("SUGGEST");
    expect(decision.evidence.length).toBeGreaterThan(0);
    cleanup();
  });

  it("نزاع رحلة يُصنَّف تصنيفه", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const decision = await core.process(
      ticket("السائق ألغى الرحلة بعد ما وصل والأجرة انخصمت رقم الطلب 88213", {
        ticket_type: "ride_dispute",
      }),
    );
    expect(decision.classification).toBe("ride_dispute");
    cleanup();
  });

  it("نصّ غامض: لا يُخترع تصنيف ولا يُعرض اقتراح ضعيف", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const decision = await core.process(ticket("؟؟؟"));
    expect(decision.status).not.toBe("suggested");
    expect(decision.recommendedAction).toBeNull();
    cleanup();
  });

  it("نصّ فارغ لا يكسر شيئاً", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const decision = await core.process(ticket(""));
    expect(decision.status).not.toBe("failed");
    expect(decision.allowedToolLevel).not.toBe("EXECUTE");
    cleanup();
  });

  it("حدث محجوز (رصد شذوذ) لا وكيل له فيعود no_decision بلا كسر", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const decision = await core.process({
      ...ticket("قفزة غير معتادة"),
      eventType: "operational_anomaly_detected",
    });
    expect(decision.status).toBe("no_decision");
    expect(decision.recommendedAction).toBeNull();
    cleanup();
  });

  it("حتمية: النصّ نفسه يُنتج التصنيف نفسه والثقة نفسها", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const text = "اشتراكي منتهي وأبغى أجدد الباقة";
    const first = await core.process(ticket(text));
    const second = await core.process(ticket(text));
    expect(second.classification).toBe(first.classification);
    expect(second.confidence).toBe(first.confidence);
    cleanup();
  });

  it("لا يرمي أبداً — حتى مع حدث مشوّه تماماً", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });
    const decision = await core.process({
      eventId: "",
      eventType: "nonsense" as never,
      occurredAt: "not-a-date",
      source: "",
      text: "\u0000\u202E",
      attributes: {},
    } satisfies EventPayload);
    expect(decision).toBeDefined();
    expect(decision.allowedToolLevel).toBe("NONE");
    cleanup();
  });
});

describe("التجربة والنتيجة والتقييم", () => {
  it("يُسجَّل القرار ثم تُسجَّل نتيجته ثم يُقيَّم", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });

    const decision = await core.process(
      ticket("اشتراكي منتهي ودفعت ومو متفعّل", { ticket_type: "subscription" }),
    );
    expect(decision.status).toBe("suggested");

    core.recordOutcome(decision.traceId, "accepted", "فعّل الاشتراك");
    const report = core.evaluate();

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.accepted).toBe(1);
    // أقلّ من الحدّ الأدنى للحكم: **لا حكم** بدل حكمٍ من عيّنة واحدة.
    expect(report.verdict).toBe("insufficient_data");
    cleanup();
  });

  it("⚠️ التعلّم لا يُنتج شيئاً معتمَداً تلقائياً مهما تكرّر النمط", async () => {
    const { root, cleanup } = tempRoot();
    const core = createAgentCore({ config: enabledConfig(root), newTraceId: deterministicTraceId });

    for (let index = 0; index < 12; index += 1) {
      const decision = await core.process(
        ticket("اشتراكي منتهي والمحفظة مرفوضة عند التجديد", { ticket_type: "subscription" }),
      );
      core.recordOutcome(decision.traceId, "accepted", "فعّل");
    }

    core.generateCandidates();
    const pending = core.listPendingCandidates();

    // مهما بلغ التكرار: كلّها **معلَّقة**، ولا واحد منها دخل الذاكرة الطويلة.
    for (const item of pending) expect(item.status).toBe("pending");
    cleanup();
  });
});
