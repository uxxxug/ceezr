/**
 * الغرض: حارس ساكن يتحقّقُ من وجود سياسة العمولة في ترحيلات platform_settings
 *   — مفتاحان: `commission_rate` و`commission_collection_mechanism`.
 *   البند `F12-17`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: scripts
 * يُتوقَّع أن يستخدمه لاحقاً: سلسلة `ci` في package.json و .github/workflows.
 *
 * ## ما لا يُدَّعى (`ح-5`)
 *
 *   ــ لا يتحقّقُ من القيمة (0 أو غيرها) — يتحقّقُ من الوجودِ فقط.
 *   ــ لا يتحقّقُ من الرؤيةِ في التطبيق — لهذا اختباراتٌ أخرى.
 *   ــ لا يتحقّقُ من محرّكِ التسعيرِ — DEC-11/F12-16 يحجبُ ذلك.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const REQUIRED_KEYS = ["commission_rate", "commission_collection_mechanism"] as const;

function fail(message: string): never {
  console.error(`\x1b[31m✗ F12-17: ${message}\x1b[0m`);
  process.exit(1);
}

const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

for (const key of REQUIRED_KEYS) {
  let found = false;
  for (const file of sqlFiles) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    if (content.includes(key)) {
      found = true;
      break;
    }
  }
  if (!found) {
    fail(`مفتاحُ الإعداد «${key}» غيرُ موجدٍ في أيِّ ترحيلٍ. أضِفْه إلى platform_settings.`);
  }
}

console.log("✓ F12-17: مفتاحا سياسة العمولة موجودان في الترحيلات.");
