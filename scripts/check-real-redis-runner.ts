#!/usr/bin/env bun
/**
 * # الحاجزُ: وظيفةُ Redis الحقيقيِّ تملكُ خادمَها — `S-3` · `O-2`
 *
 * **الغرض:** أن يسقطَ الفحصُ إن عادت وظيفةُ «تكامل على Redis حقيقي» إلى نقطةٍ
 * خارجيّةٍ لا خادمَ لها في الشغلةِ، أو انحرفَ منفذُها أو رمزُها عن القشرةِ التي
 * تنشرُها الوظيفةُ نفسُها.
 *
 * **الحالة:** `S-3` — مُنفَّذ · مُختبَر (ADR 0096).
 *
 * **ينتمي إلى:** البند `S-3` · `O-2` · سلسلةُ `ci` في `package.json`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ تعديلٍ على وظيفةِ `real-redis` في مسارِ CI.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يتّصلُ بـRedis ولا يُشغِّل اختباراً.** يقرأُ التهيئةَ نصّاً؛ والحكمُ على
 *   التشغيلِ لخطوتِه وحاجزِ دليلِه (`check-real-redis-proof.ts`)، وحاجزٌ يحرسُ
 *   شيئَين يُخفَّفُ لأجلِ أحدِهما.
 * - **لا يمنعُ الانتقالَ إلى مُزوِّدٍ مُستضافٍ.** يمنعُ الانتقالَ **صامتاً**: ذاكَ
 *   قرارٌ يُوثَّقُ بـADR ويُعدَّلُ معه هذا الملفُّ في الالتزامِ نفسِه.
 */

import { readFileSync } from "node:fs";
import { auditRealRedisRunner, REAL_REDIS_JOB } from "./lib/real-redis-runner.ts";

function main(): void {
  const path = process.argv[2] ?? ".github/workflows/ci.yml";

  let workflow = "";
  try {
    workflow = readFileSync(path, "utf8");
  } catch {
    console.error(`✗ لا يُقرَأُ مسارُ CI في ${path} — وغيابُ الملفِّ ليس نجاحاً.`);
    process.exit(1);
  }

  const violations = auditRealRedisRunner(workflow);
  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في وظيفةِ \`${REAL_REDIS_JOB}\` (S-3 · O-2):\n`);
    for (const violation of violations) console.error(`  • ${violation}`);
    console.error(
      "\n  والصوابُ إصلاحُ التهيئةِ في الوظيفةِ، لا تخفيفُ هذا الحاجزِ ولا تخفيفُ " +
        "`assertRealRedisWhenRequired`: وظيفةٌ وُجدت لتُشغِّل على خادمٍ حقيقيٍّ لا تُقرَأ " +
        "خضراءَ وهي لم تُخاطِبه.",
    );
    process.exit(1);
  }

  console.log(
    `✅ وظيفةُ \`${REAL_REDIS_JOB}\` تملكُ خادمَ Redis في الشغلةِ: قشرةُ REST موصولةٌ بالخادمِ، ` +
      `والمنفذُ والرمزُ متّفقانِ مع ما تُخاطِبُه الاختباراتُ، وخطوةُ جهوزيّةٍ تسبقُها.`,
  );
}

main();
