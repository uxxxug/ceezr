/**
 * الغرض: بوابةُ CI للبندِ `F8-03` — **سجلاتٌ مُهيكلةٌ بلا بياناتٍ شخصيّةٍ في
 *    النصِّ** (ADR 0078). وتُنفَذُ بأربعِ قواعدَ:
 *    (١) **`console` ممنوعٌ** في سطحِ الخادمِ كلِّه إلّا في المُصدِرِ الوحيدِ
 *        `packages/infrastructure/observability/structured-log.ts` — فشكلُ
 *        السطرِ يُقرَّرُ في موضعٍ واحدٍ لا يُكتَبُ إلّا منه.
 *    (٢) **رمزُ الحدثِ حرفيٌّ لاتينيٌّ منقوطٌ**: أوّلُ وسيطٍ في كلِّ نداءِ تسجيلٍ
 *        نصٌّ حرفيٌّ يطابقُ `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$` — فلا نصَّ حرّاً
 *        ولا قالباً ولا متغيّراً. وهذا وحدَه يُخرِجُ النصَّ الحرَّ من `message`،
 *        وهوَ البابُ الذي تدخلُ منه البياناتُ الشخصيّةُ.
 *    (٣) **أسماءُ الحقولِ الشخصيّةِ ممنوعةٌ** في وسائطِ نداءِ التسجيلِ — مطابقةً
 *        باسمٍ كاملٍ من قائمةٍ مغلقةٍ يقرؤها الحاجزُ **من المُصدِرِ نفسِه** لا من
 *        نسخةٍ ثانيةٍ عندَه.
 *    (٤) **المُصدِرُ قائمٌ بمضمونِه**: الملفُّ موجودٌ، وفيه شكلُ الرمزِ، وقائمةُ
 *        الأسماءِ الشخصيّةِ غيرُ فارغةٍ، والحجبُ والكنيةُ والمِلحُ فيه.
 *    **وصفرُ مواضعِ تسجيلٍ خرقٌ لا نجاحٌ** (`ح-5`): فحصٌ لا يجدُ ما يفحصُه
 *    يُخفِقُ بصوتٍ لا يمرُّ صامتاً.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُستخدم من: package.json (سلسلةُ `ci`) · .github/workflows/ci.yml (وظيفةُ `verify`)
 * الحاكم: ADR 0078 · البند `F8-03`
 * ملاحظات مستقبلية: تصنيفُ الشدّةِ لكلِّ حدثٍ (`F8-02`) ولوحاتُه (`F8-07`) ليسا
 *    ههنا؛ ومن أرادَ إضافةَ اسمٍ شخصيٍّ فليُضِفْه إلى `PERSONAL_FIELD_NAMES` في
 *    المُصدِرِ — لا إلى هذا الملفِّ، فالقائمةُ مصدرُ حقيقةٍ واحدٌ.
 *
 * لماذا فحصٌ لا مراجعة: سطرٌ واحدٌ `log("...", { address })` في ليلةِ عطبٍ يكتبُ
 * عنوانَ كلِّ من طلبَ رحلةً إلى سجلٍّ مُصدَّرٍ محفوظٍ مقروءٍ لمن لا يملكُ حقَّ
 * رؤيتِه — ولا يُستدرَكُ بعدَ كتابتِه. والمراجعةُ تسهو؛ والبناءُ الساقطُ لا يسهو.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** سطحُ الخادمِ. `apps/miniapp` **خارجٌ عن قصدٍ**: حزمةُ متصفّحٍ يحكمُها `F1-08`. */
export const ROOTS = ["apps/gateway", "apps/workers", "apps/admin", "packages"] as const;

/** المُصدِرُ الوحيدُ — وهوَ الاستثناءُ الوحيدُ من قاعدةِ `console`. */
export const EMITTER = "packages/infrastructure/observability/structured-log.ts";

/** هذا الملفُّ نفسُه يذكرُ الأنماطَ نصّاً فيُستثنى من فحصِ نفسِه. */
export const SELF = "scripts/check-structured-logging.ts";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

export const CONSOLE_PATTERN = /\bconsole\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/g;

/** شكلُ رمزِ الحدثِ — **نصُّه واحدٌ ههنا وفي المُصدِرِ**، ويُتحقَّقُ من ذلك في القاعدةِ الرابعةِ. */
export const EVENT_CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * نداءاتُ التسجيلِ: `log(` · `deps.log?.(` · `log.info(` · `log.warn(` · `log.error(`.
 * ولا يُلتقَطُ `function log(` ولا `catalog(` ولا `console.log(` — الأوّلُ تعريفٌ
 * والثاني اسمٌ يشتركُ في اللاحقةِ والثالثُ يحكمُه فحصُ `console` وحدَه.
 */
const LOG_CALL_PATTERN =
  /(?<![A-Za-z0-9_$])(?<!console\s*\.\s*)log(?:\?\.)?(?:\s*\.\s*(?:info|warn|error))?\s*(?:\?\.)?\(/g;

/** ما لا يُعَدُّ نداءً وإن طابقَ: تعريفُ دالّةٍ أو نوعٍ. */
const DECLARATION_BEFORE = /(?:function|const|let|var|type|interface|readonly)\s*$/;

/**
 * يُبيِّضُ التعليقاتَ مع حفظِ الأطوالِ والأسطرِ — فذكرُ `console.log` في تعليقٍ
 * شارحٍ ليسَ كتابةً، وشرحُ توقيعِ `log(event, fields)` في رأسِ ملفٍّ ليسَ نداءً.
 * ويحترمُ النصوصَ فلا يُبيَّضُ `//` داخلَ رابطٍ.
 */
export function blankComments(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const ch = source[index];
    if (quote !== null) {
      if (ch === "\\") index += 2;
      else {
        if (ch === quote) quote = null;
        index += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }
    if (ch === "/" && source[index + 1] === "*") {
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") out[index] = " ";
        index += 1;
      }
      out[index] = " ";
      out[index + 1] = " ";
      index += 2;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * ناقلٌ شفّافٌ: `(message, meta) => log.info(message, meta)`.
 *
 * الوسيطُ الأوّلُ ههنا مُعرِّفٌ لا نصٌّ، لكنَّه **مُعامِلُ الدالّةِ الحاويةِ**
 * الأوّلُ — فهوَ لا يُنشِئُ نصّاً جديداً، بل يُمرِّرُ رمزاً تحقَّقَ منه الحاجزُ
 * في موضعِ نشأتِه. ومنعُ هذا الشكلِ يُلزِمُ حذفَ كلِّ وصلاتِ الحقنِ في المستودعِ
 * دونَ أن يمنعَ نصّاً حرّاً واحداً — أي تعقيدٌ بلا صدقِ قياسٍ.
 * **والحدُّ مُعلَنٌ**: الحاجزُ لا يتبعُ سلسلةَ النقلِ، بل يعتمدُ أنَّ المنشأَ
 * مفحوصٌ في ملفِّه.
 */
export function isTransparentForward(
  source: string,
  identifier: string,
  callIndex: number,
): boolean {
  const asFirstParameter = new RegExp(
    `\\(\\s*${identifier}(?:\\s*:[^,)]*)?\\s*(?:,[^)]*)?\\)\\s*(?:=>|\\{|:)`,
  );
  return asFirstParameter.test(source.slice(0, callIndex));
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules" && entry !== "dist") walk(full, out);
      continue;
    }
    if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
}

export function scannedFiles(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(root, files);
  return files.filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

/**
 * يقرأُ الوسائطَ بينَ قوسَينِ متوازنَينِ بدءاً من موضعِ القوسِ المفتوحِ.
 * ويحترمُ النصوصَ فلا يُعَدُّ قوسٌ داخلَ نصٍّ إغلاقاً.
 */
export function argumentsAt(source: string, openParen: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1);
}

/** أوّلُ وسيطٍ نصّاً، إن كان حرفيّاً بعلامتَي تنصيصٍ مزدوجتَينِ. */
export function firstStringLiteral(args: string): string | null {
  const match = /^\s*"((?:[^"\\]|\\.)*)"/.exec(args);
  return match?.[1] ?? null;
}

/**
 * قائمةُ الأسماءِ الشخصيّةِ **تُقرأُ من المُصدِرِ** لا تُكتَبُ ههنا: نسختانِ من
 * قائمةٍ واحدةٍ تفترقانِ بأوّلِ إضافةٍ، فيصيرُ الحاجزُ يحرسُ قائمةً غيرَ التي
 * تحجبُ فعلاً.
 *
 * وإن تعذّرَ قراءةُ المُصدِرِ أُعيدَت قائمةٌ فارغةٌ ولم تُرمَ رميةٌ ههنا: غيابُ
 * المُصدِرِ خرقٌ **مُسمّىً** (`emitter-missing`) يُبلِّغُه `findViolations`، ورميةٌ
 * من ههنا تُخفي الاسمَ وتُبدِلُه بانهيارٍ غيرِ مُصنَّفٍ.
 */
export function personalFieldNames(read: (path: string) => string = readSource): string[] {
  let source = "";
  try {
    source = read(EMITTER);
  } catch {
    return [];
  }
  const block = /PERSONAL_FIELD_NAMES\s*:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (block === null) return [];
  const body = block[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function normalise(name: string): string {
  return name.toLowerCase().replaceAll("_", "");
}

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * يفحصُ المستودعَ ويعيدُ كلَّ خرقٍ. و`read` مُمرَّرٌ لأنَّ اختبارَ الحاجزِ
 * يُشوِّهُ نصّاً واقعيّاً ويُطالِبُه بالخرقِ — وحاجزٌ لا تُختبَرُ حالاتُه
 * السالبةُ حاجزٌ بالاسمِ.
 */
export function findViolations(
  read: (path: string) => string = readSource,
  files: readonly string[] = scannedFiles(),
): { readonly violations: Violation[]; readonly logCallSites: number } {
  const violations: Violation[] = [];
  const personal = new Set(personalFieldNames(read).map(normalise));
  let logCallSites = 0;

  // ═══ القاعدةُ الرابعةُ: المُصدِرُ قائمٌ بمضمونِه ═══
  let emitterSource = "";
  try {
    emitterSource = read(EMITTER);
  } catch {
    violations.push({
      file: EMITTER,
      line: 0,
      rule: "emitter-missing",
      detail: "المُصدِرُ الوحيدُ للسجلِّ غيرُ موجودٍ — لا يُقرَأُ غيابُ الدليلِ نجاحاً",
    });
  }
  if (emitterSource !== "") {
    const required: readonly [string, string][] = [
      ["EVENT_CODE_PATTERN", "شكلُ رمزِ الحدثِ محذوفٌ من المُصدِرِ"],
      ["PERSONAL_FIELD_NAMES", "قائمةُ الأسماءِ الشخصيّةِ محذوفةٌ من المُصدِرِ"],
      ["REDACTED", "علامةُ الحجبِ محذوفةٌ من المُصدِرِ"],
      ["function pseudonym", "دالّةُ الكنيةِ محذوفةٌ من المُصدِرِ"],
      ["randomUUID", "مِلحُ الكنيةِ العشوائيُّ محذوفٌ من المُصدِرِ"],
      ["isPersonalFieldName", "حكمُ الاسمِ الشخصيِّ محذوفٌ من المُصدِرِ"],
    ];
    for (const [needle, detail] of required) {
      if (!emitterSource.includes(needle)) {
        violations.push({ file: EMITTER, line: 0, rule: "emitter-gutted", detail });
      }
    }
    if (personal.size === 0) {
      violations.push({
        file: EMITTER,
        line: 0,
        rule: "emitter-gutted",
        detail: "قائمةُ الأسماءِ الشخصيّةِ فارغةٌ — حاجزٌ لا يمنعُ شيئاً",
      });
    }
    if (!emitterSource.includes(EVENT_CODE_PATTERN.source)) {
      violations.push({
        file: EMITTER,
        line: 0,
        rule: "pattern-drift",
        detail: `شكلُ رمزِ الحدثِ في المُصدِرِ يخالفُ شكلَ الحاجزِ: ${EVENT_CODE_PATTERN.source}`,
      });
    }
  }

  for (const file of files) {
    if (file === SELF) continue;
    let raw: string;
    try {
      raw = read(file);
    } catch {
      continue;
    }
    const source = blankComments(raw);

    // ═══ القاعدةُ الأولى: `console` ممنوعٌ خارجَ المُصدِرِ ═══
    if (file !== EMITTER) {
      for (const match of source.matchAll(CONSOLE_PATTERN)) {
        violations.push({
          file,
          line: lineOf(source, match.index),
          rule: "console-outside-emitter",
          detail: `\`console.${match[1]}\` — الكتابةُ لا تكونُ إلّا من ${EMITTER}`,
        });
      }
    }

    // ═══ القاعدتانِ الثانيةُ والثالثةُ: رمزُ الحدثِ والحقولُ ═══
    for (const match of source.matchAll(LOG_CALL_PATTERN)) {
      const before = source.slice(Math.max(0, match.index - 12), match.index);
      if (DECLARATION_BEFORE.test(before)) continue;
      const openParen = match.index + match[0].length - 1;
      const args = argumentsAt(source, openParen);
      const line = lineOf(source, match.index);
      logCallSites += 1;

      const literal = firstStringLiteral(args);
      if (literal === null) {
        const identifier = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|\))/.exec(args);
        const forwarded = identifier?.[1];
        if (forwarded !== undefined && isTransparentForward(source, forwarded, match.index))
          continue;
        violations.push({
          file,
          line,
          rule: "event-not-literal",
          detail: "أوّلُ وسيطٍ ليسَ نصّاً حرفيّاً — لا قالبَ ولا متغيّرَ في رمزِ الحدثِ",
        });
      } else if (!EVENT_CODE_PATTERN.test(literal)) {
        violations.push({
          file,
          line,
          rule: "event-code-shape",
          detail: `رمزُ حدثٍ لا يطابقُ الشكلَ (طولُه ${literal.length}) — لاتينيٌّ صغيرٌ منقوطٌ لا نصٌّ حرٌّ`,
        });
      }

      for (const field of args.matchAll(
        /(?<![A-Za-z0-9_$."'])([A-Za-z_$][\w$]*)\s*(?::|,|\}|$)/g,
      )) {
        const name = field[1];
        if (name !== undefined && personal.has(normalise(name))) {
          violations.push({
            file,
            line,
            rule: "personal-field",
            detail: `حقلٌ شخصيٌّ في نداءِ تسجيلٍ: \`${name}\` — مرِّرْ كنيةً (\`log.pseudonym\`) أو سبباً مصنَّفاً`,
          });
        }
      }
    }
  }

  // ═══ `ح-5`: صفرُ مواضعَ خرقٌ لا نجاحٌ ═══
  if (logCallSites === 0) {
    violations.push({
      file: "(المستودع)",
      line: 0,
      rule: "no-log-call-sites",
      detail: "لم يُعثَرْ على موضعِ تسجيلٍ واحدٍ — فحصٌ لا يجدُ ما يفحصُه يُخفِقُ",
    });
  }

  return { violations, logCallSites };
}

function main(): void {
  const { violations, logCallSites } = findViolations();
  if (violations.length === 0) {
    console.log(
      `✓ سجلاتٌ مُهيكلةٌ: ${logCallSites} موضعَ تسجيلٍ برموزٍ حرفيّةٍ، و\`console\` محصورٌ في المُصدِرِ، ولا حقلَ شخصيّاً.`,
    );
    return;
  }
  console.error("✗ خرقُ سياسةِ السجلاتِ المُهيكلةِ (F8-03 · ADR 0078):\n");
  for (const violation of violations) {
    console.error(`  [${violation.rule}] ${violation.file}:${violation.line}`);
    console.error(`      ${violation.detail}`);
  }
  console.error(`\nالمجموع: ${violations.length} خرقاً في ${logCallSites} موضعَ تسجيلٍ.`);
  process.exit(1);
}

if (import.meta.main) main();
