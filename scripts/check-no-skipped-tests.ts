#!/usr/bin/env bun
/**
 * # الحاجزُ: لا تجاوزَ صامتاً في تشغيلٍ حقيقيّ — `OPS-009`
 *
 * **الغرض:** أن يُقرَأ **من مخرجاتِ المُشغِّلِ نفسِه** أنّ اختباراتَ التكاملِ عملت
 * فعلاً، لا أن يُستنتَج ذلك من غيابِ جملةِ تحذيرٍ يكتبها المطوّرُ بيدِه.
 *
 * **الحالة:** `OPS-009` — مُنفَّذ · مُختبَر (ADR 0046). **وهو إصلاحُ عيبٍ حقيقيٍّ لا
 * تنظيمٌ:** الخطوتانِ السابقتانِ («منع تخطّي اختبارات التكامل صامتاً» ومثيلتُها
 * لـe2e) كانتا تكشفانِ التجاوزَ بـ`grep` على نصٍّ من `console.warn` يكتبه كلُّ
 * ملفٍّ بيدِه — وأربعةٌ وعشرون ملفّاً من خمسةٍ وخمسين لا تطبعه، فكانت تلك الملفّاتُ
 * **تُتجاوَز صامتةً والحاجزُ أخضرُ**. ثم كانت كلُّ خطوةٍ منهما **تُعيد تشغيلَ الحزمةِ
 * كاملةً مرّةً ثانيةً** لتقرأ نصّاً.
 *
 * **ينتمي إلى:** البند `OPS-009` · القسم 11-د · وسجلُّ التصنيف
 * `scripts/lib/skip-registry.ts`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** خطوتانِ في وظيفةِ «تكامل على PostgreSQL حقيقي»،
 * كلُّ واحدةٍ تقرأ سجلَّ مخرجاتِ الخطوةِ التي قبلها مباشرةً.
 *
 * **ملاحظات مستقبلية:** لو صار للمشروعِ مُراسِلٌ بصيغةٍ آليّةٍ (JUnit XML مثلاً)
 * فقراءتُه أمتنُ من قراءةِ نصٍّ للبشر — ويُقرَّر بـADR لأنّه يغيّر مسارَ CI.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يقرأ سجلَّ تشغيلٍ سبقَه، ولا يُعيد تشغيلَ شيءٍ —
 *   والإعادةُ هي ما كان يُضاعِف زمنَ الوظيفةِ بلا فائدة.
 * - **لا يمنع كلَّ تجاوزٍ.** يسمح بما أُعلِن في السجلِّ أنّه **لا مُشغِّلَ له**، ويطبعه
 *   تحذيراً في كلِّ تشغيل؛ وما سوى ذلك إخفاق.
 * - **لا يقرأ نجاحاً من غيابِ دليلٍ.** سجلٌّ بلا ملخَّصٍ إخفاقٌ، وتشغيلٌ بلا حالةٍ
 *   ناجحةٍ واحدةٍ إخفاقٌ.
 */

import { readFileSync } from "node:fs";
import { auditRun, parseTestLog } from "./lib/skip-audit.ts";
import { SKIP_REGISTRY } from "./lib/skip-registry.ts";

function main(): void {
  const logPath = process.argv[2];
  if (logPath === undefined || logPath === "") {
    console.error("✗ الاستعمال: bun run scripts/check-no-skipped-tests.ts <مسارُ سجلِّ المخرجات>");
    process.exit(1);
  }

  let log = "";
  try {
    log = readFileSync(logPath, "utf8");
  } catch {
    console.error(
      `✗ لا يُقرأ سجلُّ المخرجات ${logPath} — والخطوةُ التي قبلَه يُفترَض أنّها كتبته، ` +
        `فغيابُه إخفاقٌ لا يُتجاوَز.`,
    );
    process.exit(1);
  }
  if (log.trim() === "") {
    console.error(`✗ سجلُّ المخرجات ${logPath} فارغٌ — لا يُقرَأ الفراغُ نجاحاً.`);
    process.exit(1);
  }

  const reading = parseTestLog(log);
  const violations = auditRun(reading, SKIP_REGISTRY);

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في تشغيلِ الاختبارات (OPS-009):\n`);
    for (const violation of violations) {
      console.error(`  • ${violation}`);
    }
    console.error(
      "\n  المعنى: اختبارٌ يُفترَض أنّه يعمل في هذه الوظيفةِ لم يعمل. والصوابُ ضبطُ شرطِ " +
        "تفعيلِه في الخطوةِ، لا تخفيفُ الحاجزِ.",
    );
    process.exit(1);
  }

  const declared = [...reading.skippedByFile.keys()];
  console.log(
    `✅ التشغيلُ حقيقيٌّ: ${reading.pass} ناجحةً · ${reading.skip ?? 0} متجاوَزةً، وكلُّ متجاوَزةٍ ` +
      `منها في ملفٍّ مُعلَنٍ في السجلِّ أنّه لا مُشغِّلَ له.`,
  );
  for (const file of declared) {
    const entry = SKIP_REGISTRY.find((candidate) => candidate.file === file);
    console.log(
      `⚠ ${file}: ${(reading.skippedByFile.get(file) ?? []).length} حالةً متجاوَزةً — ${entry?.whyNotRun ?? ""}`,
    );
  }
}

main();
