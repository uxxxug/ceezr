#!/usr/bin/env bun
/**
 * # الحاجزُ: لا صنفَ في العرضِ بلا قاعدةٍ في النمطِ (`UX-021` · `ADR 0105`)
 *
 * **الغرض:** إغلاقُ `UX-021` في **جذرِه**. والجذرُ ليسَ الأصنافَ السبعةَ عشرَ
 * التي وُجِدَت بلا قاعدةٍ في سطحِ `F2-02` — تلكَ عَرَضٌ — بل أنَّ المستودعَ **لم
 * يكنْ يملكُ قياساً** يقابلُ ما يُصدِرُه العرضُ بما في ورقةِ النمطِ. فبقيَ الخرقُ
 * صنفاً من العطبِ الذي **يمرُّ في كلِّ بوّابةٍ**: لا `tsc` يراهُ ولا `biome` ولا
 * مُختبَرٌ يقرأُ HTML، ويراهُ **المستخدمُ وحدَه** قائمةً عاريةً بأنماطِ متصفِّحٍ.
 * فلمّا كانَ القياسُ غائباً تكرَّرَ الخرقُ في سطحَينِ (`F2-02` و`F2-03`)، وكانَ
 * سيتكرَّرُ في `F2-06`.
 *
 * **القواعدُ والحدودُ مكتوبةٌ في** `scripts/lib/css-class-coverage.ts`. وهذا
 * الملفُّ **قراءةٌ من القرصِ ومناداةٌ على القرارِ النقيِّ** لا قواعدَ فيه، كي
 * يُختبَرَ الحكمُ بمُدخلاتٍ مُصنَّعةٍ لا بالمستودَعِ كما هوَ.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يحكمُ في الشكلِ ولا في التناسبِ ولا في الوصولِ،
 * ولا يزعمُ أنَّ سطحاً جُرِّبَ عندَ مستخدمٍ (لا نشرَ حيَّ — `ADR 0099`). يفرضُ
 * **وجودَ النمطِ** وصدقَ التسميةِ وأن يبقى القياسُ ممكناً.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./lib/blank-comments.ts";
import {
  type CoverageInput,
  coverageProblems,
  DECLARED_BLOCKS,
  EMITTING_ROOTS,
  extractStyledClasses,
  RETAINED_RULES,
  STYLESHEETS,
} from "./lib/css-class-coverage.ts";

const SOURCE_PATTERN = /\.tsx?$/;
/** ملفّاتُ الاختبارِ تُصدِرُ أصنافاً لتتحقَّقَ منها لا لتُعرَضَ — فهيَ خارجُ القياسِ. */
const TEST_PATTERN = /\.(test|spec)\.[tj]sx?$/;

function walk(directory: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE_PATTERN.test(entry) && !TEST_PATTERN.test(entry)) out.push(path);
  }
}

export function readRepository(): CoverageInput {
  const stylesheets: Record<string, string> = {};
  for (const path of STYLESHEETS) stylesheets[path] = readFileSync(path, "utf8");

  const files: string[] = [];
  for (const root of EMITTING_ROOTS) walk(root, files);

  const sources: Record<string, string> = {};
  for (const path of files) sources[path] = blankComments(readFileSync(path, "utf8"));

  return { stylesheets, sources };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = coverageProblems(input);
  if (problems.length === 0) {
    const styled = Object.values(input.stylesheets).reduce(
      (total, css) => total + extractStyledClasses(css).size,
      0,
    );
    console.log(
      `حاجزُ تغطيةِ أصنافِ العرضِ: نجحَ — ${styled} مُحدِّدَ صنفٍ في ${STYLESHEETS.length} ورقةٍ، و${Object.keys(input.sources).length} ملفَّ عرضٍ مقروءاً، و${DECLARED_BLOCKS.length} بادئةَ كتلةٍ مُعلَنةً، و${RETAINED_RULES.length} قاعدةً باقيةً بسببٍ ومالكٍ: لا صنفَ بلا قاعدةٍ، ولا قاعدةَ بلا مُصدِرٍ غيرَ مُسجَّلةٍ، ولا تعبيرَ صنفٍ يُبنى من مصدرٍ لا يُقاسُ.`,
    );
  } else {
    console.error("حاجزُ تغطيةِ أصنافِ العرضِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
