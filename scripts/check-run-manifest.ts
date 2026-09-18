#!/usr/bin/env bun
/**
 * # الحاجزُ: بصمةُ التشغيلِ موجودةٌ وكاملةٌ — `F9-05` · `OPS-007`
 *
 * **الغرض:** أن يسقطَ الفحصُ إن لم تُنتِجْ الوظيفةُ بصمةً، أو كانت البصمةُ
 * ناقصةَ الحقول. والبصمةُ لا تُقرأُ نجاحاً — تُقرأُ **دليلاً** يُفنَّدُ أو يُقبَل.
 *
 * **الحالة:** `F9-05` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** البند `F9-05` · القسم 9 · سلسلةُ `ci` في `package.json`.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يقرأُ بصمةً كتبَها تشغيلٌ سبقَه.
 * - **لا يقرأُ قيمَ المتغيّراتِ.** بصمةُ المفاتيحِ فقط.
 * - **لا يحكمُ على صحّةِ السلوك.** يحكمُ على **وجودِ البصمةِ وكمالِ حقولِها**.
 *
 * **ملاحظة:** كلُّ وظيفةٍ تعملُ على عدّاءٍ مستقلٍّ، فلا تُشاركُ الملفاتِ. لذا
 * يفحصُ هذا الحاجزُ بصمةَ الوظيفةِ الحاليّةِ فقط، لا كلَّ الوظائف.
 */

import { existsSync, readFileSync } from "node:fs";
import { auditRunManifest } from "./lib/run-manifest.ts";

function main(): void {
  const job = process.env.JOB_NAME;
  if (!job) {
    console.error("✗ حاجزُ بصمةِ التشغيل: متغيّرُ `JOB_NAME` غيرُ مضبوطٍ.");
    process.exit(1);
  }

  const dir = process.env.RUN_MANIFEST_DIR ?? "/tmp/run-manifests";
  const path = `${dir}/${job}.json`;

  if (!existsSync(path)) {
    console.error(
      `✗ حاجزُ بصمةِ التشغيل: سقطَ — بصمةُ «${job}» غائبةٌ في ${path}. ` +
        `والخطوةُ التي قبلَه يُفترَض أنّها كتبته، فغيابُه إخفاقٌ ولا يُقرأُ غيابُ الدليلِ نجاحاً.`,
    );
    process.exit(1);
  }

  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`✗ بصمةُ «${job}» غيرُ قابلةٍ للقراءة في ${path}.`);
    process.exit(1);
  }

  const { violations } = auditRunManifest(raw, job);

  if (violations.length > 0) {
    console.error(`✗ حاجزُ بصمةِ التشغيل: سقطَ للوظيفةِ «${job}».`);
    for (const v of violations) {
      console.error(`  - [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ حاجزُ بصمةِ التشغيل: الوظيفةُ «${job}» أنتجت بصمةً كاملةً — ` +
      `الإصداراتُ والخدماتُ والحدودُ والحكمُ مُسجَّلة.`,
  );
}

main();
