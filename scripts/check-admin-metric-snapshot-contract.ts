#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ تجميعاتِ الإدارةِ المادّيّةِ على المستودَعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08`.
 * ينتمي إلى: scripts
 * يُستخدم من: سلسلةُ `ci` في `package.json` وخطوةٌ مسمّاةٌ في وظيفةِ `verify`.
 * يُتوقع أن يستخدمه لاحقاً: الساقُ الثالثةُ من `F7-08` (النسخةُ التحليليّةُ).
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ في اختبارِ وحدةٍ
 * بمدخلاتٍ مصنوعةٍ — والقاعدةُ التي لا حالةَ سالبةَ لها **غيرُ مُنفَذةٍ**
 * (`ح-7`). وهذا المِلفُّ **لا يحكمُ**: يقرأُ ويُمرِّرُ ويطبعُ.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_API_FILE,
  type AdminMetricContractInput,
  adminMetricSnapshotProblems,
  BOUNDARY_AUDIT_FILE,
  BOUNDARY_REGISTRY_FILE,
  CONTAINER_FILE,
  DOMAIN_FILE,
  ERASURE_FILE,
  JOB_FILE,
  OVERVIEW_FILE,
  QUERIES_FILE,
  RETENTION_FILE,
  SNAPSHOT_MIGRATION_FILE,
  STORE_FILE,
} from "./lib/admin-metric-snapshot-contract.ts";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";

const JUDGED_FILES: readonly string[] = [
  DOMAIN_FILE,
  STORE_FILE,
  QUERIES_FILE,
  OVERVIEW_FILE,
  ADMIN_API_FILE,
  CONTAINER_FILE,
  JOB_FILE,
  RETENTION_FILE,
  ERASURE_FILE,
  BOUNDARY_REGISTRY_FILE,
  BOUNDARY_AUDIT_FILE,
  SNAPSHOT_MIGRATION_FILE,
];

/** أشجارُ الشِّفرةِ الممسوحةُ للقاعدةِ ٥ — مكتوبةً لا مُكتشَفةً. */
const SCANNED_ROOTS: readonly string[] = ["apps", "packages", "supabase/migrations"];
const SCANNED_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".sql"];

/**
 * التعليقُ يشرحُ المحظورَ **بلفظِه** — فلو قُرِئَ لَصارَ الشرحُ جُرماً، ولَعاقبَ
 * الحاجزُ من وثَّقَ القاعدةَ وأفلتَ من كتبَها في سطرٍ بلا شرحٍ.
 */
function withoutComments(path: string, source: string): string {
  if (path.endsWith(".sql")) return blankSqlComments(source);
  if (path.endsWith(".md")) return source;
  return blankComments(source);
}

function walk(root: string, out: Record<string, string>): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(root, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
    out[path] = withoutComments(path, readFileSync(path, "utf8"));
  }
}

/**
 * قراءةُ المستودَعِ كما هوَ — مُصدَّرةٌ كي يُنادِيَها اختبارُ الوحدةِ فيحكُمَ
 * على الشِّفرةِ الحقيقيّةِ لا على مُصنَّعٍ فقط.
 *
 * ولماذا لا يُمسَحُ `scripts/`؟ لأنَّ سجلَّ المفاتيحِ المحظورةِ نفسَه يذكرُها
 * بأسمائِها كي يمنعَها، فمسحُ نفسِه يُسقِطُ الحاجزَ على تعريفِه.
 */
export function readRepository(): AdminMetricContractInput {
  const files: Record<string, string> = {};
  for (const path of JUDGED_FILES) {
    try {
      files[path] = withoutComments(path, readFileSync(path, "utf8"));
    } catch {
      // الغيابُ خرقٌ يُسمّيه الحَكَمُ، لا استثناءٌ يُسقِطُ القارئَ.
    }
  }
  const repositoryTexts: Record<string, string> = {};
  for (const root of SCANNED_ROOTS) walk(root, repositoryTexts);
  return { files, repositoryTexts };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = adminMetricSnapshotProblems(input);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ تجميعاتِ الإدارةِ (\`F7-08\`): نجحَ — ${JUDGED_FILES.length} مِلفَّ عقدٍ، و` +
        `${Object.keys(input.repositoryTexts).length} مِلفّاً ممسوحاً للكادةِ، وسبعُ قواعدَ مقيسةً: ` +
        `لا رقمَ بلا وَسْمٍ، ولا ساعةَ في النطاقِ، ونافذةٌ بمصدرٍ واحدٍ، وجدولٌ في القوائمِ الأربعِ، ` +
        `وكادةٌ في مكانٍ واحدٍ، ولا اصطناعَ زمنٍ في المحوّلِ، وسقوطٌ حيٌّ مُعلَنٌ محروسٌ.`,
    );
  } else {
    console.error("حاجزُ عقدِ تجميعاتِ الإدارةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
