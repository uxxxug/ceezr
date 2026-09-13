/**
 * الغرض: إعادةُ قاعدة القياس إلى حالةِ ما بعد الترحيل مباشرةً — بلا محوٍ أعمى.
 * الحالة: منفّذ فعلياً ومُختبَر — المرحلة 2 وحدة 2-4.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/runner.ts قبل كلّ تشغيل قياس
 * ملاحظات مستقبلية: لا تُضِف مساراً يمحو بلا أن يمرّ على `inspectBeforeReset`.
 *
 * ## المبدأ: الرفضُ لا الحذف
 *
 * أخطرُ ما في أداةٍ تمحو ليس أن تفشل، بل أن تنجح في المكان الخطأ. فالمحوُ هنا
 * مشروطٌ بثلاثة حواجز، وكسرُ أيٍّ منها يوقف الأداة ولا يُصلحه أحدٌ تلقائياً:
 *
 * 1. **الوجهة**: العنوانُ يُفحَص ساكناً (`checkIsolation`)، ثم يُسأل الاتّصالُ
 *    القائمُ نفسُه عن قاعدته. نيّةٌ وواقعٌ، لا نيّةٌ وحدها.
 * 2. **الملكيّة**: هويّةٌ واحدةٌ في القاعدة لا يملكها القياس تعني أنّ فرضيّتنا
 *    عن الوجهة مكسورة. والصحيحُ أن نتوقّف: ربّما هي قاعدةُ تطويرٍ لأحد.
 * 3. **الاتّساق**: صفوفُ تشغيلٍ بلا أيّ هويّةٍ للقياس تعني صفوفاً لا نعرف من
 *    أنشأها. لا تُمحى مجهولةً بل تُبلَّغ.
 *
 * والفشلُ مغلق (`fail closed`): أيُّ خطأٍ في الفحص نفسِه يمنع المحو، لأن فحصاً
 * لم يكتمل لا يُقرأ «لا مشكلة» بل «لا أعرف».
 */

import type { Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  assertConnectedToBenchDatabase,
  assertIsolation,
  BENCH_TELEGRAM_ID_MIN,
  type IsolationInput,
} from "./isolation.ts";
import { countRows, IDENTITY_TABLE, listOperationalTables, quoteIdent } from "./schema.ts";

export interface PreResetInspection {
  readonly database: string;
  readonly operationalTables: readonly string[];
  /** هويّاتٌ في القاعدة دون نطاق القياس — أيْ ليست منه. */
  readonly foreignIdentities: number;
  readonly benchIdentities: number;
  readonly nonEmptyTables: readonly { table: string; rows: number }[];
  readonly totalOperationalRows: number;
}

export async function inspectBeforeReset(sql: Sql): Promise<PreResetInspection> {
  const database = await assertConnectedToBenchDatabase(sql);
  const operationalTables = await listOperationalTables(sql);

  const [identities] = await sql<{ foreign_count: string; bench_count: string }[]>`
    select
      count(*) filter (where telegram_id < ${BENCH_TELEGRAM_ID_MIN})::text as foreign_count,
      count(*) filter (where telegram_id >= ${BENCH_TELEGRAM_ID_MIN})::text as bench_count
    from public.users
  `;

  const nonEmptyTables: { table: string; rows: number }[] = [];
  let totalOperationalRows = 0;
  for (const table of operationalTables) {
    const rows = await countRows(sql, table);
    totalOperationalRows += rows;
    if (rows > 0) nonEmptyTables.push({ table, rows });
  }

  return {
    database,
    operationalTables,
    foreignIdentities: Number(identities?.foreign_count ?? "0"),
    benchIdentities: Number(identities?.bench_count ?? "0"),
    nonEmptyTables,
    totalOperationalRows,
  };
}

export interface ResetReport {
  readonly database: string;
  readonly truncatedTables: readonly string[];
  readonly rowsRemoved: number;
  readonly durationMs: number;
}

/**
 * `identityTable` وسيطٌ لأن الاختبار يحتاج أن يُثبت أنّ الحاجز يعمل، ولا يستطيع
 * ذلك بلا أن يُنشئ هويّةً دخيلة. وهو **لا يُغيَّر** في أيّ مسار تشغيل حقيقي.
 */
export async function resetToMigratedState(
  sql: Sql,
  isolation: IsolationInput,
  options: { readonly identityTable?: string } = {},
): Promise<ResetReport> {
  assertIsolation(isolation);
  const identityTable = options.identityTable ?? IDENTITY_TABLE;
  const started = Bun.nanoseconds();

  const inspection = await inspectBeforeReset(sql);

  if (inspection.foreignIdentities > 0) {
    throw new Error(
      `[bench/reset:FOREIGN_ROWS] في «${inspection.database}» ${inspection.foreignIdentities} هويّة لا يملكها القياس ` +
        `(telegram_id < ${BENCH_TELEGRAM_ID_MIN}). لن يُمحى شيء: هذه القاعدة ليست قاعدة قياس خالصة.`,
    );
  }

  if (inspection.benchIdentities === 0 && inspection.totalOperationalRows > 0) {
    const names = inspection.nonEmptyTables.map((t) => `${t.table}=${t.rows}`).join(", ");
    throw new Error(
      `[bench/reset:UNEXPLAINED_ROWS] في «${inspection.database}» صفوفُ تشغيلٍ بلا أيّ هويّةٍ للقياس تُفسّرها ` +
        `(${names}). لن يُمحى شيء: لا نعرف من أنشأها.`,
    );
  }

  if (inspection.nonEmptyTables.length === 0) {
    return {
      database: inspection.database,
      truncatedTables: [],
      rowsRemoved: 0,
      durationMs: (Bun.nanoseconds() - started) / 1e6,
    };
  }

  /**
   * جملةُ `truncate` واحدةٌ تضمّ الجداولَ كلَّها، بلا `cascade`.
   *
   * والواحدةُ لا المتعدّدة لأن كلَّ مفتاحٍ أجنبيّ بين جداول التشغيل يكون طرفاه
   * داخل الجملة نفسِها، فيسقط شرطُ الترتيب ولا نحتاج أن نعرف رسمَ التبعيّات.
   * وبلا `cascade` عن قصد: `cascade` كانت ستمتدّ إلى جدولٍ لم نذكره — أي إلى
   * خارج النطاق المقصود — وهذا ما نحرسه أصلاً. فإن فشلت الجملةُ بسبب مرجعٍ من
   * خارج النطاق فذلك اكتشافٌ يجب أن يُقرأ لا أن يُدهَس بـ`cascade`.
   */
  const list = inspection.operationalTables.map((t) => `public.${quoteIdent(t)}`).join(", ");
  await sql.unsafe(`truncate table ${list} restart identity`);

  const remaining = await countRows(sql, identityTable);
  if (remaining !== 0) {
    throw new Error(`[bench/reset:INCOMPLETE] بقي ${remaining} صفّاً في ${identityTable} بعد المحو.`);
  }

  return {
    database: inspection.database,
    truncatedTables: inspection.nonEmptyTables.map((t) => t.table),
    rowsRemoved: inspection.totalOperationalRows,
    durationMs: (Bun.nanoseconds() - started) / 1e6,
  };
}
