#!/usr/bin/env bun
/**
 * الغرض: بوّابةُ CI لـ`SEC-06` — **تكتشفُ** كلَّ وحدةِ توجيهٍ تُصيِّرُ `HTML` من
 *   القرصِ، وتُطابِقُها بسِجلِّ الأسطحِ المغلقِ، وتَشتَرِطُ تركيبَ وسيطِ الترويساتِ
 *   **بلا شرطٍ**، وتقرأُ مجموعةَ الترويساتِ الواجبةَ من الوسائطِ نفسِها.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-06` من `F8-08`).
 * ينتمي إلى: scripts
 * الحاكم: ADR 0135 · `ح-7`
 *
 * لا يُؤمِّنُ هذا الحاجزُ ترويسةً. يمنعُ **صفحةً جديدةً تُولَدُ عاريةً** ولا شيءَ
 * يكشفُها — وذاكَ العطبُ الذي لا يُخفِقُ اختباراً ولا يُبطِئُ طلباً ولا يظهرُ في
 * سجلٍّ.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  describeHeadersViolation,
  PAGE_SURFACES,
  REQUIRED_PAGE_HEADERS,
  type RouteModuleFacts,
  securityHeaderViolations,
} from "./lib/security-headers-registry.ts";

const repoRoot = resolve(import.meta.dir, "..");
const routesDir = resolve(repoRoot, "apps/gateway/src/routes");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

const routeModules: RouteModuleFacts[] = walk(routesDir).map((full) => ({
  path: relative(repoRoot, full),
  source: readFileSync(full, "utf8"),
}));

const middlewarePaths = [
  "apps/gateway/src/public/security-headers.ts",
  "apps/gateway/src/admin/security-headers.ts",
];
const middlewareSources = middlewarePaths.map((path) =>
  readFileSync(resolve(repoRoot, path), "utf8"),
);

const violations = securityHeaderViolations({ routeModules, middlewareSources });

if (violations.length > 0) {
  console.error(`✗ ترويساتُ أمنِ الصفحاتِ (SEC-06): ${violations.length} خرقاً.`);
  for (const violation of violations) {
    console.error(describeHeadersViolation(violation));
  }
  process.exit(1);
}

console.log(
  `✓ SEC-06: ${PAGE_SURFACES.length} سطحَ صفحةٍ مُكتَشَفاً من القرصِ ومُسجَّلاً — ` +
    `الوسيطُ مُركَّبٌ على كلٍّ بلا شرطٍ، و${REQUIRED_PAGE_HEADERS.length} ترويساتٍ واجبةٍ مكتوبةٌ.`,
);
console.log(
  "  ولا يُدَّعى `Strict-Transport-Security`: يُنهيهِ الوسيطُ العكسيُّ — بنيةٌ تحتيّةٌ لا شيفرةٌ، وهيَ فجوةٌ باقيةٌ مُسمّاةٌ.",
);
