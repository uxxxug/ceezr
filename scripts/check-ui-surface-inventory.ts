#!/usr/bin/env bun
/**
 * # الحاجزُ: جردُ أسطحِ الواجهةِ مطابقٌ للقرصِ — UI-1 / PR 0 (`ADR 0233` §5)
 *
 * **الغرض:** أن يبدأَ PR 1 وما بعدَه من جردٍ **مقيسٍ** لكلِّ سطحٍ قائمٍ، لا من
 * ذاكرةٍ. سطحٌ جديدٌ يُضافُ إلى `scripts/lib/ui-surface-inventory.ts` في الدفعةِ
 * نفسِها، وسطحٌ محذوفٌ يُزالُ منه.
 *
 * **ما لا يفعلُه عن قصدٍ:** لا يُصنِّفُ [A/B/C/D]، ولا يُسنِدُ أرقامَ R/D.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { evaluateInventory, isTestFile, SURFACE_INVENTORY } from "./lib/ui-surface-inventory.ts";

function scan(root: string, ext: string, recursive: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (recursive) walk(path);
      } else if (entry.endsWith(ext) && !isTestFile(entry)) {
        out.push(relative(root, path).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

if (import.meta.main) {
  const onDisk: Record<string, string[]> = {};
  for (const g of SURFACE_INVENTORY) {
    try {
      onDisk[g.id] = scan(g.root, g.ext, g.recursive);
    } catch {
      /* يُبلَّغُ في الحكمِ: الجذرُ غيرُ مقروءٍ */
    }
  }
  const verdict = evaluateInventory(SURFACE_INVENTORY, onDisk);
  if (!verdict.ok) {
    console.error(`::error::check-ui-surface-inventory:\n  - ${verdict.problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(
    `✓ check-ui-surface-inventory: ${verdict.total} سطحاً في ${SURFACE_INVENTORY.length} مجموعةً، مطابقٌ للقرص.`,
  );
}
