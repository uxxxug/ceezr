/**
 * الغرض: بوابة CI تمنع ترميز أي قيمة تجارية داخل الكود (القاعدة 0.3): الأسعار، مدة التجربة،
 *    مهلة العرض، حجم الدفعة. مكانها `platform_settings` وحدها.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: تُستثنى رموز حالة HTTP صراحةً لأنها بروتوكول لا سياسة تجارية.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["apps", "packages/domain", "packages/application"];
/**
 * أرقام سياسة تجارية لا يجوز ظهورها في الكود إطلاقاً: أسعار الاشتراك ومهلة قبول العرض.
 * لا نُدرج 10 و30 لأنهما يتكرران في سياقات محايدة (قصّ تاريخ، حدود نصوص) فيصير الفحص ضجيجاً؛
 * حراستهما تقع على اختبارات الوحدة التي تُغيّر الإعدادات وتتوقّع تغيّر السلوك.
 */
const FORBIDDEN = [250, 400, 45];
/** رموز حالة HTTP: بروتوكول لا سياسة — تُقبل داخل استدعاء استجابة فقط. */
const HTTP_STATUS_LINE = /(c\.json\(|new Response\(|status:\s*\d{3}|\}\s*,\s*\d{3}\s*\))/;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly value: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === ".ts") out.push(full);
  }
  return out;
}

function main(): void {
  const hits: Hit[] = [];

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        const code = text.split("//")[0] ?? "";
        // التعليقات العربية الوصفية مستثناة: الممنوع أن يعتمد عليها المنطق
        if (HTTP_STATUS_LINE.test(code)) return;
        for (const value of FORBIDDEN) {
          const pattern = new RegExp(`(^|[^0-9a-zA-Z_.$])${value}(_|\\b)(?![0-9a-zA-Z_])`);
          if (pattern.test(code)) {
            hits.push({ file, line: index + 1, text: text.trim(), value });
          }
        }
      });
    }
  }

  if (hits.length > 0) {
    console.error("❌ قيمة تجارية مرمَّزة داخل الكود (القاعدة 0.3) — مكانها platform_settings:");
    for (const hit of hits) {
      console.error(`  - ${hit.file}:${hit.line} [${hit.value}] ${hit.text}`);
    }
    process.exit(1);
  }

  console.log(`✅ لا قيمة تجارية مرمَّزة في ${ROOTS.join("، ")}.`);
}

main();
