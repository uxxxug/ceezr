/**
 * الغرض: قواعدُ حاجزٍ واحدةٍ نصّاً — **تدهورُ الصمودِ يُقاسُ بعملِ المحرِّكِ لا
 *   بزمنِ الساعةِ**، ولا يُخفَّفُ سقفُه، ولا يُعادُ تشغيلُه حتّى يخضَرَّ.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-soak-work-measure.ts و
 *   tests/unit/check-soak-work-measure.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ اختبارِ صمودٍ أو حِملٍ يُضافُ لاحقاً ويُوكِّدُ
 *   «لا تدهورَ معَ الطولِ» — القاعدةُ فيهِ عينُها.
 * الحاكم: docs/adr/0130-degradation-is-measured-in-work-not-in-clock-time.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 * `tests/e2e/ride-soak.test.ts` كانَ يوكِّدُ أنَّ متوسّطَ زمنِ آخرِ خمسِ رحلاتٍ أقلُّ
 * من ثلاثةِ أضعافِ متوسّطِ أوّلِ خمسٍ. و`performance.now()` على مُنفِّذٍ **مُشترَكٍ**
 * يقيسُ زمنَ الجدارِ: حِملُ جارٍ على النواةِ عينِها يضاعفُ الرقمَ بلا حرفٍ تغيَّرَ
 * في شِفرتِنا. فقرأَ التوكيدُ **٣٫٢** في التشغيلِ `35124024068` على `60b1a94` ثمَّ
 * مرَّ بإعادةِ التشغيلِ **بالبصمةِ عينِها** — إنذارٌ على ضجيجٍ، ومعَهُ صمتٌ محتمَلٌ
 * عن نموٍّ حقيقيٍّ يختفي تحتَ التقلُّبِ. وذاكَ قياسٌ كاذبٌ في الاتّجاهَينِ.
 *
 * فبُدِّلَت **وحدةُ القياسِ** (`DEC-18`): صفوفٌ ممسوحةٌ وكُتَلٌ ملموسةٌ من
 * `pg_stat_database`. **والسقفُ لم يُمَسَّ: ×٣ كما كانَ.**
 *
 * ## وما يحرسُهُ هذا الملفُّ بالضبطِ
 * أنَّ الوحدةَ لا ترتدُّ إلى الساعةِ خِلسةً، وأنَّ السقفَ مصدرُ حقيقةٍ واحدٌ لا
 * رقمٌ مبثوثٌ في التوكيدِ، وأنَّ القراءةَ تمرُّ بسكونٍ مقيسٍ، وأنَّ الاختبارَ لا
 * يُعادُ تشغيلُه حتّى يخضَرَّ. **ستُّ قواعدَ، لكلِّ واحدةٍ سالبةٌ مبذورةٌ** (`ح-٧`)؛ وسابعةٌ
 *   `settle.idle-flush` زيادةً (`D-35` · `ADR 0191`).
 *
 * ## وما لا يفعلُه عن قصدٍ
 * ــ **لا يمنعُ `performance.now()` في المستودَعِ كلِّه**: قياسُ زمنٍ للعرضِ أو
 *    للسجلِّ مشروعٌ؛ الممنوعُ **توكيدٌ** يحكُمُ بزمنِ الساعةِ في ملفِّ الصمودِ.
 * ــ **لا يفرضُ رقماً للسقفِ أقلَّ من ثلاثةٍ**: `DEC-18` قرارُ وحدةِ قياسٍ لا
 *    تشديدُ عتبةٍ. الممنوعُ **رفعُه** فوقَ ما كانَ.
 * ــ **لا يقرأُ القرصَ**: دوالُّ خالصةٌ تأخذُ نصّاً، فيُقاسُ الحاجزُ بسالباتٍ
 *    مبذورةٍ لا بما يصادفُه المستودَعُ (`ح-٧`) — وقد مرَّ ههنا حاجزٌ أخضرُ وهوَ
 *    معطوبٌ لأنَّهُ قِيسَ على المستودَعِ الحقيقيِّ وحدَه.
 */

/** ملفُّ اختبارِ الصمودِ المحكومُ بهذهِ القواعدِ. */
export const SOAK_TEST_FILE = "tests/e2e/ride-soak.test.ts";

/** وحدةُ قياسِ العملِ التي يستندُ إليها التوكيدُ. */
export const WORK_SUPPORT_FILE = "tests/support/engine-work.ts";

/** الملفّانِ اللذانِ يقرؤُهما الحاجزُ — غيابُ أيِّهما خرقٌ لا صمتٌ. */
export const REQUIRED_FILES: readonly string[] = [SOAK_TEST_FILE, WORK_SUPPORT_FILE];

/**
 * السقفُ كما كانَ **قبلَ** `DEC-18` وكما يبقى بعدَه. رفعُهُ مسارٌ محظورٌ منصوصٌ
 * في نصِّ القرارِ نفسِه، فيُنفِذُهُ الحاجزُ لا المراجعةُ البشريّةُ.
 */
export const MAX_ALLOWED_CEILING = 3;

export interface GuardedFile {
  readonly path: string;
  readonly source: string;
}

export interface SoakWorkViolation {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
}

/** أسماءُ القواعدِ الستِّ — تُقرأُ في الاختبارِ فلا تُنسى قاعدةٌ بلا سالبةٍ. */
export const RULE_NAMES: readonly string[] = [
  "clock.assertion",
  "work.source",
  "work.assertion",
  "ceiling.single-source",
  "settle.before-read",
  "no-retry",
];

/**
 * يمحو تعليقاتِ JavaScript معَ الحفاظِ على عددِ الأسطرِ: شرحُ القاعدةِ في رأسِ
 * الملفِّ يذكرُ `performance.now()` بحرفِه، فحاجزٌ يقرأُ التعليقَ يُدينُ الشرحَ.
 */
export function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    "\n".repeat((block.match(/\n/g) ?? []).length),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** ساعةُ الحائطِ بأسمائِها في وقتِ التشغيلِ. */
const CLOCK_SOURCE = /\b(performance\.now|Date\.now|hrtime|new Date\(\)\.getTime)\b/;

/** توكيدٌ — بأيِّ صورةٍ من صورِ `expect` في هذا المستودَعِ. */
const ASSERTION = /\bexpect\s*\(/;

/** قراءةُ عدّاداتِ المحرِّكِ من مصدرِها الدائمِ بلا امتدادٍ. */
const WORK_SOURCE = /\bpg_stat_database\b/;
const WORK_SCOPE = /\bcurrent_database\s*\(\s*\)/;
const ROWS_COUNTER = /\btup_returned\b[\s\S]{0,40}\btup_fetched\b/;
const BLOCKS_COUNTER = /\bblks_read\b[\s\S]{0,40}\bblks_hit\b/;

/** السقفُ مُعلَناً مرّةً واحدةً بقيمةٍ مقروءةٍ. */
const CEILING_DECLARATION = /export\s+const\s+WORK_GROWTH_CEILING\s*(?::[^=]+)?=\s*(\d+(?:\.\d+)?)/;

/** إعادةُ تشغيلٍ حتّى يخضَرَّ — بأيِّ اسمٍ. */
const RETRY_CONFIG = /\b(retry|retries|rerun|repeats|flaky)\s*[:=]/i;

/**
 * القاعدةُ الأولى: **لا توكيدَ على زمنِ ساعةٍ في ملفِّ الصمودِ**. يُقرأُ التوكيدُ
 * كتلةً لا سطراً: `expect(` و`performance.now()` قد يقعانِ في سطرَينِ.
 */
function clockAssertionViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  const found: SoakWorkViolation[] = [];
  const lines = code.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!CLOCK_SOURCE.test(line)) continue;
    const block = lines.slice(Math.max(0, index - 3), index + 4).join("\n");
    if (!ASSERTION.test(block)) continue;
    found.push({
      rule: "clock.assertion",
      file: file.path,
      detail:
        `السطرُ ${String(index + 1)}: توكيدٌ يحكُمُ بزمنِ ساعةٍ — وهوَ على مُنفِّذٍ ` +
        `مُشترَكٍ يقيسُ حِملَ الجارِ لا شِفرتَنا (قرأَ ٣٫٢ ثمَّ مرَّ بالبصمةِ عينِها).`,
    });
  }
  return found;
}

/** القاعدةُ الثانيةُ: مصدرُ العملِ `pg_stat_database` محدوداً بقاعدةِ الاختبارِ. */
function workSourceViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  const missing: string[] = [];
  if (!WORK_SOURCE.test(code)) missing.push("`pg_stat_database`");
  if (!WORK_SCOPE.test(code)) missing.push("`current_database()`");
  if (!ROWS_COUNTER.test(code)) missing.push("`tup_returned + tup_fetched`");
  if (!BLOCKS_COUNTER.test(code)) missing.push("`blks_read + blks_hit`");
  if (missing.length === 0) return [];
  return [
    {
      rule: "work.source",
      file: file.path,
      detail:
        `غابَ من مصدرِ القياسِ: ${missing.join(" · ")} — ` +
        `عدَّادُ عملٍ بلا حدِّ قاعدةٍ يخلِطُ عملَ قاعدةٍ أخرى بعملِنا.`,
    },
  ];
}

/**
 * القاعدةُ الثالثةُ: التوكيدُ يقارنُ بالسقفِ **المستورَدِ** لا برقمٍ مبثوثٍ.
 * ورقمٌ حرفيٌّ داخلَ `toBeLessThan` يعني سقفاً ثانياً يُعدَّلُ وحدَه.
 */
function workAssertionViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  const found: SoakWorkViolation[] = [];
  const ceilingAssertions = [...code.matchAll(/toBeLessThan\s*\(\s*([^)]*)\)/g)];
  if (ceilingAssertions.length === 0) {
    found.push({
      rule: "work.assertion",
      file: file.path,
      detail: "لا توكيدَ على نسبةِ نموِّ العملِ — اختبارُ صمودٍ بلا حكمِ تدهورٍ.",
    });
  }
  for (const match of ceilingAssertions) {
    const argument = (match[1] ?? "").trim();
    if (argument.includes("WORK_GROWTH_CEILING")) continue;
    found.push({
      rule: "work.assertion",
      file: file.path,
      detail:
        `\`toBeLessThan(${argument})\`: سقفٌ مبثوثٌ في التوكيدِ لا مستورَدٌ — ` +
        `مصدرا حقيقةٍ للسقفِ الواحدِ، ويُرفَعُ أحدُهما بلا أن يراهُ أحدٌ.`,
    });
  }
  if (!/\bWORK_GROWTH_CEILING\b/.test(code)) {
    found.push({
      rule: "work.assertion",
      file: file.path,
      detail: "لا استيرادَ لِـ`WORK_GROWTH_CEILING` — الحكمُ بلا سقفٍ مُعلَنٍ.",
    });
  }
  return found;
}

/** القاعدةُ الرابعةُ: السقفُ مُعلَنٌ مرّةً واحدةً ولا يُرفَعُ فوقَ ما كانَ. */
function ceilingViolations(files: readonly GuardedFile[]): readonly SoakWorkViolation[] {
  const declarations = files
    .map((file) => ({ file, match: CEILING_DECLARATION.exec(stripComments(file.source)) }))
    .filter(
      (entry): entry is { file: GuardedFile; match: RegExpExecArray } => entry.match !== null,
    );

  if (declarations.length === 0) {
    return [
      {
        rule: "ceiling.single-source",
        file: WORK_SUPPORT_FILE,
        detail: "لا إعلانَ لِـ`WORK_GROWTH_CEILING` — السقفُ بلا مصدرِ حقيقةٍ.",
      },
    ];
  }
  if (declarations.length > 1) {
    return [
      {
        rule: "ceiling.single-source",
        file: declarations.map((entry) => entry.file.path).join(" · "),
        detail: "أُعلِنَ السقفُ في أكثرَ من موضعٍ — مصدرا حقيقةٍ لرقمٍ واحدٍ.",
      },
    ];
  }
  const only = declarations[0];
  if (only === undefined) return [];
  const value = Number(only.match[1]);
  if (Number.isFinite(value) && value <= MAX_ALLOWED_CEILING) return [];
  return [
    {
      rule: "ceiling.single-source",
      file: only.file.path,
      detail:
        `السقفُ ${only.match[1] ?? "?"} > ${String(MAX_ALLOWED_CEILING)}: ` +
        `\`DEC-18\` قرارُ **وحدةِ قياسٍ** لا ترخيصُ تخفيفٍ، ورفعُ السقفِ مسارٌ محظورٌ بنصِّه.`,
    },
  ];
}

/** القاعدةُ الخامسةُ: كلُّ قراءةِ حدٍّ تمرُّ بسكونٍ مقيسٍ لا بقراءةٍ عاريةٍ. */
function settleViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  if (!/\bsettleEngineWork\s*\(/.test(code)) {
    return [
      {
        rule: "settle.before-read",
        file: file.path,
        detail:
          "لا `settleEngineWork(` في الاختبارِ: عدّاداتُ `pg_stat_database` تُفرَغُ " +
          "بفواصلَ لا أقلَّ من ثانيةٍ، فقراءةٌ بلا سكونٍ تنسبُ عملَ كتلةٍ إلى تاليتِها.",
      },
    ];
  }
  if (/\breadEngineWork\s*\(/.test(code)) {
    return [
      {
        rule: "settle.before-read",
        file: file.path,
        detail: "قراءةٌ عاريةٌ `readEngineWork(` تتجاوزُ السكونَ المقيسَ.",
      },
    ];
  }
  return [];
}

/**
 * مهلةُ الإفراغِ الخاملِ في PostgreSQL ≥15 (`PGSTAT_IDLE_INTERVAL` في
 * `src/include/pgstat.h`): خادمٌ خلفيٌّ أفرغَ قبلَ أقلَّ من ثانيةٍ ثمَّ خمَلَ يُفرِغُ بعدَها.
 */
export const PGSTAT_IDLE_INTERVAL_MS = 10_000;

const SETTLE_GRACE_DECLARATION = /const\s+SETTLE_GRACE_MS\s*(?::[^=]+)?=\s*([0-9_]+)\s*;/;

/**
 * القاعدةُ السابعةُ (`D-35` · `ADR 0191`): **السكونُ أطولُ من مهلةِ الإفراغِ الخاملِ**.
 * مهلةٌ أقصرُ منها تقرأُ عدّاداتٍ ثابتةً وخادمٌ خامِلٌ ما زالَ يحملُ عملاً لم يُفرِغْه،
 * فيُنسَبُ إحماءُ كتلةٍ إلى تاليتِها — وهوَ ما أسقطَ `36122019657` ×4.52 وأخضرَ غيرَه ×0.37.
 */
function idleFlushViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  const match = SETTLE_GRACE_DECLARATION.exec(code);
  const value = match === null ? Number.NaN : Number((match[1] ?? "").replaceAll("_", ""));
  if (Number.isFinite(value) && value > PGSTAT_IDLE_INTERVAL_MS) return [];
  return [
    {
      rule: "settle.idle-flush",
      file: file.path,
      detail:
        match === null
          ? "لا `const SETTLE_GRACE_MS = <ms>;` مقروءةٌ: مهلةُ السكونِ غيرُ مُعلَنةٍ فلا تُحرَسُ."
          : `SETTLE_GRACE_MS = ${match[1] ?? "?"} ≤ ${String(PGSTAT_IDLE_INTERVAL_MS)}: ` +
            "خادمٌ خامِلٌ يُفرِغُ بعدَ عشرِ ثوانٍ، فالسكونُ الأقصرُ منها كاذبٌ.",
    },
  ];
}

/** القاعدةُ السادسةُ: لا إعادةَ تشغيلٍ حتّى يخضَرَّ — مسارٌ محظورٌ في `DEC-18`. */
function retryViolations(file: GuardedFile): readonly SoakWorkViolation[] {
  const code = stripComments(file.source);
  const match = RETRY_CONFIG.exec(code);
  if (match === null) return [];
  return [
    {
      rule: "no-retry",
      file: file.path,
      detail:
        `«${match[0]}»: إعادةُ تشغيلٍ حتّى يخضَرَّ — وهيَ عينُ ما أخفى العطبَ في ` +
        `\`35124024068\`، ومسارٌ محظورٌ بنصِّ \`DEC-18\`.`,
    },
  ];
}

/**
 * يقرأُ الملفّاتِ المحكومةَ ويردُّ خروقَها. دالّةٌ خالصةٌ: تأخذُ نصّاً وتردُّ حكماً،
 * فتُقاسُ بسالباتٍ مبذورةٍ لا بما يصادفُه القرصُ (`ح-٧`).
 */
export function soakWorkMeasureViolations(
  files: readonly GuardedFile[],
): readonly SoakWorkViolation[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const found: SoakWorkViolation[] = [];

  for (const required of REQUIRED_FILES) {
    if (byPath.has(required)) continue;
    found.push({
      rule: "work.source",
      file: required,
      detail: "ملفٌّ محكومٌ غائبٌ — لا يُحذَفُ قياسُ التدهورِ بحذفِ ملفِّه.",
    });
  }

  const soak = byPath.get(SOAK_TEST_FILE);
  if (soak !== undefined) {
    found.push(...clockAssertionViolations(soak));
    found.push(...workAssertionViolations(soak));
    found.push(...settleViolations(soak));
    found.push(...retryViolations(soak));
  }

  const support = byPath.get(WORK_SUPPORT_FILE);
  if (support !== undefined) {
    found.push(...workSourceViolations(support));
    found.push(...idleFlushViolations(support));
  }

  found.push(...ceilingViolations(files));
  return found;
}

/** رسالةُ الخرقِ — تقولُ البديلَ لا العيبَ وحدَه. */
export function describeSoakWorkViolation(violation: SoakWorkViolation): string {
  return [
    `[${violation.rule}] ${violation.file}`,
    `      ${violation.detail}`,
    "      البديلُ: قِسِ التدهورَ بعملِ المحرِّكِ (صفوفٌ ممسوحةٌ · كُتَلٌ ملموسةٌ)",
    "      من `tests/support/engine-work.ts` بسقفٍ مستورَدٍ واحدٍ (ADR 0130 · DEC-18).",
  ].join("\n");
}
