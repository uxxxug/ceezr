/**
 * الغرض: تصويرُ حالةِ قاعدة القياس تصويراً يقبل المقارنةَ آليّاً بين تشغيلين.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/runner.ts وكلّ سيناريو في وحدة 2-5
 * ملاحظات مستقبلية: عمودٌ جديد يُكتَب من `now()` يُضاف إلى VOLATILE_COLUMNS بسبب.
 *
 * ## ما الذي يُقارَن، وما الذي لا يُقارَن، ولماذا
 *
 * السؤالُ الذي تجيبه هذه الوحدة هو: «هل بدأ التشغيلان من الحالةِ نفسِها؟». وبلا
 * جوابٍ آليٍّ عليه يصير كلُّ فرقٍ في نتيجةِ قياسٍ قابلاً للتشكيك: أهو من النظام،
 * أم أنّ القاعدة بدأت من حالةٍ أخرى؟
 *
 * فالصورةُ عددان لكلّ جدول: **عددُ الصفوف** و**بصمةُ محتواها**. والعددُ وحده لا
 * يكفي — عشرون سائقاً بأسماءٍ مختلفةٍ عشرون سائقاً — والبصمةُ وحدها لا تكفي
 * لأنها لا تقول ما اختلف.
 *
 * ## بصمتان لا واحدة: المحليّةُ والمنقولة
 *
 * البصمةُ الأولى (`digest`) تُحسَب على الصفّ كما هو، وهي التي تُجيب سؤالَ «هل
 * تشغيلان **على هذه القاعدة نفسِها** بدآ من الحالة نفسها؟». وهي لا تجيب سؤالاً
 * آخرَ ظنَّ الأساسُ الأوّلُ أنّها تجيبه: «هل تشغيلان **على قاعدتين مُهيّأتين
 * انطلاقاً من الترحيلات نفسِها** بدآ من الحالة نفسها؟». والسببُ مُقاس لا مُقدَّر:
 * الترحيلاتُ تبذر `cities` و`platform_settings` بمعرّفات `gen_random_uuid()`،
 * فتختلف هذه المعرّفاتُ بين قاعدةٍ وقاعدة، ويتسرّب اختلافُها إلى كلّ صفٍّ يحمل
 * `city_id`. فقاعدتان بحالةٍ منطقيّةٍ واحدةٍ تُعطيان بصمتين مختلفتين، بينما
 * عددُ الصفوف مطابق — وهو أخطرُ صنفٍ من الفروق: فرقٌ يظهر بلا معنى، فيُدرَّب من
 * يقرؤه على تجاهُل الفروق.
 *
 * فالبصمةُ الثانية (`portableDigest`) تُحسَب بعد **تقييس الهويّات المُسنَدة من
 * القاعدة**: كلُّ `uuid` تبذره الترحيلاتُ يُستبدَل باسمه المنطقيّ الثابت
 * (`«city:JED»`، `«setting:JED:driver_search_radius_km»`). أمّا معرّفاتُ البذر
 * فهي أصلاً مُشتقّةٌ اشتقاقاً (UUIDv5) فتنتقل كما هي بلا تقييس. والنتيجةُ أنّ
 * المقارنةَ صارت تسأل عن الحالة المنطقيّة وحدها، فتصلح دليلاً بين بيئتين — وهذا
 * شرطٌ لأيّ سيناريو يُقاس مرّةً هنا ومرّةً في CI أو على مضيفٍ آخر.
 *
 * ويُستثنى `created_at` و`updated_at` من البصمة، وهذا استثناءٌ يجب أن يُقرأ
 * بوضوح: هما يُكتَبان من ساعةِ الجدار عند الإدخال (افتراضاً أو بمحفّز)، فلا
 * يستطيع أيُّ بذرٍ أن يجعلهما متساويين بين تشغيلين، ولا يجب أن يحاول: تزييفُ
 * الزمن كان سيُنتج حالةً لا ينتجها النظامُ أبداً، فتقيس المنصّةُ نظاماً غير
 * النظام. فالحتميّةُ المطلوبة هي **حتميّةُ الحالة المنطقيّة** لا حتميّةُ الطوابع
 * الزمنيّة. وكلُّ طابعٍ زمنيٍّ **ذي معنىً تجاريّ** (كنهايةِ فترة التجربة) يُضبَط
 * صراحةً في البذر، فيبقى داخل البصمة ويُقارَن.
 */

import { createHash } from "node:crypto";
import type { Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  canonicalizeRowJson,
  emptyDigest,
  PORTABLE_DIGEST_ROW_LIMIT,
  type StateSnapshot,
  type TableState,
  VOLATILE_COLUMNS,
} from "../../../scripts/lib/bench-state-compare.ts";
import { listOperationalTables, MIGRATION_OWNED_TABLES, quoteIdent } from "./schema.ts";

export {
  canonicalizeRowJson,
  compareStates,
  formatComparison,
  type StateSnapshot,
  type TableState,
  VOLATILE_COLUMNS,
} from "../../../scripts/lib/bench-state-compare.ts";

/**
 * يبني خريطةَ تقييسٍ من المعرّف المُسنَد إلى اسمه المنطقيّ الثابت.
 *
 * ولا تُبنى من قائمةٍ مكتوبةٍ باليد بل من القاعدة نفسِها، لأن المصدرَ الوحيدَ
 * لهذه المعرّفات هو الترحيلاتُ، وكلُّ ترحيلةٍ تبذر صفّاً جديداً في
 * `cities` أو `platform_settings` تدخل الخريطةَ تلقائياً.
 *
 * وإن ظهر جدولٌ ثالثٌ تبذره الترحيلاتُ بمعرّفٍ عشوائيّ، فسيكشفه
 * `verifyMigrationOwned` أوّلاً (فيسقط الفحص)، لا هذه الخريطةُ صامتةً.
 */
export async function buildIdentityAliases(sql: Sql): Promise<ReadonlyMap<string, string>> {
  const aliases = new Map<string, string>();

  const cities = await sql<{ id: string; code: string }[]>`
    select id::text as id, code from public.cities
  `;
  for (const city of cities) aliases.set(city.id, `«city:${city.code}»`);

  const settings = await sql<{ id: string; code: string; key: string }[]>`
    select s.id::text as id, c.code, s.key
    from public.platform_settings s
    join public.cities c on c.id = s.city_id
  `;
  for (const setting of settings) {
    aliases.set(setting.id, `«setting:${setting.code}:${setting.key}»`);
  }

  return aliases;
}

export async function captureState(sql: Sql): Promise<StateSnapshot> {
  const [meta] = await sql<{ database: string }[]>`select current_database() as database`;
  const tables = await listOperationalTables(sql);
  const aliases = await buildIdentityAliases(sql);
  const operational = await digestTables(sql, tables, { skipEmpty: true, aliases });

  return {
    database: meta?.database ?? "",
    capturedAt: new Date().toISOString(),
    tables: operational,
    preserved: await digestTables(sql, MIGRATION_OWNED_TABLES, { skipEmpty: false, aliases }),
    totalRows: operational.reduce((sum, t) => sum + t.rows, 0),
  };
}

async function digestTables(
  sql: Sql,
  tables: readonly string[],
  options: { readonly skipEmpty: boolean; readonly aliases: ReadonlyMap<string, string> },
): Promise<readonly TableState[]> {
  const excluded = `'{${VOLATILE_COLUMNS.join(",")}}'::text[]`;
  const captured: TableState[] = [];
  for (const table of tables) {
    /**
     * الترتيبُ بنصّ الصفّ نفسِه لا بمفتاحٍ: القياسُ لا يضمن ترتيبَ الإدخال، ولا
     * يضمن أنّ لكلّ جدولٍ مفتاحاً واحداً قابلاً للترتيب. فالبصمةُ تصير مستقلّةً
     * عن ترتيب الصفوف كما يجب أن تكون: مجموعةُ الصفوف هي الحالة، لا تسلسلُها.
     */
    const rows = await sql.unsafe<{ digest: string; rows: string }[]>(
      `select
         md5(coalesce(string_agg(t.j::text, '|' order by t.j::text), '')) as digest,
         count(*)::text as rows
       from (select (to_jsonb(x) - ${excluded}) as j from public.${quoteIdent(table)} x) t`,
    );
    const count = Number(rows[0]?.rows ?? "0");
    if (count > 0 || !options.skipEmpty) {
      captured.push({
        table,
        rows: count,
        digest: rows[0]?.digest ?? "",
        portableDigest: await portableDigest(sql, table, count, options.aliases),
      });
    }
  }
  return captured;
}

/**
 * البصمةُ المنقولة: نفسُ محتوى الصفوف بعد تقييس الهويّات المُسنَدة.
 *
 * والترتيبُ يجري **بعد** التقييس لا قبله، لأن ترتيباً على نصٍّ يحمل معرّفاتٍ
 * عشوائيّةً هو نفسُه عشوائيٌّ بين القواعد، فتختلف البصمةُ لاختلاف الترتيب وحده.
 */
async function portableDigest(
  sql: Sql,
  table: string,
  rowCount: number,
  aliases: ReadonlyMap<string, string>,
): Promise<string> {
  if (rowCount === 0) return emptyDigest();
  if (rowCount > PORTABLE_DIGEST_ROW_LIMIT) {
    throw new Error(
      `[bench/state] «${table}» فيه ${rowCount} صفّاً وسقفُ البصمة المنقولة ${PORTABLE_DIGEST_ROW_LIMIT}. ` +
        "لا تُحسَب بصمةٌ ناقصة: إمّا يُرفَع السقف بعد قياس الذاكرة، أو يُقيَّس الجدولُ بطريقةٍ أخرى.",
    );
  }

  const excluded = `'{${VOLATILE_COLUMNS.join(",")}}'::text[]`;
  const rows = await sql.unsafe<{ j: string }[]>(
    `select (to_jsonb(x) - ${excluded})::text as j from public.${quoteIdent(table)} x`,
  );
  const canonical = rows.map((row) => canonicalizeRowJson(row.j, aliases)).sort();
  return createHash("md5").update(canonical.join("|")).digest("hex");
}
