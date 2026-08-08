/**
 * الغرض: كتابة المرشَّح المعتمَد في الذاكرة الطويلة. **المكان الوحيد** الذي
 *   تتغيّر فيه معرفة النظام الدائمة.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/learning
 * يُتوقع أن يستخدمه لاحقاً: approvalFlow.ts **وحده**
 * ملاحظات مستقبلية: يُضاف لاحقاً تراجعٌ عن اعتماد (rollback) بحفظ الحالة السابقة
 *   قبل الكتابة — يصير ضرورياً حين يكثر المعتمَد ويصعب تتبّع أثر كل مدخل.
 *
 * ⚠️ ═══ لا يُستدعى إلا من `approvalFlow` بعد قرار بشري ═══
 *
 * هذا الملف هو الطرف التنفيذي لحلقة التعلّم كلها. استدعاؤه من أي مكان آخر —
 * من مولّد المرشّحات مثلاً «لأن الثقة عالية» — يُلغي الموافقة البشرية عملياً
 * ويُبقيها شكلاً. ولذلك لا يُصدَّر من `index.ts`، ولا يعرفه أحد خارج هذا المجلّد.
 */

import type { LongTermMemory } from "../memory/longTerm.ts";
import type { KeywordEntry, LearningCandidate } from "../schemas.ts";

export interface MemoryUpdateResult {
  readonly applied: boolean;
  readonly reason: string;
}

/** وزن المدخل المعتمَد حديثاً: **دون** أوزان البذرة المؤكَّدة عمداً. */
const APPROVED_KEYWORD_WEIGHT = 0.6;

export function applyCandidate(
  candidate: LearningCandidate,
  memory: LongTermMemory,
  now: () => Date = () => new Date(),
): MemoryUpdateResult {
  if (candidate.status !== "approved") {
    return { applied: false, reason: `المرشَّح ${candidate.candidateId} ليس معتمَداً` };
  }

  const timestamp = now().toISOString();
  const subject = candidate.subject.trim();

  switch (candidate.candidateType) {
    case "keyword": {
      const entry: KeywordEntry = {
        keyword: subject,
        label: candidate.label,
        // كلمةٌ اعتُمدت من نمطٍ ملحوظ ليست كالبذرة المكتوبة عن معرفة بالمجال:
        // تدخل بوزن أدنى، فترفع الثقة قليلاً ولا تقلب تصنيفاً بمفردها.
        weight: APPROVED_KEYWORD_WEIGHT,
        hits: 0,
        updatedAt: timestamp,
      };
      return memory.upsertKeyword(entry)
        ? { applied: true, reason: `أُضيفت الكلمة «${subject}» → ${candidate.label}` }
        : { applied: false, reason: "تعذّرت الكتابة في الذاكرة الطويلة" };
    }

    case "entity": {
      return memory.upsertEntity({
        name: subject,
        kind: candidate.label,
        // بلا مرادفات عند الاعتماد: المرادف قرارٌ لغوي يُضاف بمراجعة مستقلة،
        // واشتقاقه آلياً من النصّ يُنتج مرادفاتٍ خاطئة توسّع المطابقة بلا قصد.
        aliases: [],
        updatedAt: timestamp,
      })
        ? { applied: true, reason: `أُضيف الكيان «${subject}»` }
        : { applied: false, reason: "تعذّرت الكتابة في الذاكرة الطويلة" };
    }

    // `policy` و`code` معرَّفان في العقد وغير منفَّذين. الرفض هنا صريح لا افتراضي:
    // مرشَّحٌ من نوع غير منفَّذ يمرّ صامتاً هو باب تغييرٍ في السياسة بلا مراجعة.
    default:
      return {
        applied: false,
        reason: `نوع المرشَّح ${candidate.candidateType} غير منفَّذ في هذه المرحلة`,
      };
  }
}
