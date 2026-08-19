/**
 * الغرض: تحديدُ ما يملكه القياسُ وما تملكه الترحيلاتُ في قاعدة القياس، وإثباتُ
 *   أنّ هذا التحديد مطابقٌ للواقع لا مكتوبٌ بالثقة.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/reset.ts و bench/state.ts
 * ملاحظات مستقبلية: ترحيلةٌ تبذر جدولاً جديداً تُسقط `verifyMigrationOwned`.
 *
 * ## لماذا تُستنبَط القائمةُ من المخطّط ولا تُكتَب يدوياً
 *
 * قائمةٌ مكتوبةٌ يدوياً بأسماء الجداول التي تُمحى تتعفّن: ترحيلةٌ تُضيف جدولاً
 * جديداً لا تُضيف اسمَه إليها، فيبقى الجدولُ يتراكم بين التشغيلات، فيبدأ القياسُ
 * التاليُ من حالةٍ ليست الحالةَ التي يظنّها — وهذا بالضبط صنفُ الخطأ الذي جعل
 * قياساً سابقاً يُعطي رقماً جميلاً كاذباً.
 *
 * فالاستنباطُ معكوس: تُقرأ جداولُ المخطّط الحيّ، ويُستثنى منها ما تملكه
 * الترحيلاتُ صراحةً، والباقي كلُّه يُمحى. فجدولٌ جديد يدخل نطاقَ المحو تلقائياً،
 * وهو الاتّجاهُ الآمن: أن يُمحى ما لا يجب فأسوأُ نتيجةٍ بذرٌ من جديد، لا أن
 * يبقى ما يجب محوُه فتُقارَن نتيجتان بدأتا من حالتين.
 */

import type { Sql } from "../packages/infrastructure/db/client.ts";

/**
 * الجداولُ التي تملكها الترحيلاتُ ولا يجوز للقياس محوُها.
 *
 * - `cities` و`platform_settings`: تبذرهما ترحيلةٌ صراحةً، وهما جزءٌ من عقد
 *   النظام لا من بيانات التشغيل. ومحوُ `platform_settings` خصوصاً يُشلّ النظامَ
 *   كلَّه لأن كلَّ ثابتٍ تجاريّ فيه (قاعدة المستودع: لا ثوابت في الكود).
 * - `spatial_ref_sys`: جدولُ PostGIS نفسه، ليس منّا أصلاً.
 */
export const MIGRATION_OWNED_TABLES = ["cities", "platform_settings", "spatial_ref_sys"] as const;

/** الجدولُ الوحيد الذي يحمل معرّف تيليجرام، فهو أصلُ كلّ هويّة في المخطّط. */
export const IDENTITY_TABLE = "users";

export async function listPublicTables(sql: Sql): Promise<readonly string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `;
  return rows.map((row) => row.table_name);
}

/** جداولُ التشغيل: كلُّ جدولٍ عامٍّ ليس مملوكاً للترحيلات. هذا نطاقُ المحو. */
export async function listOperationalTables(sql: Sql): Promise<readonly string[]> {
  const all = await listPublicTables(sql);
  const owned = new Set<string>(MIGRATION_OWNED_TABLES);
  return all.filter((table) => !owned.has(table));
}

export async function countRows(sql: Sql, table: string): Promise<number> {
  const rows = await sql.unsafe<{ count: string }[]>(
    `select count(*)::text as count from public.${quoteIdent(table)}`,
  );
  return Number(rows[0]?.count ?? "0");
}

/**
 * الاسمُ يُغلَّف ويُتحقَّق منه رغم أنّ مصدرَه المخطَّطُ نفسُه لا مُدخلُ مستخدم.
 * والسببُ أنّ هذه الدالّة تبني نصَّ SQL بالسَّلسَلة، ودالّةٌ كهذه إن قُرأت يوماً
 * وأُعيد استخدامُها بمُدخلٍ خارجيّ صارت ثغرةً؛ فالحاجزُ يُوضَع عند كتابتها.
 */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`[bench/schema] اسم جدول غير متوقّع: «${name}»`);
  }
  return `"${name}"`;
}

export { quoteIdent };

export interface MigrationOwnedReport {
  readonly ok: boolean;
  /** جداولٌ أعلنّاها مملوكةً للترحيلات لكنّها فارغة — إعلانٌ لا يحرس شيئاً. */
  readonly declaredButEmpty: readonly string[];
  /** جداولُ تشغيلٍ فيها صفوفٌ بعد الترحيل مباشرةً — أي أنّ ترحيلةً تبذرها. */
  readonly seededButNotDeclared: readonly { table: string; rows: number }[];
}

/**
 * يُثبت أنّ `MIGRATION_OWNED_TABLES` **هي بالضبط** مجموعةُ الجداول التي تبذرها
 * الترحيلات، على قاعدةٍ مُرحَّلةٍ لم يبذر فيها القياسُ شيئاً بعد.
 *
 * وهذا هو ما يجعل قائمةَ الاستثناء دليلاً لا ادّعاءً: بلا هذا الفحص كانت
 * القائمةُ قد تُبقي جدولاً يجب محوُه (فيتراكم) أو تحمي جدولاً لا شيءَ فيه
 * (فيبدو الحرسُ أوسعَ مما هو). ولا يُنادى إلا على قاعدةٍ نظيفة، لأن وجودَ بذرِ
 * القياسِ فيها يجعل كلَّ جدولٍ يبدو مبذوراً بترحيلة.
 */
export async function verifyMigrationOwned(sql: Sql): Promise<MigrationOwnedReport> {
  const declaredButEmpty: string[] = [];
  for (const table of MIGRATION_OWNED_TABLES) {
    if ((await countRows(sql, table)) === 0) declaredButEmpty.push(table);
  }

  const seededButNotDeclared: { table: string; rows: number }[] = [];
  for (const table of await listOperationalTables(sql)) {
    const rows = await countRows(sql, table);
    if (rows > 0) seededButNotDeclared.push({ table, rows });
  }

  return {
    ok: declaredButEmpty.length === 0 && seededButNotDeclared.length === 0,
    declaredButEmpty,
    seededButNotDeclared,
  };
}
