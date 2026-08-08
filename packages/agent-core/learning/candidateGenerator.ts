/**
 * الغرض: توليد مرشّحات تعلّم من التجارب الناجحة — كلماتٌ تكرّرت في تذاكر قُبلت
 *   اقتراحاتها وليست في الذاكرة الطويلة بعد.
 * الحالة: منفّذ فعلياً — **مرشّحات ذاكرة فقط (keyword/entity)**، القسم 3، ب.6.
 * ينتمي إلى: packages/agent-core/learning
 * يُتوقع أن يستخدمه لاحقاً: gateway.generateCandidates()
 * ملاحظات مستقبلية: توسيع `candidate_type` إلى `policy` أو `code` يحتاج **أمراً
 *   صريحاً جديداً**. النوعان معرَّفان في `schemas.ts` ومرفوضان في
 *   `learningPolicy.isTypeImplemented` — والعقد وحده لا يُنفَّذ.
 *
 * ⚠️ ═══ لا اقتراح كود ولا سياسة. مرشّحات ذاكرة فقط ═══
 *
 * الفرق ليس تقنياً بل في حدّ الضرر: كلمةٌ مفتاحية خاطئة تُنتج اقتراحاً سيّئاً
 * يقرؤه موظّف فيتجاهله. سياسةٌ خاطئة تُغيّر سلوك النظام على كل حدث لاحق. الأولى
 * خطؤها محصور ومرئي، والثانية خطؤها ينتشر قبل أن يُلاحَظ.
 *
 * ═══ لماذا التجارب المقبولة وحدها ═══
 *
 * الكلمة التي تكرّرت في تذاكر **قُبلت** اقتراحاتها كلمةٌ أثبتت أنها تدلّ على ما
 * صُنّفت له. والتكرار في تذاكر رُفضت أو تُجوهلت ليس إشارة تعلّم بل إشارة خطأ —
 * التعلّم منه يُرسّخ الخطأ ويُسمّيه تحسّناً.
 */

import { normalizeArabic } from "../knowledge/knowledgeIndex.ts";
import type { LongTermMemory } from "../memory/longTerm.ts";
import type { MediumTermEntry } from "../memory/mediumTerm.ts";
import { checkCandidateEligibility } from "../policies/learningPolicy.ts";
import type { CandidateType, LearningCandidate, OutcomeRecord } from "../schemas.ts";

export interface CandidateGenerationInput {
  readonly entries: readonly MediumTermEntry[];
  readonly outcomes: readonly OutcomeRecord[];
  readonly memory: LongTermMemory;
  readonly minSupport: number;
  readonly now: () => Date;
}

export interface GeneratedCandidate {
  readonly candidate: LearningCandidate;
  readonly eligible: boolean;
  readonly reason: string;
}

/** أقصى ما يُولَّد في مرّة واحدة. قائمةٌ أطول لا تُراجَع بل يُوافَق عليها بالجملة. */
const MAX_CANDIDATES_PER_RUN = 20;

function candidateId(type: CandidateType, subject: string, label: string): string {
  return `${type}:${label}:${normalizeArabic(subject)}`;
}

export function generateCandidates(input: CandidateGenerationInput): readonly GeneratedCandidate[] {
  const acceptedTraces = new Set(
    input.outcomes.filter((outcome) => outcome.verdict === "accepted").map((o) => o.traceId),
  );
  if (acceptedTraces.size === 0) return [];

  // ما هو معروف أصلاً — لا يُقترح مرّة أخرى.
  const known = new Set(
    input.memory.keywords().map((entry) => normalizeArabic(entry.keyword.trim())),
  );

  // توكِن × تصنيف → عدد التجارب المقبولة التي ورد فيها.
  const counts = new Map<string, { subject: string; label: string; support: number }>();

  for (const entry of input.entries) {
    if (!acceptedTraces.has(entry.traceId)) continue;
    if (entry.classification === null) continue;

    // التوكِنات التي **لم** تكن سبب التصنيف: الكلمات المطابَقة معروفة أصلاً،
    // والتعلّم يكون ممّا رافقها لا منها.
    const matched = new Set(entry.matchedKeywords.map((keyword) => normalizeArabic(keyword)));

    for (const rawToken of new Set(entry.tokens)) {
      const token = normalizeArabic(rawToken);
      if (token === "" || matched.has(token) || known.has(token)) continue;
      const key = `${entry.classification}::${token}`;
      const current = counts.get(key);
      if (current === undefined) {
        counts.set(key, { subject: token, label: entry.classification, support: 1 });
      } else {
        current.support += 1;
      }
    }
  }

  const timestamp = input.now().toISOString();

  return [...counts.values()]
    .sort((left, right) =>
      right.support === left.support
        ? left.subject.localeCompare(right.subject) // ترتيب ثابت
        : right.support - left.support,
    )
    .slice(0, MAX_CANDIDATES_PER_RUN)
    .map((entry) => {
      const candidate: LearningCandidate = {
        candidateId: candidateId("keyword", entry.subject, entry.label),
        candidateType: "keyword",
        // **`pending` دائماً.** لا مسار في هذا الملف يُنتج `approved` — الاعتماد
        // في `approvalFlow` وحده، بيد إنسان.
        status: "pending",
        subject: entry.subject,
        label: entry.label,
        supportCount: entry.support,
        rationale:
          `ورد «${entry.subject}» في ${entry.support} تذكرة قُبل اقتراحها ` +
          `وصُنّفت ${entry.label}، وليس في الذاكرة الطويلة`,
        createdAt: timestamp,
        decidedAt: null,
        decidedBy: null,
      };

      const eligibility = checkCandidateEligibility(candidate, input.minSupport, known);
      return { candidate, eligible: eligibility.eligible, reason: eligibility.reason };
    });
}
