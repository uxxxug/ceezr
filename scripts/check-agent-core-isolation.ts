/**
 * الغرض: بوابة CI تفرض القيد المعماري الثاني من القسم صفر — **اتجاه اعتماد واحد**:
 *    `packages/agent-core` لا يستورد من domain ولا application ولا infrastructure
 *    إطلاقاً، والمشروع الأساسي لا يستورد منها إلا `gateway.ts` أو `index.ts`.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: حين تُفصل الطبقة إلى خدمة مستقلّة يصير هذا الفحص بلا موضوع
 *    لأن الفصل يصير فيزيائياً. حتى ذلك الحين هو الشيء الوحيد الذي يمنع الالتصاق.
 *
 * لماذا فحصٌ لا اتفاق: استيرادٌ واحد من `packages/domain` يبدو بريئاً يوم يُكتب —
 * «مجرد نوع» — لكنه يربط عمر الطبقتين ببعض، فلا تُفصل هذه الطبقة لاحقاً إلا
 * بإعادة هيكلة. الاتفاقات تُنسى بين مطوّرَين وبين شهرين؛ البناء الساقط لا يُنسى.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const AGENT_CORE = "packages/agent-core";
/** الطبقات التي لا يجوز لـagent-core أن يعرفها. */
const FORBIDDEN_INBOUND = ["packages/domain", "packages/application", "packages/infrastructure"];
const FORBIDDEN_ALIASES = ["@waslah/domain", "@waslah/application", "@waslah/infrastructure"];
/** الأبواب المسموح للمشروع الأساسي أن يدخل منها. */
const ALLOWED_ENTRY = ["agent-core/gateway.ts", "agent-core/index.ts"];
/** جذور المشروع الأساسي التي تُفحَص في الاتجاه المعاكس. */
const CONSUMER_ROOTS = [
  "apps",
  "packages/domain",
  "packages/application",
  "packages/infrastructure",
];

const IMPORT_PATTERN = /(?:from|import)\s+["']([^"']+)["']/g;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly rule: string;
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

function importsOf(file: string): { line: number; specifier: string }[] {
  const found: { line: number; specifier: string }[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, text] of lines.entries()) {
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push({ line: index + 1, specifier });
    }
  }
  return found;
}

function main(): void {
  const violations: Violation[] = [];

  // ── الاتجاه الأول: agent-core لا يعرف بقية المستودع ──────────────────────
  for (const file of walk(AGENT_CORE)) {
    for (const { line, specifier } of importsOf(file)) {
      const forbidden =
        FORBIDDEN_ALIASES.some((alias) => specifier.startsWith(alias)) ||
        FORBIDDEN_INBOUND.some((path) => specifier.includes(path)) ||
        // مسار نسبي يخرج من المجلّد: `../../domain/...`
        (specifier.startsWith("..") &&
          FORBIDDEN_INBOUND.some((path) => specifier.includes(path.replace("packages/", ""))));
      if (forbidden) {
        violations.push({
          file,
          line,
          specifier,
          rule: "agent-core لا يستورد من domain/application/infrastructure — القسم صفر، القيد 2",
        });
      }
    }
  }

  // ── الاتجاه الثاني: لا يدخل أحدٌ الطبقة إلا من بابها ──────────────────────
  for (const root of CONSUMER_ROOTS) {
    for (const file of walk(root)) {
      for (const { line, specifier } of importsOf(file)) {
        if (!specifier.includes("agent-core")) continue;
        if (ALLOWED_ENTRY.some((entry) => specifier.endsWith(entry))) continue;
        violations.push({
          file,
          line,
          specifier,
          rule: "الدخول إلى agent-core من gateway.ts أو index.ts وحدهما",
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لعزل طبقة الذكاء الاصطناعي:\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ← ${violation.specifier}`);
      console.error(`    ${violation.rule}\n`);
    }
    process.exit(1);
  }

  console.log("✓ عزل agent-core سليم: لا استيراد داخل، ولا دخول إلا من البوّابة");
}

main();
