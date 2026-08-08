/**
 * الغرض: فهرس نصّي في الذاكرة فوق مستندات المعرفة، يجعل البحث لا يمرّ على كل
 *   مستند في كل مرّة.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.5.
 * ينتمي إلى: packages/agent-core/knowledge
 * يُتوقع أن يستخدمه لاحقاً: knowledgeSearch.ts
 * ملاحظات مستقبلية: عند مليار مستخدم يُستبدل بفهرس متجهي (embeddings) ببحث دلالي.
 *   **العقد `KnowledgeIndex` هو نفسه** — يتغيّر ما تحته لا من يسأله.
 *
 * لماذا فهرس مقلوب رغم أن المستندات سبعة: ليس للسرعة اليوم — سبعة مستندات لا
 * تحتاج فهرساً — بل لأن **شكل الاستدعاء هو الذي يجب أن يثبت**. من يكتب اليوم
 * `documents.filter(...)` في كل موضع سيكتب غداً حلقةً على مليون مستند في مسار
 * حسّاس. الحدّ يُرسَم وهو رخيص.
 */

import type { KnowledgeDocument } from "./knowledgeLoader.ts";

export interface KnowledgeIndex {
  readonly documents: readonly KnowledgeDocument[];
  /** المستندات التي تحوي هذا التوكِن — في مفاتيحها أو متنها. */
  lookup(token: string): readonly KnowledgeDocument[];
  byLabel(label: string): readonly KnowledgeDocument[];
  size(): number;
}

/** أقصر توكِن يُفهرس. الحرف والحرفان يطابقان كل شيء فلا يميّزان شيئاً. */
const MIN_TOKEN_LENGTH = 3;

/**
 * تطبيع عربي خفيف: توحيد الألف والياء والتاء المربوطة، وحذف التشكيل والتطويل.
 * بلا هذا يفشل «اشتراكي» في مطابقة «اشتراك»، ويفشل «الأجرة» في مطابقة «أجرة» —
 * وهما أشيع صيغتين يكتبهما المستخدم فعلاً.
 */
export function normalizeArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, "") // تشكيل
    .replace(/\u0640/g, "") // تطويل
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // آ أ إ ← ا
    .replace(/\u0649/g, "\u064A") // ى ← ي
    .replace(/\u0629/g, "\u0647"); // ة ← ه
}

export function tokenize(value: string): readonly string[] {
  return normalizeArabic(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

export function buildKnowledgeIndex(documents: readonly KnowledgeDocument[]): KnowledgeIndex {
  const inverted = new Map<string, KnowledgeDocument[]>();
  const labels = new Map<string, KnowledgeDocument[]>();

  function add(token: string, document: KnowledgeDocument): void {
    const bucket = inverted.get(token);
    if (bucket === undefined) inverted.set(token, [document]);
    else if (!bucket.includes(document)) bucket.push(document);
  }

  for (const document of documents) {
    for (const keyword of document.keywords) {
      for (const token of tokenize(keyword)) add(token, document);
    }
    for (const token of tokenize(`${document.title} ${document.body}`)) add(token, document);

    const bucket = labels.get(document.label);
    if (bucket === undefined) labels.set(document.label, [document]);
    else bucket.push(document);
  }

  return {
    documents,
    lookup: (token) => inverted.get(normalizeArabic(token.trim())) ?? [],
    byLabel: (label) => labels.get(label) ?? [],
    size: () => documents.length,
  };
}
