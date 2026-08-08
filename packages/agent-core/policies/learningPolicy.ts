/**
 * الغرض: شروط أهلية أي مرشَّح تعلّم — ما الذي يُعرض على إنسان أصلاً، وما الذي
 *   لا يستحقّ أن يُعرض.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/policies
 * يُتوقع أن يستخدمه لاحقاً: learning/candidateGenerator.ts وapprovalFlow.ts
 * ملاحظات مستقبلية: عند توسيع `candidate_type` إلى `policy` أو `code` تُضاف هنا
 *   شروط أشدّ لكل نوع. **العقد هو نفسه** — وهذا هو موضع الشرط الجديد، فلا يُنثَر.
 *
 * ═══ لماذا سياسة قبل الاعتماد، لا بعده ═══
 *
 * لأن قائمة مراجعةٍ فيها ضجيج لا تُراجَع بل تُوافَق عليها بالجملة. تصفيةُ ما لا
 * يستحقّ **قبل** أن يصل إلى إنسان هي ما يُبقي المراجعة البشرية مراجعةً حقيقية،
 * وهي الشرط الوحيد الذي يجعل «الموافقة اليدوية» ضماناً لا طقساً.
 */

import type { CandidateType, LearningCandidate } from "../schemas.ts";
import { IMPLEMENTED_CANDIDATE_TYPES } from "../schemas.ts";

export interface LearningEligibility {
  readonly eligible: boolean;
  readonly reason: string;
}

/** أقصر كلمة تُقبل مرشَّحة. الحرفان والثلاثة تطابقان كل شيء فلا تميّزان شيئاً. */
const MIN_SUBJECT_LENGTH = 3;
const MAX_SUBJECT_LENGTH = 48;

/**
 * كلمات شائعة لا تحمل دلالة تصنيف. اعتمادُ واحدةٍ منها يُصنّف كل تذكرة تقريباً
 * تحت تصنيف واحد، فيُفسد المطابقة كلها بمدخلٍ واحد — ولذلك تُمنع قبل العرض لا
 * بعده، فالمراجع البشري قد لا ينتبه لأثر كلمةٍ تبدو بريئة.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "من",
  "الى",
  "إلى",
  "على",
  "في",
  "عن",
  "هذا",
  "هذه",
  "ذلك",
  "التي",
  "الذي",
  "كان",
  "يكون",
  "لكن",
  "حتى",
  "قد",
  "ما",
  "لا",
  "هل",
  "انا",
  "أنا",
  "انت",
  "أنت",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "your",
  "have",
  "has",
  "not",
]);

export function isTypeImplemented(type: CandidateType): boolean {
  return (IMPLEMENTED_CANDIDATE_TYPES as readonly string[]).includes(type);
}

/**
 * يفحص مرشَّحاً قبل تخزينه. **لا يعتمد شيئاً** — الاعتماد قرار بشري وحده في
 * `approvalFlow.ts`. هذه الدالة تُقرّر فقط: هل يستحقّ أن يُعرَض على إنسان؟
 */
export function checkCandidateEligibility(
  candidate: LearningCandidate,
  minSupport: number,
  existingSubjects: ReadonlySet<string>,
): LearningEligibility {
  if (!isTypeImplemented(candidate.candidateType)) {
    // النوع معرَّف في العقد لكنه غير منفَّذ. رفضه صريحاً هنا يمنع أن يتسلّل
    // مرشَّح `policy` أو `code` إلى قائمة المراجعة قبل أن يُفتح ذلك البند بأمر.
    return {
      eligible: false,
      reason: `نوع المرشَّح ${candidate.candidateType} معرَّف في العقد وغير منفَّذ في هذه المرحلة`,
    };
  }

  const subject = candidate.subject.trim().toLowerCase();

  if (subject.length < MIN_SUBJECT_LENGTH) {
    return { eligible: false, reason: `المرشَّح أقصر من ${MIN_SUBJECT_LENGTH} محارف` };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { eligible: false, reason: `المرشَّح أطول من ${MAX_SUBJECT_LENGTH} محرفاً` };
  }
  if (STOP_WORDS.has(subject)) {
    return { eligible: false, reason: `«${subject}» كلمة شائعة لا تحمل دلالة تصنيف` };
  }
  if (/^\d+$/.test(subject)) {
    return { eligible: false, reason: "أرقام مجرّدة لا تصلح كلمةً مفتاحية" };
  }
  if (existingSubjects.has(subject)) {
    return { eligible: false, reason: `«${subject}» موجود في الذاكرة الطويلة أصلاً` };
  }
  if (candidate.supportCount < minSupport) {
    // مرشَّح من تجربة أو تجربتين ليس نمطاً بل صدفة، واعتماده يُعلّم النظام الضجيج.
    return {
      eligible: false,
      reason: `الدعم ${candidate.supportCount} دون الحدّ ${minSupport} — نمطٌ لم يثبت بعد`,
    };
  }
  if (candidate.label.trim() === "") {
    return { eligible: false, reason: "مرشَّح بلا تصنيف يدلّ عليه" };
  }

  return { eligible: true, reason: `مؤهَّل للعرض على مراجع بشري (دعم ${candidate.supportCount})` };
}

/**
 * **الاعتماد الآلي ممنوع مطلقاً في هذه المرحلة.** دالّة صريحة تُعيد `false`
 * دائماً بدل أن يكون المنع غياباً لكود: الغياب يُملأ بالسهو، والمنع الصريح
 * يُصطدَم به. أعلى ثقة وأكبر دعم لا يغيّران هذا — لا استثناء.
 */
export function isAutoApprovalAllowed(): boolean {
  return false;
}
