#!/usr/bin/env bun
/**
 * الغرض: حاجزُ **تثبيتِ مصدرِ العقودِ المنقولةِ**: كلُّ ملفٍّ في
 *    `docs/contracts/core/` له سطرُ تثبيتٍ واحدٌ في `PROVENANCE.md` يُسمّي
 *    المستودَعَ المالِكَ والتزامَه الكاملَ ومسارَ المصدرِ، وكلُّ تثبيتٍ له ملفٌّ،
 *    وكلُّ ملفٍّ له بصمةٌ. البند `DEP-CORE-005`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `DEP-CORE-005`.
 * ينتمي إلى: scripts (حاجزٌ في سلسلةِ `ci`، وخطوةٌ في `verify` **قبلَ** الخطوةِ
 *    الحمراءِ `city_id` فيُقرأُ له حكمُ CI فعلاً)
 * يُستخدم من: `package.json` → `check:vendored-contract-pins`، و
 *    `.github/workflows/ci.yml` خطوةً مُسمَّاةً.
 * ملاحظات مستقبلية: هذا الحاجزُ **لا يُثبِتُ طزاجةً** — لا يقرأُ CORE ألبتّةَ.
 *    وهوَ شرطُ إمكانِ قراءتِها: المُقابِلُ
 *    (`scripts/check-core-contract-freshness.ts`) يقرأُ هذه التثبيتاتَ نفسَها.
 *
 * ## لِمَ حاجزٌ لهذا، ولِمَ يُقاسُ في CI وحدَه من الثلاثةِ
 *
 * كانَ سندُ النقلِ نثراً: «الالتزامُ 511624b…»، «مسارُ المصدرِ
 * `contracts/events/`». ويكفي ذلكَ إنساناً يُقابِلُ بيدِه، ولا يكفي آلةً: لا
 * شيءَ يربطُ ملفّاً بعينِه بمسارِه عندَ المالِكِ وبالالتزامِ الذي نُقِلَ عندَه،
 * فلا مقابلةَ آليّةَ ألبتّةَ. وهذا نصفُ `DEP-CORE-005` الذي يُملَكُ ههنا —
 * ونصفُها الآخرُ صلاحيّةُ الوصولِ إلى مستودَعٍ خاصٍّ، وهيَ `O-6` عندَ المالِكِ.
 *
 * والتثبيتُ يُحرَسُ في كلِّ جريَةٍ لا يُراجَعُ بالعينِ: ملفٌّ منقولٌ يُضافُ بلا
 * تثبيتٍ يصيرُ عقداً بلا مالِكٍ معروفٍ، وتثبيتٌ يبقى لملفٍّ حُذِفَ يصيرُ سنداً
 * كاذباً — وكلاهما يُخفِقُ ههنا.
 */

import {
  auditPins,
  CONTRACTS_DIR,
  listVendored,
  readProvenance,
} from "./lib/vendored-contract-pins.ts";

function main(): void {
  const breaches = auditPins();
  if (breaches.length > 0) {
    console.error("تثبيتُ مصدرِ العقودِ المنقولةِ مُنتقَضٌ:");
    for (const breach of breaches) console.error(`  - ${breach}`);
    console.error(
      "\nصيغةُ السطرِ: `pin <owner>/<repo> <التزامٌ بأربعينَ خانةً> <مسارُ المصدرِ> -> <المسارُ المنقولُ>`",
    );
    process.exit(1);
  }
  const { pins } = readProvenance();
  const vendored = listVendored(CONTRACTS_DIR);
  const commits = new Set([...pins.values()].map((pin) => pin.commit.slice(0, 7)));
  const repos = new Set([...pins.values()].map((pin) => pin.repo));
  console.log(
    `تثبيتُ مصدرِ العقودِ المنقولةِ: ${vendored.length} ملفّاً، كلٌّ مُثبَّتٌ إلى ` +
      `${[...repos].join(" · ")} عندَ ${[...commits].sort().join(" · ")}.`,
  );
  console.log(
    "وهذا تثبيتٌ لا طزاجةٌ: قراءةُ CORE محجوبةٌ بـ`O-6`، والمُقابِلُ " +
      "`scripts/check-core-contract-freshness.ts` يُشغَّلُ حيثُ يُقرأُ مستودَعُ CORE.",
  );
}

if (import.meta.main) main();
