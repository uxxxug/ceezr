/**
 * الغرض: بوابةُ CI للبندِ `F8-06` — تكتشفُ كُتّابَ حالةِ الدفعِ من الهجراتِ
 *   وحالاتِ القيدِ من المخطَّطِ، ثمَّ تُطابِقُهما بمصفوفةِ دورةِ الحياةِ المغلقةِ.
 * الحالة: منفَّذٌ فعليّاً — أداةُ تحقُّقٍ، ليست منطقَ أعمالٍ.
 * ينتمي إلى: scripts
 * يُستخدَمُ من: package.json (سلسلةُ `ci`) · .github/workflows/ci.yml (وظيفةُ verify)
 * الحاكم: ADR 0133 · ADR 0135 · البند `F8-06`
 *
 * **ولِمَ الاكتشافُ أوّلاً**: حاجزٌ يقرأُ قائمةً مكتوبةً يفحصُ المعروفَ ولا يجدُ
 * المفقودَ. فالكُتّابُ يُقرَأونَ من نصِّ الهجراتِ لا من مصفوفةٍ في شِفرةٍ، وحالاتُ
 * الدفعِ من قيدِ المخطَّطِ لا من نوعٍ محفوظٍ — فمَن أضافَ كاتباً أو حالةً بلا قياسٍ
 * يُخفِقُ ههنا، لا في يومِ سؤالِ «أينَ ذهبَ المالُ؟».
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  declaredPaymentStatuses,
  functionBodies,
  PAYMENT_LIFECYCLE_CASES,
  paymentLifecycleViolations,
  UNMEASURED_STATUSES,
  writesPaymentLifecycle,
} from "./lib/payment-lifecycle-matrix.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const ROADMAP_MASTER = "docs/ROADMAP-MASTER.md";

/** آخرُ تعريفٍ لكلِّ دالَّةٍ يغلبُ — `create or replace` يُبطِلُ ما قبلَه. */
export function discoverLifecycleWriters(orderedSql: readonly string[]): string[] {
  const lastBody = new Map<string, string>();
  for (const sql of orderedSql) {
    for (const fn of functionBodies(sql)) lastBody.set(fn.name, fn.body);
  }
  const writers: string[] = [];
  for (const [name, body] of lastBody) {
    if (writesPaymentLifecycle(body)) writers.push(name);
  }
  return writers.sort();
}

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const orderedSql = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

  const discoveredWriters = discoverLifecycleWriters(orderedSql);
  const statuses = declaredPaymentStatuses(orderedSql);

  if (statuses.length === 0) {
    console.error("❌ لم يُقرَأْ قيدُ حالاتِ `payment_transactions` من الهجراتِ — والمِعيارُ لا يُفترَضُ.");
    process.exit(1);
  }

  const violations = paymentLifecycleViolations({
    roadmapText: readFileSync(ROADMAP_MASTER, "utf8"),
    discoveredWriters,
    declaredStatuses: statuses,
    pathExists: (p) => existsSync(p),
    readTestFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  });

  if (violations.length > 0) {
    console.error("❌ مصفوفةُ دورةِ حياةِ الدفعِ (F8-06) — مخالفاتٌ:");
    for (const v of violations) console.error(`  - [${v.rule}] ${v.detail}`);
    process.exit(1);
  }

  const byClass = new Map<string, number>();
  for (const c of PAYMENT_LIFECYCLE_CASES) {
    byClass.set(c.lifecycleClass, (byClass.get(c.lifecycleClass) ?? 0) + 1);
  }
  const classSummary = [...byClass].map(([k, n]) => `${k}=${n}`).join(" · ");
  console.log(
    `✅ F8-06 (مصفوفةُ دورةِ حياةِ الدفعِ): ${PAYMENT_LIFECYCLE_CASES.length} حالةً على ` +
      `${byClass.size} أصنافٍ (${classSummary}) · ${discoveredWriters.length} كاتباً مُكتشَفاً من ` +
      `الهجراتِ كلُّهم مُمارَسونَ · ${statuses.length} حالةً في القيدِ ` +
      `(${UNMEASURED_STATUSES.length} مُعلَنةً دَيناً).`,
  );
  console.log(
    "  ولا يُدَّعى أنَّ الذِكرَ قياسٌ: هذا مِعيارُ شمولٍ، والمقيسُ هوَ ما يُشغِّلُه المحرِّكُ في وظيفةِ التكاملِ.",
  );
}

if (import.meta.main) {
  main();
}
