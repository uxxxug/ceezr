/**
 * الغرض: تفكيكُ حواجزِ الحكمِ المُعلَنةِ في `ROADMAP.md` إلى سجلٍّ **مقروءٍ
 *   آليّاً**، كي يكونَ للحاجزِ المفتوحِ مصدرٌ واحدٌ يُقرأُ لا سلسلةٌ حرفيّةٌ
 *   تُنسَخُ في كلِّ ملفٍّ.
 *
 *   **ولا سجلَّ ثانياً ههنا (القاعدةُ 0.6).** هذا الملفُّ لا يُعلِنُ حاجزاً ولا
 *   يحفظُ حالتَه؛ يقرأُ نصَّ `ROADMAP.md` — وهوَ المصدرُ الذي يقرؤُه حارسُ
 *   المصفوفةِ أصلاً (`declaredIds`) — ويُخرِجُ منهُ بِنيةً. فإن أُغلِقَ حاجزٌ في
 *   الخارطةِ سقطَ إغلاقُه ههنا من نفسِه بلا تعديلِ حرفٍ، وإن أُغلِقَ ههنا وحدَه
 *   فلا وجودَ لذاكَ الإغلاقِ.
 *
 *   والعطبُ الذي يُغلِقُه هذا الملفُّ مَقيسٌ لا مُتخيَّلٌ: معرّفاتُ الحواجزِ
 *   (`DEP-CORE-001`…`007` و`O-1`/`O-2` و`B-1`…`B-5`) كانت سلاسلَ حرفيّةً في
 *   أكثرَ من عشرينَ ملفَّ TypeScript، فمعرّفٌ مُختلَقٌ أو مُخطَأٌ حرفاً يُقرأُ
 *   حكماً، ولا سبيلَ آليٌّ إلى سؤالِ «هل هذا الحاجزُ مفتوحٌ الآنَ؟».
 *
 *   **والفشلُ مغلقٌ لا مفتوحٌ**: `blockerStatus` لمعرّفٍ غيرِ مُعلَنٍ **يرمي**،
 *   ولا يُرجِعُ «مُغلَقاً» ولا `undefined`. لأنَّ سؤالاً عن حاجزٍ مجهولٍ إن أُجيبَ
 *   بـ«لا حاجزَ» صارَ الجهلُ إذناً.
 *
 * الحالة: منفّذ فعلياً — `W-8` (زيادةٌ ثانيةٌ)، ومحروسٌ بـ
 *   `scripts/check-blocker-registry.ts`.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: مُصدِرُ إشهادِ CORE في
 *   `scripts/lib/wasla-migration-dry-run.ts`، وتمرينُ التحوُّلِ في `W-9`، وكلُّ
 *   حاجزٍ يحتاجُ أن يسألَ عن حالةِ حاجزٍ بدلاً من أن يفترضَها.
 * ملاحظات مستقبلية: إن صارَ للخارطةِ تمثيلٌ مُهيكَلٌ (JSON/YAML) فيُبدَّلُ
 *   `parseBlockers` وحدَه؛ ولا يعلمُ مُنادٍ واحدٌ بالتبديلِ.
 */

/** صنفُ الحاجزِ. **مغلقٌ**: لا صنفَ رابعَ يُخترَعُ في موقعِ النداءِ. */
export type BlockerKind = "CORE_DEPENDENCY" | "OWNER_DECISION" | "PROGRAMME_BLOCKER";

/** حالةُ الحاجزِ كما تُقرأُ من صفِّه. لا حالةَ ثالثةَ ولا «غيرُ معروفٍ». */
export type BlockerStatus = "OPEN" | "CLOSED";

/** حاجزٌ واحدٌ مُفكَّكٌ من صفِّ جدولٍ في `ROADMAP.md`. */
export interface Blocker {
  readonly id: string;
  readonly kind: BlockerKind;
  /** ما هوَ الحاجزُ، بنصِّ الخارطةِ لا بإعادةِ صياغةٍ. */
  readonly statement: string;
  /** ماذا يمنعُ، بنصِّ الخارطةِ. */
  readonly blocks: string;
  readonly status: BlockerStatus;
  /**
   * دليلُ الإغلاقِ كما هوَ مكتوبٌ في الصفِّ. `undefined` للمفتوحِ.
   * **ولا يُستبدَلُ بنصٍّ عامٍّ**: «مُغلَقٌ» بلا التزامٍ ولا تاريخٍ ليسَ دليلاً،
   * والحارسُ يُخفِقُ عليه.
   */
  readonly closureNote?: string;
}

/** نمطُ معرّفِ الحاجزِ. **واحدٌ** ههنا كي لا يتفرَّقَ في الحرّاسِ. */
export const BLOCKER_ID_PATTERN = /\b(?:B-\d+|O-\d+|DEP-CORE-\d{3})\b/g;

/**
 * # ذِكرُ حاجزٍ **ليسَ حاجزَنا** — بادِئةُ نطاقِ المستودَعِ المالِكِ
 *
 * MOVE يقرأُ CORE ويُوَثِّقُ ما قرأَ: فيومَ يُعادُ نقلُ عقدٍ يُسمَّى العملُ
 * الذي غيَّرَه عندَ مالِكِه بمعرّفِه هناكَ. ومعرّفاتُ CORE تقعُ في نفسِ
 * صيغةِ معرّفاتِنا (`B-\d+`)، فكانَ كلُّ اقتباسٍ يُقرَأُ حاجزاً من حواجزِنا
 * بلا صفٍ، فيُخفِقُ الحاجزُ — والمخرجانِ اللذانِ كانا متاحَينِ قبلَ هذه
 * البادِئةِ كلاهما عَطَبٌ: إمّا أن يُكتبَ لحاجزِ CORE صفٌّ في جدولِنا — وهوَ
 * ادّعاءُ ملكيّةٍ كاذبٌ، وحالتُه عندَنا ستُقادُ يداً فتنحرفُ عن مالِكِها — وإمّا
 * أن يُضافَ إعفاءٌ لكلِّ معرّفٍ يُقتبَسُ، فيصيرُ الإعفاءُ روتيناً يدويّاً ينمو معَ
 * كلِّ اقتباسٍ حتّى يُفرَّغَ الحاجزُ من معناه.
 *
 * فالمخرجُ بادِئةٌ منصوصةٌ: `CORE:B-23` و`MARKET:B-4`. وهيَ ليست
 * تخفيفاً للحاجزِ بل تحديدٌ لموضوعِه: الحاجزُ يفرِضُ أنَّ كلَّ معرّفٍ **من
 * حواجزِنا** له صفٌّ تُقرأُ منه حالتُه، وذِكرُ حاجزٍ أجنبيٍّ لا حالَةَ له عندَنا
 * ألبتّةَ — فما لا نملِكُه لا نُدعي إغلاقَه ولا فتحَه. والبادِئةُ **محصورةٌ في
 * مستودَعَينِ مُسمَّيَينِ**، فلا تصيرُ باباً يُمرَّرُ منه أيُّ معرّفٍ ببادِئةٍ مختلَقةٍ.
 */
export const FOREIGN_BLOCKER_MENTION_PATTERN = /\b(?:CORE|MARKET):(?:B-\d+|O-\d+)\b/g;

/** يُخفِقُ سؤالٌ عن حاجزٍ غيرِ مُعلَنٍ. **صنفٌ مسمّىً** كي يُقاسَ في اختبارٍ. */
export class UnknownBlockerError extends Error {
  constructor(public readonly id: string) {
    super(
      `معرّفُ حاجزٍ غيرُ مُعلَنٍ في ROADMAP.md: ${id}. ولا يُفترَضُ مُغلَقاً: سؤالٌ عن حاجزٍ مجهولٍ إن أُجيبَ بـ«لا حاجزَ» صارَ الجهلُ إذناً.`,
    );
    this.name = "UnknownBlockerError";
  }
}

interface SectionRule {
  readonly kind: BlockerKind;
  /** عنوانُ القسمِ الذي يحملُ الجدولَ، كما هوَ في `ROADMAP.md`. */
  readonly heading: RegExp;
  /** نمطُ المعرّفِ المقبولِ في العمودِ الأوّلِ من ذلكَ الجدولِ. */
  readonly id: RegExp;
}

/**
 * الأقسامُ الثلاثةُ التي تحملُ الحواجزَ. **العنوانُ شرطٌ لا العمودُ وحدَه**: صفٌّ
 * يبدأُ بـ`B-2` في جدولِ مخاطرَ لا يُقرأُ حاجزاً، وإلّا صارَ كلُّ ذكرٍ إعلاناً.
 */
const SECTIONS: readonly SectionRule[] = [
  {
    kind: "CORE_DEPENDENCY",
    heading: /^##\s+Cross-repository dependencies on CORE/m,
    id: /^DEP-CORE-\d{3}$/,
  },
  { kind: "OWNER_DECISION", heading: /^##\s+Owner decisions required/m, id: /^O-\d+$/ },
  { kind: "PROGRAMME_BLOCKER", heading: /^##\s+Blockers\s*$/m, id: /^B-\d+$/ },
];

/** يقتطعُ جسمَ قسمٍ: من عنوانِه حتّى العنوانِ التالي من الرتبةِ عينِها أو أعلى. */
function sectionBody(text: string, heading: RegExp): string | undefined {
  const start = text.match(heading);
  if (start?.index === undefined) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const next = rest.search(/^##\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** خلايا صفِّ جدولٍ، بلا الحدَّينِ الفارغَينِ. */
function cellsOf(line: string): readonly string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed
    .slice(1, trimmed.endsWith("|") ? -1 : undefined)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * هل يُقرأُ هذا الصفُّ مُغلَقاً؟ **الشرطُ ظاهرٌ**: كلمةُ `CLOSED` (أو «مُغلَق»)
 * في نصِّ الصفِّ. ولا يُستنتَجُ الإغلاقُ من شطبٍ وحدَه: نصٌّ مشطوبٌ بلا كلمةِ
 * إغلاقٍ يبقى مفتوحاً، لأنَّ الشطبَ تنسيقٌ والإغلاقُ حكمٌ.
 */
function readsClosed(rowText: string): boolean {
  return /\bCLOSED\b|مُغلَق|مغلقة/.test(rowText);
}

/**
 * دليلُ الإغلاقِ المكتوبُ في الصفِّ: ما بعدَ كلمةِ الإغلاقِ. يُرجَعُ خاماً كي
 * يقيسَه الحارسُ (التزامٌ أو تاريخٌ)، ولا يُنقَّى ههنا فيُفقَدَ ما يُقاسُ.
 */
function closureNoteOf(rowText: string): string | undefined {
  const match = rowText.match(/(?:\bCLOSED\b|مُغلَق|مغلقة)(.*)$/s);
  const note = match?.[1]?.trim();
  return note === undefined || note === "" ? undefined : note;
}

/**
 * يُفكِّكُ كلَّ الحواجزِ المُعلَنةِ. **دالّةٌ نقيّةٌ تأخذُ النصَّ** كي تُختبَرَ
 * بخارطةٍ مُفسَدةٍ بلا ملفٍّ ولا قاعدةٍ.
 */
export function parseBlockers(roadmapText: string): readonly Blocker[] {
  const blockers: Blocker[] = [];
  const seen = new Set<string>();
  for (const section of SECTIONS) {
    const body = sectionBody(roadmapText, section.heading);
    if (body === undefined) continue;
    for (const line of body.split("\n")) {
      const cells = cellsOf(line);
      if (cells.length < 3) continue;
      const id = (cells[0] ?? "").replace(/[`*]/g, "").trim();
      if (!section.id.test(id) || seen.has(id)) continue;
      seen.add(id);
      const statement = cells[1] ?? "";
      const blocks = cells[2] ?? "";
      const closed = readsClosed(line);
      const note = closed ? closureNoteOf(line) : undefined;
      blockers.push({
        id,
        kind: section.kind,
        statement,
        blocks,
        status: closed ? "CLOSED" : "OPEN",
        ...(note === undefined ? {} : { closureNote: note }),
      });
    }
  }
  return blockers;
}

/** الحواجزُ بمعرّفاتِها. */
export function blockerById(blockers: readonly Blocker[]): Map<string, Blocker> {
  return new Map(blockers.map((blocker) => [blocker.id, blocker]));
}

/**
 * حالةُ حاجزٍ. **ترمي `UnknownBlockerError`** لمعرّفٍ غيرِ مُعلَنٍ، ولا تُرجِعُ
 * قيمةً تُقرأُ إذناً.
 */
export function blockerStatus(id: string, blockers: readonly Blocker[]): BlockerStatus {
  const blocker = blockerById(blockers).get(id);
  if (blocker === undefined) throw new UnknownBlockerError(id);
  return blocker.status;
}

/** هل الحاجزُ مفتوحٌ؟ ترمي للمجهولِ، للسببِ عينِه. */
export function isBlockerOpen(id: string, blockers: readonly Blocker[]): boolean {
  return blockerStatus(id, blockers) === "OPEN";
}

/** المفتوحةُ وحدَها، بترتيبِ المعرّفِ. */
export function openBlockers(blockers: readonly Blocker[]): readonly Blocker[] {
  return blockers.filter((blocker) => blocker.status === "OPEN");
}

/**
 * كلُّ معرّفٍ **مذكورٍ** في نصٍّ — ذكراً لا إعلاناً، **ومن حواجزِنا دونَ غيرِنا**.
 * فالمذكورُ ببادِئةِ مستودَعٍ مالِكٍ (`CORE:B-23`) يُسقَطُ قبلَ المسحِ لا بعدَه:
 * إسقاطُ النصِّ أوّلاً يمنعُ أن يُقرأَ منه المعرّفُ العاري مرّةً ثانيةً.
 */
export function mentionedBlockerIds(text: string): ReadonlySet<string> {
  const ours = text.replace(FOREIGN_BLOCKER_MENTION_PATTERN, " ");
  return new Set(ours.match(BLOCKER_ID_PATTERN) ?? []);
}
