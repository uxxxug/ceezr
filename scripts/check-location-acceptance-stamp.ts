/**
 * الغرض: بوابة CI تفرضُ صدقَ `drivers.last_location_at` — أنَّه **زمنُ قبولِ
 *    الخادمِ** المحمولُ من موضعِ الاستقبالِ، لا `now()` مُختَرَعةً لحظةَ الإفراغِ
 *    المجمَّعِ. البند `F4-05`، والعائقُ `CAP-009`، وقرارُ
 *    [ADR 0076](../docs/adr/0076-last-location-at-is-acceptance-time.md)،
 *    وتعليقُ العمودِ في هجرةِ المرحلةِ الخامسةِ حرفاً.
 *    والفحصُ خمسةُ آثارٍ، وكلُّه قراءةُ نصٍّ لا قراءةُ وثيقةٍ:
 *      ١) عقدُ الإصلاحةِ الساخنةِ (`HotLocationFix`) يُعلِنُ حقلَ لحظةِ القبولِ
 *         (`observedAtMs`) — فمن حذفَه سقطَ الحاجزُ قبلَ أن يسقطَ الطابعُ.
 *      ٢) موضعُ الاستقبالِ يُمرِّرُ الحقلَ من **قراءةِ الساعةِ نفسِها** التي
 *         قُوِّمَت بها الإصلاحةُ (`observedAtMs: nowMs`) لا من قراءةٍ ثانيةٍ.
 *      ٣) محوّلُ الدفعةِ يُرسِلُ الحقلَ بالاسمِ الحرفيِّ الذي تُفكِّكُ به الدالّةُ
 *         (`observed_at_ms`) — واختلافُ حرفٍ يُقرأُ `null` صامتاً.
 *      ٤) أحدثُ هجرةٍ تُعرِّفُ دالّةَ الدفعةِ **لا** تكتبُ
 *         `last_location_at = now()`، بل تكتبُه من الطابعِ المحمولِ.
 *      ٥) لا هجرةَ تكتبُ `last_location_at` من طابعِ الجهازِ
 *         (`recorded_at`) — فذاكَ مُدخَلٌ خارجيٌّ يُزوَّرُ، ونهيُه صريحٌ في هجرةِ
 *         `20260812040000`.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml · tests/unit
 * ملاحظات مستقبلية: إن صارَ للاستمرارِ مسارٌ ثانٍ (طابورٌ موحَّدٌ مثلاً) فالحاجزُ
 *    يبقى بمعناهُ: كلُّ كاتبٍ لهذا العمودِ يحملُ الطابعَ ولا يخترعُه — ويُزادُ
 *    موضعُه إلى `WRITER_MIGRATIONS` لا يُخفَّفُ الفحصُ.
 *
 * لماذا فحصٌ لا اتفاقٌ: العطبُ الأصليُّ وقعَ **بلا سطرٍ خاطئٍ**. `F4-02` لم يمسَّ
 * تعليقَ العمودِ ولا قارئيه؛ كتبَ `now()` في دالّةٍ جديدةٍ فحسبُ. فلا ترجمةٌ
 * تُخفِقُ ولا اختبارٌ يسقطُ ولا مراجعٌ يرى تعارضاً — والعمودُ صارَ يدّعي حداثةً
 * لا يملكُها، وصفحةُ `SS-06` تنقلُ الادّعاءَ إلى من ينتظرُ طردَه. ومبالغةُ
 * الحداثةِ أسوأُ اتجاهَي الخطأِ: التأخّرُ يُرى، والادّعاءُ يُطمئِنُ كذباً.
 *
 * **وحدُّ الحاجزِ مُعلَنٌ:** يقرأُ النصَّ لا الأثرَ. أنَّ الطابعَ يعبرُ `Redis`
 * فعلاً ويُكتَبُ في القاعدةِ كما حُمِلَ يُثبِتُه اختبارُ التكاملِ على PostgreSQL
 * حقيقيٍّ — لا هذا الملفُّ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** عقدُ الإصلاحةِ الساخنةِ: موضعُ إعلانِ الحقلِ الوحيد. */
export const CONTRACT_MODULE = "packages/application/geo/driver-location-hot-state.ts";
/** موضعُ القبولِ: حالةُ استخدامِ الاستقبالِ. */
export const INTAKE_MODULE = "packages/application/geo/update-driver-location.ts";
/** محوّلُ الدفعةِ: يبني حِملَ الدالّةِ الذرّيّةِ. */
export const BATCH_ADAPTER = "packages/infrastructure/geo/driver-location-batch-persistence.ts";
/** مجلّدُ الهجراتِ. */
export const MIGRATIONS_DIR = "supabase/migrations";
/** اسمُ الدالّةِ الذرّيّةِ التي تكتبُ العمودَ في المسارِ المجمَّعِ. */
export const BATCH_FUNCTION = "persist_driver_location_batch";

/** اسمُ الحقلِ في الشيفرةِ. */
export const FIELD_TS = "observedAtMs";
/** اسمُه الحرفيُّ في حِملِ الدالّةِ — تُفكِّكُه `jsonb_to_recordset` بهذا الاسمِ. */
export const FIELD_SQL = "observed_at_ms";
/** العمودُ المحروسُ. */
export const COLUMN = "last_location_at";
/** طابعُ الجهازِ — لا يجوزُ أن يُكتَبَ في العمودِ المحروسِ. */
export const DEVICE_STAMP_COLUMN = "last_location_recorded_at";

export interface Violation {
  readonly file: string;
  readonly line: number | null;
  readonly why: string;
}

export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

/** سطرُ تعليقٍ (`//` أو `--` أو `*`) — يُذكَرُ فيه النصُّ شرحاً لا استعمالاً. */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("--") || trimmed.startsWith("*");
}

/** أوّلُ سطرٍ **غيرِ تعليقٍ** يحوي النصَّ، أو `null` إن لم يوجَد. */
export function findCodeLine(source: string, needle: string): number | null {
  const lines = source.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!isCommentLine(line) && line.includes(needle)) return index + 1;
  }
  return null;
}

/** يقرأُ ملفّاً واحداً؛ الغيابُ يُعادُ `null` ليُقرأَ خرقاً لا استثناءً. */
function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * هجراتُ SQL كلُّها مُرتَّبةً بالاسمِ — والأسماءُ مُبتدَأةٌ بطابعٍ زمنيٍّ، فترتيبُ
 * الاسمِ هوَ ترتيبُ التطبيقِ. **الأحدثُ آخراً** وهوَ الحاكمُ.
 */
export function readMigrations(dir: string = MIGRATIONS_DIR): readonly SourceFile[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
  const files: SourceFile[] = [];
  for (const name of names) {
    const source = readFileOrNull(join(dir, name));
    if (source !== null) files.push({ path: join(dir, name), source });
  }
  return files;
}

/** الهجراتُ التي تُعرِّفُ دالّةَ الدفعةِ، بترتيبِ التطبيقِ. */
export function batchFunctionMigrations(migrations: readonly SourceFile[]): readonly SourceFile[] {
  return migrations.filter(({ source }) => source.includes(`function ${BATCH_FUNCTION}`));
}

/**
 * أثرُ الكتابةِ في العمودِ داخلَ نصِّ هجرةٍ: أسطرُ الإسنادِ غيرَ التعليقِ.
 * ويُقرأُ الإسنادُ بنمطٍ لا بمجرّدِ ذكرِ الاسمِ، وإلّا لَعُدَّ شرطُ `where` كتابةً.
 */
export function assignmentsOf(source: string, column: string): readonly string[] {
  const pattern = new RegExp(`(^|[^_a-z])${column}\\s*=`, "i");
  return source
    .split("\n")
    .filter((line) => !isCommentLine(line) && pattern.test(line))
    .map((line) => line.trim());
}

/**
 * قارئُ الملفِّ الواحدِ. **مُمرَّرٌ لا مُستدعىً مباشرةً** كي تستطيعَ الاختباراتُ
 * السالبةُ أن تُغذِّيَ الفحصَ نصّاً مخروقاً: حاجزٌ لا يُثبَتُ أنّه يُخفِقُ عندَ
 * الخرقِ ليسَ حاجزاً بل تعليقٌ يُنفَّذُ.
 */
export type FileReader = (path: string) => string | null;

export function findViolations(
  read: FileReader = readFileOrNull,
  migrations: readonly SourceFile[] = readMigrations(),
): readonly Violation[] {
  const violations: Violation[] = [];

  // ١) عقدُ الإصلاحةِ يُعلِنُ الحقلَ.
  const contract = read(CONTRACT_MODULE);
  if (contract === null) {
    violations.push({
      file: CONTRACT_MODULE,
      line: null,
      why: `عقدُ الإصلاحةِ الساخنةِ غائبٌ — ولا يُفحَصُ ما لا يُقرأُ. إن نُقِلَ الملفُّ فيُحدَّثُ \`CONTRACT_MODULE\`.`,
    });
  } else if (findCodeLine(contract, `${FIELD_TS}:`) === null) {
    violations.push({
      file: CONTRACT_MODULE,
      line: null,
      why: `\`HotLocationFix\` لا يُعلِنُ \`${FIELD_TS}\`. وبلا حقلٍ يحملُ لحظةَ القبولِ تعودُ الدالّةُ إلى \`now()\` لحظةَ الإفراغِ، فيدّعي \`${COLUMN}\` حداثةً لا يملكُها (ADR-0076).`,
    });
  }

  // ٢) موضعُ الاستقبالِ يُمرِّرُ قراءةَ الساعةِ نفسَها.
  const intake = read(INTAKE_MODULE);
  if (intake === null) {
    violations.push({
      file: INTAKE_MODULE,
      line: null,
      why: `موضعُ القبولِ غائبٌ — إن نُقِلَ فيُحدَّثُ \`INTAKE_MODULE\`.`,
    });
  } else {
    const line = findCodeLine(intake, `${FIELD_TS}:`);
    if (line === null) {
      violations.push({
        file: INTAKE_MODULE,
        line: null,
        why: `الاستقبالُ لا يُمرِّرُ \`${FIELD_TS}\` إلى الحالةِ الساخنةِ. وهذا **موضعُ القبولِ** الوحيدُ: بعدَه لا يعرفُ أحدٌ متى قُبِلَت الإصلاحةُ.`,
      });
    } else {
      const text = intake.split("\n")[line - 1] ?? "";
      if (!/observedAtMs:\s*nowMs\b/.test(text)) {
        violations.push({
          file: INTAKE_MODULE,
          line,
          why: `\`${FIELD_TS}\` لا يُمرَّرُ من \`nowMs\` — وهيَ قراءةُ الساعةِ التي قُوِّمَت بها الإصلاحةُ. قراءةٌ ثانيةٌ للساعةِ تُعطي رقماً ثانياً فيختلفُ الحكمُ عن الطابعِ بلا معنىً.`,
        });
      }
    }
  }

  // ٣) محوّلُ الدفعةِ يُرسِلُ الاسمَ الحرفيَّ.
  const adapter = read(BATCH_ADAPTER);
  if (adapter === null) {
    violations.push({
      file: BATCH_ADAPTER,
      line: null,
      why: `محوّلُ الدفعةِ غائبٌ — إن نُقِلَ فيُحدَّثُ \`BATCH_ADAPTER\`.`,
    });
  } else if (findCodeLine(adapter, `${FIELD_SQL}:`) === null) {
    violations.push({
      file: BATCH_ADAPTER,
      line: null,
      why: `الدفعةُ لا تحملُ \`${FIELD_SQL}\`. والدالّةُ تُفكِّكُ بأسماءٍ حرفيّةٍ، فاسمٌ ناقصٌ أو مختلفٌ يُقرأُ \`null\` **صامتاً** فيرجعُ \`now()\` بلا إخفاقٍ.`,
    });
  }

  // ٤) و ٥) الهجراتُ.
  const writers = batchFunctionMigrations(migrations);
  if (writers.length === 0) {
    // صفرُ حاملينَ = خرقٌ لا نجاحٌ: فحصٌ لا يجدُ ما يفحصُه يُخفِقُ بصوتٍ.
    violations.push({
      file: MIGRATIONS_DIR,
      line: null,
      why: `لا هجرةَ تُعرِّفُ \`${BATCH_FUNCTION}\`. فإمّا نُقِلَ المجلّدُ أو أُعيدَت تسميةُ الدالّةِ — وفي الحالَينِ الحاجزُ يفحصُ لا شيءَ، وذاكَ أخطرُ من خرقٍ يُرى.`,
    });
  } else {
    // الأحدثُ هوَ الحاكمُ: نسخةٌ أقدمُ فيها `now()` تُبدَّلُ بالأحدثِ عندَ التطبيقِ.
    const governing = writers[writers.length - 1] as SourceFile;
    const assignments = assignmentsOf(governing.source, COLUMN);
    if (assignments.length === 0) {
      violations.push({
        file: governing.path,
        line: null,
        why: `أحدثُ نسخةٍ من \`${BATCH_FUNCTION}\` لا تكتبُ \`${COLUMN}\` بحالٍ — فحداثةُ المعرفةِ تجمدُ على آخرِ كتابةٍ مباشرةٍ، وهوَ عطبٌ آخرُ لا إصلاحٌ.`,
      });
    }
    for (const assignment of assignments) {
      if (/=\s*now\(\)/.test(assignment)) {
        violations.push({
          file: governing.path,
          line: findCodeLine(governing.source, assignment),
          why: `\`${COLUMN} = now()\` في المسارِ المجمَّعِ: هذه لحظةُ **الإفراغِ** لا لحظةُ **القبولِ**. والفرقُ دورةُ إفراغٍ كاملةٌ تُعرَضُ على \`SS-06\` بوصفِها «آخرَ تحديثٍ» (ADR-0076).`,
        });
      }
    }
  }

  // ٥) لا هجرةَ تُسنِدُ طابعَ الجهازِ إلى عمودِ زمنِ الخادمِ.
  for (const migration of migrations) {
    for (const assignment of assignmentsOf(migration.source, COLUMN)) {
      if (assignment.includes("recorded_at") || assignment.includes(DEVICE_STAMP_COLUMN)) {
        violations.push({
          file: migration.path,
          line: findCodeLine(migration.source, assignment),
          why: `\`${COLUMN}\` يُكتَبُ من طابعِ الجهازِ. وهجرةُ \`20260812040000\` تنهى عنه صريحاً: الطابعُ مُدخَلٌ خارجيٌّ يُضبَطُ خطأً أو يُزوَّرُ، فسائقٌ ساعتُه متقدّمةٌ يبدو موقعُه أحدثَ من كلِّ من حولَه إلى الأبدِ.`,
        });
      }
    }
  }

  return violations;
}

function main(): void {
  const violations = findViolations();

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لصدقِ \`${COLUMN}\` (F4-05 · CAP-009 · ADR-0076):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}${violation.line === null ? "" : `:${violation.line}`}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  const writers = batchFunctionMigrations(readMigrations());
  const governing = writers[writers.length - 1]?.path ?? "—";
  console.log(
    `✓ \`${COLUMN}\` زمنُ **قبولٍ** محمولٌ من الاستقبالِ لا \`now()\` لحظةَ الإفراغِ — العقدُ والاستقبالُ والمحوّلُ و${writers.length} هجرةً، والحاكمةُ: ${governing}`,
  );
}

if (import.meta.main) main();
