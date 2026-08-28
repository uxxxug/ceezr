/**
 * الغرض: بوابة CI تفرض حدودَ شاشاتِ الحالاتِ في البند `F1-07`:
 *    (١) **لا استقصاءَ دوريّاً ولا إعادةَ محاولةٍ بمؤقّتٍ** في التطبيقِ المصغَّر —
 *        الفعلُ بيدِ المستخدمِ وحدَه (ADR 0035 §4 · القسم 9.7).
 *    (٢) **فحصُ الحياةِ `GET /health` في موضعٍ واحدٍ** — فلا يصير نداؤه عادةً
 *        متفرّقةً في الشاشات.
 *    (٣) **مبادلةُ `initData` في موضعٍ واحدٍ** — مسارُ الإقلاعِ واحدٌ لا مسارات.
 *    (٤) **`GET /ready` لا يُنادى من العميل** — جسمُه يكشف داخلياتِ الخادم.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: هذا الفحصُ **ليس** فحصَ ADR 0035 الآليَّ الثالثَ (منعُ
 *    الاستقصاءِ مقابلَ النقلِ الفوريّ): ذاك مستحقٌّ بعدَ بندِ النقلِ الفوريِّ ويقيس
 *    شيئاً آخر. وما ههنا حدٌّ أضيقُ: **لا مؤقّتَ في التطبيقِ المصغَّرِ اليوم**.
 *    وحين يُبنى النقلُ الفوريُّ سيلزم استثناءٌ صريحٌ لطبقتِه وحدَها، لا إلغاءُ الفحص.
 *
 * لماذا فحصٌ لا اتفاق: `setInterval(refetch, 5000)` سطرٌ واحدٌ يحلّ مشكلةَ شاشةٍ
 * اليومَ ويكسر عقدَ المعمارِ كلَّه غداً — ويبقى يعمل في جيبِ المستخدمِ بلا أن
 * يراه أحد. والاتفاقُ يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 *
 * والفحصُ يُسقِط البناءَ أيضاً إن **غابت** المواضعُ المفردةُ أو خلت من نداءاتِها:
 * حاجزٌ لا يمكن أن يمرَّ فراغاً.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html"]);

const MINIAPP_ROOT = "apps/miniapp";
/** موضعُ فحصِ الحياةِ الوحيد. */
const HEALTH_FILE = "apps/miniapp/src/system/health.ts";
/** موضعُ مبادلةِ الجلسةِ الوحيد. */
const BOOT_FILE = "apps/miniapp/src/identity/boot.ts";
/** موضعُ تصنيفِ الفشلِ الوحيد. */
const FAILURE_FILE = "apps/miniapp/src/system/failure.ts";
/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً فيُستثنى. */
const SELF = "scripts/check-system-screens-policy.ts";

interface Rule {
  readonly pattern: RegExp;
  readonly why: string;
  readonly allowed: (file: string) => boolean;
}

const isTest = (file: string): boolean => file.includes(".test.");

const RULES: readonly Rule[] = [
  {
    pattern: /\bsetInterval\s*\(/,
    why: "لا استقصاءَ دوريّاً في التطبيقِ المصغَّر — إعادةُ المحاولةِ بفعلِ المستخدمِ وحدَه (ADR 0035 §4 · F1-07)",
    allowed: () => false,
  },
  {
    pattern: /\bsetTimeout\s*\([^;]{0,160}?\b(?:retry|refetch|reload|poll)\w*/i,
    why: "إعادةُ محاولةٍ بمؤقّتٍ = استقصاءٌ بثوبٍ آخر — الفعلُ بيدِ المستخدم (ADR 0035 §4 · F1-07)",
    allowed: () => false,
  },
  {
    pattern: /["'`]\/health\b/,
    why: "فحصُ الحياةِ يُنادى من موضعِه الواحدِ وحدَه (F1-07)",
    allowed: (file) => file === HEALTH_FILE || isTest(file),
  },
  {
    pattern: /["'`]\/ready\b/,
    why: "`GET /ready` يكشف `missingEnv` و`failedChecks` — لا يُنادى من العميلِ (F1-07 · القسم 10)",
    allowed: () => false,
  },
  {
    pattern: /["'`]\/v1\/session\/telegram\b/,
    // الاختباراتُ تُستثنى كما في حارسِ `\/v1\/me`: نصُّها لا يُشحَن، ويلزمها ذكرُ
    // المسارِ لتتحقّق منه أصلاً. والقاعدةُ على شيفرةِ الإنتاجِ وهي التي تعمل.
    why: "مبادلةُ `initData` مسارُ إقلاعٍ واحدٌ لا مسارات (F1-07 · القسم 9.8)",
    allowed: (file) => file === BOOT_FILE || isTest(file),
  },
  {
    pattern: /\bnavigator\s*\.\s*onLine\b/,
    why: "`navigator.onLine` إشارةٌ ضعيفةٌ تُقرأ في موضعِ التشخيصِ وحدَه (F1-07)",
    allowed: (file) => file === HEALTH_FILE || isTest(file),
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

/** حاجزٌ لا يمرُّ فراغاً: الموضعُ موجودٌ ويحوي فعلاً ما يُنسَب إليه. */
function requirePresence(file: string, needles: readonly string[], item: string): void {
  let source = "";
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error(`✗ موضعٌ مفقود: ${file} (${item})`);
    process.exit(1);
  }
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length > 0) {
    console.error(`✗ ${file} لا يحوي: ${missing.join(" · ")} (${item})`);
    process.exit(1);
  }
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

  requirePresence(HEALTH_FILE, ['"/health"', "probeReachability"], "F1-07 · SS-01");
  requirePresence(BOOT_FILE, ['"/v1/session/telegram"', "establishSession"], "F1-07 · SS-05");
  requirePresence(
    FAILURE_FILE,
    ["classifyFailure", "no_connection", "service_unavailable", "session_expired"],
    "F1-07 · تصنيفُ الفشل",
  );

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لحدودِ شاشاتِ الحالات (F1-07 · ADR 0035 §4):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ شاشاتُ الحالاتِ بلا استقصاءٍ دوريٍّ ومواضعُها مفردة (${files.length} ملفاً مفحوصاً · ${RULES.length} قواعد)`,
  );
}

main();
