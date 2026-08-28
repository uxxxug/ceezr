/**
 * الغرض: بوابة CI تفرض سياسةَ تخزينِ الجلسةِ في البند `F1-04` والقسمَ 4.4 من
 *    الخارطة: **رمزُ التجديدِ في `SecureStorage` وحدَه على الجهازِ، ورمزُ الوصولِ في
 *    الذاكرةِ وحدَها** — فلا `CloudStorage` (تُزامِن بين الأجهزة)، ولا
 *    `DeviceStorage` (غيرُ مُعَمًّى)، ولا `localStorage` ولا `sessionStorage` ولا
 *    كوكيز، ولا تراجعَ إلى تخزينٍ أضعفَ عندَ غيابِ `SecureStorage`.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: إن أُضيف مضيفٌ ثانٍ (متصفحٌ بمصادقةٍ بديلة — `DEC-07`) فالقاعدةُ
 *    لا تتغيّر: يبقى لكلِّ مضيفٍ موضعُ سياسةٍ واحدٌ يُفحَص.
 *
 * لماذا فحصٌ لا اتفاق: `localStorage.setItem("token", t)` سطرٌ واحدٌ مغرٍ في شاشةٍ
 * مستعجلة، وهو الذي ينقل رمزَ الجلسةِ إلى تخزينٍ يقرؤه كلُّ سكربتٍ في الصفحة. ثم
 * تبقى الوثيقةُ تقول «`SecureStorage` وحدَه» سنةً كاملةً وهي غيرُ صحيحة. والاتفاقُ
 * يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 *
 * والفحصُ يُسقِط البناءَ أيضاً إن **غاب** موضعُ السياسةِ أو خلا من نداءاتِ التخزينِ
 * الآمن: حاجزٌ لا يمكن أن يمرَّ فراغاً.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html"]);

/** شيفرةُ التطبيقِ المصغَّرِ كلُّها. */
const MINIAPP_ROOT = "apps/miniapp";
/** طبقةُ تغليفِ تيليجرام: تُغلِّف كلَّ المخازنِ بلا سياسة (`F1-02`)، فتُستثنى. */
const WRAPPER_DIR = "apps/miniapp/src/tg/";
/** موضعُ سياسةِ التخزينِ الوحيد: هو وحدَه ينادي `SecureStorage`. */
const POLICY_FILE = "apps/miniapp/src/identity/session-storage.ts";
const POLICY_TEST = "apps/miniapp/src/identity/session-storage.test.ts";
/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً فيُستثنى. */
const SELF = "scripts/check-session-storage-policy.ts";

interface Rule {
  readonly pattern: RegExp;
  readonly why: string;
  readonly allowed: (file: string) => boolean;
}

const insideWrapper = (file: string): boolean => file.startsWith(WRAPPER_DIR);
const isPolicy = (file: string): boolean => file === POLICY_FILE || file === POLICY_TEST;

const RULES: readonly Rule[] = [
  {
    pattern: /\b(?:window\s*\.\s*)?localStorage\b/,
    why: "`localStorage` ممنوعٌ في التطبيقِ المصغَّر — ولا تراجعَ إليه عندَ غيابِ `SecureStorage` (F1-04 · القسم 4.4)",
    allowed: () => false,
  },
  {
    pattern: /\b(?:window\s*\.\s*)?sessionStorage\b/,
    why: "`sessionStorage` ممنوعٌ في التطبيقِ المصغَّر — الجلسةُ في الذاكرةِ أو في `SecureStorage` (F1-04)",
    allowed: () => false,
  },
  {
    pattern: /\bdocument\s*\.\s*cookie\b/,
    why: "الكوكيز ممنوعةٌ لحملِ الجلسةِ في التطبيقِ المصغَّر (F1-04)",
    allowed: () => false,
  },
  {
    pattern: /\bcloudStorage[A-Z]\w*\s*\(/,
    why: "`CloudStorage` يُزامِن بين الأجهزةِ فلا يحمل رمزَ جلسة — ممنوعٌ في طبقةِ الهوية (القسم 4.4)",
    allowed: (file) => insideWrapper(file) || !file.includes("/identity/"),
  },
  {
    pattern: /\bdeviceStorage[A-Z]\w*\s*\(/,
    why: "`DeviceStorage` غيرُ مُعَمًّى فلا يحمل رمزَ جلسة — ممنوعٌ في طبقةِ الهوية (القسم 4.4)",
    allowed: (file) => insideWrapper(file) || !file.includes("/identity/"),
  },
  {
    pattern: /\bsecureStorage[A-Z]\w*\s*\(/,
    why: "نداءُ `SecureStorage` من موضعِ السياسةِ وحدَه — سياسةٌ موزَّعةٌ على ملفّاتٍ ليست سياسة (F1-04)",
    allowed: (file) => insideWrapper(file) || isPolicy(file),
  },
];

/**
 * يُفرِّغ التعليقاتَ قبلَ المطابقة: التعليقاتُ تشرح القاعدةَ فتذكر الأسماءَ
 * الممنوعةَ نصّاً، ولا تُنفِّذ شيئاً. والتفريغُ يُبقي أطوالَ الأسطرِ كما هي كي
 * تبقى أرقامُها صحيحةً في البلاغ.
 */
function blankComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      while (index < source.length && source[index] !== "\n") {
        out += " ";
        index += 1;
      }
      continue;
    }
    if (two === "/*") {
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        out += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      out += "  ";
      index += 2;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

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

function main(): void {
  const violations: Violation[] = [];
  const files = walk(MINIAPP_ROOT).filter((file) => file !== SELF);

  for (const file of files) {
    const lines = blankComments(readFileSync(file, "utf8")).split("\n");
    for (const [index, text] of lines.entries()) {
      for (const rule of RULES) {
        if (!rule.pattern.test(text)) continue;
        if (rule.allowed(file)) continue;
        violations.push({ file, line: index + 1, text: text.trim().slice(0, 160), why: rule.why });
      }
    }
  }

  // حاجزٌ لا يمرُّ فراغاً: موضعُ السياسةِ موجودٌ وينادي التخزينَ الآمنَ فعلاً.
  let policySource = "";
  try {
    policySource = readFileSync(POLICY_FILE, "utf8");
  } catch {
    console.error(`✗ موضعُ سياسةِ التخزين مفقود: ${POLICY_FILE} (F1-04)`);
    process.exit(1);
  }
  const requiredCalls = ["secureStorageSet(", "secureStorageGet(", "secureStorageRemove("];
  const missing = requiredCalls.filter((call) => !policySource.includes(call));
  if (missing.length > 0) {
    console.error(`✗ ${POLICY_FILE} لا ينادي التخزينَ الآمن: ${missing.join(" · ")} (F1-04)`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لسياسةِ تخزينِ الجلسة (F1-04 · القسم 4.4):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ رمزُ التجديدِ في التخزينِ الآمنِ وحدَه ورمزُ الوصولِ في الذاكرة (${files.length} ملفاً مفحوصاً · ${RULES.length} قواعد)`,
  );
}

main();
