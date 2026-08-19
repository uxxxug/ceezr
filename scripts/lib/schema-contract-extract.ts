/**
 * الغرض: استخراج «عقد المخطّط» من المستودع نفسه: أسماءُ الدوالّ والجداول التي
 *   يُنشئها مجلّد الترحيلات، وأيُّها يستدعيه كودُ التشغيل فعلياً.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/check-schema-contract.ts وتوليد
 *   packages/infrastructure/db/schema-contract.ts
 * ملاحظات مستقبلية: الاستخراجُ نصّيٌّ بقصد. مُحلِّلُ SQL كاملٌ يبدو أنقى لكنّه
 *   يُدخل تبعيةً ثقيلةً لأجل قائمةِ أسماء، والتقاطعُ مع ما تُنشئه الترحيلات فعلاً
 *   يكفي لطردِ كلِّ اسمٍ مخترع.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase/migrations");
/** كودُ التشغيل فقط: الاختباراتُ تستدعي دوالَّ تهيئةٍ لا تعني الإنتاج. */
const CODE_ROOTS = ["packages", "apps"] as const;

/** دوالُّ PostgreSQL المبنيّة وامتداداتُه: لا تُنشئها ترحيلاتُنا فلا تدخل العقد. */
function walk(directory: string, out: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

export interface SchemaObjects {
  readonly functions: readonly string[];
  readonly tables: readonly string[];
}

/** ما تُنشئه الترحيلاتُ: مصدرُ الحقيقةِ لما يجوز أن يُطلَب وجودُه. */
export function objectsCreatedByMigrations(): SchemaObjects {
  const functions = new Set<string>();
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      if (match[1] !== undefined) functions.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      if (match[1] !== undefined) tables.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(
      /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi,
    )) {
      if (match[1] !== undefined) tables.delete(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_]+)/gi,
    )) {
      // الحذفُ ثمّ الإنشاءُ في ملفٍ واحدٍ شائع: الترتيبُ داخل الملف يحكم.
      const name = match[1]?.toLowerCase();
      if (
        name !== undefined &&
        !new RegExp(`function\\s+(public\\.)?${name}\\s*\\(`, "i").test(sql)
      )
        functions.delete(name);
    }
  }
  return { functions: [...functions].sort(), tables: [...tables].sort() };
}

/**
 * ما يستدعيه كودُ التشغيل. النيّةُ ليست جردَ المخطّط كلِّه بل حصرَ ما يُعطِّل
 * إجراءً حقيقياً حين يغيب: دالّةٌ يناديها الكودُ وليست في القاعدة تعني خطأَ
 * تشغيلٍ في وجه السائق، لا نقصاً نظرياً.
 */
export function objectsUsedByCode(created: SchemaObjects): SchemaObjects {
  const createdFunctions = new Set(created.functions);
  const createdTables = new Set(created.tables);
  const functions = new Set<string>();
  const tables = new Set<string>();
  const files: string[] = [];
  for (const root of CODE_ROOTS) walk(join(ROOT, root), files);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
      const name = match[1];
      if (name !== undefined && createdFunctions.has(name)) functions.add(name);
    }
    for (const match of text.matchAll(
      /\b(?:from|join|into|update|delete\s+from|table)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      const name = match[1]?.toLowerCase();
      if (name !== undefined && createdTables.has(name)) tables.add(name);
    }
  }
  return { functions: [...functions].sort(), tables: [...tables].sort() };
}
