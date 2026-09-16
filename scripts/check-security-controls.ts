#!/usr/bin/env bun
/**
 * الغرض: بوّابةُ CI لسِجلِّ ضوابطِ `F8-08` — تفرضُ **العددَ** من نصِّ البندِ،
 *   و**الدليلَ** على كلِّ دعوى بناءٍ، و**اشتقاقَ رمزِ البندِ** من السِجلِّ لا من يدِ
 *   كاتبٍ.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (الرِجلُ الثانيةُ من `F8-08`).
 * ينتمي إلى: scripts
 * الحاكم: ADR 0133 · `ح-7` (لكلِّ قاعدةٍ سالبةٌ مزروعةٌ)
 *
 * لا يُؤمِّنُ هذا الحاجزُ سطراً. يُؤمِّنُ **صدقَ الدعوى**: أنَّ «١٦ ضابطاً» لم
 * تَعُد عدداً في جملةٍ، وأنَّ رمزَ `[x]` لا يُكتَبُ قبلَ أن يصدُقَ.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  describeSecurityControlViolation,
  REQUIRED_CONTROL_COUNT,
  SECURITY_CONTROLS,
  securityControlViolations,
  summarizeControls,
} from "./lib/security-controls-registry.ts";

const repoRoot = resolve(import.meta.dir, "..");
const roadmapPath = resolve(repoRoot, "docs/ROADMAP-MASTER.md");

if (!existsSync(roadmapPath)) {
  console.error("✗ docs/ROADMAP-MASTER.md غيرُ موجودٍ — والعجزُ عن القياسِ عطبٌ لا عذرٌ.");
  process.exit(1);
}

const violations = securityControlViolations({
  roadmapText: readFileSync(roadmapPath, "utf8"),
  pathExists: (path) => existsSync(resolve(repoRoot, path)),
});

if (violations.length > 0) {
  console.error(`✗ سِجلُّ ضوابطِ F8-08: ${violations.length} خرقاً.`);
  for (const violation of violations) {
    console.error(describeSecurityControlViolation(violation));
  }
  process.exit(1);
}

const { built, partial, notBuilt, blocked } = summarizeControls();
console.log(
  `✓ F8-08 (سِجلُّ الضوابطِ): ${REQUIRED_CONTROL_COUNT} ضابطاً مُسمّىً — ` +
    `${built} مبنيّاً · ${partial} جزئيّاً · ${notBuilt} غيرَ مبنيٍّ ` +
    `(${blocked} محجوزٌ بعائقِ مالكٍ). الرمزُ يبقى \`[ ]\` باشتقاقٍ لا بيدٍ.`,
);
console.log(
  "  ولا يُدَّعى أنَّ التسميةَ بناءٌ: هذا مِعيارُ إغلاقٍ، والمبنيُّ منها هوَ ما لهُ دليلٌ وحاجزٌ على القرصِ.",
);
if (SECURITY_CONTROLS.length !== REQUIRED_CONTROL_COUNT) {
  process.exit(1);
}
