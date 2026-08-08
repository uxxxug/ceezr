/**
 * الغرض: نافذة متدحرجة على التجارب الأخيرة — المكان الذي يُرصد فيه النمط المتكرّر
 *   قبل أن يستحقّ الترقية إلى معرفة دائمة.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.4.
 * ينتمي إلى: packages/agent-core/memory
 * يُتوقع أن يستخدمه لاحقاً: learning/candidateGenerator.ts، evaluation/*
 * ملاحظات مستقبلية: عند مليار مستخدم تصير هذه Redis بـTTL حقيقي على كل مدخل، لا
 *   قصّاً بعدد الأسطر. **العقد أدناه هو نفسه** — يتغيّر التخزين لا من يقرأ منه.
 *
 * ⚠️ **يُفقَد عند كل إعادة نشر على Render** (راجع التحذير الكامل في `storage.ts`).
 * أثر الفقدان هنا **الأخفّ بين الطبقات الثلاث**: تعود النافذة فارغة، فيتأخّر
 * توليد مرشّحات التعلّم حتى تتراكم تجارب جديدة. لا قرار يُبنى عليها مباشرة، ولا
 * سلوك يعتمد عليها.
 *
 * لماذا القصّ بالعدد لا بالعمر: العمر يحتاج ساعةً موثوقة وتنظيفاً دورياً وعملية
 * تعمل حتى بلا أحداث. العدد يحتاج سطراً واحداً عند كل كتابة، ويُعطي نفس الضمان
 * الذي نحتاجه فعلاً: **ألّا ينمو الملف بلا حدّ**. الأدقّ هنا ليس الأفضل.
 */

import type { DecisionStatus, EventType } from "../schemas.ts";
import type { FileStore } from "./storage.ts";

export const MEDIUM_TERM_FILE = "medium_term.jsonl";

/**
 * مدخل واحد في النافذة. **لا يحمل نصّ الحدث كاملاً** — يحمل طوله وتصنيفه ونتيجته.
 * حفظ نصّ شكوى مستخدم في ملف تجريبي يُفقَد بلا سياسة احتفاظ ولا حذف قرارٌ لا
 * يُتَّخذ بالسهو، وما نحتاجه للتعلّم هو النمط لا النصّ.
 */
export interface MediumTermEntry {
  readonly traceId: string;
  readonly eventType: EventType;
  readonly agentId: string | null;
  readonly classification: string | null;
  readonly status: DecisionStatus;
  readonly confidence: number;
  /** الكلمات التي أدّت للتصنيف — هذه ما يُبنى عليه المرشَّح لاحقاً. */
  readonly matchedKeywords: readonly string[];
  /** كلمات النصّ بعد التطبيع، **بحدّ أقصى** — لا النصّ الأصلي. */
  readonly tokens: readonly string[];
  readonly textLength: number;
  readonly recordedAt: string;
}

export interface MediumTermMemory {
  append(entry: MediumTermEntry): void;
  /** آخر `limit` مدخلاً، الأحدث أولاً. */
  recent(limit: number): readonly MediumTermEntry[];
  all(): readonly MediumTermEntry[];
  size(): number;
}

export function createMediumTermMemory(store: FileStore, maxLines: number): MediumTermMemory {
  return {
    append: (entry) => {
      store.appendLine(MEDIUM_TERM_FILE, entry);
      // القصّ بعد كل كتابة لا في مهمّة دورية: مهمّةٌ دورية تحتاج جدولةً وعمليةً
      // تعمل، وكلاهما بنيةٌ تُصان لأجل ملفٍ تجريبي يُفقَد أصلاً عند النشر.
      store.truncateToLast(MEDIUM_TERM_FILE, maxLines);
    },
    recent: (limit) => {
      const entries = store.readLines<MediumTermEntry>(MEDIUM_TERM_FILE);
      return entries.slice(Math.max(0, entries.length - limit)).reverse();
    },
    all: () => store.readLines<MediumTermEntry>(MEDIUM_TERM_FILE),
    size: () => store.readLines<MediumTermEntry>(MEDIUM_TERM_FILE).length,
  };
}
