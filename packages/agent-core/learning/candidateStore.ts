/**
 * الغرض: مخزن مرشّحات التعلّم — ما ينتظر مراجعة بشرية، وما فُصل فيه.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/learning
 * يُتوقع أن يستخدمه لاحقاً: candidateGenerator.ts، approvalFlow.ts
 * ملاحظات مستقبلية: يُعرض لاحقاً في لوحة الإدارة بدل قراءة ملف. **العقد هو نفسه.**
 *
 * ⚠️ يُفقَد عند إعادة النشر — راجع `memory/storage.ts`. أثر الفقدان هنا: تُفقَد
 * المرشّحات المعلَّقة، وتُعاد توليدها من التجارب إن بقيت. لا يُفقَد شيء **اعتُمد**،
 * لأن المعتمَد يُكتب في الذاكرة الطويلة لا هنا.
 */

import type { FileStore } from "../memory/storage.ts";
import type { CandidateStatus, LearningCandidate } from "../schemas.ts";

export const CANDIDATES_FILE = "candidates.json";

export interface CandidateStore {
  all(): readonly LearningCandidate[];
  pending(): readonly LearningCandidate[];
  byId(candidateId: string): LearningCandidate | undefined;
  /** يضيف مرشَّحاً جديداً، أو يزيد دعم مرشَّح معلَّق مطابق. */
  upsert(candidate: LearningCandidate): boolean;
  setStatus(
    candidateId: string,
    status: CandidateStatus,
    decidedBy: string,
    decidedAt: string,
  ): boolean;
}

function sameSubject(left: LearningCandidate, right: LearningCandidate): boolean {
  return (
    left.candidateType === right.candidateType &&
    left.subject.trim().toLowerCase() === right.subject.trim().toLowerCase() &&
    left.label === right.label
  );
}

export function createCandidateStore(store: FileStore): CandidateStore {
  const read = (): LearningCandidate[] => store.readJson<LearningCandidate[]>(CANDIDATES_FILE, []);

  return {
    all: read,
    pending: () => read().filter((candidate) => candidate.status === "pending"),
    byId: (candidateId) => read().find((candidate) => candidate.candidateId === candidateId),

    upsert: (candidate) => {
      const stored = read();
      const existing = stored.find((entry) => sameSubject(entry, candidate));

      if (existing === undefined) return store.writeJson(CANDIDATES_FILE, [...stored, candidate]);

      // مرشَّحٌ فُصل فيه **لا يُحيا مجدّداً**: رفضُ مراجعٍ لكلمةٍ قرارٌ قائم، وإعادة
      // طرحها كلّما تكرّرت تجعل الرفض بلا أثر وتُغرق قائمة المراجعة بما رُفض.
      if (existing.status !== "pending") return true;

      const updated = stored.map((entry) =>
        sameSubject(entry, candidate)
          ? { ...entry, supportCount: Math.max(entry.supportCount, candidate.supportCount) }
          : entry,
      );
      return store.writeJson(CANDIDATES_FILE, updated);
    },

    setStatus: (candidateId, status, decidedBy, decidedAt) => {
      const stored = read();
      if (!stored.some((entry) => entry.candidateId === candidateId)) return false;
      const updated = stored.map((entry) =>
        entry.candidateId === candidateId ? { ...entry, status, decidedBy, decidedAt } : entry,
      );
      return store.writeJson(CANDIDATES_FILE, updated);
    },
  };
}
