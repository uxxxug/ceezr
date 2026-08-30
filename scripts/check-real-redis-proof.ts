#!/usr/bin/env bun
/**
 * # الحاجزُ: لا يُقرَأ زعمُ «Redis حقيقيٍّ» دليلاً — `OPS-006`
 *
 * **الغرض:** أن تسقطَ وظيفةُ CI إن كان ما جرى **ليس** ما زُعِم: عميلٌ مزدوجٌ بدلَ
 * حقيقيٍّ · فحصٌ مطلوبٌ لم يتمّ · مفتاحٌ تُرِك في الخادمِ · أو **سرٌّ ظهرَ في الدليلِ**.
 *
 * **الحالة:** `OPS-006` — مُنفَّذ · مُختبَر (ADR 0049).
 *
 * **ينتمي إلى:** البند `OPS-006` · القسم 11-د · وظيفةُ «تكامل على Redis حقيقي».
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ خطوةٍ تُشغِّل `tests/real-redis/`.
 *
 * **ملاحظات مستقبلية:** لو صار للمستودعِ مخزنٌ حقيقيٌّ ثانٍ في CI (طابورٌ مثلاً)
 * فيُنسَخ هذا النمطُ بحاجزٍ آخرَ لا بتوسيعِ هذا: الحاجزُ الذي يحرس شيئَين يُخفَّف
 * لأجلِ أحدِهما.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يُشغِّل الاختبارات.** يقرأ دليلاً كتبَه تشغيلٌ سبقَه؛ وغيابُ الملفِّ إخفاقٌ
 *   لا تخطٍّ، لأنّ غيابَ القياسِ ليس نجاحاً.
 * - **لا يتّصل بالخادمِ ولا يقرأ سرّاً.** لا يعرف النقطةَ ولا الرمزَ أصلاً.
 * - **لا يحكم على صحّةِ سلوكِ الجلساتِ.** ذلك حكمُ التوكيداتِ في الاختبارِ نفسِه؛
 *   وهذا يحرس أنّ الاختبارَ **جرى حقّاً** ولم يُتجاوَز صامتاً.
 */

import { readFileSync } from "node:fs";
import { auditRealRedisProof, MIN_REAL_COMMANDS } from "./lib/real-redis-proof.ts";

function main(): void {
  const path = process.argv[2] ?? "/tmp/real-redis-proof.json";

  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(
      `✗ لا دليلَ على تشغيلٍ حقيقيٍّ في ${path} — والخطوةُ التي قبلَه يُفترَض أنّها كتبته، ` +
        `فغيابُه إخفاقٌ ولا يُقرَأ غيابُ الدليلِ نجاحاً (OPS-006).`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`✗ الدليلُ في ${path} ليس JSON مقروءاً — ولا يُمرَّر ما لا يُقرَأ.`);
    process.exit(1);
  }

  const violations = auditRealRedisProof(parsed);
  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في دليلِ Redis الحقيقيِّ (OPS-006):\n`);
    for (const violation of violations) console.error(`  • ${violation}`);
    console.error(
      "\n  المعنى: التشغيلُ لم يُخاطِب Redis حقيقياً كما زُعِم، أو الدليلُ يحمل ما لا يُنشَر. " +
        "والصوابُ ضبطُ شرطِ التفعيلِ في الخطوةِ أو كتمُ ما يجب كتمُه، لا تخفيفُ الحاجزِ.",
    );
    process.exit(1);
  }

  const proof = parsed as { commandsIssued: number; checks: readonly string[]; runId: string };
  console.log(
    `✅ Redis حقيقيٌّ في CI: ${proof.checks.length} فحصاً تمَّ · ${proof.commandsIssued} أمراً خرجَ ` +
      `إلى الخادمِ (الحدُّ الأدنى ${MIN_REAL_COMMANDS}) · تشغيلٌ ${proof.runId} · ولا مفتاحَ متروكاً، ` +
      `ولا سرَّ في الدليلِ.`,
  );
}

main();
