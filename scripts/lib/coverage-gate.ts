/**
 * # بوابةُ التغطيةِ على المسارات الحرجة — وحدةٌ نقيّةٌ
 *
 * **الغرض:** أن يستحيل أن تنقص تغطيةُ الاختبارِ على مسارٍ حرجٍ **بلا إشعارٍ**. وهي
 * تقرأ ثلاثةَ أشياءَ مُمرَّرةً — سجلَّ الأرضيّاتِ المغلقَ، ومخرجَ `lcov` المقيسَ،
 * وقائمةَ ملفّاتِ المصدرِ على القرصِ — فتحكم، ولا تقرأ هي شيئاً من نظامِ الملفّات.
 *
 * **الحالة:** `OPS-005` — مُنفَّذ · مُختبَر · مبرهَنُ السقوط (ADR 0048).
 *
 * **ينتمي إلى:** البند `OPS-005` · القسم 11-د (بوابات CI).
 *
 * **يُتوقع أن يستخدمه لاحقاً:** `scripts/check-coverage-gate.ts` وحدَه اليومَ.
 *
 * ## المقياسانِ ولِمَ اثنانِ لا واحدٌ
 *
 * أداةُ التغطيةِ في bun **لا تُدرِج ملفّاً لم يُحمَّل في أيِّ اختبارٍ**. فملفٌّ لا
 * يستورده اختبارٌ واحدٌ يغيب عن `lcov` غياباً تامّاً، ونسبةُ التغطيةِ المحسوبةُ من
 * `lcov` وحدَه تعلو بغيابِه لا تنخفض. وهذا **أخضرُ كاذبٌ** في جوهرِه: `claim-order.ts`
 * غائبٌ اليومَ عن القياسِ، فحسابُ «تغطيةِ الإسنادِ» من `lcov` وحدَه يُخفيه.
 *
 * فالحاجزُ يقيس مقياسَين معاً على كلِّ مسارٍ حرجٍ:
 * 1. **`minLineCoverage`** — نسبةُ الأسطرِ المنفَّذةِ على الملفّاتِ **المقيسة**.
 * 2. **`maxUnmeasuredFiles`** — عددُ ملفّاتِ المصدرِ على القرصِ التي **لم يُحمِّلها
 *    اختبارٌ قطُّ**. سقفٌ لا يعلو: إضافةُ ملفٍّ جديدٍ بلا اختبارٍ تُسقِط البناءَ.
 *
 * والأرضيّاتُ والسقوفُ في {@link ./coverage-registry.ts} **مقيسةٌ يومَ التصنيفِ لا
 * مُتخيَّلةٌ**، وهي مِرقاةٌ (ratchet): تُرفَع بقصدٍ ولا تُخفَّض إلّا بقرارٍ مُدوَّنٍ.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **لا تُشغِّل الاختباراتَ ولا تقيس شيئاً.** تقرأ مخرجَ قياسٍ جرى قبلَها؛ فإن كان
 *   المخرجُ ناقصاً كُشِف بـ{@link GateInput.minMeasuredFiles} لا بالثقةِ.
 * - **لا تُميِّز ملفَّ الأنواعِ من ملفِّ المنطق.** `errors.ts` و`events.ts` و`index.ts`
 *   قد لا تحمل سطراً قابلاً للتنفيذِ أصلاً، وهي محسوبةٌ في السقفِ كما هي: السقفُ
 *   **عددٌ خامٌ** لا حكمٌ على الدَّين. ولذلك لا يُقرأ «سقفٌ = 12» على أنّه «12 ملفَّ
 *   منطقٍ بلا اختبارٍ».
 * - **لا تقيس التفرّعَ (branch) ولا الدوالَّ.** الأسطرُ فقط، لأنّ `lcov` من bun
 *   يُصدِر `DA:` موثوقاً و`BRDA:` غيرَ مُصدَرٍ.
 * - **لا تحكم على انحدارِ الأداءِ.** ذلك الشطرُ الثاني من `OPS-005` وهو محجوبٌ
 *   بـ`OPS-004`/`REQ-06` (لا مولِّدَ حملٍ موزَّعٌ)، فلا يُدَّعى ههنا.
 */

/** تغطيةُ ملفٍّ واحدٍ كما قرأها `lcov`: أسطرٌ قابلةٌ للتنفيذِ وما نُفِّذ منها. */
export interface FileCoverage {
  readonly totalLines: number;
  readonly hitLines: number;
}

/**
 * يقرأ `lcov.info` نصّاً: `SF:` مسارُ الملفِّ، و`DA:<سطر>,<مرّات>` سطرٌ قابلٌ
 * للتنفيذِ ومرّاتُ تنفيذِه. تُجمَع السجلّاتُ المتكرّرةُ لملفٍّ واحدٍ (يُصدِرها bun
 * مرّةً لكلِّ ملفِّ اختبارٍ في بعضِ الإصداراتِ) بأخذِ أكبرِ عددِ مرّاتٍ لكلِّ سطرٍ،
 * فلا يُحتسَب سطرٌ مرّتَين ولا يُفقَد تنفيذٌ حصلَ في أحدِ السجلَّين.
 */
export function parseLcov(text: string): ReadonlyMap<string, FileCoverage> {
  const perFile = new Map<string, Map<number, number>>();
  let current: Map<number, number> | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      const existing = perFile.get(file);
      if (existing === undefined) {
        current = new Map<number, number>();
        perFile.set(file, current);
      } else {
        current = existing;
      }
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!line.startsWith("DA:") || current === null) continue;
    const [rawLineNumber, rawHits] = line.slice(3).split(",");
    const lineNumber = Number.parseInt(rawLineNumber ?? "", 10);
    const hits = Number.parseInt(rawHits ?? "", 10);
    if (!Number.isFinite(lineNumber) || !Number.isFinite(hits)) continue;
    const previous = current.get(lineNumber) ?? 0;
    current.set(lineNumber, Math.max(previous, hits));
  }

  const result = new Map<string, FileCoverage>();
  for (const [file, lines] of perFile) {
    let hitLines = 0;
    for (const hits of lines.values()) {
      if (hits > 0) hitLines += 1;
    }
    result.set(file, { totalLines: lines.size, hitLines });
  }
  return result;
}

/** أرضيّةُ مسارٍ حرجٍ واحدٍ — مدخلٌ في سجلٍّ مغلقٍ لا يُولَّد. */
export interface CriticalPathBar {
  /** نصُّه حرفيّاً من `CRITICAL_PATHS` في `scripts/lib/skip-registry.ts`. */
  readonly criticalPath: string;
  /** بادئاتُ مساراتِ المصدرِ التي تُمثِّل هذا المسارَ الحرجَ — لا تكون فارغةً. */
  readonly roots: readonly string[];
  /** أرضيّةُ نسبةِ الأسطرِ على الملفّاتِ المقيسة، أو `null` إن كان المسارُ غيرَ مُبَوَّبٍ. */
  readonly minLineCoverage: number | null;
  /** سقفُ عددِ الملفّاتِ التي لم يُحمِّلها اختبارٌ، أو `null` إن كان المسارُ غيرَ مُبَوَّبٍ. */
  readonly maxUnmeasuredFiles: number | null;
  /** بيانُ سببِ عدمِ التبويبِ — إلزاميٌّ متى كانت الأرضيّتانِ معدومتَين، ومحرَّمٌ خلافَ ذلك. */
  readonly reason: string | null;
  readonly owner: string;
}

/** ما يحتاجه الحكمُ — كلُّه مُمرَّرٌ، فالوحدةُ لا تقرأ شيئاً بنفسِها. */
export interface CoverageAuditInput {
  readonly bars: readonly CriticalPathBar[];
  /** القائمةُ المغلقةُ للمساراتِ الحرجةِ كما هي في سجلِّ التجاوز. */
  readonly criticalPaths: readonly string[];
  readonly coverage: ReadonlyMap<string, FileCoverage>;
  /** كلُّ ملفّاتِ المصدرِ المرشَّحةِ في المستودعِ، مساراتٌ نسبيّةٌ من الجذر. */
  readonly sourceFiles: readonly string[];
  /**
   * أدنى عددِ ملفّاتٍ مقيسةٍ يُقبَل في `lcov` قبلَ الحكم. حرزٌ من قياسٍ جزئيٍّ أو
   * قديمٍ يُقرَأ نجاحاً — ليس هدفَ تغطيةٍ.
   */
  readonly minMeasuredFiles: number;
}

/** تقريرُ مسارٍ حرجٍ واحدٍ — يُطبَع كلَّ تشغيلٍ ليكون الدَّينُ مرئيّاً. */
export interface CriticalPathReport {
  readonly criticalPath: string;
  readonly totalFiles: number;
  readonly measuredFiles: number;
  readonly unmeasuredFiles: readonly string[];
  readonly totalLines: number;
  readonly hitLines: number;
  /** `null` متى لم يُقَس ملفٌّ واحدٌ، فلا تُختلَق نسبةٌ. */
  readonly lineCoverage: number | null;
  readonly gated: boolean;
}

export interface CoverageAuditResult {
  readonly violations: readonly string[];
  readonly reports: readonly CriticalPathReport[];
}

const MIN_REASON_PROSE = 40;
/** هامشُ فاصلةٍ عائمةٍ: 82.5 ≥ 82.5 لا يُسقِطها خطأُ تمثيلٍ. */
const EPSILON = 1e-9;

function filesUnder(roots: readonly string[], sourceFiles: readonly string[]): readonly string[] {
  const matched: string[] = [];
  for (const file of sourceFiles) {
    for (const root of roots) {
      if (file === root || file.startsWith(root.endsWith("/") ? root : `${root}/`)) {
        matched.push(file);
        break;
      }
    }
  }
  return matched;
}

/**
 * يحكم على السجلِّ في مقابلِ القياسِ والقرصِ، ويُعيد المخالفاتِ والتقاريرَ.
 * قائمةُ مخالفاتٍ فارغةٌ تعني **«لا انحدارَ عن المقيسِ يومَ التصنيف»** — ولا تعني
 * «التغطيةُ كافيةٌ».
 */
export function auditCoverage(input: CoverageAuditInput): CoverageAuditResult {
  const { bars, criticalPaths, coverage, sourceFiles, minMeasuredFiles } = input;
  const violations: string[] = [];
  const reports: CriticalPathReport[] = [];

  if (coverage.size < minMeasuredFiles) {
    violations.push(
      `القياسُ ناقصٌ: ${coverage.size} ملفّاً في lcov والحدُّ الأدنى ${minMeasuredFiles} — ` +
        `مخرجُ تغطيةٍ جزئيٌّ أو قديمٌ لا يُقرَأ نجاحاً.`,
    );
  }

  const seen = new Set<string>();
  for (const bar of bars) {
    if (seen.has(bar.criticalPath)) {
      violations.push(`مسارٌ حرجٌ مكرَّرٌ في السجلِّ: ${bar.criticalPath}`);
    }
    seen.add(bar.criticalPath);
    if (!criticalPaths.includes(bar.criticalPath)) {
      violations.push(
        `${bar.criticalPath}: مسارٌ خارجَ القائمةِ المغلقةِ في skip-registry — ` +
          `القائمتانِ تُقرَآنِ معاً فلا تتفرّقان.`,
      );
    }
  }
  for (const path of criticalPaths) {
    if (!seen.has(path)) {
      violations.push(`${path}: مسارٌ حرجٌ لا أرضيّةَ له ولا بيانَ — القائمةُ مغلقةٌ فلا يُترَك مسارٌ.`);
    }
  }

  for (const bar of bars) {
    const gated = bar.minLineCoverage !== null || bar.maxUnmeasuredFiles !== null;

    if (bar.roots.length === 0) {
      violations.push(
        `${bar.criticalPath}: لا بادئةَ مصدرٍ واحدةً — لا يُحكَم على مسارٍ بلا شيفرةٍ مُسمّاةٍ.`,
      );
    }
    if (bar.owner.trim().length === 0) {
      violations.push(`${bar.criticalPath}: لا مالكَ — كلُّ أرضيّةٍ أو دَينٍ مملوكٌ.`);
    }

    if (gated && bar.reason !== null) {
      violations.push(
        `${bar.criticalPath}: بيانُ سببٍ مع أرضيّةٍ مضروبةٍ — البيانُ محرَّمٌ ههنا كي لا يُلبَس ` +
          `الحاجزُ ثوبَ العُذر.`,
      );
    }
    if (!gated && (bar.reason === null || bar.reason.trim().length < MIN_REASON_PROSE)) {
      violations.push(
        `${bar.criticalPath}: مسارٌ غيرُ مُبَوَّبٍ بلا بيانٍ كافٍ (${MIN_REASON_PROSE} حرفاً على الأقلّ) — ` +
          `فلا يُسكَتُ عن مسارٍ حرجٍ.`,
      );
    }

    const files = filesUnder(bar.roots, sourceFiles);
    for (const root of bar.roots) {
      if (filesUnder([root], sourceFiles).length === 0) {
        violations.push(
          `${bar.criticalPath}: البادئةُ «${root}» لا تُطابِق ملفَّ مصدرٍ واحداً — ` +
            `نُقِل الكودُ أو أُعيدَ تسميتُه، فالسجلُّ يُحدَّث بقصدٍ لا يُتجاهَل.`,
        );
      }
    }

    const measured = files.filter((file) => coverage.has(file));
    const unmeasured = files.filter((file) => !coverage.has(file));
    let totalLines = 0;
    let hitLines = 0;
    for (const file of measured) {
      const entry = coverage.get(file) as FileCoverage;
      totalLines += entry.totalLines;
      hitLines += entry.hitLines;
    }
    const lineCoverage = totalLines === 0 ? null : (100 * hitLines) / totalLines;

    reports.push({
      criticalPath: bar.criticalPath,
      totalFiles: files.length,
      measuredFiles: measured.length,
      unmeasuredFiles: unmeasured,
      totalLines,
      hitLines,
      lineCoverage,
      gated,
    });

    if (bar.minLineCoverage !== null) {
      if (lineCoverage === null) {
        violations.push(
          `${bar.criticalPath}: أرضيّةٌ مضروبةٌ (${bar.minLineCoverage}%) ولا سطرَ مقيساً واحداً — ` +
            `غيابُ القياسِ ليس نجاحاً.`,
        );
      } else if (lineCoverage + EPSILON < bar.minLineCoverage) {
        violations.push(
          `${bar.criticalPath}: تغطيةُ الأسطرِ ${lineCoverage.toFixed(2)}% دونَ الأرضيّةِ ` +
            `${bar.minLineCoverage}% (${hitLines}/${totalLines} سطراً في ${measured.length} ملفّاً).`,
        );
      }
    }

    if (bar.maxUnmeasuredFiles !== null && unmeasured.length > bar.maxUnmeasuredFiles) {
      const extra = unmeasured.slice(0, 10).join("، ");
      violations.push(
        `${bar.criticalPath}: ${unmeasured.length} ملفّاً لم يُحمِّلها اختبارٌ والسقفُ ` +
          `${bar.maxUnmeasuredFiles} — السقفُ لا يعلو: ${extra}` +
          `${unmeasured.length > 10 ? " …" : ""}`,
      );
    }
  }

  return { violations, reports };
}
