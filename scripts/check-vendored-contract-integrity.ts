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
 * ملاحظات مستقبلية: هذا الحاجزُ يحرسُ أنَّ النسخةَ **لم تُمَسَّ بعدَ نقلِها**. ولا
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

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const CONTRACTS_DIR = "docs/contracts/core";
const PROVENANCE_NAME = "PROVENANCE.md";
/** السجلُّ نفسُه لا يُبصَمُ: بصمتُه فيه فتتغيَّرُ بتغيُّرِها، وذاكَ دورٌ لا يُقفَلُ. */
const NOT_VENDORED = new Set(["PROVENANCE.md"]);

/** سطرُ بصمةٍ: أربعٌ وستّونَ خانةً ستّعشريّةً، ثمَّ فراغٌ، ثمَّ مسارٌ نسبيٌّ. */
const FINGERPRINT_LINE = /^([0-9a-f]{64})\s{1,2}(\S+)$/;

function readFingerprints(provenance: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(provenance, "utf8").split("\n")) {
    const match = FINGERPRINT_LINE.exec(line.trim());
    if (match === null) continue;
    const [, digest, path] = match;
    if (digest === undefined || path === undefined) continue;
    out.set(path, digest);
  }
  return out;
}

function listVendored(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listVendored(full, root));
      continue;
    }
    const rel = relative(root, full);
    if (NOT_VENDORED.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * تدقيقٌ خالصٌ يُرجِعُ الخروقَ ولا يطبعُ ولا يُخرِجُ العمليّةَ — ليُقاسَ بخرقٍ
 * مزروعٍ في مجلَّدٍ مؤقّتٍ، فلا يبقى الحاجزُ نفسُه هوَ الشيءُ الوحيدُ غيرَ
 * المُختبَرِ في السلسلةِ.
 */
export function auditVendoredContracts(root: string = CONTRACTS_DIR): readonly string[] {
  const breaches: string[] = [];
  const provenance = join(root, PROVENANCE_NAME);
  const recorded = readFingerprints(provenance);
  const vendored = listVendored(root, root);

  if (recorded.size === 0) {
    breaches.push(`${provenance}: لا بصمةَ واحدةً مكتوبةً — سجلٌّ فارغٌ يُجيزُ كلَّ شيءٍ`);
  }

  for (const rel of vendored) {
    const expected = recorded.get(rel);
    if (expected === undefined) {
      breaches.push(`${rel}: ملفٌّ منقولٌ بلا بصمةٍ في PROVENANCE.md — نقلٌ بلا إثباتٍ`);
      continue;
    }
    const actual = sha256(join(root, rel));
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
  const vendored = listVendored(CONTRACTS_DIR, CONTRACTS_DIR);
  console.log(`سلامةُ العقودِ المنقولةِ: ${vendored.length} ملفّاً، كلُّ بصمةٍ مُطابِقةٌ.`);
}

/** لا يُنفَّذُ عندَ الاستيرادِ في اختبارٍ: `main` للجريَةِ المباشرةِ وحدَها. */
if (import.meta.main) main();
