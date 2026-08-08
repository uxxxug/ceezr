/**
 * الغرض: المعرفة المعتمدة بعد موافقة بشرية — الكلمات المفتاحية والكيانات والحالة.
 *   هذه **الطبقة الوحيدة** التي يُبنى عليها قرار وكيلٍ بلا إعادة تحقّق.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.4.
 * ينتمي إلى: packages/agent-core/memory
 * يُتوقع أن يستخدمه لاحقاً: agents/supportTicketAgent.ts، learning/memoryUpdater.ts
 * ملاحظات مستقبلية: عند مليار مستخدم تصير قاعدة معرفة متجهية ببحث دلالي لا نصّي.
 *   `KeywordEntry` حينها يحمل تضميناً (embedding) بدل نصّ مطابَق — **والعقد أدناه
 *   هو نفسه**، لأن من يستدعي يسأل «ما تصنيف هذا النصّ؟» لا «طابِق هذه الحروف».
 *
 * ⚠️ **يُفقَد عند كل إعادة نشر على Render** (التحذير الكامل في `storage.ts`).
 * أثر الفقدان هنا هو **الأثقل بين الطبقات الثلاث، وهو مع ذلك مقبول**: يعود الوكيل
 * إلى حالة «بلا معرفة سابقة» — يقرأ الكلمات المزروعة أدناه و`knowledge_base/`
 * (وكلاهما في المستودع فلا يُفقَد) ولا يقرأ ما تعلَّمه بعد آخر نشر. أي أنه **يفقد
 * التحسّن لا الوظيفة**: يبقى يصنّف ويقترح بأدلّة أقلّ. هذا تدهور جودة لا كسر
 * سلوك، وهو السلوك المقبول المقصود في هذه المرحلة التجريبية.
 *
 * ثلاثة ملفات لا ملف واحد (كما في المواصفة الأصلية): الكلمات تتغيّر كل يوم بموافقة
 * بشرية، والكيانات نادراً، والحالة عند التهيئة. خلطها في ملف واحد يجعل كل تعديل
 * يعيد كتابة كل شيء، فيصير فقدان أحدها فقداناً للثلاثة.
 */

import type { EntityEntry, KeywordEntry, LongTermSnapshot, StateEntry } from "../schemas.ts";
import type { FileStore } from "./storage.ts";

export const KEYWORDS_FILE = "keywords.json";
export const ENTITIES_FILE = "entities.json";
export const STATE_FILE = "state.json";

/**
 * البذرة الأولى. **في الكود لا في ملف runtime**، وهذا هو الفرق الذي يجعل فقدان
 * القرص تدهوراً لا كسراً: بدونها يبدأ الوكيل من لا شيء بعد كل نشر فلا يصنّف
 * شيئاً؛ بها يبدأ من حدٍّ أدنى معقول دائماً. التصنيفات الثلاثة تقابل ما يفتحه
 * المستخدم فعلاً في المشروع الأساسي.
 */
export const SEED_KEYWORDS: readonly KeywordEntry[] = [
  { keyword: "اشتراك", label: "subscription_issue", weight: 0.9, hits: 0, updatedAt: "" },
  { keyword: "تجديد", label: "subscription_issue", weight: 0.8, hits: 0, updatedAt: "" },
  { keyword: "باقة", label: "subscription_issue", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "دفع", label: "subscription_issue", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "انتهت", label: "subscription_issue", weight: 0.6, hits: 0, updatedAt: "" },
  { keyword: "subscription", label: "subscription_issue", weight: 0.9, hits: 0, updatedAt: "" },
  { keyword: "payment", label: "subscription_issue", weight: 0.7, hits: 0, updatedAt: "" },

  { keyword: "رحلة", label: "ride_dispute", weight: 0.8, hits: 0, updatedAt: "" },
  { keyword: "سائق", label: "ride_dispute", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "أجرة", label: "ride_dispute", weight: 0.8, hits: 0, updatedAt: "" },
  { keyword: "تأخر", label: "ride_dispute", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "ألغى", label: "ride_dispute", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "نزاع", label: "ride_dispute", weight: 0.9, hits: 0, updatedAt: "" },
  { keyword: "ride", label: "ride_dispute", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "driver", label: "ride_dispute", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "fare", label: "ride_dispute", weight: 0.8, hits: 0, updatedAt: "" },

  { keyword: "كيف", label: "general_inquiry", weight: 0.5, hits: 0, updatedAt: "" },
  { keyword: "استفسار", label: "general_inquiry", weight: 0.7, hits: 0, updatedAt: "" },
  { keyword: "سؤال", label: "general_inquiry", weight: 0.6, hits: 0, updatedAt: "" },
  { keyword: "how", label: "general_inquiry", weight: 0.5, hits: 0, updatedAt: "" },
];

export interface LongTermMemory {
  snapshot(): LongTermSnapshot;
  keywords(): readonly KeywordEntry[];
  entities(): readonly EntityEntry[];
  state(): readonly StateEntry[];
  /** يضيف أو يُحدِّث كلمة. يعيد `false` عند تعذّر الكتابة — ولا يرمي. */
  upsertKeyword(entry: KeywordEntry): boolean;
  upsertEntity(entry: EntityEntry): boolean;
  setState(key: string, value: string): boolean;
  /** يزيد عدّاد الإصابات لكلمات استُعملت فعلاً في قرار. */
  recordHits(keywords: readonly string[]): boolean;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * تُدمَج البذرة مع المقروء من القرص، **والمقروء يغلب**: كلمةٌ عُدِّل وزنها
 * بموافقة بشرية لا يجوز أن تُعيدها البذرة إلى قيمتها الأولى عند كل إقلاع.
 */
function mergeSeed(stored: readonly KeywordEntry[]): KeywordEntry[] {
  const merged = new Map<string, KeywordEntry>();
  for (const entry of SEED_KEYWORDS) merged.set(normalizeKey(entry.keyword), entry);
  for (const entry of stored) merged.set(normalizeKey(entry.keyword), entry);
  return [...merged.values()];
}

export function createLongTermMemory(
  store: FileStore,
  now: () => Date = () => new Date(),
): LongTermMemory {
  return {
    snapshot: () => ({
      keywords: mergeSeed(store.readJson<KeywordEntry[]>(KEYWORDS_FILE, [])),
      entities: store.readJson<EntityEntry[]>(ENTITIES_FILE, []),
      state: store.readJson<StateEntry[]>(STATE_FILE, []),
    }),

    keywords: () => mergeSeed(store.readJson<KeywordEntry[]>(KEYWORDS_FILE, [])),
    entities: () => store.readJson<EntityEntry[]>(ENTITIES_FILE, []),
    state: () => store.readJson<StateEntry[]>(STATE_FILE, []),

    upsertKeyword: (entry) => {
      const stored = store.readJson<KeywordEntry[]>(KEYWORDS_FILE, []);
      const key = normalizeKey(entry.keyword);
      const next = stored.filter((existing) => normalizeKey(existing.keyword) !== key);
      next.push({ ...entry, updatedAt: now().toISOString() });
      return store.writeJson(KEYWORDS_FILE, next);
    },

    upsertEntity: (entry) => {
      const stored = store.readJson<EntityEntry[]>(ENTITIES_FILE, []);
      const key = normalizeKey(entry.name);
      const next = stored.filter((existing) => normalizeKey(existing.name) !== key);
      next.push({ ...entry, updatedAt: now().toISOString() });
      return store.writeJson(ENTITIES_FILE, next);
    },

    setState: (key, value) => {
      const stored = store.readJson<StateEntry[]>(STATE_FILE, []);
      const next = stored.filter((existing) => existing.key !== key);
      next.push({ key, value, updatedAt: now().toISOString() });
      return store.writeJson(STATE_FILE, next);
    },

    recordHits: (used) => {
      if (used.length === 0) return true;
      const wanted = new Set(used.map(normalizeKey));
      const stored = mergeSeed(store.readJson<KeywordEntry[]>(KEYWORDS_FILE, []));
      const timestamp = now().toISOString();
      const next = stored.map((entry) =>
        wanted.has(normalizeKey(entry.keyword))
          ? { ...entry, hits: entry.hits + 1, updatedAt: timestamp }
          : entry,
      );
      return store.writeJson(KEYWORDS_FILE, next);
    },
  };
}
