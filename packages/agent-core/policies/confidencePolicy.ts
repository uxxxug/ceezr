/**
 * الغرض: الحكم على كفاية ثقة الوكيل — هل يُعرض اقتراحه على إنسان أم لا.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/policies
 * يُتوقع أن يستخدمه لاحقاً: core.ts بعد الوكيل مباشرة
 * ملاحظات مستقبلية: العتبة اليوم رقمٌ ثابت في الإعداد. حين تتراكم بيانات القبول
 *   الحقيقي تُضبط من `evaluation/scoring.ts` — العتبة الصحيحة تُقاس بفجوة
 *   المعايرة لا تُختار بالحدس.
 *
 * ═══ لماذا سياسة مستقلّة عن الوكيل ═══
 *
 * لأن من ينتج الحكم لا يجوز أن يكون هو من يُجيزه. لو أدرج الوكيل عتبته بنفسه
 * لصار رفع ثقته ورفع عتبته تعديلاً واحداً — أي أن الرقابة تُعدَّل مع المُراقَب.
 * الفصل هنا هو ما يجعل ضبط العتبة قراراً يُرى في المراجعة على حدة.
 */

import type { AgentProposal } from "../schemas.ts";

export interface ConfidenceVerdict {
  readonly sufficient: boolean;
  readonly reason: string;
  readonly threshold: number;
  /** الثقة بعد الخصومات — قد تقلّ عمّا أعلنه الوكيل. */
  readonly effectiveConfidence: number;
}

/**
 * نقصُ بياناتٍ يخصم من الثقة ولا يُلغيها: وكيلٌ صنّف بأدلّة قوية وينقصه حقلٌ
 * ثانوي ما زال اقتراحه نافعاً، لكنه أقلّ يقيناً ممّن لا ينقصه شيء.
 */
const MISSING_DATA_PENALTY = 0.1;
/** خصمٌ أثقل لغياب الدليل بالكامل: تصنيفٌ بلا دليل حدسٌ لا استنتاج. */
const NO_EVIDENCE_PENALTY = 0.25;

export function evaluateConfidence(proposal: AgentProposal, threshold: number): ConfidenceVerdict {
  if (proposal.classification === null) {
    return {
      sufficient: false,
      reason: "الوكيل لم يستطع تصنيف الحدث",
      threshold,
      effectiveConfidence: 0,
    };
  }

  if (proposal.recommendedAction.trim() === "") {
    return {
      sufficient: false,
      reason: "لا نصّ اقتراح — لا شيء يُعرض على إنسان",
      threshold,
      effectiveConfidence: proposal.confidence,
    };
  }

  const penalties =
    proposal.missingData.length * MISSING_DATA_PENALTY +
    (proposal.evidence.length === 0 ? NO_EVIDENCE_PENALTY : 0);
  const effective = Math.max(0, Number((proposal.confidence - penalties).toFixed(4)));

  if (effective < threshold) {
    return {
      sufficient: false,
      reason:
        `الثقة الفعلية ${effective} دون العتبة ${threshold}` +
        (penalties > 0 ? ` (خُصم ${Number(penalties.toFixed(4))} لنقص بيانات أو أدلّة)` : ""),
      threshold,
      effectiveConfidence: effective,
    };
  }

  return {
    sufficient: true,
    reason: `الثقة الفعلية ${effective} تبلغ العتبة ${threshold}`,
    threshold,
    effectiveConfidence: effective,
  };
}
