/**
 * الغرض: مطابقة نصّية بسيطة تُعيد أفضل مستندات المعرفة لنصّ حدثٍ ما.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.5.
 * ينتمي إلى: packages/agent-core/knowledge
 * يُتوقع أن يستخدمه لاحقاً: agents/supportTicketAgent.ts
 * ملاحظات مستقبلية: عند مليار مستخدم يصير هذا بحثاً دلالياً بإعادة ترتيب
 *   (re-ranking). **العقد `KnowledgeSearch` هو نفسه** — يسأل «ما أقرب معرفة لهذا
 *   النصّ؟» ويستقبل نتائج مرتَّبة بدرجة، وهو سؤالٌ لا يتغيّر بتغيّر الخوارزمية.
 *
 * ═══ حدود هذه المطابقة، مذكورةً صراحةً ═══
 *
 * مطابقة نصّية لا تفهم معنى: لا تُدرك «ما وصلني شيء من أسبوع» أنها اشتراك منتهٍ
 * ما لم ترد كلمة من المفاتيح. **وهذا مقبول** لأن ناتجها اقتراحٌ يقرؤه إنسان لا
 * فعلٌ يُنفَّذ: أسوأ ما يقع أن يجد الموظّف اقتراحاً غير مناسب فيتجاهله. لو كان
 * الناتج فعلاً تلقائياً لما جاز هذا المستوى من الدقّة أصلاً.
 */

import type { KnowledgeIndex } from "./knowledgeIndex.ts";
import { tokenize } from "./knowledgeIndex.ts";
import type { KnowledgeDocument } from "./knowledgeLoader.ts";

export interface KnowledgeMatch {
  readonly document: KnowledgeDocument;
  /** درجة في [0,1]. نسبيّة داخل هذه النتيجة، لا مقياس مطلق للصواب. */
  readonly score: number;
  readonly matchedTokens: readonly string[];
}

export interface KnowledgeSearch {
  search(text: string, limit: number): readonly KnowledgeMatch[];
  /** بحث مقيَّد بتصنيف معروف مسبقاً — يستعمله الوكيل بعد أن يصنّف. */
  searchWithinLabel(text: string, label: string, limit: number): readonly KnowledgeMatch[];
  size(): number;
}

/** مطابقة المفتاح المعلن أثقل من مطابقة كلمة في المتن: المفتاح مقصود والمتن عرضي. */
const KEYWORD_WEIGHT = 3;
const BODY_WEIGHT = 1;

function scoreDocuments(
  index: KnowledgeIndex,
  tokens: readonly string[],
  candidates: readonly KnowledgeDocument[] | null,
): KnowledgeMatch[] {
  const scores = new Map<
    string,
    { document: KnowledgeDocument; score: number; hits: Set<string> }
  >();
  const allowed = candidates === null ? null : new Set(candidates.map((d) => d.id));

  for (const token of tokens) {
    for (const document of index.lookup(token)) {
      if (allowed !== null && !allowed.has(document.id)) continue;
      const isKeyword = document.keywords.some((keyword) => tokenize(keyword).includes(token));
      const weight = isKeyword ? KEYWORD_WEIGHT : BODY_WEIGHT;
      const current = scores.get(document.id);
      if (current === undefined) {
        scores.set(document.id, { document, score: weight, hits: new Set([token]) });
      } else {
        // التوكِن يُحتسب مرّة واحدة لكل مستند: تكراره في المتن دليلُ طولٍ لا صلة.
        if (!current.hits.has(token)) {
          current.score += weight;
          current.hits.add(token);
        }
      }
    }
  }

  const maximum = Math.max(...[...scores.values()].map((entry) => entry.score), 1);
  return [...scores.values()]
    .map((entry) => ({
      document: entry.document,
      score: Number((entry.score / maximum).toFixed(4)),
      matchedTokens: [...entry.hits],
    }))
    .sort((left, right) =>
      right.score === left.score
        ? left.document.id.localeCompare(right.document.id) // ترتيب ثابت: نفس المُدخل ينتج نفس المُخرج
        : right.score - left.score,
    );
}

export function createKnowledgeSearch(index: KnowledgeIndex): KnowledgeSearch {
  return {
    search: (text, limit) =>
      scoreDocuments(index, tokenize(text), null).slice(0, Math.max(0, limit)),
    searchWithinLabel: (text, label, limit) => {
      const scoped = index.byLabel(label);
      if (scoped.length === 0) return [];
      return scoreDocuments(index, tokenize(text), scoped).slice(0, Math.max(0, limit));
    },
    size: () => index.size(),
  };
}

/** بحثٌ لا يجد شيئاً أبداً. يُستعمل حين يفشل تحميل المعرفة — فتعمل الطبقة بلا معرفة. */
export function createEmptyKnowledgeSearch(): KnowledgeSearch {
  return { search: () => [], searchWithinLabel: () => [], size: () => 0 };
}
