/**
 * الغرض: قراءة الحدث وتحديد ما هو مطلوب فعلاً منه — قبل أي تصنيف أو بحث.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/planning
 * يُتوقع أن يستخدمه لاحقاً: planner.ts، وwكيل الدعم
 * ملاحظات مستقبلية: عند وصل نموذج حقيقي يصير التحليل استخراجاً دلالياً للنيّة
 *   بدل قراءة إشارات سطحية. **العقد `TaskAnalysis` هو نفسه**.
 *
 * لماذا التحليل منفصل عن التصنيف: التصنيف يقول «هذه مشكلة اشتراك»، والتحليل يقول
 * «هذا سؤال لا شكوى» أو «هذا نصّ لا يحمل ما يُصنَّف أصلاً». الفصل يجعل تذكرةً
 * فارغةً تُعرف فارغةً بلا أن تُصنَّف عشوائياً بأقرب كلمة صادفتها.
 */

import { tokenize } from "../knowledge/knowledgeIndex.ts";
import type { EventPayload } from "../schemas.ts";

export type TaskIntent = "question" | "complaint" | "request" | "unclear";

export interface TaskAnalysis {
  readonly intent: TaskIntent;
  readonly tokens: readonly string[];
  /** هل في النصّ ما يكفي لمحاولة تصنيفه أصلاً؟ */
  readonly analyzable: boolean;
  readonly rationale: string;
}

/** أقلّ عدد توكِنات ذات معنى قبل أن تُعدّ محاولة التصنيف مجديةً. */
const MIN_MEANINGFUL_TOKENS = 2;

const QUESTION_MARKERS: readonly string[] = [
  "كيف",
  "متى",
  "اين",
  "أين",
  "لماذا",
  "هل",
  "ماهي",
  "ايش",
  "وش",
  "?",
  "؟",
  "how",
  "when",
  "where",
  "why",
  "what",
];
const COMPLAINT_MARKERS: readonly string[] = [
  "مشكله",
  "مشكلة",
  "شكوى",
  "مو شغال",
  "ما يشتغل",
  "خطا",
  "خطأ",
  "تاخر",
  "تأخر",
  "ما وصل",
  "زعلان",
  "سيء",
  "problem",
  "issue",
  "broken",
  "wrong",
  "bad",
  "late",
];
const REQUEST_MARKERS: readonly string[] = [
  "ابغى",
  "أبغى",
  "اريد",
  "أريد",
  "ممكن",
  "الرجاء",
  "ارجو",
  "أرجو",
  "طلب",
  "please",
  "need",
  "want",
  "request",
];

function containsAny(haystack: string, markers: readonly string[]): boolean {
  return markers.some((marker) => haystack.includes(marker));
}

export function analyzeTask(event: EventPayload): TaskAnalysis {
  const raw = event.text.trim();
  const tokens = tokenize(raw);

  if (raw === "" || tokens.length < MIN_MEANINGFUL_TOKENS) {
    return {
      intent: "unclear",
      tokens,
      analyzable: false,
      // نقول ذلك صراحةً بدل أن نصنّف بأقرب كلمة: تصنيفٌ من كلمة واحدة يبدو عملاً
      // وهو تخمين، وتخمينٌ معروضٌ على موظّف دعم أسوأ من لا شيء لأنه يوجّهه خطأً.
      rationale: `نصّ قصير جداً (${tokens.length} توكِن) — لا يكفي لمحاولة تصنيف`,
    };
  }

  const lowered = raw.toLowerCase();

  // الترتيب مقصود: الشكوى أولاً. نصٌّ فيه شكوى وسؤال معاً شكوى أولاً — من يشتكي
  // ويسأل يحتاج معالجة شكواه، والإجابة عن سؤاله وحده تُقرأ تجاهلاً.
  if (containsAny(lowered, COMPLAINT_MARKERS)) {
    return { intent: "complaint", tokens, analyzable: true, rationale: "إشارات شكوى في النصّ" };
  }
  if (containsAny(lowered, REQUEST_MARKERS)) {
    return { intent: "request", tokens, analyzable: true, rationale: "إشارات طلب في النصّ" };
  }
  if (containsAny(lowered, QUESTION_MARKERS)) {
    return { intent: "question", tokens, analyzable: true, rationale: "إشارات سؤال في النصّ" };
  }

  return {
    intent: "unclear",
    tokens,
    // `analyzable: true` رغم `unclear`: غياب إشارة النيّة لا يعني غياب المضمون.
    // «اشتراكي منتهي» بلا سؤال ولا شكوى صريحة نصٌّ يُصنَّف تماماً.
    analyzable: true,
    rationale: "لا إشارة نيّة صريحة — يُحاول التصنيف بالمضمون",
  };
}
