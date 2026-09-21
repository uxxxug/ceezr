#!/usr/bin/env node
/**
 * Roadmap freshness gate.
 *
 * Rule (mandatory across all three WASLA repositories): a push that changes
 * implementation must update the roadmap in the same cycle.
 *
 * ## Correction 2026-09-21 — `OPS-ROADMAP-GATE` (additive; the rule is unchanged)
 *
 * This gate was **blind on exactly the pushes it exists to police.** It took its
 * base from `github.event.before`, which is `0000000…` on the **first push of a
 * new branch**. `git diff` then threw, the script took its `catch` path, and it
 * **exited 0 printing "check skipped"**. Every feature branch begins with a first
 * push, so for years the rule was enforced on follow-up commits only — and PR
 * `#191` merged green while touching no roadmap file at all.
 *
 * **A guard that passes where it cannot read is not enforcement, and a green that
 * means "I did not look" is worse than a missing guard**, because it is counted as
 * a verdict. Two things changed, in opposite directions, and both are declared:
 *
 * **(1) Strengthened — the range now resolves, or the build fails.** The fallback
 * is the branch's merge-base with `main`, which is the *same* resolution its
 * sibling in this very workflow (`check-vendored-pin-follows-bytes.ts`, `ADR
 * 0090`) has always used. So this is not an invention: it is one guard being
 * brought up to the standard of the one that runs beside it. And when no range can
 * be resolved at all, **the gate now fails loudly** instead of reporting success.
 *
 * **(2) Loosened — `docs/ROADMAP-MASTER.md` now satisfies the rule too.** The
 * repository carries two roadmap files: this gate named `ROADMAP.md`, while the
 * roadmap actually maintained is `docs/ROADMAP-MASTER.md`. Naming only the stale
 * one meant the gate's letter and its purpose pointed at different files. Either
 * now counts. **The duplication itself is not fixed here and is not pretended
 * away** — which file is authoritative is a governance decision, not a script's to
 * make. See `docs/adr/0167-*.md`.
 *
 * The net effect is far more enforcement, not less: before, a first push proved
 * nothing about any file; now every push must move a roadmap.
 *
 * Usage: node scripts/check-roadmap.mjs [baseRef] [headRef]
 */
import { execSync } from "node:child_process";

const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * The paths that count as implementation. Unchanged from the original gate — the
 * correction is about *when* the gate looks, not about what it considers code.
 */
const IMPLEMENTATION = /^(apps\/|packages\/|supabase\/|scripts\/|docs\/contracts\/|package\.json$|\.github\/workflows\/)/;

/**
 * The files that satisfy the rule. **Two entries, deliberately** — see §2 of the
 * header. A roadmap that moved is a roadmap that moved, whichever file holds it.
 */
export const ROADMAP_FILES = ["ROADMAP.md", "docs/ROADMAP-MASTER.md"];

function git(args) {
  return execSync(`git ${args.join(" ")}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * Resolves the range: what the push event gives first, then the branch's origin in
 * `main`. **Silence is not an option here** — an unresolvable range returns a
 * reason string and the caller fails, so "I could not look" is never read as "all
 * clear". Mirrors `check-vendored-pin-follows-bytes.ts` on purpose.
 */
export function resolveRange(argBase, argHead, env = process.env) {
  if (argBase !== undefined && argHead !== undefined) return { base: argBase, head: argHead };

  const head = env.HEAD_SHA?.trim() || "HEAD";
  const envBase = env.BASE_SHA?.trim();
  if (envBase !== undefined && envBase.length > 0 && envBase !== ZERO_SHA) {
    try {
      git(["rev-parse", "--verify", `${envBase}^{commit}`]);
      return { base: envBase, head };
    } catch {
      /* the branch origin is tried next */
    }
  }

  for (const ref of ["origin/main", "main"]) {
    try {
      const base = git(["merge-base", ref, head]).trim();
      if (base.length > 0) return { base, head };
    } catch {
      /* the next ref is tried */
    }
  }

  return "No range resolves: no valid BASE_SHA and no origin in `main` (shallow clone? set `fetch-depth: 0`).";
}

/**
 * The pure verdict. Kept free of `git` and of `process` so it can be tested
 * directly — the original gate had no test at all, which is how the blind spot
 * survived.
 */
export function evaluateRoadmapFreshness(files) {
  const implementation = files.filter((f) => IMPLEMENTATION.test(f));
  const roadmap = files.filter((f) => ROADMAP_FILES.includes(f));
  return {
    implementation,
    roadmap,
    ok: implementation.length === 0 || roadmap.length > 0,
  };
}

function main() {
  const range = resolveRange(process.argv[2], process.argv[3]);
  if (typeof range === "string") {
    console.error(`Roadmap check could not run: ${range}`);
    console.error("A gate that cannot read its input fails; it does not pass.");
    process.exit(3);
  }

  let raw;
  try {
    raw = git(["diff", "--name-only", range.base, range.head]);
  } catch {
    console.error(`Roadmap check could not run: git diff ${range.base} ${range.head} failed.`);
    console.error("A gate that cannot read its input fails; it does not pass.");
    process.exit(3);
  }

  const files = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const verdict = evaluateRoadmapFreshness(files);
  if (!verdict.ok) {
    console.error(`No roadmap file was updated alongside implementation changes (${range.base}..${range.head}):`);
    for (const f of verdict.implementation) console.error(`  - ${f}`);
    console.error(`\nUpdate one of: ${ROADMAP_FILES.join(" or ")}. This is a hard rule.`);
    process.exit(1);
  }

  console.log(
    verdict.implementation.length === 0
      ? `Roadmap check passed: no implementation changes in ${range.base}..${range.head}.`
      : `Roadmap check passed: implementation and ${verdict.roadmap.join(", ")} changed together.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) main();
