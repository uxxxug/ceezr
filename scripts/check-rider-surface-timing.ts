/**
 * الغرض: حاجزٌ ساكنٌ لموضعِ عنصرِ قياسِ «زمنِ بلوغِ سطحِ الراكبِ المرسومِ» (`DEC-19` · `ADR 0185`).
 * الحالة: منفّذ فعلياً — `F1-09` الصفوفُ 3–5 (`[~]`) · الحكمُ في `scripts/lib/rider-surface-timing.ts`.
 * ينتمي إلى: scripts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { evaluateRiderSurfaceTiming } from "./lib/rider-surface-timing.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const BASE = join(ROOT, "apps/miniapp/src");

function walk(dir: string, out: Map<string, string>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.set(relative(ROOT, full), readFileSync(full, "utf8"));
    }
  }
}

const sources = new Map<string, string>();
walk(BASE, sources);
const problems = evaluateRiderSurfaceTiming(sources);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ [${p.rule}] ${p.detail}`);
  process.exit(1);
}
console.log(
  `✓ عنصرُ قياسِ سطحِ الراكبِ واحدٌ، في الحالةِ الجاهزةِ لأوّلِ شاشةٍ (${sources.size} ملفاً مفحوصاً · DEC-19)`,
);
