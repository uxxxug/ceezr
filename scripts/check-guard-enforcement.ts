#!/usr/bin/env bun
/**
 * # الحاجزُ: تكافؤُ الإنفاذِ بينَ المشغِّلِ المحلّيِّ وسيرِ CI — `ADR 0143`
 *
 * **الغرضُ:** ألّا يبقى حاجزٌ «قائماً» في وثيقةٍ وهوَ لا يُسقِطُ بناءً حيثُ يُدَّعى.
 * فقد قِيسَ في `2026-09-17` أنَّ سبعةَ حواجزَ في `package.json → ci` **لا تُنادى في
 * أيِّ سيرِ عملٍ**، ووثيقتانِ تدَّعيانِ صراحةً أنَّ إحداها «حاجزُ CI قائمٌ».
 *
 * **مصدرُ الحقيقةِ واحدٌ لا مكرَّرٌ:** لا قائمةَ حواجزَ مكتوبةً هنا. المشغِّلُ
 * `package.json → ci` جانبٌ، وملفّاتُ `.github/workflows/*.yml` جانبٌ، والقرصُ
 * ثالثٌ — والحاجزُ يقابلُ الثلاثةَ. فلا يتقادمُ بإضافةِ حاجزٍ جديدٍ.
 *
 * **فكُّ الأسماءِ:** `bun run check:coverage` يُفَكُّ إلى ما ينادِيه فعلاً
 * (`scripts/check-coverage-gate.ts`) — وإلّا حُسِبَ ملفٌّ مُنفَّذٌ «غيرَ مُنادىً».
 *
 * **الحالة:** مُنفَّذٌ · مُختبَرٌ سقوطُه بخرقٍ مزروعٍ لكلِّ قاعدةٍ في
 * `tests/unit/check-guard-enforcement.test.ts` (`ح-7`).
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يكتبُ سيرَ عملٍ ولا يُعدِّلُ `package.json`، ولا
 * يُقرِّرُ أيَّ حاجزٍ يلزمُ المشروعَ — يقيسُ التكافؤَ ويُسمّي الخلَلَ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type GuardEnforcementInputs, guardEnforcementProblems } from "./lib/guard-enforcement.ts";
import {
  LOCAL_ONLY_EXEMPTIONS,
  REMOTE_ONLY_EXEMPTIONS,
  UNINVOKED_EXEMPTIONS,
} from "./lib/guard-enforcement-registry.ts";

const PACKAGE_PATH = "package.json";
const WORKFLOWS_DIR = ".github/workflows";
const SCRIPTS_DIR = "scripts";
const RUNNER_SCRIPT = "ci";

/** مسارُ ملفٍّ تنفيذيٍّ داخلَ `scripts/` بأيِّ لاحقةٍ نستعملُها. */
const SCRIPT_PATH = /scripts\/[A-Za-z0-9._-]+\.(?:ts|mjs|sh)/g;
/** نداءُ اسمٍ من `package.json` — يُفَكُّ إلى ما يُنادِيه. */
const NAMED_RUN = /bun\s+run\s+(?!scripts\/)([A-Za-z0-9:_-]+)/g;

function scriptPathsIn(text: string): readonly string[] {
  return [...text.matchAll(SCRIPT_PATH)].map((match) => match[0]);
}

/**
 * كلُّ ملفٍّ تنفيذيٍّ يبلغُه نصٌّ، بعدَ فكِّ نداءاتِ الأسماءِ تكرارًا.
 * والحمايةُ من الحلقاتِ بمجموعةِ الأسماءِ المزارةِ لا بعُمقٍ مُقدَّرٍ.
 */
function reachableScripts(text: string, named: Record<string, string>): readonly string[] {
  const found = new Set<string>();
  const visited = new Set<string>();
  const pending: string[] = [text];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const path of scriptPathsIn(current)) found.add(path);
    for (const match of current.matchAll(NAMED_RUN)) {
      const name = match[1];
      if (name === undefined || visited.has(name)) continue;
      visited.add(name);
      const body = named[name];
      if (body !== undefined) pending.push(body);
    }
  }

  return [...found];
}

/**
 * تعليقٌ ليسَ تنفيذاً.
 *
 * وهذا ليسَ احتياطاً نظريًّا: في `ci.yml` تعليقٌ يحكي تصحيحَ `F6-07` ويذكرُ فيه
 * `bun run ci` نصًّا، فقرأَه المُحلِّلُ الأوّلُ نداءً ووسَّعَ المشغِّلَ كلَّه إلى
 * «مُنفَّذٍ في CI» — فأخرجَ تكافؤاً كاذباً وأخفى الخلَلَ الذي كُتِبَ ليجدَه.
 * والسخريةُ أنَّ ذلكَ التعليقَ نفسَه يقولُ: «حاجزٌ مكتوبٌ ولا يُشغَّلُ فليسَ حاجزاً».
 *
 * وتُحذَفُ الأسطرُ التي كلُّها تعليقٌ وحدَها — لا ما بعدَ `#` في سطرِ أمرٍ، إذ قد
 * يكونُ `#` داخلَ نصٍّ مُقتبَسٍ فيُقطَعُ أمرٌ قائمٌ.
 */
export function stripFullLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function workflowText(): string {
  let text = "";
  for (const entry of readdirSync(WORKFLOWS_DIR)) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    text += `${stripFullLineComments(readFileSync(join(WORKFLOWS_DIR, entry), "utf8"))}\n`;
  }
  return text;
}

export function defaultInputs(): GuardEnforcementInputs {
  const named =
    (JSON.parse(readFileSync(PACKAGE_PATH, "utf8")) as { scripts?: Record<string, string> })
      .scripts ?? {};

  const runner = named[RUNNER_SCRIPT];
  if (runner === undefined) {
    throw new Error(`لا مشغِّلَ باسمِ \`${RUNNER_SCRIPT}\` في ${PACKAGE_PATH} — الكشفُ معطوبٌ.`);
  }

  const workflows = workflowText();
  const guardsOnDisk = readdirSync(SCRIPTS_DIR)
    .filter((entry) => entry.startsWith("check-") && /\.(?:ts|mjs)$/.test(entry))
    .map((entry) => `${SCRIPTS_DIR}/${entry}`);

  return {
    localGuards: reachableScripts(runner, named),
    workflowGuards: reachableScripts(workflows, named),
    guardsOnDisk,
    localOnlyExemptions: LOCAL_ONLY_EXEMPTIONS,
    remoteOnlyExemptions: REMOTE_ONLY_EXEMPTIONS,
    uninvokedExemptions: UNINVOKED_EXEMPTIONS,
  };
}

if (import.meta.main) {
  const inputs = defaultInputs();
  const problems = guardEnforcementProblems(inputs);

  if (problems.length > 0) {
    console.error(`✗ ${problems.length} مخالفةً في تكافؤِ الإنفاذِ (ADR 0143):\n`);
    for (const problem of problems) console.error(`  • [${problem.rule}] ${problem.detail}\n`);
    process.exit(1);
  }

  const exemptions =
    LOCAL_ONLY_EXEMPTIONS.length + REMOTE_ONLY_EXEMPTIONS.length + UNINVOKED_EXEMPTIONS.length;
  console.log(
    `✅ تكافؤُ الإنفاذِ مستقيمٌ: ${inputs.localGuards.length} ملفّاً في المشغِّلِ · ` +
      `${inputs.workflowGuards.length} في سيرِ العملِ · ${inputs.guardsOnDisk.length} حاجزاً على القرصِ · ` +
      `${exemptions} إعفاءً مكتوباً بسببِه.`,
  );
}
