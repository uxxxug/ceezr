/**
 * الغرض: قياس جدوى اقتراحات طبقة الذكاء الاصطناعي — حفظ القرار، والتقاط ما فعله
 *   البشر بعده بثلاث طرق: نقرة، واستنتاج آلي، وتوسيم يدوي.
 * الحالة: منفّذ فعلياً — أمر «فعّل الطبقة على عيّنة حقيقية وابدأ قياس الجدوى».
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: bots/support-dialog، scripts/agent-core-report.ts،
 *   ولوحة الإدارة حين تعرض جدوى الاقتراحات
 * ملاحظات مستقبلية: حين يُربط وكيل ثانٍ يبقى هذا الملف كما هو — `traceId` لا يعرف
 *   من أيّ وكيل جاء، وهو المقصود.
 *
 * ═══ لماذا القياس هنا لا داخل الطبقة ═══
 *
 * الطبقة تُقيّم نفسها بملفّاتها لتولّد مرشّحات تعلّم، وتلك نسخةٌ عاملة يجوز فقدها.
 * أمّا **الرقم الذي نحكم به على الطبقة فلا يجوز أن تكتبه الطبقة**، ولا أن يعيش في
 * قرصٍ يُمحى عند كل نشر. مصدر الحقيقة للقياس هو قاعدة البيانات، وهذا الملف بابها.
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** حكم على اقتراح. مطابق لـ `OutcomeVerdict` في الطبقة — والتطابق مقصود لا صدفة. */
export type AdviceVerdict = "accepted" | "rejected" | "ignored";

/** من أين جاء الحكم. تُفصَّل دلالة كلٍّ منها في الهجرة. */
export type AdviceVerdictSource = "button" | "manual" | "inferred";

export interface AgentDecisionRecord {
  readonly traceId: string;
  readonly ticketId: string;
  readonly agentId: string | null;
  readonly classification: string | null;
  readonly recommendedAction: string | null;
  readonly confidence: number;
  readonly allowedToolLevel: string;
  readonly published: boolean;
}

export interface AgentOutcomeInput {
  readonly traceId: string;
  readonly verdict: AdviceVerdict;
  readonly source: AdviceVerdictSource;
  readonly humanAction: string | null;
  /**
   * مطلوب للنقرة، ومهمَل لغيرها: نقرةٌ بلا هوية لا قيمة لها.
   * نصٌّ لا رقم — كسائر معرّفات تليجرام في المستودع، والتحويل لـ`bigint` في المحوّل وحده.
   */
  readonly actorTelegramId: string | null;
}

export interface AgentOutcomeReport {
  readonly recorded: boolean;
  /** `WEAKER_SOURCE` و`ALREADY_RECORDED` حالتان طبيعيتان لا أعطال. */
  readonly reason: string | null;
}

/** ما يحتاجه الاستنتاج الآلي ليقارن الفعل بالاقتراح. */
export interface AgentDecisionSnapshot {
  readonly traceId: string;
  readonly classification: string | null;
}

export interface AgentMeasurementPort {
  saveDecision(record: AgentDecisionRecord): Promise<Result<void, PortFailureError>>;
  recordOutcome(input: AgentOutcomeInput): Promise<Result<AgentOutcomeReport, PortFailureError>>;
  /** القرار المرتبط بتذكرة، إن وُجد. `null` حين لم تُنتج الطبقة اقتراحاً لها. */
  decisionForTicket(
    ticketId: string,
  ): Promise<Result<AgentDecisionSnapshot | null, PortFailureError>>;
}

/**
 * ما فعله الدعم بالتذكرة ← حكمٌ على الاقتراح.
 *
 * ═══ لماذا المقارنة على التصنيف لا على نصّ الردّ ═══
 *
 * نصّ الاقتراح جملةٌ عربية طويلة، ونصّ ما فعله الموظّف زرٌّ واحد. مقارنتهما حرفياً
 * تقيس تشابه الصياغة لا صواب الرأي. أمّا التصنيف فهو **ما يدّعيه الوكيل قابلاً
 * للتكذيب**: قال «مشكلة اشتراك» فإن فعّل الموظّف الاشتراك فقد صدق، وإن رفض التذكرة
 * فقد أخطأ.
 *
 * ⚠️ وهذا الاستنتاج **أضعف الثلاثة ويُعلَن ضعفه**: هو يرى أن الفعل وافق الاقتراح،
 * ولا يرى هل قرأه صاحبه أم وافقه صدفةً. ولذلك يُخزَّن مصدره `inferred`، ويُهمَل
 * كلّما وُجد حكم بشري — وهو ما تفرضه `record_agent_outcome` في القاعدة لا هذا الملف.
 */
export function inferVerdict(
  classification: string | null,
  resolution: "activate" | "reject" | "terminate",
): AdviceVerdict {
  // بلا تصنيف لا دعوى، وبلا دعوى لا صواب ولا خطأ.
  if (classification === null) return "ignored";

  if (classification === "subscription_issue") {
    return resolution === "activate" ? "accepted" : "rejected";
  }
  if (classification === "ride_dispute") {
    // النزاع لا يُحسم بتفعيل اشتراك: أيّ حسمٍ آخر موافقٌ لكون التذكرة نزاعاً.
    return resolution === "activate" ? "rejected" : "accepted";
  }
  // `general_inquiry` وأيّ تصنيف يُضاف لاحقاً: لا يُقابله فعلٌ في هذا المسار،
  // فلا يُحاكَم بما لا يخصّه. **ولا يُضاف هنا فرعٌ لتصنيف لم يُنتجه الوكيل بعد** —
  // قاعدةُ حكمٍ على تصنيفٍ لا وجود له تُختبَر ولا تُنفَّذ، فتبدو مصونة وهي مجهولة.
  return "ignored";
}

export interface RecordAdviceFeedbackInput {
  readonly traceId: string;
  readonly helpful: boolean;
  readonly actorTelegramId: string;
}

/** نقرة «مفيد» أو «غير مفيد» تحت الاقتراح. أوثق الأحكام الثلاثة. */
export async function recordAdviceFeedback(
  input: RecordAdviceFeedbackInput,
  port: AgentMeasurementPort,
): Promise<Result<AgentOutcomeReport, PortFailureError>> {
  return port.recordOutcome({
    traceId: input.traceId,
    verdict: input.helpful ? "accepted" : "rejected",
    source: "button",
    humanAction: null,
    actorTelegramId: input.actorTelegramId,
  });
}

export interface InferAdviceOutcomeInput {
  readonly ticketId: string;
  readonly resolution: "activate" | "reject" | "terminate";
}

/**
 * يُستدعى بعد حسم التذكرة. **لا يُفشل الحسم بحال** — يعود بتقرير لا بخطأ يوقف نداءه،
 * فالتذكرة حُسمت قبل أن يُستدعى، وقياسٌ فاته سطر أهون من حسمٍ تعطّل.
 */
export async function inferAdviceOutcome(
  input: InferAdviceOutcomeInput,
  port: AgentMeasurementPort,
): Promise<AgentOutcomeReport> {
  const found = await port.decisionForTicket(input.ticketId);
  if (!found.ok) return { recorded: false, reason: "LOOKUP_FAILED" };
  const decision = found.value;
  // لا اقتراح على هذه التذكرة أصلاً: لا شيء يُقاس، وهذه الحالة الغالبة حين تكون
  // الطبقة معطَّلة — فيمرّ المسار كلّه بلا أثر.
  if (decision === null) return { recorded: false, reason: "NO_DECISION" };

  const recorded = await port.recordOutcome({
    traceId: decision.traceId,
    verdict: inferVerdict(decision.classification, input.resolution),
    source: "inferred",
    humanAction: input.resolution,
    actorTelegramId: null,
  });
  if (!recorded.ok) return { recorded: false, reason: "WRITE_FAILED" };
  return recorded.value;
}

/** توسيم يدوي لاحق من صاحب المشروع على دفعة مصدَّرة. */
export async function applyManualLabel(
  input: {
    readonly traceId: string;
    readonly verdict: AdviceVerdict;
    readonly note: string | null;
  },
  port: AgentMeasurementPort,
): Promise<Result<AgentOutcomeReport, PortFailureError>> {
  const recorded = await port.recordOutcome({
    traceId: input.traceId,
    verdict: input.verdict,
    source: "manual",
    humanAction: input.note,
    actorTelegramId: null,
  });
  if (!recorded.ok) return err(recorded.error);
  return ok(recorded.value);
}
