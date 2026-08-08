/**
 * الغرض: سجلّ الأحداث الداخلة كما وصلت — أساس إعادة تشغيل أي حالة للتحقيق.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/experience
 * يُتوقع أن يستخدمه لاحقاً: core.ts، evaluation/regressionChecks.ts
 * ملاحظات مستقبلية: عند مليار مستخدم يصير هذا مجرى أحداث (event stream) بسياسة
 *   احتفاظ معلنة. **العقد هو نفسه.**
 *
 * ⚠️ يُكتب في `runtime_experience/` ويُفقَد عند إعادة النشر — راجع `memory/storage.ts`.
 *
 * ⚠️ **هذا ليس سجلّ تدقيق.** سجلّ التدقيق الحقيقي هو `audit_log` في قاعدة المشروع
 * الأساسي: مضمونٌ، ومُهاجَر، ولا يُفقَد. ما هنا أثرٌ تشخيصي لطبقةٍ تجريبية، ولا
 * يجوز أن يُبنى عليه قرار محاسبة ولا نزاع.
 */

import type { FileStore } from "../memory/storage.ts";
import type { EventPayload } from "../schemas.ts";

export const EVENT_LOG_FILE = "events.jsonl";

/** ما يُسجَّل. **بلا نصّ الحدث** — طوله وتوقيعه يكفيان للتشخيص بلا حفظ شكوى. */
export interface StoredEvent {
  readonly traceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly source: string;
  readonly occurredAt: string;
  readonly textLength: number;
  readonly attributeKeys: readonly string[];
  readonly recordedAt: string;
}

export interface EventStore {
  record(traceId: string, event: EventPayload): void;
  recent(limit: number): readonly StoredEvent[];
  count(): number;
}

export function createEventStore(
  store: FileStore,
  maxLines: number,
  now: () => Date = () => new Date(),
): EventStore {
  return {
    record: (traceId, event) => {
      const entry: StoredEvent = {
        traceId,
        eventId: event.eventId,
        eventType: event.eventType,
        source: event.source,
        occurredAt: event.occurredAt,
        textLength: event.text.length,
        attributeKeys: Object.keys(event.attributes),
        recordedAt: now().toISOString(),
      };
      store.appendLine(EVENT_LOG_FILE, entry);
      store.truncateToLast(EVENT_LOG_FILE, maxLines);
    },
    recent: (limit) => {
      const all = store.readLines<StoredEvent>(EVENT_LOG_FILE);
      return all.slice(Math.max(0, all.length - limit)).reverse();
    },
    count: () => store.readLines<StoredEvent>(EVENT_LOG_FILE).length,
  };
}
