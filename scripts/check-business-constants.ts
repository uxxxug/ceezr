/**
 * الغرض: بوابة CI تمنع ترميز أي قيمة تجارية داخل الكود (القاعدة 0.3): الأسعار، مدة التجربة،
 *    مهلة العرض، حجم الدفعة. مكانها `platform_settings` وحدها.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: تُستثنى رموز حالة HTTP صراحةً لأنها بروتوكول لا سياسة تجارية.
 *
 *   تصحيح (الإطلاق النهائي): الفاحص كان يُسقط تعليقات `//` وحدها، فيمرّ على
 *   تعليقات الكتلة `/* … *\/` فيرفع مخالفتين وهميتين على نصٍّ وصفيّ لا ينفّذه أحد
 *   (apps/workers/src/container.ts وpackages/domain/eta/index.ts) — وكان ذلك يُسقط CI البعيد.
 *   المقصد المكتوب أصلاً (سطر «التعليقات العربية الوصفية مستثناة») لم يتغيّر: الممنوع
 *   أن يعتمد المنطق على القيمة، والمنطق لا يقرأ التعليقات. الفاحص لم يُرخَّص بل صار أدقّ:
 *   أيّ رقمٍ ممنوعٍ في كودٍ قابلٍ للتنفيذ لا يزال يُسقط الفحص (يُثبته tests/unit/check-business-constants.test.ts).
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

/**
 * يحوّل كل سطر إلى جزئه القابل للتنفيذ وحده: تُحذف تعليقات `//` وتعليقات
 * الكتلة `/* … *\/` معاً، مع تتبّع حالة الكتلة عبر الأسطر. الطول محفوظ بعدد
 * الأسطر لا بالمحتوى: المخرج سطرٌ مقابل كلّ مدخل، فتبقى أرقام الأسطر صحيحة.
 */
export function executableLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;

  for (const raw of source.split("\n")) {
    let code = "";
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf("*/", i);
        if (end === -1) {
          i = raw.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }
      const lineComment = raw.indexOf("//", i);
      const blockStart = raw.indexOf("/*", i);
      if (blockStart !== -1 && (lineComment === -1 || blockStart < lineComment)) {
        code += raw.slice(i, blockStart);
        inBlock = true;
        i = blockStart + 2;
        continue;
      }
      if (lineComment !== -1) {
        code += raw.slice(i, lineComment);
        i = raw.length;
        continue;
      }
      code += raw.slice(i);
      i = raw.length;
    }
    out.push(code);
  }

  return out;
}

/** يرجع القيم التجارية المرمّزة في كودٍ قابلٍ للتنفيذ داخل ملفّ واحد. */
export function findHardcodedValues(
  source: string,
): { readonly line: number; readonly value: number }[] {
  const found: { line: number; value: number }[] = [];

  executableLines(source).forEach((code, index) => {
    if (HTTP_STATUS_LINE.test(code)) return;
    for (const value of FORBIDDEN) {
      const pattern = new RegExp(`(^|[^0-9a-zA-Z_.$])${value}(_|\\b)(?![0-9a-zA-Z_])`);
      if (pattern.test(code)) found.push({ line: index + 1, value });
    }
  });

  return found;
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
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      // التعليقات الوصفية — سطريةً وكتليةً — مستثناة: الممنوع أن يعتمد عليها المنطق.
      for (const { line, value } of findHardcodedValues(source)) {
        hits.push({ file, line, text: (lines[line - 1] ?? "").trim(), value });
      }
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

// الحماية تجعل الملفّ قابلاً للاستيراد في اختبار وحدة بلا تشغيل الفحص وإسقاط العملية.
if (import.meta.main) {
  main();
}
