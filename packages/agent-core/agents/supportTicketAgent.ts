/**
 * الغرض: **الوكيل الحقيقي الوحيد في هذه المرحلة.** يستقبل حدث فتح تذكرة دعم،
 *   يصنّفه بمطابقة كلمات الذاكرة الطويلة، يبحث في قاعدة المعرفة عن ردّ مناسب،
 *   ويُعيد اقتراحاً نصّياً بمستوى `SUGGEST` — **لا فعل تلقائي إطلاقاً**.
 * الحالة: منفّذ فعلياً وكامل الوظيفة — القسم 3، البند ب.3.
 * ينتمي إلى: packages/agent-core/agents
 * يُتوقع أن يستخدمه لاحقاً: registry.ts، core.ts
 * ملاحظات مستقبلية: عند وصل نموذج حقيقي يُستبدل تركيب النصّ (`compose`) بتوليد
 *   مشروط بالمستندات المطابَقة، **ويبقى كل ما عداه كما هو** — التصنيف والأدلّة
 *   وحدود الصلاحية. النموذج يُحسّن الصياغة لا يمنح صلاحية.
 *
 * ═══ لماذا مطابقة كلمات لا نموذج ═══
 *
 * لأن الاقتراح **يُقرأ ولا يُنفَّذ**. مطابقة الكلمات حتمية وقابلة للتفسير سطراً
 * بسطر: كل اقتراح يحمل الكلمة التي صنّفته والمستند الذي جاء منه. وهذا ما يجعل
 * تقييم أداء الطبقة ممكناً أصلاً في هذه المرحلة — لا يمكن أن تُقيس ما لا تفهم
 * سبب إنتاجه. النموذج يأتي بعد أن يُعرف المقياس، لا قبله.
 *
 * ⚠️ `requestedToolLevel` في هذا الملف هو `"SUGGEST"` حرفياً في كل مسار، ولا يوجد
 * فرعٌ واحد يطلب أعلى منه. ولو طُلب، لرفضه `executionPolicy` و`outputGuard` معاً.
 */

import { normalizeArabic, tokenize } from "../knowledge/knowledgeIndex.ts";
import type { KnowledgeMatch } from "../knowledge/knowledgeSearch.ts";
import { detectMissingData } from "../planning/missingDataDetector.ts";
import { buildPlan, isStepEnabled } from "../planning/planner.ts";
import { analyzeTask } from "../planning/taskAnalyzer.ts";
import type { AgentProposal, EvidenceItem, KeywordEntry } from "../schemas.ts";
import { SUPPORT_TICKET_AGENT_ID } from "./ids.ts";
import type { Agent, AgentContext } from "./types.ts";
import { emptyProposal } from "./types.ts";

/** التصنيفات الثلاثة المعروفة. أكثر منها في هذه المرحلة تصنيفاتٌ لا يُميّزها الدعم. */
export const SUPPORT_CLASSIFICATIONS = [
  "subscription_issue",
  "ride_dispute",
  "general_inquiry",
] as const;
export type SupportClassification = (typeof SUPPORT_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS_AR: Readonly<Record<SupportClassification, string>> = {
  subscription_issue: "مشكلة اشتراك",
  ride_dispute: "نزاع رحلة",
  general_inquiry: "استفسار عام",
};

/** ثقة أساس لكل تصنيف نجح. ما فوقها يأتي من قوّة المطابقة، وما دونها من النقص. */
const BASE_CONFIDENCE = 0.35;
/** أكبر إضافة ممكنة من وزن الكلمات المطابَقة. */
const KEYWORD_CONFIDENCE_SPAN = 0.35;
/** أكبر إضافة ممكنة من قوّة مطابقة المعرفة. */
const KNOWLEDGE_CONFIDENCE_SPAN = 0.25;

interface ClassificationOutcome {
  readonly label: SupportClassification | null;
  readonly matched: readonly KeywordEntry[];
  /** مجموع أوزان الكلمات المطابَقة للتصنيف الفائز. */
  readonly weight: number;
  /** أفضل تصنيف منافس ووزنه — يُقرأ في السبب حين تكون المسافة ضيقة. */
  readonly runnerUp: { readonly label: string; readonly weight: number } | null;
}

function isSupportClassification(value: string): value is SupportClassification {
  return (SUPPORT_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * التصنيف بجمع أوزان الكلمات المطابَقة لكل تصنيف، والأعلى يفوز.
 *
 * لماذا الجمع لا أعلى كلمة مفردة: نصٌّ فيه «اشتراك» و«تجديد» و«دفع» أدلّ على
 * مشكلة اشتراك من نصٍّ فيه «نزاع» وحدها، حتى لو كان وزن «نزاع» المفرد أعلى.
 * تعدّد الإشارات المتوافقة أقوى من إشارة واحدة قوية.
 */
function classify(text: string, keywords: readonly KeywordEntry[]): ClassificationOutcome {
  const normalized = normalizeArabic(text);
  const tokens = new Set(tokenize(text));
  const weights = new Map<string, { weight: number; entries: KeywordEntry[] }>();

  for (const entry of keywords) {
    const keyword = normalizeArabic(entry.keyword.trim());
    if (keyword === "") continue;
    // المطابقة بالتوكِن أولاً (أدقّ)، ثم بالاحتواء (يلتقط «اشتراكي»/«الاشتراك»).
    const hit = tokens.has(keyword) || (keyword.length >= 4 && normalized.includes(keyword));
    if (!hit) continue;

    const bucket = weights.get(entry.label);
    if (bucket === undefined) weights.set(entry.label, { weight: entry.weight, entries: [entry] });
    else {
      bucket.weight += entry.weight;
      bucket.entries.push(entry);
    }
  }

  const ranked = [...weights.entries()]
    .map(([label, bucket]) => ({ label, ...bucket }))
    .sort((left, right) =>
      right.weight === left.weight
        ? left.label.localeCompare(right.label) // ترتيب ثابت عند التعادل
        : right.weight - left.weight,
    );

  const winner = ranked[0];
  if (winner === undefined || !isSupportClassification(winner.label)) {
    return { label: null, matched: [], weight: 0, runnerUp: null };
  }

  const second = ranked[1];
  return {
    label: winner.label,
    matched: winner.entries,
    weight: Number(winner.weight.toFixed(4)),
    runnerUp:
      second === undefined
        ? null
        : { label: second.label, weight: Number(second.weight.toFixed(4)) },
  };
}

/** يحوّل الوزن الخام إلى نسبة في [0,1] تشبع تدريجياً — لا تبلغ 1 بكلمة واحدة. */
function saturate(weight: number): number {
  return weight <= 0 ? 0 : weight / (weight + 1.5);
}

function composeSuggestion(
  classification: SupportClassification,
  best: KnowledgeMatch | undefined,
  missing: readonly string[],
): string {
  const heading = `التصنيف المقترح: ${CLASSIFICATION_LABELS_AR[classification]}.`;

  if (best === undefined || best.document.suggestion === "") {
    return `${heading} لم يُعثر على مستند معرفة مطابق، فلا يوجد ردّ جاهز مقترح — ` + "يُراجَع يدوياً.";
  }

  const caution = missing.length === 0 ? "" : ` تنبيه قبل الإرسال: ${missing.join("؛ ")}.`;

  return (
    `${heading} أقرب مستند: «${best.document.title}». ` +
    `مقترح للنسخ بعد المراجعة: ${best.document.suggestion}${caution}`
  );
}

function buildEvidence(
  matchedKeywords: readonly KeywordEntry[],
  matches: readonly KnowledgeMatch[],
): readonly EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  for (const entry of matchedKeywords) {
    evidence.push({
      source: "memory:keyword",
      excerpt: `«${entry.keyword}» → ${entry.label} (وزن ${entry.weight})`,
      score: entry.weight,
    });
  }
  for (const match of matches) {
    evidence.push({
      source: `knowledge:${match.document.id}`,
      excerpt: match.document.title,
      score: match.score,
    });
  }
  // الأقوى أولاً: قارئ الاقتراح يقرأ أوّل سطرين ولا يقرأ الخامس.
  return evidence.sort((left, right) => right.score - left.score);
}

export function createSupportTicketAgent(): Agent {
  return {
    id: SUPPORT_TICKET_AGENT_ID,
    handles: ["support_ticket_opened"],

    handle: async (context: AgentContext): Promise<AgentProposal> => {
      const { event, shortTerm, longTerm, knowledge } = context;

      // ── الخطوة 1: تحليل المهمّة ─────────────────────────────────────────
      const analysis = analyzeTask(event);
      const plan = buildPlan(event, analysis);
      shortTerm.set("intent", analysis.intent);
      shortTerm.note(`تحليل: ${analysis.rationale}`);

      if (!isStepEnabled(plan, "match_keywords")) {
        shortTerm.note("خطّة مختصرة — لا محاولة تصنيف");
        return emptyProposal(SUPPORT_TICKET_AGENT_ID, analysis.rationale);
      }

      // ── الخطوة 2: التصنيف من الذاكرة الطويلة ────────────────────────────
      // **هذه هي القراءة الوحيدة التي يُبنى عليها قرار** — الطبقة الطويلة وحدها.
      const keywords = longTerm.keywords();
      const outcome = classify(event.text, keywords);
      shortTerm.set("classification", outcome.label);
      shortTerm.note(
        outcome.label === null
          ? "لم تُطابَق كلمة مفتاحية معروفة"
          : `صُنّف ${outcome.label} بوزن ${outcome.weight}` +
              (outcome.runnerUp === null
                ? ""
                : ` (المنافس ${outcome.runnerUp.label}: ${outcome.runnerUp.weight})`),
      );

      // ── الخطوة 3: البحث في المعرفة ──────────────────────────────────────
      const matches = isStepEnabled(plan, "search_knowledge")
        ? outcome.label === null
          ? knowledge.search(event.text, 3) // بلا تصنيف: بحثٌ عامّ لعلّه يفيد المراجع
          : knowledge.searchWithinLabel(event.text, outcome.label, 3)
        : [];
      shortTerm.note(`مطابقات المعرفة: ${matches.length}`);

      const matchedKeywordTexts = outcome.matched.map((entry) => entry.keyword);

      // ── الخطوة 4: ما ينقص ───────────────────────────────────────────────
      const missing = detectMissingData({
        event,
        analysis,
        classification: outcome.label,
        matches,
        matchedKeywords: matchedKeywordTexts,
      });

      if (outcome.label === null) {
        // لا تصنيف = لا اقتراح. **لا نُركّب نصّاً عامّاً** يبدو مفيداً وهو ليس
        // مبنيّاً على شيء: نصٌّ كهذا يُدرّب فريق الدعم على تجاهل كل الاقتراحات.
        return {
          agentId: SUPPORT_TICKET_AGENT_ID,
          classification: null,
          recommendedAction: "",
          confidence: 0,
          requestedToolLevel: "SUGGEST",
          evidence: buildEvidence([], matches),
          missingData: missing,
        };
      }

      // ── الخطوة 5: تركيب الاقتراح ────────────────────────────────────────
      const best = matches[0];
      const confidence = Number(
        Math.min(
          1,
          BASE_CONFIDENCE +
            saturate(outcome.weight) * KEYWORD_CONFIDENCE_SPAN +
            (best?.score ?? 0) * KNOWLEDGE_CONFIDENCE_SPAN,
        ).toFixed(4),
      );

      // تسجيل الإصابات على الكلمات التي استُعملت فعلاً — أساس ترجيح المرشّحات لاحقاً.
      longTerm.recordHits(matchedKeywordTexts);

      return {
        agentId: SUPPORT_TICKET_AGENT_ID,
        classification: outcome.label,
        recommendedAction: composeSuggestion(outcome.label, best, missing),
        confidence,
        // ⚠️ ثابتة في كل مسار. لا فرع في هذا الملف يطلب أعلى منها.
        requestedToolLevel: "SUGGEST",
        evidence: buildEvidence(outcome.matched, matches),
        missingData: missing,
      };
    },
  };
}
