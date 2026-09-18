#!/usr/bin/env bun
/**
 * # الحاجزُ: بصمةُ التشغيلِ موجودةٌ وكاملةٌ — `F9-05` · `OPS-007`
 *
 * **الغرض:** أن يسقطَ الفحصُ إن لم تُنتِجْ وظيفةٌ واجبةٌ بصمةً، أو كانت البصمةُ
 * ناقصةً الحقول. والبصمةُ لا تُقرأُ نجاحاً — تُقرأُ **دليلاً** يُفنَّدُ أو يُقبَل.
 *
 * **الحالة:** `F9-05` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** البند `F9-05` · القسم 9 · سلسلةُ `ci` في `package.json`.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يقرأُ بصمةً كتبَها تشغيلٌ سبقَه.
 * - **لا يقرأُ قيمَ المتغيّراتِ.** بصمةُ المفاتيحِ فقط.
 * - **لا يحكمُ على صحّةِ السلوك.** يحكمُ على **وجودِ البصمةِ وكمالِ حقولِها**.
 */

import { existsSync, readFileSync } from "node:fs";
import { auditRunManifest, type ManifestViolation, REQUIRED_JOBS } from "./lib/run-manifest.ts";

function main(): void {
  const dir = process.env.RUN_MANIFEST_DIR ?? "/tmp/run-manifests";
  const violations: ManifestViolation[] = [];

  for (const job of REQUIRED_JOBS) {
    const path = `${dir}/${job}.json`;

    if (!existsSync(path)) {
      violations.push({
        rule: "manifest.job-produced",
        detail: `الوظيفةُ «${job}» لم تُنتِجْ بصمةً في ${path} — والخطوةُ التي قبلَه يُفترَض أنّها كتبته، فغيابُه إخفاقٌ ولا يُقرأُ غيابُ الدليلِ نجاحاً.`,
      });
      continue;
    }

    let raw = "";
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      violations.push({
        rule: "manifest.readable",
        detail: `البصمةُ في ${path} غيرُ قابلةٍ للقراءة.`,
      });
      continue;
    }

    const { violations: jobViolations } = auditRunManifest(raw, job);
    violations.push(...jobViolations);
  }

  if (violations.length > 0) {
    console.error("✗ حاجزُ بصمةِ التشغيل: سقطَ.");
    for (const v of violations) {
      console.error(`  - [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ حاجزُ بصمةِ التشغيل: ${REQUIRED_JOBS.length} وظائفَ أنتجت بصمةً كاملةً — ` +
      `الإصداراتُ والخدماتُ والحدودُ والحكمُ مُسجَّلة.`,
  );
}

main();
