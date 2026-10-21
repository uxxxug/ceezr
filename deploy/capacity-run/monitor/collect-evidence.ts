/**
 * الغرض: LOAD-01 (الدفعةُ 28) — جامعُ أدلّةِ موجةِ المقعد. يحلُّ محلَّ القائمةِ البيضاءِ في `collect()`
 *   (`seat-b2x.sh`) التي أسقطت `telegram-jobs.csv` من أرشيفِ الدفعة 26 مع أنَّ `post-diag.sh` يكتبُه
 *   ويُعلنُه. القاعدةُ هنا: كلُّ ملفٍّ عاديٍّ في مجلّدِ الدليلِ يُنقَل (لا قائمةَ تُسقِطُ جديدًا)،
 *   والنصوصُ الكبيرةُ تُضغَطُ gzip، ويُكتَبُ `MANIFEST.json` بالأسماءِ والأحجامِ وSHA256 لكلِّ ما نُقِل،
 *   ثمّ يُطابَقُ مع قائمةِ «المُعلَن» — ما يَعِدُ به منتجو الدليل — فإن غابَ مُعلَنٌ: سطرُ
 *   `COLLECT_MISSING <اسم>` ورمزُ خروجٍ 3، ولا يُبتلَعُ الغيابُ صامتًا.
 *   الاستعمال: bun deploy/capacity-run/monitor/collect-evidence.ts <مجلّدُ الدليل> <الوجهة> [مُعلَنٌ…]
 *   بلا مُعلَنٍ صريحٍ تُستعمَلُ `DECLARED_DEFAULT`.
 * ينتمي إلى: deploy/capacity-run/monitor
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** ما يُعلنُه منتجو دليلِ الموجة: `wave-full.sh`/`b24-trace.sh` و`post-diag.sh` (pgss + telegram-jobs). */
export const DECLARED_DEFAULT: readonly string[] = [
  "wave-report.json",
  "load-trace.jsonl",
  "update-jobs.csv",
  "pgss-full.csv",
  "telegram-jobs.csv",
];

/** ملفّاتٌ صغيرةٌ تُنسَخُ كما هي (تُقرأُ مباشرةً في التحليلِ والمراجعة). */
const VERBATIM = /\.(json|txt|md)$/;
/** ما يُرفَضُ ضغطُه: مضغوطٌ سلفًا. */
const ALREADY_COMPRESSED = /\.(gz|zip|zst)$/;
const VERBATIM_MAX_BYTES = 1_000_000;

export interface CollectEntry {
  readonly source: string;
  readonly stored: string;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly sha256: string;
}

export interface CollectResult {
  readonly entries: readonly CollectEntry[];
  readonly declared: readonly string[];
  readonly missing: readonly string[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function collectEvidence(
  evidenceDir: string,
  destDir: string,
  declared: readonly string[] = DECLARED_DEFAULT,
): CollectResult {
  mkdirSync(destDir, { recursive: true });
  const entries: CollectEntry[] = [];
  const names = readdirSync(evidenceDir).sort();
  for (const name of names) {
    const src = join(evidenceDir, name);
    const st = statSync(src);
    if (!st.isFile()) continue;
    const raw = readFileSync(src);
    const keep =
      ALREADY_COMPRESSED.test(name) || (VERBATIM.test(name) && st.size <= VERBATIM_MAX_BYTES);
    const stored = keep ? name : `${name}.gz`;
    const body = keep ? raw : gzipSync(raw, { level: 9 });
    writeFileSync(join(destDir, stored), body);
    entries.push({
      source: name,
      stored,
      bytes: st.size,
      storedBytes: body.length,
      sha256: sha256(body),
    });
  }
  const present = new Set(entries.map((e) => e.source));
  const missing = declared.filter((d) => !present.has(d));
  const manifest = {
    generatedBy: "deploy/capacity-run/monitor/collect-evidence.ts",
    declared,
    missing,
    entries,
  };
  writeFileSync(join(destDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { entries, declared, missing };
}

if (import.meta.main) {
  const [evidenceDir, destDir, ...declared] = process.argv.slice(2);
  if (evidenceDir === undefined || destDir === undefined) {
    console.error("الاستعمال: collect-evidence.ts <مجلّدُ الدليل> <الوجهة> [مُعلَنٌ…]");
    process.exit(2);
  }
  const result = collectEvidence(
    evidenceDir,
    destDir,
    declared.length > 0 ? declared : DECLARED_DEFAULT,
  );
  for (const m of result.missing) console.log(`COLLECT_MISSING ${m}`);
  console.log(`COLLECT_DONE files=${result.entries.length} missing=${result.missing.length}`);
  process.exit(result.missing.length > 0 ? 3 : 0);
}
