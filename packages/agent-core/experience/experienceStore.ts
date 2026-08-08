/**
 * الغرض: التجربة المكتملة — القرار مقروناً بما جرى بعده. الوحدة التي يتعلّم منها
 *   النظام، ويُقاس عليها أداؤه.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/experience
 * يُتوقع أن يستخدمه لاحقاً: evaluation/*، learning/candidateGenerator.ts
 * ملاحظات مستقبلية: عند حجم حقيقي يصير هذا مخزناً استعلامياً بفهارس على التصنيف
 *   والنتيجة، لا ملف JSONL يُقرأ كاملاً. **العقد هو نفسه.**
 *
 * ⚠️ يُفقَد عند إعادة النشر، وليس سجلّ تدقيق — راجع `eventStore.ts`.
 */

import type { FileStore } from "../memory/storage.ts";
import type { ExperienceRecord } from "../schemas.ts";

export const EXPERIENCE_FILE = "experience.jsonl";

export interface ExperienceStore {
  record(entry: ExperienceRecord): void;
  all(): readonly ExperienceRecord[];
  byTraceId(traceId: string): ExperienceRecord | undefined;
  byClassification(classification: string): readonly ExperienceRecord[];
  count(): number;
}

export function createExperienceStore(store: FileStore, maxLines: number): ExperienceStore {
  return {
    record: (entry) => {
      store.appendLine(EXPERIENCE_FILE, entry);
      store.truncateToLast(EXPERIENCE_FILE, maxLines);
    },
    all: () => store.readLines<ExperienceRecord>(EXPERIENCE_FILE),
    byTraceId: (traceId) =>
      store.readLines<ExperienceRecord>(EXPERIENCE_FILE).find((entry) => entry.traceId === traceId),
    byClassification: (classification) =>
      store
        .readLines<ExperienceRecord>(EXPERIENCE_FILE)
        .filter((entry) => entry.classification === classification),
    count: () => store.readLines<ExperienceRecord>(EXPERIENCE_FILE).length,
  };
}
