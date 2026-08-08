/**
 * الغرض: القرار الآمن الذي تعود به الطبقة في كل حالة لا تستطيع فيها أن تقرّر —
 *   معطَّلة، أو مرفوضة من حارس، أو عاجزة عن الثقة، أو منهارة بعطل غير متوقَّع.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.1.
 * ينتمي إلى: packages/agent-core
 * يُتوقع أن يستخدمه لاحقاً: gateway.ts، core.ts، وأي مسار خروج مبكر
 * ملاحظات مستقبلية: عند التوزيع يُسجَّل لكل تفعيل fallback مقياسٌ فوري (معدّل
 *   التراجع دليلُ صحّة أفضل من معدّل النجاح، لأنه يرتفع قبل أن ينهار شيء). اليوم
 *   سجلّ محلي فقط.
 *
 * المبدأ الحاكم: **التراجع هنا ليس خطأً بل ناتجٌ صالح.** كل دالة أدناه تُعيد
 * `DecisionResult` كامل الشكل، فلا يوجد في هذه الطبقة مسارٌ واحد يعود بـ
 * `undefined` أو يرمي استثناءً إلى المشروع الأساسي. المنصّة لا تتأثّر بما يحدث
 * هنا، وهذا هو تعريف العزل.
 */

import type { DecisionResult, DecisionStatus, EventPayload } from "./schemas.ts";

interface FallbackInput {
  readonly traceId: string;
  readonly eventId: string;
  readonly status: DecisionStatus;
  readonly reason: string;
  readonly agentId?: string | null;
  readonly durationMs?: number;
}

/** القرار الأساسي الفارغ: لا اقتراح، لا صلاحية، لا ثقة. */
function base(input: FallbackInput): DecisionResult {
  return {
    traceId: input.traceId,
    eventId: input.eventId,
    status: input.status,
    agentId: input.agentId ?? null,
    classification: null,
    recommendedAction: null,
    confidence: 0,
    // `NONE` لا `SUGGEST`: قرارٌ لم يُتَّخذ لا يمنح صلاحية، ولو كانت صلاحية قراءة.
    allowedToolLevel: "NONE",
    evidence: [],
    missingData: [],
    reason: input.reason,
    durationMs: input.durationMs ?? 0,
  };
}

/** الطبقة مطفأة بالإعداد — المسار الأكثر توقّعاً، لا الأقلّ. */
export function disabledResult(traceId: string, eventId: string): DecisionResult {
  return base({
    traceId,
    eventId,
    status: "no_decision",
    reason: "طبقة الذكاء معطَّلة بالإعداد (AGENT_CORE_ENABLED)",
  });
}

/** لا وكيل مسجَّل لهذا النوع من الأحداث — حالة متوقَّعة لا عطل. */
export function noAgentResult(
  traceId: string,
  eventId: string,
  eventType: string,
  durationMs: number,
): DecisionResult {
  return base({
    traceId,
    eventId,
    status: "no_decision",
    reason: `لا وكيل مسجَّل للنوع ${eventType}`,
    durationMs,
  });
}

/** حارسٌ رفض. السبب يُنقَل كما هو كي يُقرأ في السجلّ بلا ترجمة. */
export function blockedResult(
  traceId: string,
  eventId: string,
  reason: string,
  durationMs: number,
): DecisionResult {
  return base({ traceId, eventId, status: "blocked", reason, durationMs });
}

/** الثقة دون العتبة أو نقصت بيانات جوهرية: نُبقي الأدلّة، فهي تشرح لماذا لم نثق. */
export function lowConfidenceResult(input: {
  readonly traceId: string;
  readonly eventId: string;
  readonly agentId: string;
  readonly confidence: number;
  readonly classification: string | null;
  readonly evidence: DecisionResult["evidence"];
  readonly missingData: readonly string[];
  readonly reason: string;
  readonly durationMs: number;
}): DecisionResult {
  return {
    ...base({
      traceId: input.traceId,
      eventId: input.eventId,
      status: "insufficient_confidence",
      reason: input.reason,
      agentId: input.agentId,
      durationMs: input.durationMs,
    }),
    classification: input.classification,
    confidence: input.confidence,
    evidence: input.evidence,
    missingData: input.missingData,
  };
}

/**
 * عطل غير متوقَّع. **هذا المسار هو آخر سدّ**: لا شيء يمرّ من ورائه إلى المشروع
 * الأساسي. رسالة الخطأ تُقصَر عمداً — استثناء طويل قد يحمل نصّ مستخدم أو مساراً
 * داخلياً، وكلاهما لا مكان له في قيمة تعود لطبقة أخرى.
 */
export function failureResult(
  traceId: string,
  eventId: string,
  error: unknown,
  durationMs: number,
): DecisionResult {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  return base({
    traceId,
    eventId,
    status: "failed",
    reason: `عطل داخلي في طبقة الذكاء: ${trimmed}`,
    durationMs,
  });
}

/**
 * يلفّ أي عملية داخلية قد ترمي، فيُعيد بديلاً بدل أن يتسرّب الاستثناء. كل نداء
 * ملفّ أو قراءة معرفة في هذه الطبقة يمرّ من هنا: العجز عن قراءة ملف ذاكرة تجريبي
 * لا يجوز أن يمنع تصنيف تذكرة، فضلاً عن أن يمسّ المنصّة.
 */
export async function guarded<T>(
  operation: () => Promise<T>,
  onFailure: T,
  log?: (message: string, meta: Record<string, unknown>) => void,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    log?.("agent_core.guarded_failure", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return onFailure;
  }
}

/** نسخة متزامنة من `guarded` لعمليات الملفات المتزامنة. */
export function guardedSync<T>(
  operation: () => T,
  onFailure: T,
  log?: (message: string, meta: Record<string, unknown>) => void,
): T {
  try {
    return operation();
  } catch (error) {
    log?.("agent_core.guarded_failure", {
      detail: error instanceof Error ? error.message : String(error),
    });
    return onFailure;
  }
}

/** يُستعمل في السجلّ: وسمٌ مختصر للحدث بلا نصّه، فالنصّ قد يكون شكوى شخصية. */
export function eventTag(event: EventPayload): Record<string, unknown> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    source: event.source,
    textLength: event.text.length,
  };
}
