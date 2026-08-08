/**
 * الغرض: سجلّ القرارات كما خرجت من الطبقة، مع الخطوات التي أدّت إليها.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/experience
 * يُتوقع أن يستخدمه لاحقاً: core.ts، evaluation/evaluator.ts
 * ملاحظات مستقبلية: يُربط لاحقاً بمعرّف الرسالة المعروضة لفريق الدعم، ليصير
 *   ربط القرار بنتيجته آلياً بدل أن يُمرَّر `traceId` يدوياً.
 *
 * ⚠️ يُفقَد عند إعادة النشر، وليس سجلّ تدقيق — راجع `eventStore.ts`.
 *
 * لماذا تُسجَّل الملاحظات (`notes`) لا القرار وحده: قرارٌ بلا أثرٍ لكيف وصل إليه
 * لا يُراجَع بل يُقبَل أو يُرفض. الملاحظات هي ما يجعل «لماذا اقترح هذا؟» سؤالاً
 * له جواب.
 */

import type { FileStore } from "../memory/storage.ts";
import type { DecisionResult } from "../schemas.ts";

export const DECISION_LOG_FILE = "decisions.jsonl";

export interface LoggedDecision {
  readonly decision: DecisionResult;
  /** ملاحظات الذاكرة القصيرة قبل إفنائها — الأثر الوحيد الباقي منها. */
  readonly notes: readonly string[];
  readonly recordedAt: string;
}

export interface DecisionLog {
  record(decision: DecisionResult, notes: readonly string[]): void;
  byTraceId(traceId: string): LoggedDecision | undefined;
  recent(limit: number): readonly LoggedDecision[];
  all(): readonly LoggedDecision[];
}

export function createDecisionLog(
  store: FileStore,
  maxLines: number,
  now: () => Date = () => new Date(),
): DecisionLog {
  return {
    record: (decision, notes) => {
      store.appendLine(DECISION_LOG_FILE, { decision, notes, recordedAt: now().toISOString() });
      store.truncateToLast(DECISION_LOG_FILE, maxLines);
    },
    byTraceId: (traceId) =>
      store
        .readLines<LoggedDecision>(DECISION_LOG_FILE)
        .find((entry) => entry.decision.traceId === traceId),
    recent: (limit) => {
      const all = store.readLines<LoggedDecision>(DECISION_LOG_FILE);
      return all.slice(Math.max(0, all.length - limit)).reverse();
    },
    all: () => store.readLines<LoggedDecision>(DECISION_LOG_FILE),
  };
}
