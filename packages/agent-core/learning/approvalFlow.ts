/**
 * الغرض: البوابة البشرية بين مرشَّح ومعرفة معتمَدة. **لا يمرّ شيء إلى الذاكرة
 *   الطويلة إلا من هنا، وبيد إنسان مُسمّى.**
 * الحالة: منفّذ فعلياً — **يدوي بالكامل.** القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/learning
 * يُتوقع أن يستخدمه لاحقاً: gateway.approveCandidate/rejectCandidate
 * ملاحظات مستقبلية: أي حديث مستقبلي عن «اعتماد آلي للمرشّحات عالية الثقة» يحتاج
 *   أمراً صريحاً جديداً **وسجلّ تراجع يعمل قبله**. لا يُفتح لأن النتائج بدت جيدة
 *   لفترة: النظام الذي يُعدّل معرفته بنفسه ينحرف ببطء، ويُكتشف انحرافه متأخّراً.
 *
 * ⚠️ ═══ لا اعتماد آلي إطلاقاً، ولو بلغت الثقة 1.0 ═══
 *
 * `isAutoApprovalAllowed()` تُعيد `false` دائماً، و`approve` **تشترط `decidedBy`
 * غير فارغ** فلا يمكن اعتماد شيء بلا اسم من اعتمده. هذان قيدان في الكود لا في
 * الاتفاق، وعليهما اختبارات وحدة.
 *
 * ولماذا الاسم شرط؟ لأن التعلّم يغيّر سلوك النظام على كل حدثٍ لاحق. تغييرٌ بهذا
 * الأثر بلا مسؤول عنه تغييرٌ لا يُراجَع ولا يُتراجَع عنه — ولا يتعلّم منه أحد
 * حين يتبيّن خطؤه.
 */

import type { LongTermMemory } from "../memory/longTerm.ts";
import { isAutoApprovalAllowed, isTypeImplemented } from "../policies/learningPolicy.ts";
import type { LearningCandidate } from "../schemas.ts";
import type { CandidateStore } from "./candidateStore.ts";
import { applyCandidate } from "./memoryUpdater.ts";

export interface ApprovalOutcome {
  readonly ok: boolean;
  readonly candidateId: string;
  readonly reason: string;
}

export interface ApprovalFlow {
  /** المعروض على مراجع بشري. */
  listPending(): readonly LearningCandidate[];
  /** **يتطلّب `decidedBy` غير فارغ.** يعتمد ثم يكتب في الذاكرة الطويلة. */
  approve(candidateId: string, decidedBy: string): ApprovalOutcome;
  reject(candidateId: string, decidedBy: string, note: string): ApprovalOutcome;
}

export function createApprovalFlow(
  store: CandidateStore,
  memory: LongTermMemory,
  now: () => Date = () => new Date(),
): ApprovalFlow {
  return {
    listPending: () => store.pending(),

    approve: (candidateId, decidedBy) => {
      // الحاجز المطلق أولاً: لو عاد هذا `true` يوماً بلا أمر صريح، فهو خطأ.
      if (isAutoApprovalAllowed()) {
        return { ok: false, candidateId, reason: "الاعتماد الآلي ممنوع في هذه المرحلة" };
      }
      if (decidedBy.trim() === "") {
        return { ok: false, candidateId, reason: "لا اعتماد بلا اسم من اعتمده" };
      }

      const candidate = store.byId(candidateId);
      if (candidate === undefined) {
        return { ok: false, candidateId, reason: `لا مرشَّح بالمعرّف ${candidateId}` };
      }
      if (candidate.status !== "pending") {
        return {
          ok: false,
          candidateId,
          reason: `المرشَّح ${candidate.status} أصلاً — لا يُعاد الفصل فيه`,
        };
      }
      if (!isTypeImplemented(candidate.candidateType)) {
        return {
          ok: false,
          candidateId,
          reason: `نوع ${candidate.candidateType} غير منفَّذ — لا يُعتمَد ولو وافق مراجع`,
        };
      }

      const decidedAt = now().toISOString();
      if (!store.setStatus(candidateId, "approved", decidedBy.trim(), decidedAt)) {
        return { ok: false, candidateId, reason: "تعذّر تحديث حالة المرشَّح" };
      }

      // الحالة تُحدَّث **قبل** الكتابة في الذاكرة: لو فشلت الكتابة بقي المرشَّح
      // معتمَداً وغير مطبَّق — وهي حالة مرئية تُصحَّح. العكس (كتابةٌ بلا حالة) يُنتج
      // معرفةً في الذاكرة لا يعرف أحد من اعتمدها، وهذا لا يُصحَّح لأنه لا يُرى.
      const applied = applyCandidate({ ...candidate, status: "approved" }, memory, now);
      if (!applied.applied) {
        return { ok: false, candidateId, reason: `اعتُمد ولم يُطبَّق: ${applied.reason}` };
      }

      store.setStatus(candidateId, "applied", decidedBy.trim(), decidedAt);
      return { ok: true, candidateId, reason: `${applied.reason} — باعتماد ${decidedBy.trim()}` };
    },

    reject: (candidateId, decidedBy, note) => {
      if (decidedBy.trim() === "") {
        return { ok: false, candidateId, reason: "لا رفض بلا اسم من رفضه" };
      }
      const candidate = store.byId(candidateId);
      if (candidate === undefined) {
        return { ok: false, candidateId, reason: `لا مرشَّح بالمعرّف ${candidateId}` };
      }
      if (candidate.status !== "pending") {
        return { ok: false, candidateId, reason: `المرشَّح ${candidate.status} أصلاً` };
      }
      return store.setStatus(candidateId, "rejected", decidedBy.trim(), now().toISOString())
        ? {
            ok: true,
            candidateId,
            reason: `رُفض بواسطة ${decidedBy.trim()}${note.trim() === "" ? "" : `: ${note.trim()}`}`,
          }
        : { ok: false, candidateId, reason: "تعذّر تحديث حالة المرشَّح" };
    },
  };
}
