#!/usr/bin/env bun
/**
 * # الحاجزُ: حتميّةُ بذرةِ القياس — `F9-04` · `OPS-004`
 *
 * **الغرض:** أن يسقطَ البناءُ إن صارت البذرةُ غيرَ حتميّة. والبذرةُ حتميّةٌ إن
 * أنتجت المدخلاتُ نفسُها البصمةَ نفسَها — وهذا ما يُثبَت ههنا بلا قاعدةِ بيانات.
 *
 * **الحالة:** `F9-04` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** البند `F9-04` · القسم 9 · سلسلةُ `ci` في `package.json`.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ:**
 * - **لا يبذرُ بيانات.** يتحقّقُ من أنّ الدوالَّ الصرفةَ تُنتجُ ما تُنتجُه.
 * - **لا يتحقّقُ من التشغيل على قاعدةٍ حقيقيّة.** ذاكَ اختبارُ التكامل.
 * - **لا يدّعي أنّ البذرةَ صحيحة.** يدّعي أنّها **حتميّة**.
 *
 * **ما يُقيس:** أنّ `DEFAULT_SEED_FINGERPRINT` ثابتٌ لا يتغيّرُ بين تشغيلين، وأنّ
 * `benchUuid` تُنتجُ معرّفاً صالحاً ثابتاً، وأنّ تغييرَ المدخلاتِ يُغيّرُ البصمة.
 */

import {
  benchUuid,
  computeSeedFingerprint,
  DEFAULT_SEED_FINGERPRINT,
  DEFAULT_SEED_PLAN,
  SEED_EPOCH,
} from "./lib/bench-seed-fingerprint.ts";

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function main(): void {
  const problems: string[] = [];

  // ١. البصمةُ الافتراضيّةُ ثابتةٌ لا تتغيّر.
  const fp1 = computeSeedFingerprint(DEFAULT_SEED_PLAN, []);
  const fp2 = computeSeedFingerprint(DEFAULT_SEED_PLAN, []);
  if (fp1 !== fp2) {
    problems.push(`البصمةُ ليست حتميّةً: ${fp1} ≠ ${fp2} على المدخلاتِ نفسِها.`);
  }
  if (fp1 !== DEFAULT_SEED_FINGERPRINT) {
    problems.push(
      `البصمةُ المحسوبةُ (${fp1}) لا تطابقُ الثابتَ المسجَّلَ (${DEFAULT_SEED_FINGERPRINT}). ` +
        "وهذا يعني أنّ أحدَ مدخلاتِ البصمةِ تغيّرَ منذ آخرِ تشغيلٍ أخضر.",
    );
  }

  // ٢. تغييرُ المدخلاتِ يُغيّرُ البصمة.
  const differentPlan = { drivers: 21, riders: 10 };
  const fpDifferent = computeSeedFingerprint(differentPlan, []);
  if (fpDifferent === fp1) {
    problems.push("البصمةُ لا تميّزُ بين خطّتَين مختلفتَين — فالحتميّةُ بلا تمييزٍ عمى.");
  }

  // ٣. مدنٌ مختلفة → بصمةٌ مختلفة.
  const fpWithCities = computeSeedFingerprint(DEFAULT_SEED_PLAN, ["JED", "RUH"]);
  if (fpWithCities === fp1) {
    problems.push("البصمةُ لا تميّزُ بين بذرٍ بمدنٍ وبذرٍ بلا مدن.");
  }

  // ٤. benchUuid تُنتجُ معرّفاً صالحاً ثابتاً.
  const uuid1 = benchUuid("driver:0");
  const uuid2 = benchUuid("driver:0");
  if (uuid1 !== uuid2) {
    problems.push(`benchUuid ليس حتميّاً: ${uuid1} ≠ ${uuid2}`);
  }
  if (!UUID_V5_PATTERN.test(uuid1)) {
    problems.push(`benchUuid لا تُنتجُ UUIDv5 صالحاً: ${uuid1}`);
  }

  // ٥. مدخلاتٌ مختلفة → معرّفاتٌ مختلفة.
  const uuidDifferent = benchUuid("driver:1");
  if (uuidDifferent === uuid1) {
    problems.push("benchUuid لا تميّزُ بين مدخلاتٍ مختلفة.");
  }

  // ٦. SEED_EPOCH ثابت.
  const expectedEpoch = "2026-01-01T00:00:00.000Z";
  if (SEED_EPOCH.toISOString() !== expectedEpoch) {
    problems.push(`SEED_EPOCH تغيّر: ${SEED_EPOCH.toISOString()} ≠ ${expectedEpoch}`);
  }

  if (problems.length > 0) {
    console.error(`✗ حاجزُ حتميّةِ البذرة: سقطَ (${problems.length} مخالفةً).`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `✓ حاجزُ حتميّةِ البذرة: البصمةُ (${DEFAULT_SEED_FINGERPRINT}) ثابتةٌ ` +
      `وbenchUuid صالحةٌ والتمييزُ بين المدخلاتِ قائم.`,
  );
}

main();
