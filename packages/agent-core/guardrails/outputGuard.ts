/**
 * الغرض: فحص الاقتراح قبل خروجه من الطبقة. آخر نقطة قبل أن يقرأه إنسان.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/guardrails
 * يُتوقع أن يستخدمه لاحقاً: core.ts (آخر خطوة قبل الإرجاع)
 * ملاحظات مستقبلية: عند وصل نموذج توليدي حقيقي تصير هذه الطبقة **الأهمّ في
 *   الملف كله**: نصٌّ مطابَق من `knowledge_base/` محدود بما كُتب فيه، ونصٌّ
 *   مولَّد غير محدود بشيء. تُضاف حينها فحوص الادّعاء والالتزام بالمصدر.
 *
 * لماذا يُفحص مُخرَجٌ مصدرُه ملفاتنا: لأن الاقتراح يمرّ عليه نصّ المستخدم أيضاً
 * (اقتباساً في الأدلّة)، ولأن الحارس الذي يُبنى بعد أن يصير المُخرَج خطيراً
 * يُبنى تحت ضغط الحادثة. يُبنى الآن وهو رخيص.
 */

import type { AgentProposal } from "../schemas.ts";
import { MAX_ALLOWED_TOOL_LEVEL, toolLevelRank } from "../schemas.ts";

export interface OutputVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly sanitized: AgentProposal;
  readonly adjustments: readonly string[];
}

export interface OutputGuardOptions {
  readonly maxLength: number;
  readonly maxEvidence: number;
  readonly maxExcerptLength: number;
}

export const DEFAULT_OUTPUT_GUARD_OPTIONS: OutputGuardOptions = {
  maxLength: 2000,
  maxEvidence: 5,
  maxExcerptLength: 240,
};

/**
 * أنماط لا يجوز أن تخرج في نصّ يُعرض. الرقم السعودي والبريد يظهران في نصّ
 * الشكوى نفسه، وإعادة عرضهما في اقتراحٍ يُنشر في مجموعة دعم تسريبٌ لا لزوم له.
 */
const SENSITIVE_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:\+?966|0)5\d{8}\b/g, label: "رقم جوال" },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/g, label: "بريد إلكتروني" },
  { pattern: /\b\d{10}\b/g, label: "رقم هوية محتمل" },
  { pattern: /\b(?:gh[pousr]|sk|pk)_[A-Za-z0-9]{16,}\b/g, label: "رمز وصول" },
];

/** مؤشّرات على أن نصّاً يحاول أن يُقرأ كأمر لا كاقتراح. */
const INSTRUCTION_MARKERS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?previous\s+instructions/i,
  /تجاهل\s+(?:كل\s+)?التعليمات/i,
  /system\s*prompt/i,
];

function redact(value: string): { text: string; found: string[] } {
  let text = value;
  const found: string[] = [];
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      found.push(label);
      text = text.replace(pattern, "[محجوب]");
    }
    pattern.lastIndex = 0; // الأنماط عامة (`g`) فتحتفظ بموضعها بين النداءات
  }
  return { text, found };
}

/**
 * **الفحص الحاكم أوّلاً**: أي طلب صلاحية فوق السقف يُرفض رفضاً كاملاً لا يُخفَّض.
 * التخفيض الصامت يُنتج وكيلاً يطلب `EXECUTE` في كل مرّة ويُخفَّض في كل مرّة، فلا
 * يظهر أن هناك خللاً حتى يُرفع السقف يوماً فينفَّذ ما كان يُطلب طوال الوقت.
 */
export function inspectOutput(
  proposal: AgentProposal,
  overrides: Partial<OutputGuardOptions> = {},
): OutputVerdict {
  const options: OutputGuardOptions = { ...DEFAULT_OUTPUT_GUARD_OPTIONS, ...overrides };

  if (toolLevelRank(proposal.requestedToolLevel) > toolLevelRank(MAX_ALLOWED_TOOL_LEVEL)) {
    return {
      allowed: false,
      reason: `الوكيل ${proposal.agentId} طلب ${proposal.requestedToolLevel} والسقف ${MAX_ALLOWED_TOOL_LEVEL}`,
      sanitized: proposal,
      adjustments: [],
    };
  }

  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    return {
      allowed: false,
      reason: `ثقة خارج المدى [0,1]: ${String(proposal.confidence)}`,
      sanitized: proposal,
      adjustments: [],
    };
  }

  const adjustments: string[] = [];

  const marker = INSTRUCTION_MARKERS.find((pattern) => pattern.test(proposal.recommendedAction));
  if (marker !== undefined) {
    return {
      allowed: false,
      reason: "الاقتراح يحوي ما يُقرأ كتعليمة لا كنصّ",
      sanitized: proposal,
      adjustments: [],
    };
  }

  const { text: redacted, found } = redact(proposal.recommendedAction);
  if (found.length > 0) adjustments.push(`حُجب: ${found.join("، ")}`);

  let action = redacted.replace(/\s+/g, " ").trim();
  if (action.length > options.maxLength) {
    action = `${action.slice(0, options.maxLength)}…`;
    adjustments.push(`قُصّ الاقتراح إلى ${options.maxLength} محرفاً`);
  }

  const evidence = proposal.evidence.slice(0, options.maxEvidence).map((item) => {
    const cleaned = redact(item.excerpt).text.replace(/\s+/g, " ").trim();
    return {
      ...item,
      excerpt:
        cleaned.length > options.maxExcerptLength
          ? `${cleaned.slice(0, options.maxExcerptLength)}…`
          : cleaned,
    };
  });
  if (proposal.evidence.length > options.maxEvidence) {
    adjustments.push(`أُبقيت ${options.maxEvidence} أدلّة من ${proposal.evidence.length}`);
  }

  return {
    allowed: true,
    reason: null,
    sanitized: { ...proposal, recommendedAction: action, evidence },
    adjustments,
  };
}
