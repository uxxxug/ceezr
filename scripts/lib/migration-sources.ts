/**
 * الغرض: التفريقُ بينَ **الهجراتِ المُطبَّقةِ** و**الهجراتِ المُعلَنةِ**، كي
 *    يقرأَ كلُّ حاجزٍ ما يخصُّه ولا يقرأَ غيرَه.
 * الحالة: منفّذ فعلياً — مصدرُ مسارٍ واحدٌ يقرؤه أكثرُ من حاجزٍ.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `check-boundary-audit` · `check-retention-policy` ·
 *    `check-queue-backpressure` · `check-rollback-safety` ·
 *    `check-migration-dry-run` · `check-core-contract-parity` ·
 *    `check-deferred-area`.
 *
 * ## لماذا مساران لا مسارٌ واحدٌ (ADR 0094 · ADR 0095)
 *
 * تعليمةُ المالكِ `O-7` أجّلَت تكاملَ CORE، فأُخرِجَت هجراتُ ذلكَ التكاملِ من
 * **مسارِ التطبيقِ** إلى `deferred/core-integration/migrations` — لا حُذِفَت
 * (`ح-2`). فصارَ في المستودعِ صنفانِ من الهجراتِ، ولكلٍّ قارئُه:
 *
 * - **المُطبَّقُ** (`supabase/migrations`): ما يُنفَّذُ على قاعدةٍ حقيقيّةً.
 *   يقرؤه ما يحكمُ على **الحالةِ الفعليّةِ**: القاعدةُ 0.4 (`city_id`)،
 *   وسلامةُ الهجرةِ، والمُطبِّقُ الآمنُ، وعقدُ المخطَّطِ.
 * - **المُعلَنُ** (المُطبَّقُ + المؤجَّلُ): كلُّ `create table` كُتِبَ في هذا
 *   المستودعِ. يقرؤه ما يحكمُ على **الجردِ والتصنيفِ**: جردُ الحدودِ، وسياسةُ
 *   الاستبقاءِ، والضغطُ العكسيُّ، ومسارُ العودةِ، ومسابرُ التحوُّلِ، ومُقابِلُ
 *   عقدِ CORE.
 *
 * وهذا ليسَ تخفيفاً: الجدولُ المؤجَّلُ **يبقى مُصنَّفاً ومحروساً** كما كانَ، ولا
 * يُقرأُ صفٌّ ميّتٌ في سجلٍّ ولا يُسقَطُ تصنيفٌ. والذي تغيَّرَ حقّاً أنَّ الجدولَ
 * **لن يوجدَ في قاعدةِ المنتجِ**، فلا تُطالِبُه القاعدةُ 0.4 بمدينةٍ لا مصدرَ
 * لها — وذاكَ إغلاقُ `O-1` في جذرِه لا نقلٌ للمشكلةِ.
 *
 * ## ما يحرسُ هذا التفريقَ من أن يصيرَ باباً
 *
 * `scripts/check-deferred-area.ts`: لا يُستورَدُ من `deferred/` شيءٌ في شيفرةِ
 * التطبيقِ، ولا يُطبَّقُ منها ملفٌّ، ولا تُضافُ مجلّداتٌ مؤجَّلةٌ بلا سببٍ
 * مكتوبٍ وقرارٍ يحكمُها.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** ما يُنفَّذُ على قاعدةٍ حقيقيّةً. */
export const APPLIED_MIGRATIONS_DIR = "supabase/migrations";

/**
 * مجلّداتُ الهجراتِ المؤجَّلةِ: مكتوبةٌ ومقروءةٌ ومُصنَّفةٌ، **ولا تُطبَّقُ**.
 * كلُّ مجلّدٍ ههنا يلزمُه سببٌ في `deferred/<المجلّد>/README.md` وقرارٌ يحكمُه.
 */
export const DEFERRED_MIGRATION_DIRS: readonly string[] = [
  "deferred/core-integration/migrations",
] as const;

/** المُطبَّقُ والمؤجَّلُ معاً — كلُّ `create table` كُتِبَ في هذا المستودعِ. */
export const DECLARED_MIGRATION_DIRS: readonly string[] = [
  APPLIED_MIGRATIONS_DIR,
  ...DEFERRED_MIGRATION_DIRS,
];

export interface MigrationFile {
  /** اسمُ الملفِّ وحدَه، كما تعرفُه السجلّاتُ. */
  readonly file: string;
  /** المجلّدُ الذي سكنَه: مُطبَّقٌ أو مؤجَّلٌ. */
  readonly dir: string;
  readonly sql: string;
}

function filesIn(root: string, dir: string): readonly MigrationFile[] {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, dir, sql: readFileSync(join(path, file), "utf8") }));
}

/** الهجراتُ المُطبَّقةُ وحدَها، مرتَّبةً بالاسمِ. */
export function appliedMigrations(root: string = "."): readonly MigrationFile[] {
  return filesIn(root, APPLIED_MIGRATIONS_DIR);
}

/**
 * الهجراتُ المُعلَنةُ كلُّها — مُطبَّقةً ومؤجَّلةً — مرتَّبةً بالاسمِ لا
 * بالمجلّدِ، فالاسمُ هوَ ما تحملُه السجلّاتُ.
 */
export function declaredMigrations(root: string = "."): readonly MigrationFile[] {
  return DECLARED_MIGRATION_DIRS.flatMap((dir) => filesIn(root, dir)).sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  );
}

/** نصُّ كلِّ الهجراتِ المُعلَنةِ مضموماً — لمن يبحثُ عن نمطٍ لا عن ملفٍّ. */
export function declaredMigrationsText(root: string = "."): string {
  return declaredMigrations(root)
    .map((entry) => entry.sql)
    .join("\n");
}

/** مسارُ ملفِّ هجرةٍ بالاسمِ، مُطبَّقاً كانَ أو مؤجَّلاً. `null` إن لم يوجَدْ. */
export function resolveMigrationPath(file: string, root: string = "."): string | null {
  for (const dir of DECLARED_MIGRATION_DIRS) {
    const path = join(root, dir, file);
    if (existsSync(path)) return path;
  }
  return null;
}
