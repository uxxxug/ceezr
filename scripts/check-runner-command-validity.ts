#!/usr/bin/env bun
/**
 * # الحاجزُ: أمرٌ في المشغِّلِ لا يُنادى كما كُتِبَ ليسَ حاجزاً — `D-24`
 *
 * **الغرض:** أن يُقاسَ أنَّ كلَّ أمرٍ في سلسلةِ `package.json → ci` **قابلٌ
 * للنداءِ كما كُتِبَ**، فلا يبقى أمرٌ يُخفِقُ في كلِّ نداءٍ محلّيٍّ وهوَ أخضرُ
 * في كلِّ مكانٍ.
 *
 * **الحالة:** `D-24` — إصلاحُ عطبٍ حقيقيٍّ لا تنظيمٌ: `check-no-skipped-tests.ts`
 * أُدرِجَ في السلسلةِ بلا وسيطِ سجلٍّ فكانَ يُخفِقُ (خروج `1`) في كلِّ نداءٍ،
 * **ودُمِجَ خضراءَ** لأنَّ CI لا تُشغِّلُ السلسلةَ وحاجزُ `ADR 0143` يقيسُ
 * العضويّةَ لا الصلاحيّةَ.
 *
 * **ينتمي إلى:** `D-24` في `docs/technical-debt/20260917-audit-debt-registry.md`
 * ويبني على `ADR 0143` (تكافؤُ الإنفاذِ) ويُكمِلُ حدَّهُ المُعلَنَ.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّلُ أمراً ولا يُدَّعى أنَّه ناجحٌ.** يُقاسُ أنَّه **يُنادى كما كُتِبَ**؛
 *   والصلاحيّةُ الدلاليّةُ (أيُنجِزُ ما وُعِدَ؟) تبقى دَيناً مُعلَناً في `D-24`.
 * - **لا يخترعُ استهلاكاً للوسائطِ.** يُقرأُ من عُرفِ المستودعِ نفسِه: سطرُ
 *   استعمالٍ **مطبوعٌ** (لا في تعليقٍ) ثمَّ خروجٌ بغيرِ صفرٍ.
 * - **لا يقرأُ نجاحاً من كشفٍ فارغٍ.**
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeRunnerValidityProblem,
  type RunnerCommand,
  type RunnerValidityInputs,
  runnerValidityProblems,
} from "./lib/runner-command-validity.ts";
import { ARGUMENT_EXEMPTIONS } from "./lib/runner-command-validity-registry.ts";

const PACKAGE_PATH = "package.json";
const SCRIPTS_DIR = "scripts";
const RUNNER_SCRIPT = "ci";

/** مسارُ ملفٍّ تنفيذيٍّ داخلَ `scripts/`. */
const SCRIPT_PATH = /scripts\/[A-Za-z0-9._-]+\.(?:ts|mjs|sh)/;

/**
 * نداءٌ مُحلَّلٌ: `bun run [أعلامٌ] <اسمٌ|مسارٌ> [وسائطُ]`.
 *
 * والأعلامُ تُحلَّلُ ولا تُقرأُ أسماءً: `bun run --cwd apps/miniapp build` نداءٌ
 * لسكربتِ **حزمةٍ أخرى**، فيُحَلُّ في `package.json` الخاصِّ بها — وقراءتُه
 * اسماً في الجذرِ تُخرِجُ إخفاقاً كاذباً، وقراءتُه `--cwd` اسماً أسوأُ.
 */
function parseNamedRun(raw: string): { name: string; cwd: string } | undefined {
  const tokens = raw.split(/\s+/);
  if (tokens.length < 3) return undefined;
  if (tokens[0] !== "bun" && tokens[0] !== "bunx") return undefined;
  if (tokens[1] !== "run") return undefined;

  let cwd = ".";
  let index = 2;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith("-")) break;
    if (token === "--cwd") {
      cwd = tokens[index + 1] ?? ".";
      index += 2;
      continue;
    }
    index += 1;
  }

  const target = tokens[index];
  if (target === undefined || target.startsWith("scripts/")) return undefined;
  return { name: target, cwd };
}

/** مفتاحُ السكربتِ المُسمّى: الاسمُ وحدَه في الجذرِ، ومُقيَّدٌ بالحزمةِ سواه. */
function scriptKey(name: string, cwd: string): string {
  return cwd === "." ? name : `${cwd}#${name}`;
}

/**
 * تعليقٌ ليسَ تنفيذاً: تُنزَعُ تعليقاتُ الكتلةِ وتعليقاتُ السطرِ قبلَ البحثِ عن
 * سطرِ الاستعمالِ، إذ يذكرُ عددٌ من السكربتاتِ استعمالَها في رأسِ التوثيقِ
 * ولا يُطبِعُهُ — فقراءةُ التعليقِ تنفيذاً تُخرِجُ استهلاكاً كاذباً.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * الأمرُ يستهلكُ وسيطاً إن كانَ **يُطبِعُ** سطرَ استعمالٍ ثمَّ يخرجُ بغيرِ صفرٍ.
 * وهذا عُرفُ المستودعِ المكتوبُ في شيفرتِه، لا اصطلاحٌ مستوردٌ.
 */
export function consumesArgument(source: string): boolean {
  const code = stripComments(source);
  const printsUsage = /console\.(?:error|log|warn)\([^)]*الاستعمال/.test(code);
  const exitsNonZero = /process\.exit\(\s*[1-9]/.test(code);
  return printsUsage && exitsNonZero;
}

/** يُقسَمُ نصُّ سكربتٍ إلى أوامرَ مفردةٍ على `&&` و`;` و`||`. */
function splitCommands(body: string): readonly string[] {
  return body
    .split(/&&|\|\||;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * أوامرُ السلسلةِ بعدَ فكِّ نداءاتِ الأسماءِ تكرارًا. والحمايةُ من الحلقاتِ
 * بمجموعةِ الأسماءِ المزارةِ لا بعُمقٍ مُقدَّرٍ.
 */
function chainCommands(
  runner: string,
  scriptsOf: (cwd: string) => Record<string, string>,
): { commands: RunnerCommand[]; keysSeen: Set<string> } {
  const commands: RunnerCommand[] = [];
  const keysSeen = new Set<string>();
  const visited = new Set<string>();
  const pending: string[] = [runner];

  while (pending.length > 0) {
    const body = pending.pop();
    if (body === undefined) break;

    for (const raw of splitCommands(body)) {
      const namedRun = parseNamedRun(raw);
      if (namedRun !== undefined) {
        const key = scriptKey(namedRun.name, namedRun.cwd);
        keysSeen.add(key);
        commands.push({ raw, namedScript: key, argCount: 0 });
        const body = scriptsOf(namedRun.cwd)[namedRun.name];
        if (body === undefined) continue;
        if (visited.has(key)) continue;
        visited.add(key);
        pending.push(body);
        continue;
      }

      const pathMatch = SCRIPT_PATH.exec(raw);
      if (pathMatch === null) continue;
      const scriptPath = pathMatch[0];
      const after = raw.slice(pathMatch.index + scriptPath.length).trim();
      const argCount = after.length === 0 ? 0 : after.split(/\s+/).length;
      commands.push({ raw, scriptPath, argCount });
    }
  }

  return { commands, keysSeen };
}

export function defaultInputs(): RunnerValidityInputs {
  const named =
    (JSON.parse(readFileSync(PACKAGE_PATH, "utf8")) as { scripts?: Record<string, string> })
      .scripts ?? {};

  const runner = named[RUNNER_SCRIPT];
  if (runner === undefined) {
    throw new Error(`لا مشغِّلَ باسمِ \`${RUNNER_SCRIPT}\` في ${PACKAGE_PATH} — الكشفُ معطوبٌ.`);
  }

  const packageCache = new Map<string, Record<string, string>>([[".", named]]);
  const scriptsOf = (cwd: string): Record<string, string> => {
    const cached = packageCache.get(cwd);
    if (cached !== undefined) return cached;
    let scripts: Record<string, string> = {};
    try {
      scripts =
        (
          JSON.parse(readFileSync(join(cwd, PACKAGE_PATH), "utf8")) as {
            scripts?: Record<string, string>;
          }
        ).scripts ?? {};
    } catch {
      scripts = {};
    }
    packageCache.set(cwd, scripts);
    return scripts;
  };

  const { commands } = chainCommands(runner, scriptsOf);
  const definedNamedScripts: string[] = [];
  for (const [cwd, scripts] of packageCache) {
    for (const name of Object.keys(scripts)) definedNamedScripts.push(scriptKey(name, cwd));
  }

  const existingScriptFiles = readdirSync(SCRIPTS_DIR)
    .filter((entry) => /\.(?:ts|mjs|sh)$/.test(entry))
    .map((entry) => `${SCRIPTS_DIR}/${entry}`);
  const onDisk = new Set(existingScriptFiles);

  const argumentConsumers = existingScriptFiles.filter((path) => {
    if (!onDisk.has(path) || path.endsWith(".sh")) return false;
    return consumesArgument(readFileSync(join(path), "utf8"));
  });

  return {
    commands,
    existingScriptFiles,
    definedNamedScripts,
    argumentConsumers,
    argumentExemptions: ARGUMENT_EXEMPTIONS,
  };
}

if (import.meta.main) {
  const inputs = defaultInputs();
  const problems = runnerValidityProblems(inputs);

  if (problems.length > 0) {
    console.error(`✗ ${problems.length} مخالفةً في صلاحيّةِ نداءِ أوامرِ المشغِّلِ (D-24):\n`);
    for (const problem of problems)
      console.error(`  • ${describeRunnerValidityProblem(problem)}\n`);
    process.exit(1);
  }

  const consumersInChain = new Set(
    inputs.commands
      .map((command) => command.scriptPath)
      .filter(
        (path): path is string => path !== undefined && inputs.argumentConsumers.includes(path),
      ),
  );
  console.log(
    `✅ أوامرُ المشغِّلِ قابلةٌ للنداءِ كما كُتِبَت: ${inputs.commands.length} أمراً · ` +
      `${inputs.existingScriptFiles.length} ملفّاً على القرصِ · ` +
      `${inputs.argumentConsumers.length} سكربتاً يستهلكُ وسيطاً (${consumersInChain.size} منها في السلسلةِ) · ` +
      `${inputs.argumentExemptions.length} إعفاءً مكتوباً بسببِه. ` +
      "ولا يُدَّعى نجاحُ أمرٍ — يُدَّعى أنَّه يُنادى.",
  );
}
