#!/usr/bin/env bun
/**
 * # check-state-sync — بوابة مزامنة الحوكمة الكاملة
 *
 * **الغرض:** منع انتقال تغيير تنفيذي إلى مرحلة الدمج دون تحديث الحالة
 * والخارطة والوثائق المتأثرة معًا. القاعدة الحاكمة:
 *
 *   Implementation + Project State + Roadmap + Affected Documentation = ONE UNIT
 *
 * **كيف تعمل:**
 * 1. إن لم يكن هناك تغيير تنفيذي → تمر (لا يلزم manifest).
 * 2. إن كان هناك تغيير تنفيذي:
 *    أ. يجب تحديث `docs/SYSTEM_STATE.md`.
 *    ب. يجب تحديث `ROADMAP.md` أو `docs/ROADMAP-MASTER.md` (بوابة check-roadmap.mjs).
 *    ج. يجب وجود manifest واحد على الأقل في `docs/work-packets/*.json`.
 *    د. كل ملف تنفيذي في الـdiff يجب أن يكون في `implementation` الـmanifest.
 *    هـ. كل ملف في `affected_docs` الـmanifest يجب أن يكون معدّلًا فعلًا.
 *    و. أي وثيقة معدّلة (غير SYSTEM_STATE/ROADMAP/manifest) يجب أن تكون في `affected_docs`.
 *    ز. إن كانت `affected_docs` فارغة، يجب وجود `no_other_affected_docs_reason`.
 *
 * **Manifest:** ملف JSON في `docs/work-packets/*.json`:
 *   {
 *     "id": "work-packet-name",
 *     "implementation": ["scripts/foo.ts", "apps/bar.tsx"],
 *     "state": ["docs/SYSTEM_STATE.md"],
 *     "roadmap": ["ROADMAP.md"],
 *     "affected_docs": ["docs/some-design-doc.md"],
 *     "no_other_affected_docs_reason": "..."
 *   }
 *
 * **لا تُسقط عند تعذّر القراءة:** إن لم يُمكن تحديد نطاق المقارنة،
 * تفشل البوابة بصوت عالٍ. (درسٌ من `check-roadmap.mjs`.)
 *
 * **لا استثناءات commit message:** لا تُعتمد على حسن نية الوكيل.
 * التصريح (manifest) إلزامي، والملفات المصرّح بها يجب أن تتحرك.
 *
 * **ينتمي إلى:** حوكمة المستودع — UI/UX REFOUNDATION.
 * **يُستخدَم من:** سلسلة `bun run ci`.
 * **وحداته النقية:** قابلة للحقن بالكامل — `changedFiles` و`manifests` مدخلات.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED_STATE_FILE = "docs/SYSTEM_STATE.md";

const ROADMAP_FILES = ["ROADMAP.md", "docs/ROADMAP-MASTER.md"];

/**
 * Implementation / config-executable patterns.
 * Files matching these are treated as implementation changes that require
 * state + roadmap + manifest synchronization.
 *
 * Categories:
 * - Source/executable dirs: apps/, packages/, supabase/, scripts/, tests/
 * - CI/deploy/build config: .github/workflows/, render.yaml, package.json,
 *   bun.lock, tsconfig.json, biome.json, biome.jsonc, Dockerfile,
 *   docker-compose.yml, vite.config.*, vitest.config.*, playwright.config.*
 */
const IMPL_PATTERNS = [
  /^apps\//,
  /^packages\//,
  /^supabase\//,
  /^scripts\//,
  /^tests\//,
  /^\.github\/workflows\//,
  /^render\.yaml$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^tsconfig\.json$/,
  /^biome\.json[c]?$/,
  /^Dockerfile$/,
  /^docker-compose\.yml$/,
  /^vite\.config\./,
  /^vitest\.config\./,
  /^playwright\.config\./,
] as const;

const MANIFEST_GLOB = "docs/work-packets/";

// ─── Pure types ───

export interface WorkPacketManifest {
  readonly id: string;
  readonly implementation: readonly string[];
  readonly state: readonly string[];
  readonly roadmap: readonly string[];
  readonly affected_docs: readonly string[];
  readonly no_other_affected_docs_reason?: string;
}

export interface GovernanceSyncInput {
  readonly changedFiles: readonly string[];
  readonly manifests: readonly WorkPacketManifest[];
}

export interface GovernanceSyncResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly implChanged: readonly string[];
  readonly stateChanged: readonly string[];
  readonly roadmapChanged: readonly string[];
  readonly manifestCount: number;
  readonly unaccountedImpl: readonly string[];
  readonly unaccountedDocs: readonly string[];
  readonly declaredDocsMissing: readonly string[];
}

function isImpl(f: string): boolean {
  return IMPL_PATTERNS.some((p) => p.test(f));
}

/**
 * Documentation files: any file under docs/ (except manifests, handled
 * separately), plus root-level *.md files such as README.md, CHANGELOG.md.
 *
 * NOT documentation:
 * - Implementation files (apps/, scripts/, tests/, etc.) — even if .md
 * - Non-markdown files outside docs/ (e.g. notes.txt, .env.example)
 * - Manifest files (docs/work-packets/*.json) — handled separately
 */
function isDocumentationFile(f: string): boolean {
  // Files under docs/ are documentation (manifests filtered out separately)
  if (f.startsWith("docs/")) return true;
  // Root-level markdown files are documentation (README.md, CHANGELOG.md, etc.)
  if (/^[^/]+\.md$/.test(f)) return true;
  return false;
}

function isStateFile(f: string): boolean {
  return f === REQUIRED_STATE_FILE;
}

function isRoadmapFile(f: string): boolean {
  return ROADMAP_FILES.includes(f);
}

function isManifestFile(f: string): boolean {
  return f.startsWith(MANIFEST_GLOB) && f.endsWith(".json");
}

/**
 * The pure verdict. No git, no fs, no process — fully injectable.
 */
export function evaluateGovernanceSync(input: GovernanceSyncInput): GovernanceSyncResult {
  const { changedFiles, manifests } = input;

  const implChanged = changedFiles.filter((f) => isImpl(f));

  if (implChanged.length === 0) {
    return {
      ok: true,
      reason: "لا تغيير تنفيذي — لا يلزم manifest ولا تحديث حالة.",
      implChanged: [],
      stateChanged: [],
      roadmapChanged: [],
      manifestCount: 0,
      unaccountedImpl: [],
      unaccountedDocs: [],
      declaredDocsMissing: [],
    };
  }

  // Collect all declared implementation files and affected docs from manifests
  const declaredImpl = new Set<string>();
  const declaredDocs = new Set<string>();
  for (const m of manifests) {
    for (const f of m.implementation) declaredImpl.add(f);
    for (const f of m.affected_docs) declaredDocs.add(f);
  }

  // Check: every implementation file in diff must be declared in a manifest
  const unaccountedImpl = implChanged.filter((f) => !declaredImpl.has(f));

  // Check: every declared affected_doc must actually be in the diff
  const changedSet = new Set(changedFiles);
  const declaredDocsMissing = [...declaredDocs].filter((f) => !changedSet.has(f));

  // Check: any modified doc that's not state/roadmap/manifest must be in affected_docs
  const knownDocPatterns = [
    (f: string) => isStateFile(f),
    (f: string) => isRoadmapFile(f),
    (f: string) => isManifestFile(f),
  ];
  const unaccountedDocs = changedFiles.filter(
    (f) =>
      isDocumentationFile(f) &&
      !knownDocPatterns.some((p) => p(f)) &&
      !declaredDocs.has(f) &&
      !isImpl(f),
  );

  // Check: SYSTEM_STATE.md must be in diff
  const stateChanged = changedFiles.filter((f) => isStateFile(f));
  const stateMissing = stateChanged.length === 0;

  // Check: ROADMAP must be in diff (if check-roadmap.mjs hasn't run yet)
  const roadmapChanged = changedFiles.filter((f) => isRoadmapFile(f));
  const roadmapMissing = roadmapChanged.length === 0;

  // Check: at least one manifest must exist
  const manifestCount = manifests.length;
  const manifestMissing = manifestCount === 0;

  // Check: if affected_docs is empty, reason is required
  const emptyAffectedDocsReasonMissing = manifests.some(
    (m) => m.affected_docs.length === 0 && !m.no_other_affected_docs_reason,
  );

  // Assemble failure reasons
  const reasons: string[] = [];

  if (manifestMissing) {
    reasons.push("تغيير تنفيذي دون manifest في docs/work-packets/*.json.");
  }
  if (stateMissing) {
    reasons.push(`تغيير تنفيذي دون تحديث ${REQUIRED_STATE_FILE}.`);
  }
  if (roadmapMissing) {
    reasons.push(`تغيير تنفيذي دون تحديث ROADMAP (بوابة check-roadmap.mjs تغطي ذلك أيضًا).`);
  }
  if (unaccountedImpl.length > 0) {
    reasons.push(
      `ملفات تنفيذية غير مُصرّح بها في manifest: ${unaccountedImpl.slice(0, 5).join(", ")}${unaccountedImpl.length > 5 ? "…" : ""}`,
    );
  }
  if (declaredDocsMissing.length > 0) {
    reasons.push(
      `وثائق مُصرّح بها في manifest لكنها غير معدّلة: ${declaredDocsMissing.slice(0, 5).join(", ")}`,
    );
  }
  if (unaccountedDocs.length > 0) {
    reasons.push(
      `وثائق معدّلة غير مُصرّح بها في affected_docs: ${unaccountedDocs.slice(0, 5).join(", ")}${unaccountedDocs.length > 5 ? "…" : ""}`,
    );
  }
  if (emptyAffectedDocsReasonMissing) {
    reasons.push("manifest بـ affected_docs فارغة دون no_other_affected_docs_reason.");
  }

  const ok = reasons.length === 0;

  return {
    ok,
    reason: ok
      ? `تغيير تنفيذي (${implChanged.length}) + state + roadmap + ${manifestCount} manifest(s) + affected docs متزامنة.`
      : `حوكمة غير متزامنة:\n  - ${reasons.join("\n  - ")}`,
    implChanged,
    stateChanged,
    roadmapChanged,
    manifestCount,
    unaccountedImpl,
    unaccountedDocs,
    declaredDocsMissing,
  };
}

/**
 * Range resolver — mirrors check-roadmap.mjs pattern.
 * Returns { base, head } or null if no range resolves.
 */
export interface RangeResult {
  readonly base: string;
  readonly head: string;
}

export function resolveRange(
  argBase: string | undefined,
  argHead: string | undefined,
  env: Record<string, string | undefined>,
  gitFn: (args: string[]) => string,
): RangeResult | null {
  if (argBase !== undefined && argHead !== undefined) {
    return { base: argBase, head: argHead };
  }

  const ZERO_SHA = "0000000000000000000000000000000000000000";
  const head = env.HEAD_SHA?.trim() || "HEAD";
  const envBase = env.BASE_SHA?.trim();

  if (envBase && envBase.length > 0 && envBase !== ZERO_SHA) {
    try {
      gitFn(["rev-parse", "--verify", `${envBase}^{commit}`]);
      return { base: envBase, head };
    } catch {
      /* fall through */
    }
  }

  for (const ref of ["origin/main", "main"]) {
    try {
      const result = gitFn(["merge-base", ref, head]).trim();
      if (result.length > 0) {
        return { base: result, head };
      }
    } catch {
      /* try next */
    }
  }

  return null;
}

/**
 * Read all manifest files from docs/work-packets/*.json.
 * Returns parsed manifests or empty array.
 */
export function readManifests(manifestPaths: readonly string[]): WorkPacketManifest[] {
  const manifests: WorkPacketManifest[] = [];
  for (const path of manifestPaths) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content) as WorkPacketManifest;
      if (parsed && typeof parsed.id === "string") {
        manifests.push(parsed);
      }
    } catch {
      /* skip invalid manifest */
    }
  }
  return manifests;
}

function git(args: string[]): string {
  return execSync(`git ${args.join(" ")}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// CLI entry point
if (import.meta.main) {
  const range = resolveRange(process.argv[2], process.argv[3], process.env, git);

  if (!range) {
    console.error(
      "::error::check-state-sync: تعذّر تحديد نطاق المقارنة — لا BASE_SHA صالح ولا origin/main.",
    );
    console.error("A gate that cannot read its input fails; it does not pass.");
    process.exit(3);
  }

  let raw: string;
  try {
    raw = git(["diff", "--name-only", range.base, range.head]);
  } catch {
    console.error(`::error::check-state-sync: git diff ${range.base} ${range.head} failed.`);
    console.error("A gate that cannot read its input fails; it does not pass.");
    process.exit(3);
  }

  const changedFiles = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Find manifest files in the full PR diff
  // With PR-range BASE_SHA (or merge-base fallback), manifests committed
  // in earlier pushes within the same PR will appear in changedFiles.
  const manifestPaths = changedFiles.filter((f) => isManifestFile(f));
  const manifests = readManifests(manifestPaths);

  const result = evaluateGovernanceSync({
    changedFiles,
    manifests,
  });

  if (!result.ok) {
    console.error(`::error::check-state-sync: ${result.reason}`);
    process.exit(1);
  }

  console.log(`✓ check-state-sync: ${result.reason}`);
  process.exit(0);
}
