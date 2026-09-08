/**
 * الغرض: تحديد ما ينقص الوكيلَ ليقرّر بثقة أعلى — وقوله صراحةً بدل تعويضه بالحدس.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/planning
 * يُتوقع أن يستخدمه لاحقاً: agents/supportTicketAgent.ts، confidencePolicy
 * ملاحظات مستقبلية: يوم تُفتح أداة `READ` واحدة، يصير النقص المكتشَف هنا **طلب
 *   قراءة** لا مجرّد ملاحظة: «ينقص حالة الاشتراك» تصير استدعاءً يجلبها. اليوم
 *   يُقال النقص ويُخصم من الثقة، وهذا كل ما يجوز.
 *
 * ═══ لماذا يُقال النقص بدل أن يُملأ ═══
 *
 * لأن وكيلاً يُكمل الناقص بالمرجّح يُنتج اقتراحاً يبدو واثقاً بلا أساس، وموظّف
 * الدعم لا يرى ما بُني عليه. حين يُذكر النقص صراحةً ويُخصم من الثقة، يعرف القارئ
 * أن هذا اقتراحٌ ناقص المعطيات فيتحقّق — وهذا هو الفرق بين مساعدةٍ ومضلّل.
 */

import type { KnowledgeMatch } from "../knowledge/knowledgeSearch.ts";
import type { EventPayload } from "../schemas.ts";
import type { TaskAnalysis } from "./taskAnalyzer.ts";

export interface MissingDataInput {
  readonly event: EventPayload;
  readonly analysis: TaskAnalysis;
  readonly classification: string | null;
  readonly matches: readonly KnowledgeMatch[];
  readonly matchedKeywords: readonly string[];
}

/** درجة تحت هذا الحدّ تعني أن أقرب مستند ليس قريباً فعلاً. */
const WEAK_MATCH_SCORE = 0.4;
/** نصٌّ أقصر من هذا نادراً ما يحمل تفاصيل تكفي للتحقّق. */
const SHORT_TEXT_LENGTH = 25;

/**
 * ما يُعاد هنا يُخصم من الثقة في `confidencePolicy` — فكل بند يُضاف له كلفة.
 * ولذلك القائمة **مقصورة على ما يُغيّر القرار فعلاً** لا كل ما يمكن تخيّل نقصه:
 * قائمةٌ طويلة تُصفّر ثقة كل اقتراح فتُعطّل الطبقة عملياً بينما تبدو دقيقة.
 */
export function detectMissingData(input: MissingDataInput): readonly string[] {
  const missing: string[] = [];

  if (!input.analysis.analyzable) {
    missing.push("نصّ التذكرة لا يحمل تفاصيل كافية");
    return missing; // ما دام النصّ غير قابل للتحليل فبقية البنود ضجيج
  }

  if (input.classification === null) {
    missing.push("لا تصنيف — لم تُطابَق كلمة مفتاحية معروفة");
  } else if (input.matchedKeywords.length === 1) {
    missing.push("التصنيف مبنيّ على كلمة واحدة فقط");
  }

  const best = input.matches[0];
  if (best === undefined) {
    missing.push("لا مستند معرفة مطابق");
  } else if (best.score < WEAK_MATCH_SCORE) {
    missing.push(`أقرب مستند معرفة ضعيف المطابقة (${best.score})`);
  }

  if (input.event.text.trim().length < SHORT_TEXT_LENGTH) {
    missing.push("نصّ التذكرة قصير — قد ينقصه سياق");
  }

  // مرجع الطلب: بلا رقم طلب لا يستطيع موظّف الدعم التحقّق من نزاع رحلة، فيصير
  // الاقتراح صحيحاً في العموم وغير قابل للتطبيق على هذه الحالة.
  if (input.classification === "ride_dispute") {
    // `attributes` قيمها بدائية لا نصّية حتماً — تُطبَّع قبل الفحص بدل أن يُفترض شكلها.
    const reference = input.event.attributes.order_id;
    const hasReference =
      (reference !== undefined && reference !== null && String(reference).trim() !== "") ||
      /\b\d{4,}\b/.test(input.event.text);
    if (!hasReference) missing.push("لا مرجع طلب يُتحقَّق منه");
  }

  return missing;
}
