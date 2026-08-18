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
 * ويُستثنى `created_at` و`updated_at` من البصمة، وهذا استثناءٌ يجب أن يُقرأ
 * بوضوح: هما يُكتَبان من ساعةِ الجدار عند الإدخال (افتراضاً أو بمحفّز)، فلا
 * يستطيع أيُّ بذرٍ أن يجعلهما متساويين بين تشغيلين، ولا يجب أن يحاول: تزييفُ
 * الزمن كان سيُنتج حالةً لا ينتجها النظامُ أبداً، فتقيس المنصّةُ نظاماً غير
 * النظام. فالحتميّةُ المطلوبة هي **حتميّةُ الحالة المنطقيّة** لا حتميّةُ الطوابع
 * الزمنيّة. وكلُّ طابعٍ زمنيٍّ **ذي معنىً تجاريّ** (كنهايةِ فترة التجربة) يُضبَط
 * صراحةً في البذر، فيبقى داخل البصمة ويُقارَن.
 */

import type { Sql } from "../packages/infrastructure/db/client.ts";
import { listOperationalTables, MIGRATION_OWNED_TABLES, quoteIdent } from "./schema.ts";

/** أعمدةٌ تُكتَب من ساعة الجدار، فلا تدخل بصمةَ الحالة المنطقيّة. */
export const VOLATILE_COLUMNS = ["created_at", "updated_at"] as const;

export interface TableState {
  readonly table: string;
  readonly rows: number;
  /** بصمةُ محتوى الجدول بعد استثناء الأعمدة المتغيّرة بالزمن. */
  readonly digest: string;
}

export interface StateSnapshot {
  readonly database: string;
  readonly capturedAt: string;
  /** الجداولُ غيرُ الفارغة وحدها، مرتّبةً بالاسم. الفارغةُ لا تُذكَر: ذكرُها يُضخّم الصورة بلا معلومة. */
  readonly tables: readonly TableState[];
  /**
   * الجداولُ التي لا يمحوها `reset` — المخطّطُ وما تبذره الترحيلاتُ وما تضبطه
   * التهيئة. تُصوَّر ولا تُمحى.
   *
   * ولماذا تُصوَّر إن كانت محفوظة؟ لأن «محفوظة» تعني أنّ الأداةَ لا تمسّها، لا
   * أنّها لا تتغيّر: مدينةٌ عُطّلت بين تجربتين، أو إعدادٌ تجاريٌّ عُدِّل، يُغيّران
   * نتيجةَ القياس تغييراً جذريّاً ولا يظهران في أيّ جدولٍ تشغيليّ. فتركُها بلا
   * تصويرٍ كان سيُنتج تجربتين «متطابقتي الحالة» ونتيجتين مختلفتين بلا تفسير.
   */
  readonly preserved: readonly TableState[];
  readonly totalRows: number;
}

export async function captureState(sql: Sql): Promise<StateSnapshot> {
  const [meta] = await sql<{ database: string }[]>`select current_database() as database`;
  const tables = await listOperationalTables(sql);
  const operational = await digestTables(sql, tables, { skipEmpty: true });

  return {
    database: meta?.database ?? "",
    capturedAt: new Date().toISOString(),
    tables: operational,
    preserved: await digestTables(sql, MIGRATION_OWNED_TABLES, { skipEmpty: false }),
    totalRows: operational.reduce((sum, t) => sum + t.rows, 0),
  };
}

async function digestTables(
  sql: Sql,
  tables: readonly string[],
  options: { readonly skipEmpty: boolean },
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
      captured.push({ table, rows: count, digest: rows[0]?.digest ?? "" });
    }
  }
  return captured;
}

export type StateDifferenceKind = "missing_table" | "extra_table" | "row_count" | "content";

export interface StateDifference {
  readonly kind: StateDifferenceKind;
  readonly table: string;
  readonly detail: string;
}

export interface StateComparison {
  readonly identical: boolean;
  readonly differences: readonly StateDifference[];
}

/**
 * مقارنةٌ آليّةٌ لا بصريّة، وتُسمّي ما اختلف لا أنّه اختلف.
 *
 * وتفصيلُ الفرق مقصود: «الحالتان مختلفتان» جوابٌ لا يُفيد من يُصلح. أمّا
 * «`drivers` كان 20 وصار 40» فيقول إنّ إعادةَ البذر ضاعفت ولم تُعِد — وهو
 * بالضبط العطبُ الذي تحرس منه هذه المقارنة.
 */
export function compareStates(before: StateSnapshot, after: StateSnapshot): StateComparison {
  const differences: StateDifference[] = [];
  const beforeMap = new Map([...before.tables, ...before.preserved].map((t) => [t.table, t]));
  const afterMap = new Map([...after.tables, ...after.preserved].map((t) => [t.table, t]));

  for (const [table, left] of beforeMap) {
    const right = afterMap.get(table);
    if (right === undefined) {
      differences.push({
        kind: "missing_table",
        table,
        detail: `كان فيه ${left.rows} صفّاً وصار فارغاً`,
      });
      continue;
    }
    if (left.rows !== right.rows) {
      differences.push({
        kind: "row_count",
        table,
        detail: `عدد الصفوف ${left.rows} ← ${right.rows}`,
      });
      continue;
    }
    if (left.digest !== right.digest) {
      differences.push({
        kind: "content",
        table,
        detail: `العدد نفسه (${left.rows}) لكن المحتوى مختلف: ${left.digest.slice(0, 12)} ← ${right.digest.slice(0, 12)}`,
      });
    }
  }

  for (const [table, right] of afterMap) {
    if (!beforeMap.has(table)) {
      differences.push({
        kind: "extra_table",
        table,
        detail: `كان فارغاً وصار فيه ${right.rows} صفّاً`,
      });
    }
  }

  return { identical: differences.length === 0, differences };
}

export function formatComparison(comparison: StateComparison): string {
  if (comparison.identical) return "الحالتان متطابقتان منطقيّاً.";
  return comparison.differences.map((d) => `- [${d.kind}] ${d.table}: ${d.detail}`).join("\n");
}
