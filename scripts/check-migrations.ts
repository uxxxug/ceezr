/**
 * الغرض: بوابة CI تفحص كل مخطط SQL وترفض أي جدول بلا city_id أو بلا RLS.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: cities مستثنى من فحص المفتاح الأجنبي لأن عموده مولَّد من id نفسه.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

interface Violation {
  readonly file: string;
  readonly table: string;
  readonly problem: string;
}

function findTableBlocks(sql: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;

    // بداية جسم الجدول: مباشرة بعد القوس المفتوح الذي التقطه النمط
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    blocks.push({ name, body: sql.slice(bodyStart, i - 1) });
  }
  return blocks;
}

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const violations: Violation[] = [];
  const allTables: string[] = [];
  let combined = "";

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    combined += `\n${sql}`;

    for (const { name, body } of findTableBlocks(sql)) {
      allTables.push(name);

      if (!/\bcity_id\b/.test(body)) {
        violations.push({ file, table: name, problem: "لا يحمل عمود city_id (القاعدة 0.4)" });
        continue;
      }
      if (name !== "cities" && !/city_id[^,]*references\s+cities\s*\(/i.test(body)) {
        violations.push({ file, table: name, problem: "city_id بلا مفتاح أجنبي إلى cities" });
      }
      if (name !== "cities" && !/city_id\s+uuid\s+not\s+null/i.test(body)) {
        violations.push({ file, table: name, problem: "city_id يجب أن يكون NOT NULL" });
      }
    }
  }

  for (const table of allTables) {
    const rlsEnabled =
      new RegExp(`alter\\s+table\\s+${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(
        combined,
      ) || /foreach\s+t\s+in\s+array/i.test(combined);
    if (!rlsEnabled) {
      violations.push({ file: "—", table, problem: "RLS غير مفعّلة" });
    }
  }

  if (violations.length > 0) {
    console.error("❌ مخالفات في المخططات:");
    for (const v of violations) {
      console.error(`  - [${v.file}] ${v.table}: ${v.problem}`);
    }
    process.exit(1);
  }

  console.log(`✅ ${allTables.length} جدولاً: كلها تحمل city_id و RLS مفعّلة.`);
}

main();
