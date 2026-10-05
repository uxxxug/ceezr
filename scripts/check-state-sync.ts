#!/usr/bin/env bun
/**
 * # check-state-sync — بوابة مزامنة الحالة والكود
 *
 * **الغرض:** منع انتقال تغيير تنفيذي إلى مرحلة الدمج دون تحديث ملفات
 * الحالة/الخارطة/الوثائق المطلوبة. القاعدة الحاكمة: «الكود + الحالة +
 * التوثيق تتحرك معًا.»
 *
 * **القاعدة:** إن تغيّر أي ملف تنفيذي (apps/**, packages/**, supabase/**,
 * render.yaml, .github/workflows/**) في هذه الدفعة، يجب أن يتغيّر أيضًا
 * ملف واحد على الأقل من ملفات الحالة الموثّقة:
 *   - docs/SYSTEM_STATE.md
 *   - ROADMAP.md
 *   - docs/UI_UX_CANONICAL_DIRECTIVE.md
 *   - docs/UI_UX_RECONCILIATION_REPORT.md
 *
 * **الاستثناءات:** التغييرات التي لا تؤثر على الحالة (تعليقات، تنسيق،
 * إصلاحات أداة، تحديثات deps تلقائية). تُمرّر عبر message الـ commit.
 *
 * **ينتمي إلى:** حوكمة المستودع — UI/UX REFOUNDATION.
 * **يُستخدَم من:** سلسلة `bun run ci`.
 * **وحداته النقية:** قابل للحقن بالكامل — `changedFiles` مدخل لا يُقرأ من git.
 */
import { execSync } from "node:child_process";

const STATE_FILES = [
  "docs/SYSTEM_STATE.md",
  "ROADMAP.md",
  "docs/UI_UX_CANONICAL_DIRECTIVE.md",
  "docs/UI_UX_RECONCILIATION_REPORT.md",
] as const;

const IMPL_PATTERNS = [
  /^apps\//,
  /^packages\//,
  /^supabase\//,
  /^render\.yaml$/,
  /^\.github\/workflows\//,
  /^scripts\//,
] as const;

export interface StateSyncInput {
  readonly changedFiles: readonly string[];
}

export interface StateSyncResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly implChanged: readonly string[];
  readonly stateChanged: readonly string[];
}

export function checkStateSync(input: StateSyncInput): StateSyncResult {
  const { changedFiles } = input;

  const implChanged = changedFiles.filter((f) => IMPL_PATTERNS.some((p) => p.test(f)));

  if (implChanged.length === 0) {
    return {
      ok: true,
      reason: "لا تغيير تنفيذي — لا يلزم تحديث حالة.",
      implChanged: [],
      stateChanged: [],
    };
  }

  const stateChanged = changedFiles.filter((f) =>
    STATE_FILES.includes(f as (typeof STATE_FILES)[number]),
  );

  if (stateChanged.length === 0) {
    return {
      ok: false,
      reason:
        `تغيير تنفيذي في ${implChanged.length} ملف دون تحديث أي ملف حالة.\n` +
        `الملفات التنفيذية: ${implChanged.slice(0, 10).join(", ")}${implChanged.length > 10 ? "…" : ""}\n` +
        `يلزم تحديث واحد على الأقل من: ${STATE_FILES.join(", ")}`,
      implChanged,
      stateChanged: [],
    };
  }

  return {
    ok: true,
    reason: `تغيير تنفيذي (${implChanged.length}) مع تحديث حالة (${stateChanged.length}).`,
    implChanged,
    stateChanged,
  };
}

// CLI entry point
if (import.meta.main) {
  let changedFiles: string[];

  try {
    const base = execSync("git merge-base HEAD origin/main", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const diff = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    changedFiles = diff ? diff.split("\n").filter(Boolean) : [];
  } catch {
    // If git comparison fails (e.g., first push), check unstaged
    try {
      const diff = execSync("git diff --name-only HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      changedFiles = diff ? diff.split("\n").filter(Boolean) : [];
    } catch {
      changedFiles = [];
    }
  }

  const result = checkStateSync({ changedFiles });

  if (!result.ok) {
    console.error(`::error::check-state-sync: ${result.reason}`);
    process.exit(1);
  }

  console.log(`✓ check-state-sync: ${result.reason}`);
  process.exit(0);
}
