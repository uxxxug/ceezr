#!/usr/bin/env bun
/**
 * # الحاجزُ: staging مُشتقّةٌ من الإنتاجِ لا مكتوبةٌ بجانبِه — `F9-01` · `OPS-001` · `ADR 0206`
 *
 * **الغرض:** أن يستحيلَ تباعدُ `deploy/staging/render.staging.yaml` عن
 * `render.yaml` بلا سقوطِ بناءٍ. الملفُّ الأوّلُ مُشتقٌّ آليّاً من الثاني بفرقٍ
 * مُعلَنٍ مغلقٍ (`scripts/lib/staging-blueprint.ts`)، وهذا الحاجزُ يُعيدُ
 * الاشتقاقَ ويُقارنُ بايتاً ببايتٍ، ويفحصُ أنّ كلَّ بعدٍ من أبعادِ `OPS-001`
 * في نصِّ البندِ مُصنَّفٌ (مُنفَذٌ بالاشتقاقِ أو خارجيٌّ بحاجزٍ قائمٍ).
 *
 * **الحالة:** منفَّذٌ · مُختبَرٌ · مبرهَنُ السقوطِ بسالباتٍ مزروعةٍ في
 * `tests/unit/staging-blueprint.test.ts`. والبندُ لا يُقلَبُ `[x]`: البيئةُ لم
 * تُنشأْ (فعلٌ مدفوعٌ خارجَ المستودعِ) وأبعادٌ خارجيّةٌ محجوبةٌ.
 *
 * ## كيف يُشغَّل
 *
 * ```
 * bun run scripts/check-staging-blueprint.ts          # حُكمٌ — يُسقِطُ على التباعدِ
 * bun run scripts/check-staging-blueprint.ts --write  # إعادةُ التوليدِ بعدَ تعديلِ render.yaml
 * ```
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  deriveStagingBlueprint,
  dimensionFindings,
  f901ItemText,
  OPS001_DIMENSIONS,
  PRODUCTION_BLUEPRINT,
  STAGING_BLUEPRINT,
  stagingFindings,
} from "./lib/staging-blueprint";

const ROADMAP = "docs/ROADMAP-MASTER.md";

function main(): number {
  if (!existsSync(PRODUCTION_BLUEPRINT)) {
    console.error(`❌ ${PRODUCTION_BLUEPRINT} غائبٌ — لا مصدرَ يُشتقُّ منه.`);
    return 1;
  }
  const production = readFileSync(PRODUCTION_BLUEPRINT, "utf8");

  if (process.argv.includes("--write")) {
    const derived = deriveStagingBlueprint(production);
    mkdirSync(dirname(STAGING_BLUEPRINT), { recursive: true });
    writeFileSync(STAGING_BLUEPRINT, derived);
    console.log(`✍️ كُتِبَ ${STAGING_BLUEPRINT} مُشتقّاً من ${PRODUCTION_BLUEPRINT}.`);
  }

  const staging = existsSync(STAGING_BLUEPRINT) ? readFileSync(STAGING_BLUEPRINT, "utf8") : null;
  const roadmap = readFileSync(ROADMAP, "utf8");
  const itemLine = f901ItemText(roadmap);
  if (itemLine === null) {
    console.error("❌ لا صفَّ لـF9-01 في ROADMAP-MASTER.md — لا نصَّ تُقاسُ عليه الأبعادُ.");
    return 1;
  }

  const findings = [
    ...stagingFindings(production, staging),
    ...dimensionFindings(itemLine, roadmap),
  ];
  if (findings.length > 0) {
    for (const finding of findings) console.error(`❌ [${finding.code}] ${finding.message}`);
    return 1;
  }

  const enforced = OPS001_DIMENSIONS.filter((entry) => entry.status === "enforced-by-derivation");
  const external = OPS001_DIMENSIONS.filter((entry) => entry.status === "external");
  console.log(
    `✅ staging مُشتقّةٌ من الإنتاجِ بلا تباعدٍ: ${OPS001_DIMENSIONS.length} بعداً من OPS-001 — ` +
      `${enforced.length} مُنفَذاً بالاشتقاقِ · ${external.length} خارجيّاً بحاجزٍ قائمٍ ` +
      `(${external.map((entry) => `${entry.dimension}: ${entry.blockers.join("/")}`).join(" · ")}).`,
  );
  return 0;
}

process.exit(main());
