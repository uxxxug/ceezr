/**
 * الغرض: حاجزُ CI يمنعُ تمريرَ `allow_paid_broadcast` في الشيفرةِ بلا قرارِ مالكٍ صريحٍ.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُستخدم من: package.json (`bun run ci`) · .github/workflows/ci.yml
 * الحاكم: ADR 0199 · البند `TG-003` · `DEC-04`
 *
 * ## لماذا حاجزٌ
 *
 * `TG-003` يطلبُ قرارَ ADR قبلَ تمكينِ البثِّ المدفوعِ. والقرارُ (ADR 0199) لا يُفعِّلُهُ
 * بل يُحجِزُهُ بقرارِ مالكٍ (`DEC-04` `[!]`). والحاجزُ يمنعُ تمريرًا عابرًا للمعاملِ
 * في مراجعةٍ مستقبليّةٍ بلا قرارٍ — فالتمكينُ قرارٌ لا تذكرةٌ.
 *
 * ## القواعدُ
 *
 * ١. `no-allow-paid-broadcast`: لا وجودَ للنصِّ `allow_paid_broadcast` أو
 *    `allowPaidBroadcast` في `apps/` أو `packages/`. وخرقُهُ يُسقِطُ البناءَ.
 *
 * ٢. `adr-required`: إن وُجدَ النصُّ، يُشتَرَطُ ملفُّ ADR 0199 موجودًا على القرصِ.
 *
 * ٣. `owner-decision-required`: إن وُجدَ النصُّ، يُشتَرَطُ تعليقٌ على `TG-003` في
 *    `docs/ROADMAP-MASTER.md` يقولُ إنَّ `DEC-04` حُسِمَ بالفتحِ.
 *
 * والسالبةُ المزروعةُ: كتابةُ `allow_paid_broadcast: true` في أيِّ ملفٍ تُسقِطُ البناءَ.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ADR_PATH = "docs/adr/0199-paid-broadcast-is-gated-by-owner-decision-not-enabled.md";
const ROADMAP_PATH = "docs/ROADMAP-MASTER.md";
const SEARCH_TERMS = ["allow_paid_broadcast", "allowPaidBroadcast"];
const SEARCH_DIRS = ["apps", "packages"];
const FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

interface Violation {
  rule: string;
  file: string;
  line: number;
  message: string;
}

function scanDir(dir: string, results: Violation[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath, results);
      continue;
    }
    if (!FILE_EXTENSIONS.has(extOf(entry))) continue;
    const content = readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const term of SEARCH_TERMS) {
        if (lines[i]?.includes(term)) {
          results.push({
            rule: "no-allow-paid-broadcast",
            file: relative(ROOT, fullPath),
            line: i + 1,
            message: `found "${term}" — البثُّ المدفوعُ محجوزٌ بقرارِ مالكٍ (ADR 0199 · DEC-04). إن كان قرّر المالكُ التفعيلَ، أُرفِع الحاجزُ بتعليقٍ على TG-003.`,
          });
        }
      }
    }
  }
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.substring(dot);
}

function checkAdrExists(): Violation[] {
  if (!existsSync(ADR_PATH)) {
    return [
      {
        rule: "adr-required",
        file: ADR_PATH,
        line: 0,
        message: "ADR 0199 غير موجود — لا يُفعَّلُ البثُّ المدفوعُ بلا قرارٍ موثَّقٍ.",
      },
    ];
  }
  return [];
}

function checkOwnerDecision(): Violation[] {
  if (!existsSync(ROADMAP_PATH)) return [];
  const content = readFileSync(ROADMAP_PATH, "utf-8");
  // إن وُجدَ allow_paid_broadcast في الشيفرةِ، يُشتَرَطُ تعليقٌ يقولُ إنَّ DEC-04 حُسِمَ بالفتحِ
  const tg003Line = content
    .split("\n")
    .findIndex(
      (l) =>
        l.includes("TG-003") &&
        l.includes("DEC-04") &&
        (l.includes("حُسِمَ بالفتح") || l.includes("resolved: enable")),
    );
  if (tg003Line === -1) {
    return [
      {
        rule: "owner-decision-required",
        file: ROADMAP_PATH,
        line: 0,
        message: "لا تعليقَ على TG-003 يقولُ إنَّ DEC-04 حُسِمَ بالفتحِ — البثُّ المدفوعُ محجوزٌ.",
      },
    ];
  }
  return [];
}

function main(): void {
  const violations: Violation[] = [];

  // القاعدةُ الأولى: لا وجودَ للنصِّ في الشيفرةِ
  for (const dir of SEARCH_DIRS) {
    scanDir(dir, violations);
  }

  // إن وُجدَ النصُّ، تُفعَّلُ القاعدتانِ الثانيةُ والثالثةُ
  if (violations.length > 0) {
    violations.push(...checkAdrExists());
    violations.push(...checkOwnerDecision());
  }

  if (violations.length > 0) {
    console.error(`✗ check-paid-broadcast-guard: ${violations.length} violation(s)`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.rule}: ${v.message}`);
    }
    process.exit(1);
  }

  console.log("✓ check-paid-broadcast-guard: no paid broadcast in code (ADR 0199)");
}

main();
