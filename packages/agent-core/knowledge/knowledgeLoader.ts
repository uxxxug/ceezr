/**
 * الغرض: تحميل ملفات `knowledge_base/*.md` عند الإقلاع وتحويلها إلى مستندات
 *   قابلة للفهرسة.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.5.
 * ينتمي إلى: packages/agent-core/knowledge
 * يُتوقع أن يستخدمه لاحقاً: knowledgeIndex.ts، knowledgeSearch.ts
 * ملاحظات مستقبلية: عند مليار مستخدم تُحمَّل المعرفة من مخزن مُدار بإصدارات
 *   ومراجعة، لا من ملفات في المستودع. **العقد `KnowledgeDocument` هو نفسه** حينها.
 *
 * لماذا التحميل عند الإقلاع مرّة واحدة: الملفات في المستودع، فلا تتغيّر بين
 * نشرتين. قراءتها عند كل حدث تدفع كلفة قرصٍ في مسارٍ حسّاس لأجل تغيّرٍ لا يقع.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { guardedSync } from "../fallback.ts";

export interface KnowledgeDocument {
  readonly id: string;
  readonly title: string;
  /** التصنيف الذي ينتمي إليه المستند — يربطه بمخرجات وكيل الدعم. */
  readonly label: string;
  readonly keywords: readonly string[];
  /** المتن بلا الترويسة. */
  readonly body: string;
  /** الردّ المقترح وحده، مستخرَجاً من قسم «الردّ المقترح». */
  readonly suggestion: string;
  readonly sourceFile: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = FRONT_MATTER.exec(raw);
  if (match === null || match[1] === undefined) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { meta, body: raw.slice(match[0].length) };
}

/**
 * يستخرج قسم «الردّ المقترح». عند غيابه يعود بأوّل فقرة — **لا بسلسلة فارغة**:
 * مستندٌ بلا ردّ صريح ما زال يحمل معلومةً تُقرأ، وإسقاطه بالكامل يخسرها.
 */
function extractSuggestion(body: string): string {
  const heading = /^##\s+الردّ المقترح\s*$/m.exec(body);
  const section =
    heading === null
      ? body
      : (body.slice(heading.index + heading[0].length).split(/^##\s+/m)[0] ?? "");
  const paragraph = section
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part !== "" && !part.startsWith("#"));
  return (paragraph ?? "").replace(/\s+/g, " ").trim();
}

function splitList(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return [];
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
}

/** يقرأ مجلّد المعرفة. **مجلّد مفقود يعني قائمة فارغة لا عطلاً** — الطبقة تعمل بلا معرفة. */
export function loadKnowledge(
  knowledgeRoot: string,
  log?: (message: string, meta: Record<string, unknown>) => void,
): readonly KnowledgeDocument[] {
  const root = resolve(knowledgeRoot);
  if (!existsSync(root)) {
    log?.("agent_core.knowledge_root_missing", { root: knowledgeRoot });
    return [];
  }

  return guardedSync(
    () => {
      const documents: KnowledgeDocument[] = [];
      for (const name of readdirSync(root).sort()) {
        if (!name.endsWith(".md")) continue;
        const full = join(root, name);
        const raw = guardedSync(() => readFileSync(full, "utf8"), "", log);
        if (raw === "") continue;
        const { meta, body } = parseFrontMatter(raw);
        documents.push({
          id: meta.id ?? name.replace(/\.md$/, ""),
          title: meta.title ?? name.replace(/\.md$/, ""),
          label: meta.label ?? "general_inquiry",
          keywords: splitList(meta.keywords),
          body: body.trim(),
          suggestion: extractSuggestion(body),
          sourceFile: name,
        });
      }
      return documents;
    },
    [],
    log,
  );
}
