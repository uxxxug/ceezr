#!/usr/bin/env bun
/**
 * # الحاجزُ: تباينُ الهويةِ اللونيةِ — UI-1 / PR 0 (`ADR 0233`)
 *
 * **الغرض:** أن يكونَ تباينُ ألوانِ Layer 2 (§2 في `docs/UI_UX_CANONICAL_DIRECTIVE.md`)
 * **مقيساً قبلَ** أن تُكتَبَ رموزاً في CSS (PR 1)، لا مُدَّعى بعدَه.
 *
 * **ما يفحصُ:**
 * 1. اللوحةُ المعلنةُ في `scripts/lib/ui-contrast.ts` = جدولُ §2 في الدليلِ حرفاً.
 * 2. كلُّ تعبئةٍ وكلُّ نصٍّ معلنٍ فوقَها ≥ 4.5:1 (WCAG AA).
 * 3. `mute` (= `--tg-hint-color` من Layer 1) على افتراضَي السطحِ في `global.css`.
 * 4. الإخفاقاتُ القائمةُ قبلَ UI-1 تُؤكَّدُ حرفيّاً: لا تزيدُ ولا تختفي صامتةً.
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يُعدِّلُ CSS، ولا يقيسُ سماتِ تيليجرام الحيّةَ.
 */
import { readFileSync } from "node:fs";
import {
  evaluateContrast,
  LAYER_TWO_PALETTE,
  parseDirectivePalette,
  parseLayerOneFallbacks,
} from "./lib/ui-contrast.ts";

const DIRECTIVE = "docs/UI_UX_CANONICAL_DIRECTIVE.md";
const GLOBAL_CSS = "apps/miniapp/src/styles/global.css";

if (import.meta.main) {
  let verdict: ReturnType<typeof evaluateContrast>;
  try {
    verdict = evaluateContrast({
      declared: LAYER_TWO_PALETTE,
      directive: parseDirectivePalette(readFileSync(DIRECTIVE, "utf8")),
      layerOne: parseLayerOneFallbacks(readFileSync(GLOBAL_CSS, "utf8")),
    });
  } catch (err) {
    console.error(`::error::check-ui-contrast: تعذّرت القراءةُ — ${(err as Error).message}`);
    console.error("A gate that cannot read its input fails; it does not pass.");
    process.exit(3);
  }
  for (const c of verdict.checks) {
    console.log(`${c.pass ? "✓" : "✗"} ${c.id}: ${c.fg} على ${c.bg} = ${c.ratio.toFixed(2)}:1`);
  }
  if (!verdict.ok) {
    console.error(`::error::check-ui-contrast:\n  - ${verdict.problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ check-ui-contrast: ${verdict.checks.length} زوجاً مقيساً، اللوحةُ مطابقةٌ للدليل.`);
}
