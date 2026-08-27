/**
 * الغرض: بوابة CI تفرض بندَ `F1-02` في الخارطة — «طبقةُ تغليفِ SDK تيليجرام
 *    (`tg/`): كلُّ استدعاءِ تيليجرامٍ يمرُّ عبرها» — وهو نفسُه البندُ الثالثُ من
 *    ADR 0031 وشرطُ `ARCH-014` في القسم 9.2. والفحصُ ثلاثيُّ الأثر:
 *      ١) لا وصولَ إلى مضيفِ تيليجرامَ (`window.Telegram` · `Telegram.WebApp` ·
 *         `initDataUnsafe` · سكربت `telegram-web-app.js`) خارجَ
 *         `apps/miniapp/src/tg/`، إلا في `index.html` حيث يُحمَّل السكربتُ الرسميّ.
 *      ٢) لا دخولَ إلى الطبقةِ إلا من بابِها الواحد `tg/index.ts` — فالطبقةُ
 *         «قابلةٌ للاستبدال» فقط إذا كان لها بابٌ واحدٌ يُستبدَل من خلفِه.
 *      ٣) لا تسجيلَ لـ`initData` الخامِ في أيِّ مكانٍ من المستودع: هو بيانُ اعتمادٍ
 *         يحمل كائنَ المستخدمِ وتوقيعَه، وتسجيلُه تسريبٌ لا يُستدرَك بعدَ حدوثِه.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: إن أُضيف مضيفٌ ثانٍ (متصفحٌ بمصادقةٍ بديلةٍ — `DEC-07`) فلا
 *    يتغيّر هذا الفحص: يبقى المطلوبَ أن يكون لكلِّ مضيفٍ طبقتُه وبابُه الواحد.
 *
 * لماذا فحصٌ لا اتفاق: `window.Telegram?.WebApp?.something` سطرٌ واحدٌ مغرٍ في
 * شاشةٍ مستعجلة، وهو الذي يُنهي قابليةَ الاستبدال بلا أن يُعلِن ذلك. والاتفاقُ
 * يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** الجذورُ المفحوصة: شيفرةُ المستودعِ كلُّها بلا اعتماديات. */
const ROOTS = ["apps", "packages", "scripts", "tests", "bench"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".html", ".js", ".jsx"]);

/** الطبقةُ نفسُها: وحدَها لها حقُّ لمسِ المضيف. */
const WRAPPER_DIR = "apps/miniapp/src/tg/";
const WRAPPER_ENTRY = "apps/miniapp/src/tg/index.ts";
/** صفحةُ المضيفِ: موضعُ تحميلِ السكربتِ الرسميّ وحدَه. */
const HOST_PAGE = "apps/miniapp/index.html";
/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً، فيُستثنى من مطابقتِها. */
const SELF = "scripts/check-telegram-wrapper-isolation.ts";

type Rule = {
  readonly pattern: RegExp;
  readonly why: string;
  /** الملفّاتُ المسموحُ لها بهذا النمط. */
  readonly allowed: (file: string) => boolean;
};

const insideWrapper = (file: string): boolean => file.startsWith(WRAPPER_DIR);

const RULES: readonly Rule[] = [
  {
    pattern: /\bwindow\s*(\?)?\.\s*Telegram\b/,
    why: "الوصولُ إلى `window.Telegram` داخلَ `apps/miniapp/src/tg/` وحدَه (ADR 0031 §3)",
    allowed: insideWrapper,
  },
  {
    pattern: /\bTelegram\s*(\?)?\.\s*WebApp\b/,
    why: "الوصولُ إلى `Telegram.WebApp` داخلَ `apps/miniapp/src/tg/` وحدَه (ADR 0031 §3)",
    allowed: insideWrapper,
  },
  {
    pattern: /telegram-web-app\.js/,
    why: "سكربتُ تيليجرامَ يُحمَّل في `apps/miniapp/index.html` وحدَه (القسم 9.2)",
    allowed: (file) => file === HOST_PAGE || insideWrapper(file),
  },
  {
    pattern: /\binitDataUnsafe\b/,
    why: "`initDataUnsafe` لا يُلمَس خارجَ الطبقة، ولا يُبنى عليه قرارٌ إطلاقاً (القسم 4.2 · 9.8)",
    allowed: insideWrapper,
  },
  {
    // تسجيلُ `initData` الخامِ ممنوعٌ في كلِّ المستودعِ بلا استثناء — ولا يُستثنى
    // منه ذكرُ `describeInitData` لأنه اسمٌ آخر لا يطابق الكلمةَ المفردة.
    pattern: /console\s*\.\s*\w+\s*\([^)]*\binitData\b/,
    why: "لا يُسجَّل `initData` الخام: بيانُ اعتمادٍ يحمل هُويةَ المستخدمِ وتوقيعَها",
    allowed: () => false,
  },
];

/** استيرادُ الطبقةِ من خارجِها: لا يُقبل إلا بابُها الواحد. */
const TG_IMPORT = /(?:from|import)\s+["']([^"']*\/tg\/[^"']+)["']/g;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly why: string;
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

function main(): void {
  const violations: Violation[] = [];
  const files = ROOTS.flatMap((root) => walk(root)).filter((file) => file !== SELF);

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");

    for (const [index, text] of lines.entries()) {
      for (const rule of RULES) {
        if (!rule.pattern.test(text)) continue;
        if (rule.allowed(file)) continue;
        violations.push({ file, line: index + 1, text: text.trim().slice(0, 160), why: rule.why });
      }
    }

    if (insideWrapper(file)) continue;

    for (const [index, text] of lines.entries()) {
      for (const match of text.matchAll(TG_IMPORT)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const isEntry =
          specifier.endsWith("/tg/index.ts") ||
          specifier.endsWith("/tg/index") ||
          specifier.endsWith("/tg");
        if (isEntry) continue;
        violations.push({
          file,
          line: index + 1,
          text: specifier,
          why: `الدخولُ إلى طبقةِ تيليجرامَ من \`${WRAPPER_ENTRY}\` وحدَه — طبقةٌ واحدةٌ قابلةٌ للاستبدال (القسم 9.2)`,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لعزلِ طبقةِ تيليجرام (F1-02):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ كلُّ استدعاءِ تيليجرامٍ داخلَ \`${WRAPPER_DIR}\`، والدخولُ من \`${WRAPPER_ENTRY}\` وحدَه، ولا تسجيلَ لـ\`initData\` الخام`,
  );
}

main();
