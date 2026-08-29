/**
 * الغرض: بوابةُ CI لميزانيةِ الأداءِ في القسم 9.9 — تُقرأ من `apps/miniapp/dist`
 *   بعدَ البناءِ وتُسقِط البناءَ إن تُجوِّزت. والمفحوصُ ثلاثةُ صفوفٍ من ثمانيةٍ:
 *     (١) الحملُ الأوّلُ بعدَ الضغط ≤ 180 KB — بقراءتَين: الحرفيّةُ
 *         (`shell`+`identity`) والأوسعُ (كلُّ ما يُنزَّل قبلَ أوّلِ رسمٍ، ومنه
 *         `vendor-react` الذي لا يذكره الجدولُ ويُنزَّل مع الشاشةِ الأولى).
 *     (٢) كلُّ حزمةٍ مؤجَّلةٍ ≤ 120 KB بعدَ الضغط.
 *     (٦) طلباتُ الشبكةِ لأوّلِ رسمٍ ≤ 6 — والمستندُ نفسُه طلبٌ ويُحسَب.
 *   ومعها التقسيمُ الإلزاميُّ في القسم 9.4: **لا حزمةَ باسمٍ ليس في الجدول**.
 * الحالة: منفّذ فعلياً — أداةُ تحقّقٍ، ليست منطقَ أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml و`bun run ci`
 * ملاحظات مستقبلية:
 *   - **خمسةُ صفوفٍ في القسم 9.9 ليست ههنا ولا يُدَّعى فحصُها**: `FCP` و`LCP`
 *     وزمنُ التفاعلِ بعدَ فتحِ تيليجرام وبياناتُ جلسةِ عشرِ دقائقَ وإعادةُ رسمِ
 *     الخريطة. الثلاثةُ الأولى تحتاج متصفّحاً وشبكةً مُقيَّدةً وجهازاً، والأخيرانِ
 *     يقيسان ميزةً غيرَ مبنيّةٍ بعدُ (رحلةٌ نشطةٌ وخريطةٌ). ولذلك بندُ `F1-09`
 *     يبقى `[~]` لا `[x]` — التفصيلُ في ملفِّ الدليل §٣ و§٧.
 *   - حين يُضاف مسارُ قياسٍ بمتصفّحٍ فليكن **وظيفةً منفصلةً** في CI: فحصٌ حتميٌّ
 *     من مُخرَجِ البناءِ لا يُخلَط بقياسٍ مُتقلِّبٍ يُطفَأ عند أوّلِ تذبذب.
 *
 * لماذا يُقرأ من `dist` لا من `src`: الميزانيةُ عن بايتاتٍ تعبُر شبكةَ المستخدمِ،
 * وعددُ الطلباتِ عمّا يذكره المستندُ الذي يستقبله جهازُه. وكلُّ حكمٍ على ذلك من
 * قراءةِ الشيفرةِ تخمينٌ: الجامعُ يُدمِج ويُقسِّم ويُضيف تحميلاً مسبقاً بلا أن يُكتَب
 * ذلك في سطرٍ واحدٍ من `src`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BUDGET,
  DECLARED_EXTRA_BUNDLES,
  evaluate,
  readBuildFacts,
} from "./lib/performance-budget.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "apps/miniapp/dist");

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main(): void {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(
      "✗ لا مُخرَجَ بناءٍ في apps/miniapp/dist — ميزانيةُ الأداءِ لا تُفحَص من الشيفرةِ بل من البايتات.\n" +
        "  شغّل: bun run build:miniapp",
    );
    process.exit(1);
  }

  const facts = readBuildFacts(DIST);
  const violations = evaluate(facts);

  const eagerLocal = facts.eager.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const eagerTotal = eagerLocal + facts.inlineStyleGzipBytes;

  console.log("ميزانيةُ الأداءِ (القسم 9.9) — من مُخرَجِ البناء:");
  console.log(
    `  الحملُ الأوّل: ${kb(eagerTotal)} بعدَ الضغط / الحدُّ ${kb(BUDGET.eagerGzipBytes)}` +
      (facts.inlineStyleGzipBytes > 0
        ? ` (ومنها ${kb(facts.inlineStyleGzipBytes)} أنماطاً مُدمَجةً في المستند)`
        : ""),
  );
  for (const asset of [...facts.eager].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(`    · ${asset.bundle}: ${kb(asset.gzipBytes)} (${kb(asset.rawBytes)} قبلَ الضغط)`);
  }
  console.log(`  طلباتُ أوّلِ رسم: ${facts.requests.length} / الحدُّ ${BUDGET.firstPaintRequests}`);
  for (const request of facts.requests) {
    console.log(
      `    · ${request.kind}: ${request.target}${request.external ? " (نطاقٌ خارجيّ — بايتاتُه ليست في ميزانيتِنا وطلبُه محسوب)" : ""}`,
    );
  }
  console.log(
    `  حزمٌ مؤجَّلة: ${facts.lazy.length} / الحدُّ لكلِّ واحدةٍ ${kb(BUDGET.lazyChunkGzipBytes)}`,
  );
  for (const asset of [...facts.lazy].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(`    · ${asset.bundle}: ${kb(asset.gzipBytes)}`);
  }

  console.log("  حزمٌ مأذونٌ بها خارجَ جدولِ القسم 9.4 — بسندِ كلِّ واحدةٍ:");
  for (const [bundle, reason] of Object.entries(DECLARED_EXTRA_BUNDLES)) {
    console.log(`    · ${bundle}: ${reason}`);
  }

  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} تجاوزاً لميزانيةِ الأداء (القسم 9.9 · F1-09):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.rule}`);
      console.error(`    ← ${violation.detail}\n`);
    }
    process.exit(1);
  }

  console.log(
    "\n✓ ميزانيةُ الأداءِ محفوظةٌ في الصفوفِ الثلاثةِ القابلةِ للإثباتِ من البناء " +
      "(الحملُ الأوّلُ · الحزمُ المؤجَّلةُ · طلباتُ أوّلِ رسمٍ) — ولا زمنَ يُدَّعى قياسُه ههنا",
  );
}

main();
