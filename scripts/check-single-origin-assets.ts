/**
 * الغرض: بوابة CI تفرض البند `F1-10` «تثبيت النطاق الواحد ومنع الأصول التنفيذية
 *    الخارجية» والقيدَ `TG-005` وصفَّ «النطاق» في القسم 9.2 — بخمسِ قواعدَ:
 *    (١) **لا نطاقَ خارجيّاً إلّا المأذونَ له كتابةً**: كلُّ عنوانٍ مطلقٍ في شيفرةِ
 *        التطبيقِ المصغَّرِ يجب أن يكون في القائمةِ المغلقةِ
 *        (`scripts/lib/content-security-policy.ts`) — وفيها **واحدٌ** بسندٍ مكتوبٍ.
 *    (٢) **لا إطارَ داخليّاً**: لا `<iframe>` ولا `<embed>` ولا `<object>` — إطارٌ
 *        داخلَ Mini App هو بالضبطِ ما تحرسه حمايةُ تلغرامَ المفعَّلةُ في 2026-07-20.
 *    (٣) **لا تنفيذَ من نصٍّ**: لا `eval` ولا `new Function` ولا `document.write`
 *        ولا `setTimeout("…")` — كلُّها تُلزِم `'unsafe-eval'`/`'unsafe-inline'`.
 *    (٤) **لا حقنَ سكربتٍ في زمنِ التشغيلِ**: لا `createElement("script")` ولا
 *        `appendChild` لسكربتٍ ولا `import()` بعنوانٍ مطلقٍ — أصلٌ تنفيذيٌّ يُجلَب
 *        في زمنِ التشغيلِ يتجاوز كلَّ فحصٍ يقرأ المُخرَجَ.
 *    (٥) **سياسةُ المُخرَجِ = سياسةُ الوحدةِ حرفاً حرفاً**: وسمُ `dist/index.html`
 *        يُقارَن بما تبنيه الوحدةُ من أنماطِ المُخرَجِ نفسِه. فسياسةٌ تُعدَّل بيدٍ في
 *        المستندِ المصدريِّ أو بصمةُ أنماطٍ متقادمةٌ لا تمرُّ.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml و`bun run ci`
 * ملاحظات مستقبلية:
 *    - حين يُقرَّر شأنُ MapLibre (استضافةٌ ذاتيةٌ أم CDN) فالتعديلُ يكون في وحدةِ
 *      السياسةِ وحدَها ومعه ADR: القائمةُ تُوسَّع بسندٍ مكتوبٍ لا بإلغاءِ قاعدةٍ.
 *      والتوتُّرُ اليومَ **مُعلَنٌ غيرُ محسومٍ** (ADR 0045 §٦).
 *    - حين يُوجَد مضيفٌ للتطبيقِ في `render.yaml` يُضاف فحصٌ لرأسِ الاستجابةِ إلى
 *      جانبِ الوسمِ — والوسمُ **أضعفُ من الرأسِ** ولا يُدَّعى غيرُ ذلك.
 *
 * لماذا فحصٌ لا اتفاق: سطرٌ واحدٌ يُنشئ `<script>` ويُسنِد إليه عنواناً من نطاقٍ
 * ثالثٍ يُدخِل كودَ غيرِنا إلى مستندٍ يحمل جلسةَ المستخدمِ — ولا يظهر في مراجعةٍ
 * عابرةٍ ولا في أيِّ اختبارِ سلوكٍ، ويبقى يعمل.
 *
 * والفحصُ يُسقِط البناءَ أيضاً إن **غاب** المُخرَجُ أو غاب وسمُ السياسةِ أو خلت
 * القائمةُ المغلقةُ: حاجزٌ لا يمكن أن يمرَّ فراغاً.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { blankComments } from "./lib/blank-comments.ts";
import {
  ALLOWED_EXTERNAL_ORIGIN_LIST,
  buildCsp,
  cspMetaTag,
  SOLE_EXTERNAL_SCRIPT_HOST_FILE,
} from "./lib/content-security-policy.ts";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html"]);

/** شيفرةُ التطبيقِ المصغَّرِ وحدَها: هي ما يُنفَّذ في مستندٍ يُضمَّنه تلغرام. */
const MINIAPP_ROOT = "apps/miniapp";
const DIST_INDEX = "apps/miniapp/dist/index.html";
/** وحدةُ السياسةِ نفسُها تذكر النطاقَ نصّاً — وهي مصدرُ الإذنِ لا مخالفتُه. */
const POLICY_MODULE = "scripts/lib/content-security-policy.ts";
/** هذا الملفُّ يذكر الأنماطَ الممنوعةَ نصّاً فيُستثنى من نفسِه. */
const SELF = "scripts/check-single-origin-assets.ts";

const isTest = (file: string): boolean => file.includes(".test.");
/** شيفرةُ إنتاجٍ في التطبيقِ المصغَّرِ — لا اختبارات، ولا مُخرَجُ بناءٍ. */
const isMiniappSource = (file: string): boolean =>
  file.startsWith(`${MINIAPP_ROOT}/`) && !isTest(file) && !file.includes("/dist/");

interface Rule {
  readonly pattern: RegExp;
  readonly why: string;
  readonly applies: (file: string) => boolean;
}

const RULES: readonly Rule[] = [
  {
    pattern: /<\s*(?:iframe|embed|object)\b/i,
    why: "لا إطارَ ولا كائنَ مُضمَّنٍ في Mini App: حمايةُ الأصولِ المتقاطعةِ (TG-005 · القسم 9.2)",
    applies: (file) => isMiniappSource(file),
  },
  {
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|document\s*\.\s*write\b/,
    why: "لا تنفيذَ من نصٍّ: يُلزِم 'unsafe-eval'/'unsafe-inline' فيُبطِل السياسةَ (F1-10 · ADR 0045)",
    applies: (file) => isMiniappSource(file),
  },
  {
    pattern: /\b(?:setTimeout|setInterval)\s*\(\s*["'`]/,
    why: "مؤقّتٌ بنصٍّ تنفيذٌ من نصٍّ: يُلزِم 'unsafe-eval' (F1-10 · ADR 0045)",
    applies: (file) => isMiniappSource(file),
  },
  {
    pattern: /createElement\s*\(\s*["'`]script["'`]/i,
    why: "لا حقنَ سكربتٍ في زمنِ التشغيلِ: أصلٌ تنفيذيٌّ يتجاوز كلَّ فحصٍ يقرأ المُخرَجَ (TG-005)",
    applies: (file) => isMiniappSource(file),
  },
  {
    pattern: /\bimport\s*\(\s*[`"']https?:\/\//i,
    why: "لا استيرادَ حيويّاً من عنوانٍ مطلقٍ: النطاقُ واحدٌ (TG-005 · القسم 9.2)",
    applies: (file) => isMiniappSource(file),
  },
  {
    pattern: /\bimportScripts\s*\(|\bnew\s+Worker\s*\(|\bServiceWorker\b|serviceWorker/,
    why: "لا عامِلَ ولا عامِلَ خدمةٍ: السياسةُ تمنعهما ('none') وإدخالُهما قرارٌ لم يُتَّخذ (F1-10)",
    applies: (file) => isMiniappSource(file),
  },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly why: string;
}

/**
 * كلُّ أصلٍ خارجيٍّ (`https://host`) مذكورٍ في سطرٍ. والمنعُ على **الأصلِ** لا على
 * العنوانِ الكاملِ: نطاقٌ واحدٌ مأذونٌ له لا يصير عشرةً بمساراتٍ مختلفة.
 */
function externalOriginsIn(line: string): string[] {
  const found: string[] = [];
  const pattern = /https?:\/\/[a-z0-9.-]+(?::\d+)?/gi;
  let match = pattern.exec(line);
  while (match !== null) {
    found.push(match[0].toLowerCase());
    match = pattern.exec(line);
  }
  return found;
}

/**
 * أصولٌ لا تُنفَّذ ولا تُطلَب من الجهازِ: عناوينُ توثيقٍ ومعاييرَ في التعليقاتِ
 * تُفرَّغ سلفاً، وهذه بقيّةُ ما يظهر في نصوصٍ لا في وسومٍ ولا في نداءاتِ شبكةٍ.
 * والقائمةُ **معلَنةٌ** كي لا تصير الاستثناءاتُ ضمنيّة.
 */
const NON_FETCHED_ORIGIN_PREFIXES: readonly string[] = [
  /** فضاءاتُ أسماءٍ في XML/SVG — نصٌّ لا يُطلَب من الشبكةِ بحالٍ. */
  "http://www.w3.org",
  "https://www.w3.org",
];

function main(): void {
  const violations: Violation[] = [];

  /** حاجزٌ لا يمرُّ فراغاً: القائمةُ المغلقةُ ليست فارغةً. */
  if (ALLOWED_EXTERNAL_ORIGIN_LIST.length === 0) {
    console.error("✗ قائمةُ النطاقاتِ المأذونِ لها فارغةٌ: الحاجزُ يمرُّ فراغاً ولا يُقبَل.");
    process.exit(1);
  }

  const allowed = new Set(ALLOWED_EXTERNAL_ORIGIN_LIST.map((origin) => origin.toLowerCase()));

  const files = walk(".")
    .map((file) => (file.startsWith("./") ? file.slice(2) : file))
    .filter((file) => file.startsWith(`${MINIAPP_ROOT}/`) || file.startsWith("scripts/"))
    .filter((file) => file !== SELF && file !== POLICY_MODULE);

  for (const file of files) {
    const lines = blankComments(readFileSync(file, "utf8")).split("\n");
    for (const [index, text] of lines.entries()) {
      for (const rule of RULES) {
        if (!rule.applies(file)) continue;
        if (!rule.pattern.test(text)) continue;
        violations.push({ file, line: index + 1, text: text.trim().slice(0, 160), why: rule.why });
      }

      /**
       * قاعدةُ الأصلِ الخارجيِّ: على **شيفرةِ الإنتاجِ** في التطبيقِ المصغَّرِ وحدَها.
       *
       * **وحدُّها هذا اكتُشِف بالبرهانِ لا بالتقدير:** أوّلُ صيغةٍ طبّقتها على
       * الاختباراتِ أيضاً فأسقطت خمسةَ مواضعَ **كلُّها سليمةٌ** — نصوصُ أخطاءٍ
       * مصنوعةٌ فيها عنوانٌ لإثباتِ أنّ القياسَ لا ينقله، ومُعامِلاتُ
       * `openExternalLink`/`openTelegramDeepLink`. والفرقُ جوهريٌّ لا شكليٌّ:
       * **عنوانٌ يُفتَح في متصفّحِ المستخدمِ ليس أصلاً تنفيذيّاً في مستندِنا**،
       * والقيدُ `TG-005` عن الثاني لا الأوّل. فتوسيعُ القاعدةِ إلى الاختباراتِ كان
       * **يمنع فتحَ رابطٍ** وهو قدرةٌ معتمَدةٌ في §4.4 — أي حاجزاً يمنع الصوابَ.
       *
       * **وما يبقى بلا حِراسةٍ يُعلَن:** عنوانٌ خارجيٌّ يُكتَب في ملفِّ اختبارٍ
       * لا يُبلَّغ عنه. وذاك مقبولٌ لأنّ ملفَّ الاختبارِ لا يُبنى في `dist` ولا
       * يُنفَّذ على جهازٍ، والمُخرَجُ نفسُه مفحوصٌ في القاعدةِ الخامسةِ.
       */
      if (!isMiniappSource(file)) continue;
      for (const origin of externalOriginsIn(text)) {
        if (NON_FETCHED_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix))) continue;
        if (!allowed.has(origin)) {
          violations.push({
            file,
            line: index + 1,
            text: text.trim().slice(0, 160),
            why: `نطاقٌ خارجيٌّ غيرُ مأذونٍ له: ${origin} — القائمةُ مغلقةٌ في ${POLICY_MODULE} (TG-005)`,
          });
          continue;
        }
        if (file !== SOLE_EXTERNAL_SCRIPT_HOST_FILE) {
          violations.push({
            file,
            line: index + 1,
            text: text.trim().slice(0, 160),
            why: `الأصلُ الخارجيُّ المأذونُ له يُذكَر في ${SOLE_EXTERNAL_SCRIPT_HOST_FILE} وحدَه (F1-10)`,
          });
        }
      }
    }
  }

  /** (٥) سياسةُ المُخرَجِ تُقارَن بما تبنيه الوحدةُ من أنماطِ المُخرَجِ نفسِه. */
  let dist = "";
  try {
    dist = readFileSync(DIST_INDEX, "utf8");
  } catch {
    console.error(
      `✗ ${DIST_INDEX} غيرُ موجودٍ: هذا الفحصُ يقرأ مُخرَجَ البناءِ لا الشيفرةَ، فيُشغَّل بعدَ البناء.`,
    );
    process.exit(1);
  }

  const styleHashes: string[] = [];
  const stylePattern = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g;
  let styleMatch = stylePattern.exec(dist);
  while (styleMatch !== null) {
    const body = styleMatch[1] ?? "";
    styleHashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    styleMatch = stylePattern.exec(dist);
  }

  /** D-23: بصماتُ السكربتِ المُدمَجِ — نفسُ النمطِ، لكن للسكربتِ الخارجيّ. */
  const scriptHashes: string[] = [];
  const scriptPattern = /<script\s+[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g;
  let scriptMatch = scriptPattern.exec(dist);
  while (scriptMatch !== null) {
    const tag = scriptMatch[0];
    const body = scriptMatch[1] ?? "";
    if (!/\ssrc=/.test(tag)) {
      scriptHashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    }
    scriptMatch = scriptPattern.exec(dist);
  }

  const expected = cspMetaTag(
    buildCsp({
      apiBase: process.env.VITE_WASLAH_API_BASE,
      inlineStyleHashes: styleHashes,
      inlineScriptHashes: scriptHashes,
    }),
  );

  if (!dist.includes(expected)) {
    const actual = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i.exec(dist);
    console.error("✗ وسمُ سياسةِ المحتوى في المُخرَجِ لا يطابق ما تبنيه وحدةُ السياسةِ.");
    console.error(`  المتوقَّع: ${expected}`);
    console.error(`  الموجود : ${actual === null ? "(لا وسمَ سياسةٍ في المُخرَجِ إطلاقاً)" : actual[0]}`);
    process.exit(1);
  }

  /** ولا سياسةَ ثانيةً: وسمانِ متعارضانِ يُطبَّقانِ معاً فيصير الأشدُّ غامضاً. */
  const tagCount = (dist.match(/<meta\s+http-equiv="Content-Security-Policy"/gi) ?? []).length;
  if (tagCount !== 1) {
    console.error(`✗ عددُ وسومِ سياسةِ المحتوى في المُخرَجِ ${tagCount} والمطلوبُ واحدٌ بالضبط.`);
    process.exit(1);
  }

  /** ولا سكربتَ من نطاقٍ غيرِ مأذونٍ له في المُخرَجِ نفسِه. */
  const scriptSrc = /<script[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/gi;
  let externalScriptMatch = scriptSrc.exec(dist);
  while (externalScriptMatch !== null) {
    const url = externalScriptMatch[1] ?? "";
    const origin = new URL(url).origin.toLowerCase();
    if (!allowed.has(origin)) {
      console.error(`✗ سكربتٌ في المُخرَجِ من نطاقٍ غيرِ مأذونٍ له: ${origin} (TG-005)`);
      process.exit(1);
    }
    externalScriptMatch = scriptSrc.exec(dist);
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لسياسةِ النطاقِ الواحدِ (F1-10):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✅ النطاقُ واحدٌ: ${allowed.size} نطاقاً خارجيّاً مأذوناً له بسندٍ مكتوبٍ، ` +
      `وسياسةُ المُخرَجِ تطابق وحدةَ السياسةِ حرفاً حرفاً (${styleHashes.length} بصمةَ أنماطٍ مُدمَجةٍ).`,
  );
}

main();
