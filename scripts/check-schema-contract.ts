/**
 * الغرض: حارسٌ يُبقي «عقد المخطّط» مطابقاً للمستودع: كلُّ دالّةٍ أو جدولٍ يستدعيه
 *   كودُ التشغيل يجب أن يكون في العقد، وكلُّ ما في العقد يجب أن تُنشئه ترحيلةٌ.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: package.json (ci) و.github/workflows
 * ملاحظات مستقبلية: `--write` يُعيد توليد الملفّ. من يُضيف استدعاءً جديداً يشغّله
 *   مرّةً ويدفع الناتج مع تغييره.
 *
 * ## لماذا هذا الحارس موجود
 *
 * قاعدةُ الإنتاج كانت متأخّرةً سبعَ عشرةَ ترحيلةً عن المستودع ولم يُنبِّه شيءٌ:
 * الاتّصالُ ناجح، و`/ready` يجيب «جاهز»، والجداولُ والدوالُّ التي يناديها الكودُ
 * غائبة. أي أنّ الخدمةَ تُعلن جهوزيّتها ثمّ تُخفق في وجه أوّل سائقٍ يضغط زرّاً.
 * فالعقدُ هنا هو ما يقرؤه فحصُ الجهوزيّة ليقول «قاعدتي ناقصة» بدلاً من «أنا بخير».
 */

import { readFileSync, writeFileSync } from "node:fs";
import { objectsCreatedByMigrations, objectsUsedByCode } from "./lib/schema-contract-extract.ts";

const TARGET = new URL("../packages/infrastructure/db/schema-contract.ts", import.meta.url)
  .pathname;

function render(functions: readonly string[], tables: readonly string[]): string {
  const list = (values: readonly string[]): string =>
    values.map((value) => `  "${value}",`).join("\n");
  return `/**
 * الغرض: عقدُ المخطّط: أسماءُ دوالّ القاعدة وجداولِها التي يستدعيها كودُ التشغيل،
 *   ليتحقّق فحصُ الجهوزيّة من وجودها في القاعدة الموصولة فعلاً.
 * الحالة: مولَّد آلياً — لا يُحرَّر يدوياً. شغّل: bun run scripts/check-schema-contract.ts --write
 * ينتمي إلى: packages/infrastructure/db
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/db/schema-guard.ts وفحص /ready
 * ملاحظات مستقبلية: الغيابُ هنا يعني خطأَ تشغيلٍ حقيقياً لا نقصاً نظرياً، فالقائمةُ
 *   محصورةٌ بما يناديه الكودُ لا بكلّ ما في الترحيلات.
 */

/** دوالُّ القاعدة التي يناديها كودُ التشغيل. */
export const CONTRACT_FUNCTIONS: readonly string[] = [
${list(functions)}
];

/** جداولُ القاعدة التي يقرؤها كودُ التشغيل أو يكتب فيها مباشرةً. */
export const CONTRACT_TABLES: readonly string[] = [
${list(tables)}
];
`;
}

const created = objectsCreatedByMigrations();
const used = objectsUsedByCode(created);
const expected = render(used.functions, used.tables);

if (process.argv.includes("--write")) {
  writeFileSync(TARGET, expected, "utf8");
  console.log(`عقد المخطّط كُتب: ${used.functions.length} دالّة و${used.tables.length} جدولاً.`);
  process.exit(0);
}

const actual = readFileSync(TARGET, "utf8");
if (actual === expected) {
  console.log(`عقد المخطّط مطابق: ${used.functions.length} دالّة و${used.tables.length} جدولاً.`);
  process.exit(0);
}

const parse = (source: string, name: string): readonly string[] => {
  const block = new RegExp(`${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`).exec(source);
  return [...(block?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");
};
const previousFunctions = parse(actual, "CONTRACT_FUNCTIONS");
const previousTables = parse(actual, "CONTRACT_TABLES");
const diff = (next: readonly string[], previous: readonly string[]): string =>
  next.filter((value) => !previous.includes(value)).join(" ") || "—";

console.error(
  "عقد المخطّط لا يطابق المستودع. شغّل: bun run scripts/check-schema-contract.ts --write",
);
console.error(`  دوالّ ناقصة من العقد: ${diff(used.functions, previousFunctions)}`);
console.error(`  دوالّ زائدة في العقد: ${diff(previousFunctions, used.functions)}`);
console.error(`  جداول ناقصة من العقد: ${diff(used.tables, previousTables)}`);
console.error(`  جداول زائدة في العقد: ${diff(previousTables, used.tables)}`);
process.exit(1);
