#!/usr/bin/env bun
/**
 * الغرض: حاجزٌ يمنعُ جدولاً من الدخولِ إلى المخطّطِ **بلا تصنيفِ استبقاءٍ**،
 *   ويمنعُ اسماً في التصنيفِ **بلا جدولٍ يقابلُه**. البند `F7-06`، `ADR-0075`.
 * الحالة: منفّذ فعلياً — أداةُ تحقّقٍ، ليست منطقَ أعمالٍ.
 * ينتمي إلى: scripts
 * يُستخدم من: `.github/workflows/ci.yml` عبرَ `bun run check:retention`.
 * ملاحظات مستقبلية: يومَ يُحسَمُ `F12-10` تُستبدَلُ الأصنافُ الموسومةُ
 *   `pending-decision-f12-10` بمُدَدٍ معتمدةٍ؛ ولا يُغيَّرُ هذا الحاجزُ.
 *
 * ## لماذا حاجزٌ أصلاً
 *
 * لأنَّ العطلَ الذي وجدَه فحصُ `F7-06` لم يكنْ جدولاً صُنِّفَ خطأً، بل **ثلاثةً
 * وأربعينَ جدولاً لم يُنظَرْ في استبقائِها قطُّ** — لا في هجرةٍ ولا في وثيقةٍ.
 * ولا يُصلِحُ ذلكَ وثيقةٌ تُكتَبُ اليومَ وتُنسى غداً: الجدولُ الرابعُ والأربعونَ
 * سيُضافُ بعدَ شهرٍ وليسَ في المستودعِ ما يسألُ عنه. فالحاجزُ هوَ السؤالُ الذي
 * لا يُنسى.
 *
 * ## ولماذا لا يفرضُ حذفاً
 *
 * لا يفرضُ. أكثرُ الأصنافِ في السياسةِ «لا يُحذَفُ»، وصنفٌ كاملٌ منها معناهُ
 * «صُنِّفَ ولم يُحسَمْ». والمطلوبُ **أن يكونَ الجدولُ منظوراً فيه**، لا أن
 * يُحذَفَ منه شيءٌ. وحاجزٌ يفرضُ الحذفَ كانَ سيدفعُ إلى حذفٍ ما لأجلِ الخُضرةِ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TABLE_RETENTION } from "../packages/shared/config/retention-policy.ts";
import { findTableBlocks } from "./check-migrations.ts";

const MIGRATIONS_DIR = "supabase/migrations";

/** أسماءُ الجداولِ المُنشأةِ في الهجراتِ — بالقارئِ نفسِه الذي يستعملُه حاجزُ المخطّطِ. */
export function tablesInMigrations(dir: string): readonly string[] {
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const block of findTableBlocks(sql)) names.add(block.name);
  }
  return [...names].sort();
}

/** الفروقُ في الاتجاهَينِ: جدولٌ بلا تصنيفٍ، وتصنيفٌ بلا جدولٍ. */
export function retentionGaps(
  tables: readonly string[],
  classified: Readonly<Record<string, string>>,
): { readonly unclassified: readonly string[]; readonly orphaned: readonly string[] } {
  const known = new Set(Object.keys(classified));
  const present = new Set(tables);
  return {
    unclassified: tables.filter((table) => !known.has(table)),
    orphaned: [...known].filter((name) => !present.has(name)).sort(),
  };
}

function main(): void {
  const tables = tablesInMigrations(MIGRATIONS_DIR);
  const { unclassified, orphaned } = retentionGaps(tables, TABLE_RETENTION);

  if (unclassified.length === 0 && orphaned.length === 0) {
    console.log(`✅ سياسةُ الاستبقاءِ: ${tables.length} جدولاً كلُّها مُصنَّفةٌ.`);
    return;
  }

  for (const table of unclassified) {
    console.error(
      `❌ الجدولُ \`${table}\` بلا تصنيفِ استبقاءٍ — يُضافُ إلى ` +
        "`TABLE_RETENTION` في `packages/shared/config/retention-policy.ts`.",
    );
  }
  for (const name of orphaned) {
    console.error(
      `❌ \`${name}\` مُصنَّفٌ في سياسةِ الاستبقاءِ ولا جدولَ له في الهجراتِ — ` +
        "مُدخلٌ ميّتٌ يُوهِمُ أنَّ شيئاً حُسِمَ.",
    );
  }
  process.exit(1);
}

if (import.meta.main) main();
