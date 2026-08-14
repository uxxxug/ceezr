/**
 * الغرض: التحقّق من أنّ القاعدة الموصولة تحتوي فعلاً كلَّ دالّةٍ وجدولٍ يناديه
 *   كودُ التشغيل، وتسميةُ الناقص باسمه.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: packages/infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (فحص /ready) وapps/workers عند الإقلاع
 * ملاحظات مستقبلية: الفحصُ استعلامانِ على فهارس النظام. لو صار /ready ثقيلاً
 *   يُخزَّن الناتجُ الناجحُ لأنّ المخطّط لا يتغيّر داخل عمرِ العملية — لكن الإخفاق
 *   لا يُخزَّن، فترحيلةٌ تُطبَّق بعد الإقلاع يجب أن تُنهي حالةَ «غير جاهز».
 */

import type { Sql } from "./client.ts";
import { CONTRACT_FUNCTIONS, CONTRACT_TABLES } from "./schema-contract.ts";

export interface SchemaContractReport {
  readonly complete: boolean;
  readonly missingFunctions: readonly string[];
  readonly missingTables: readonly string[];
}

/**
 * الغيابُ يُسمّى ولا يُعدّ فقط: «ناقص ٣» لا يقول لأحدٍ أيَّ ترحيلةٍ لم تُطبَّق،
 * بينما اسمُ الدالّةِ يقود إلى ملفِّها في دقيقة.
 */
export async function verifySchemaContract(sql: Sql): Promise<SchemaContractReport> {
  const [functions, tables] = await Promise.all([
    sql<{ name: string }[]>`
      select distinct p.proname as name
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any(${CONTRACT_FUNCTIONS as string[]}::text[])
    `,
    sql<{ name: string }[]>`
      select c.relname as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and c.relname = any(${CONTRACT_TABLES as string[]}::text[])
    `,
  ]);
  const presentFunctions = new Set(functions.map((row) => row.name));
  const presentTables = new Set(tables.map((row) => row.name));
  const missingFunctions = CONTRACT_FUNCTIONS.filter((name) => !presentFunctions.has(name));
  const missingTables = CONTRACT_TABLES.filter((name) => !presentTables.has(name));
  return {
    complete: missingFunctions.length === 0 && missingTables.length === 0,
    missingFunctions,
    missingTables,
  };
}
