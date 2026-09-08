/**
 * الغرض: بوابة CI تفرض شرطاً صريحاً من البند `F1-03`: **لا يُسجَّل سرٌّ ولا بيانُ
 *    اعتمادٍ في سجلٍّ ولا رسالةِ خطأ** — لا `initData` خامّاً، ولا رمزَ جلسةٍ أو
 *    تجديدٍ، ولا رمزَ بوت، ولا سرَّ توقيعٍ أو ويبهوك.
 *    والفحصُ يعمّ كلَّ مسارِ تسجيلٍ لا `console` وحدَه: الحقنُ عبر `log(...)` أو
 *    `deps.log?.(...)` هو الأسلوبُ السائدُ في البوابة، فحصرُ الفحصِ في `console`
 *    كان سيترك البابَ الذي يُستعمَل فعلاً مفتوحاً.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: عند بناءِ التجديدِ (`F1-04`) تُضاف أسماءُ رموزِه إلى القائمةِ
 *    لا قاعدةٌ جديدة؛ والقاعدةُ نفسُها لا تتغيّر.
 *
 * لماذا فحصٌ لا مراجعة: تسريبُ سرٍّ إلى سجلٍّ لا يُستدرَك بعد حدوثِه — السجلُّ
 * مُصدَّرٌ ومحفوظٌ ومقروءٌ لمن لا يملك السرَّ أصلاً. وسطرُ تصحيحٍ واحدٌ في ليلةِ
 * عطبٍ يكفي، ثم يُنسى في المستودعِ سنةً. فالبناءُ الساقطُ هو الحاجزُ الذي لا يُنسى.
 *
 * ولماذا تُفحَص الأسماءُ لا القيم: لأنّ القيمَ لا تُعرَف وقتَ الفحص. فالمنعُ يقع
 * على تمريرِ **مُعرِّفٍ** اسمُه اسمُ سرٍّ إلى نداءِ تسجيل، وهذا يُلزِم الكاتبَ أن
 * يمرّر بدلاً منه وصفاً مصنَّفاً (`reason`, `bot`) — وهو المطلوبُ نفسُه.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["apps", "packages", "scripts", "bots", "bench"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً فيُستثنى. */
const SELF = "scripts/check-secret-logging.ts";

/**
 * أسماءُ ما لا يُسجَّل. تُطابَق كلمةً كاملةً بلا حساسيةِ حالةٍ، فـ`initData`
 * و`init_data` و`INIT_DATA` سواءٌ — والحيلةُ بتغييرِ الحالةِ لا تمرّ.
 */
const SECRET_NAMES = [
  "initData",
  "init_data",
  "rawInitData",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "botToken",
  "bot_token",
  "driverBotToken",
  "riderBotToken",
  "sessionSecret",
  "session_secret",
  "miniappSessionSecret",
  "MINIAPP_SESSION_SECRET",
  "webhookSecret",
  "TELEGRAM_WEBHOOK_SECRET",
  "secretKey",
  "serviceRoleKey",
  "SUPABASE_SERVICE_ROLE_KEY",
  // ترويساتُ اعتمادِ المُجمِّع المركزيّ (F5-07 · ADR 0062): قيمتُها رمزُ اعتمادٍ
  // يُكتَب في `Authorization`، ومن ملكَه كتب في لوحةِ مراقبتِنا ما شاء.
  "METRICS_EXPORT_HEADERS",
  "metricsExportHeaders",
] as const;

/**
 * نداءاتُ التسجيلِ المفحوصة: `console.*`, و`log(`/`logger.*(`, و`log?.(`
 * و`deps.log(` و`this.log(` — أي كلُّ ما ينتهي إلى سجلٍّ مكتوب.
 */
const LOG_CALL =
  /(?:console\s*\.\s*\w+|(?:\w+\s*(?:\?)?\.\s*)?log(?:ger)?(?:\s*\?)?\s*\.?\s*\w*)\s*\(/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly name: string;
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

/** يقتطع من السطرِ ما بعدَ أوّلِ نداءِ تسجيل — فالبحثُ في وسائطِه لا في السطرِ كلِّه. */
function argumentsAfterLogCall(text: string): string | null {
  const match = LOG_CALL.exec(text);
  if (match === null) return null;
  return text.slice(match.index + match[0].length);
}

function main(): void {
  const violations: Violation[] = [];
  const files = ROOTS.flatMap((root) => walk(root)).filter((file) => file !== SELF);

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, text] of lines.entries()) {
      // التعليقاتُ تشرح القاعدةَ فتذكر الأسماءَ، ولا تُنفِّذ شيئاً.
      const trimmed = text.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

      const args = argumentsAfterLogCall(text);
      if (args === null) continue;

      for (const name of SECRET_NAMES) {
        const pattern = new RegExp(`\\b${name}\\b`, "i");
        if (!pattern.test(args)) continue;
        violations.push({ file, line: index + 1, text: trimmed.slice(0, 160), name });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} تسريباً محتملاً لسرٍّ إلى سجلٍّ (F1-03):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.text}`);
      console.error(`    لا يُمرَّر \`${violation.name}\` إلى نداءِ تسجيل — مرِّر سبباً مصنَّفاً بدلاً منه\n`);
    }
    process.exit(1);
  }

  console.log(`✓ لا سرَّ ولا بيانَ اعتمادٍ يُمرَّر إلى نداءِ تسجيل (${SECRET_NAMES.length} اسماً مفحوصاً)`);
}

main();
