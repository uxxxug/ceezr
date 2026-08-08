/**
 * الغرض: تسجيل ما فعله الإنسان فعلاً بعد الاقتراح — وافق عليه، أم رفضه، أم
 *   تجاهله. **بلا هذا الملف لا وجود لتقييم**، بل لعدّاد اقتراحات.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/experience
 * يُتوقع أن يستخدمه لاحقاً: gateway.ts (نقطة تسجيل النتيجة)، evaluation/*
 * ملاحظات مستقبلية: تُلتقط النتيجة آلياً لاحقاً بمقارنة الردّ المُرسَل فعلاً
 *   بالاقتراح. اليوم تُسجَّل صراحةً عبر `gateway.recordOutcome`.
 *
 * ⚠️ يُفقَد عند إعادة النشر، وليس سجلّ تدقيق — راجع `eventStore.ts`.
 *
 * ═══ الفرق بين «رُفض» و«تُجوهل» ═══
 *
 * رفضٌ صريح يعني أن إنساناً قرأ الاقتراح ورآه خطأً — إشارةٌ عن **دقّة** الوكيل.
 * والتجاهل يعني أنه لم يُقرأ أصلاً — إشارةٌ عن **نفعه أو عرضه**، لا عن دقّته.
 * خلطهما في «لم يُقبل» يُضيّع أثمن ما في البيانات: التمييز بين أن تكون مخطئاً
 * وأن تكون غير مقروء، وعلاجهما مختلف تماماً.
 */

import type { FileStore } from "../memory/storage.ts";
import type { OutcomeRecord, OutcomeVerdict } from "../schemas.ts";

export const OUTCOME_FILE = "outcomes.jsonl";

export interface OutcomeRecorder {
  record(traceId: string, verdict: OutcomeVerdict, humanAction: string | null): OutcomeRecord;
  byTraceId(traceId: string): OutcomeRecord | undefined;
  all(): readonly OutcomeRecord[];
}

export function createOutcomeRecorder(
  store: FileStore,
  maxLines: number,
  now: () => Date = () => new Date(),
): OutcomeRecorder {
  return {
    record: (traceId, verdict, humanAction) => {
      const entry: OutcomeRecord = {
        traceId,
        verdict,
        humanAction,
        recordedAt: now().toISOString(),
      };
      store.appendLine(OUTCOME_FILE, entry);
      store.truncateToLast(OUTCOME_FILE, maxLines);
      return entry;
    },
    // الأحدث يفوز: تصحيح حكمٍ سُجّل خطأً يجب أن يكون ممكناً بلا تعديل ملف يدوياً.
    byTraceId: (traceId) =>
      [...store.readLines<OutcomeRecord>(OUTCOME_FILE)]
        .reverse()
        .find((entry) => entry.traceId === traceId),
    all: () => store.readLines<OutcomeRecord>(OUTCOME_FILE),
  };
}
