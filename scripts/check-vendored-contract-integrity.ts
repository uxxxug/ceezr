#!/usr/bin/env bun
/**
 * الغرض: حاجزُ **سلامةِ العقودِ المنقولةِ**: يُعيدُ حسابَ بصمةِ `sha256` لكلِّ ملفٍّ
 *    منقولٍ في `docs/contracts/core/` ويُقابِلُها بالبصماتِ المكتوبةِ في
 *    `PROVENANCE.md`، ويُخفِقُ على أوّلِ بايتٍ يختلفُ، وعلى ملفٍّ منقولٍ لا بصمةَ
 *    له، وعلى بصمةٍ لا ملفَّ لها. البند `W-5`.
 * الحالة: منفّذ فعلياً — 2026-09-12 · البند `W-5`.
 * ينتمي إلى: scripts (حاجزٌ في سلسلةِ `ci`)
 * يُستخدم من: `package.json` → `check:vendored-contract-integrity`، و
 *    `.github/workflows/ci.yml` خطوةً مُسمَّاةً.
 * ملاحظات مستقبلية: يقرأُ السجلَّ منذُ 2026-09-12 عبرَ القارئِ المشترَكِ
 *    `scripts/lib/vendored-contract-pins.ts` (البند `DEP-CORE-005`) لا بتعبيرٍ
 *    خاصٍّ به، فلا ينحرفُ تفكيكانِ لسجلٍّ واحدٍ. وسلوكُه ومُخرَجاتُه كما كانت.
 *    وهذا الحاجزُ يحرسُ أنَّ النسخةَ **لم تُمَسَّ بعدَ نقلِها**. ولا
 *    يحرسُ أنَّها **ما زالت مُطابِقةً لـCORE** — ذاكَ يلزمُه وصولٌ متبادلٌ، وهوَ
 *    `DEP-CORE-005` المسجَّلُ. فإذا انفتحَ الوصولُ، تُضافُ خطوةٌ تقرأُ بصمةَ رأسِ
 *    CORE وتُقابِلُها بهذه البصماتِ نفسِها، فيصيرُ الحاجزانِ سلسلةً واحدةً.
 *
 * ## لِمَ يلزمُ حاجزٌ لهذا
 *
 * دعوى `PROVENANCE.md` أنَّ الملفّاتِ **منقولةٌ حرفاً**، وقيمةُ الدعوى كلُّها في
 * البايتِ: عقدٌ يُقرأُ منه حرفٌ زائدٌ أو ناقصٌ لم يبقَ عقداً منقولاً بل صار عقداً
 * مُحرَّراً هنا. وقد حدثَ ذلكَ فعلاً في هذه الدورةِ: أعادَ المُنسِّقُ تنسيقَ ملفَّينِ
 * فبطلَت بصمتاهما وبقيَت الدعوى مكتوبةً — أي دليلٌ كاذبٌ لا يكشفُه أحدٌ. وكشفُ
 * مثلِ هذا بالعينِ لا يُعتمَدُ عليه، وبالمُنسِّقِ وحدَه لا يكفي (فقد يُستثنى مسارٌ
 * ثمَّ يُعادُ). فالحرسُ الوحيدُ الذي لا يُنسى هوَ إعادةُ الحسابِ في كلِّ جريَةٍ.
 *
 * ## ما يُفحَصُ بالضبطِ
 *
 * ١) كلُّ بصمةٍ مكتوبةٍ في `PROVENANCE.md` لها ملفٌّ، وبصمةُ الملفِّ تُطابِقُها.
 * ٢) كلُّ ملفٍّ منقولٍ (بأيِّ امتدادٍ، في أيِّ عمقٍ) له بصمةٌ مكتوبةٌ — فلا يُنقَلُ
 *    ملفٌّ بلا إثباتٍ، و`PROVENANCE.md` نفسُه وحدَه مُستثنىً لأنَّه السجلُّ لا
 *    المنقولُ.
 */

import { join } from "node:path";
import {
  CONTRACTS_DIR,
  listVendored,
  PROVENANCE_NAME,
  readProvenance,
  sha256OfFile,
} from "./lib/vendored-contract-pins.ts";

export { CONTRACTS_DIR };

export function auditVendoredContracts(root: string = CONTRACTS_DIR): readonly string[] {
  const breaches: string[] = [];
  const provenance = join(root, PROVENANCE_NAME);
  const recorded = readProvenance(root).fingerprints;
  const vendored = listVendored(root);

  if (recorded.size === 0) {
    breaches.push(`${provenance}: لا بصمةَ واحدةً مكتوبةً — سجلٌّ فارغٌ يُجيزُ كلَّ شيءٍ`);
  }

  for (const rel of vendored) {
    const expected = recorded.get(rel);
    if (expected === undefined) {
      breaches.push(`${rel}: ملفٌّ منقولٌ بلا بصمةٍ في PROVENANCE.md — نقلٌ بلا إثباتٍ`);
      continue;
    }
    const actual = sha256OfFile(join(root, rel));
    if (actual !== expected) {
      breaches.push(
        `${rel}: البصمةُ لا تُطابِقُ. المكتوبةُ ${expected.slice(0, 12)}… والمحسوبةُ ${actual.slice(0, 12)}… — ` +
          `الملفُّ مُسَّ بعدَ نقلِه، فإمّا يُعادُ إلى بايتاتِ المصدرِ وإمّا تُحدَّثُ البصمةُ بالتزامِ مصدرٍ جديدٍ`,
      );
    }
  }

  for (const rel of recorded.keys()) {
    if (!vendored.includes(rel)) {
      breaches.push(`${rel}: بصمةٌ مكتوبةٌ بلا ملفٍّ — إمّا حُذِفَ المنقولُ وإمّا أُخطئَ مسارُه`);
    }
  }

  return breaches;
}

function main(): void {
  const breaches = auditVendoredContracts();
  if (breaches.length > 0) {
    console.error("سلامةُ العقودِ المنقولةِ مُنتقَضةٌ:");
    for (const breach of breaches) console.error(`  - ${breach}`);
    process.exit(1);
  }
  const vendored = listVendored(CONTRACTS_DIR);
  console.log(`سلامةُ العقودِ المنقولةِ: ${vendored.length} ملفّاً، كلُّ بصمةٍ مُطابِقةٌ.`);
}

/** لا يُنفَّذُ عندَ الاستيرادِ في اختبارٍ: `main` للجريَةِ المباشرةِ وحدَها. */
if (import.meta.main) main();
