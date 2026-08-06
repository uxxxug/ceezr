/**
 * الغرض: التأكد أن كل قاموس لغة يحمل نفس المفاتيح — فلا رسالة تظهر كمفتاح خام للمستخدم.
 * الحالة: منفّذ فعلياً — يعمل كبوابة في CI.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: عند إضافة لغة جديدة تُضاف هنا تلقائياً بقراءة المجلد.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "packages", "shared", "i18n");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

const keysByFile = new Map<string, Set<string>>();
for (const file of files) {
  const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim() === "") {
      console.error(`❌ ${file}: المفتاح ${key} ليس نصاً غير فارغ`);
      process.exit(1);
    }
  }
  keysByFile.set(file, new Set(Object.keys(parsed)));
}

const reference = keysByFile.get("ar.json");
if (reference === undefined) {
  console.error("❌ القاموس العربي غير موجود");
  process.exit(1);
}

let failed = false;
for (const [file, keys] of keysByFile) {
  const missing = [...reference].filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !reference.has(key));
  if (missing.length > 0) {
    console.error(`❌ ${file}: مفاتيح ناقصة (${missing.length}): ${missing.join(", ")}`);
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`❌ ${file}: مفاتيح زائدة (${extra.length}): ${extra.join(", ")}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`✅ ${keysByFile.size} قواميس متطابقة، ${reference.size} مفتاحاً في كل منها`);
