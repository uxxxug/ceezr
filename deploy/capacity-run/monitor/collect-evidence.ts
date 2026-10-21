/**
 * الغرض: LOAD-01 (الدفعةُ 28) — جامعُ أدلّةِ موجةِ المقعد. يحلُّ محلَّ القائمةِ المضمَّنةِ في `collect()`
 *   (`seat-b2x.sh`) التي أسقطت `telegram-jobs.csv` من أرشيفاتِ الدفعاتِ 26–27 مع أنَّ `post-diag.sh`
 *   يكتبُه ويُعلنُه (`wc -l` في post-diag.out). القاعدة: البيانُ (`wave-evidence-manifest.json`) هو
 *   المصدرُ الوحيدُ لما يُرفَع وكيف (`copy` حرفًا أو `gzip`)، ويُكتَبُ `MANIFEST.json` بالأحجامِ وSHA256
 *   لكلِّ ما نُقِل. مُعلَنٌ مطلوبٌ غائبٌ ⇒ سطرُ `COLLECT_MISSING <اسم>` ورمزُ خروجٍ 3 — لا يُبتلَعُ صامتًا.
 *   ما في مجلّدِ الدليلِ وليس في البيانِ لا يُرفَع (قد يحملُ سرًّا فيُسقِطُ تدقيقَ الأسرارِ الأرشيفَ كلَّه)
 *   بل يُسمّى بحجمِه تحتَ `undeclared_present` ليُرى ويُعلَنَ في البيانِ إن لزم.
 *   الاستعمال: bun deploy/capacity-run/monitor/collect-evidence.ts <مجلّدُ الدليل> <الوجهة> [مسارُ البيان]
 * ينتمي إلى: deploy/capacity-run/monitor
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

export interface ManifestFile {
  readonly name: string;
  readonly mode: "copy" | "gzip";
  readonly required: boolean;
}

export interface CollectEntry {
  readonly source: string;
  readonly stored: string;
  readonly bytes: number;
  readonly storedBytes: number;
  readonly sha256: string;
}

export interface CollectResult {
  readonly entries: readonly CollectEntry[];
  readonly missing: readonly string[];
  readonly absentOptional: readonly string[];
  readonly undeclaredPresent: readonly { readonly name: string; readonly bytes: number }[];
}

export const DEFAULT_MANIFEST = join(
  dirname(new URL(import.meta.url).pathname),
  "wave-evidence-manifest.json",
);

export function loadManifest(path: string = DEFAULT_MANIFEST): readonly ManifestFile[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { files?: unknown };
  if (!Array.isArray(raw.files)) throw new Error(`بيانٌ بلا files: ${path}`);
  const seen = new Set<string>();
  return raw.files.map((f: { name?: unknown; mode?: unknown; required?: unknown }) => {
    if (typeof f.name !== "string" || f.name === "" || f.name.includes("/"))
      throw new Error(`اسمٌ غيرُ صالحٍ في البيان: ${String(f.name)}`);
    if (f.mode !== "copy" && f.mode !== "gzip") throw new Error(`طريقةُ حفظٍ مجهولة: ${f.name}`);
    if (typeof f.required !== "boolean") throw new Error(`required غيرُ منطقيٍّ: ${f.name}`);
    if (seen.has(f.name)) throw new Error(`اسمٌ مكرَّرٌ في البيان: ${f.name}`);
    seen.add(f.name);
    return { name: f.name, mode: f.mode, required: f.required };
  });
}

const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

export function collectEvidence(
  evidenceDir: string,
  destDir: string,
  manifest: readonly ManifestFile[] = loadManifest(),
): CollectResult {
  mkdirSync(destDir, { recursive: true });
  const entries: CollectEntry[] = [];
  const missing: string[] = [];
  const absentOptional: string[] = [];
  const declared = new Set(manifest.map((f) => f.name));
  for (const f of manifest) {
    const src = join(evidenceDir, f.name);
    let st: ReturnType<typeof statSync> | null = null;
    try {
      st = statSync(src);
    } catch {
      st = null;
    }
    if (st === null || !st.isFile()) {
      (f.required ? missing : absentOptional).push(f.name);
      continue;
    }
    const raw = readFileSync(src);
    const stored = f.mode === "copy" ? f.name : `${f.name}.gz`;
    const body = f.mode === "copy" ? raw : gzipSync(raw, { level: 9 });
    writeFileSync(join(destDir, stored), body);
    entries.push({
      source: f.name,
      stored,
      bytes: raw.length,
      storedBytes: body.length,
      sha256: sha256(body),
    });
  }
  const undeclaredPresent = readdirSync(evidenceDir)
    .sort()
    .filter((n) => !declared.has(n))
    .map((n) => ({ name: n, st: statSync(join(evidenceDir, n)) }))
    .filter((x) => x.st.isFile())
    .map((x) => ({ name: x.name, bytes: x.st.size }));
  const out = {
    generatedBy: "deploy/capacity-run/monitor/collect-evidence.ts",
    missing,
    absentOptional,
    undeclaredPresent,
    entries,
  };
  writeFileSync(join(destDir, "MANIFEST.json"), `${JSON.stringify(out, null, 2)}\n`);
  return { entries, missing, absentOptional, undeclaredPresent };
}

if (import.meta.main) {
  const [evidenceDir, destDir, manifestPath] = process.argv.slice(2);
  if (evidenceDir === undefined || destDir === undefined) {
    console.error("الاستعمال: collect-evidence.ts <مجلّدُ الدليل> <الوجهة> [مسارُ البيان]");
    process.exit(2);
  }
  const r = collectEvidence(evidenceDir, destDir, loadManifest(manifestPath ?? DEFAULT_MANIFEST));
  for (const m of r.missing) console.log(`COLLECT_MISSING ${m}`);
  for (const u of r.undeclaredPresent) console.log(`COLLECT_UNDECLARED ${u.name} ${u.bytes}`);
  console.log(
    `COLLECT_DONE files=${r.entries.length} missing=${r.missing.length} undeclared=${r.undeclaredPresent.length}`,
  );
  process.exit(r.missing.length > 0 ? 3 : 0);
}
