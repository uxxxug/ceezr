#!/usr/bin/env bun
/**
 * # check-state-sync — بوابة مزامنة الحالة والكود
 *
 * **الغرض:** منع انتقال تغيير تنفيذي إلى مرحلة الدمج دون تحديث
 * `docs/SYSTEM_STATE.md`. القاعدة الحاكمة: «الكود + الحالة + التوثيق
 * يتحرك معًا.»
 *
 * **القاعدة:** إن تغيّر أي ملف تنفيذي (apps/**, packages/**, supabase/**,
 * render.yaml, .github/workflows/**, scripts/**) في هذه الدفعة، يجب أن
 * يتغيّر `docs/SYSTEM_STATE.md` أيضًا. بوابة `check-roadmap.mjs` تغطي
 * `ROADMAP.md` و`docs/ROADMAP-MASTER.md`، فهذه البوابة مكمّلة لا مكرّرة.
 *
 * **الاستثناءات:** التغييرات التي لا تؤثر على الحالة (تعليقات، تنسيق،
 * إصلاحات أداة، تحديثات deps تلقائية). تُمرّر عبر message الـ commit.
 *
 * **لا تُسقط عند تعذّر القراءة:** إن لم يُمكن تحديد نطاق المقارنة،
 * تفشل البوابة بصوت عالٍ — أخضرُ «لم أقرأ» أسوأُ من غياب البوابة.
 * (درسٌ من `check-roadmap.mjs` · `OPS-ROADMAP-GATE`.)
 *
 * **ينتمي إلى:** حوكمة المستودع — UI/UX REFOUNDATION.
 * **يُستخدَم من:** سلسلة `bun run ci`.
 * **وحداته النقية:** قابل للحقن بالكامل — `changedFiles` مدخل لا يُقرأ من git.
 */
import { execSync } from "node:child_process";

/** الملف الذي تطلبه هذه البوابة تحديدًا للتغييرات التنفيذية. */
const REQUIRED_STATE_FILE = "docs/SYSTEM_STATE.md";

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

  const stateChanged = changedFiles.filter((f) => f === REQUIRED_STATE_FILE);

  if (stateChanged.length === 0) {
    return {
      ok: false,
      reason:
        `تغيير تنفيذي في ${implChanged.length} ملف دون تحديث ${REQUIRED_STATE_FILE}.\n` +
        `الملفات التنفيذية: ${implChanged.slice(0, 10).join(", ")}${implChanged.length > 10 ? "…" : ""}\n` +
        `يلزم تحديث ${REQUIRED_STATE_FILE} (بوابة check-roadmap.mjs تغطي ROADMAP.md).`,
      implChanged,
      stateChanged: [],
    };
  }

  return {
    ok: true,
    reason: `تغيير تنفيذي (${implChanged.length}) مع تحديث ${REQUIRED_STATE_FILE}.`,
    implChanged,
    stateChanged,
  };
}

// CLI entry point
if (import.meta.main) {
  const ZERO_SHA = "0000000000000000000000000000000000000000";

  const head = process.env.HEAD_SHA?.trim() || "HEAD";
  let base: string | null = null;

  // 1) BASE_SHA from env (GitHub Actions event.before)
  const envBase = process.env.BASE_SHA?.trim();
  if (envBase && envBase.length > 0 && envBase !== ZERO_SHA) {
    try {
      execSync(`git rev-parse --verify ${envBase}^{commit}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      base = envBase;
    } catch {
      /* fall through to merge-base */
    }
  }

  // 2) merge-base with origin/main or main
  if (!base) {
    for (const ref of ["origin/main", "main"]) {
      try {
        const result = execSync(`git merge-base ${ref} ${head}`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        if (result.length > 0) {
          base = result;
          break;
        }
      } catch {
        /* try next ref */
      }
    }
  }

  if (!base) {
    console.error(
      "::error::check-state-sync: تعذّر تحديد نطاق المقارنة — لا BASE_SHA صالح ولا origin/main (shallow clone? fetch-depth: 0).",
    );
    process.exit(1);
  }

  const diff = execSync(`git diff --name-only ${base}...${head}`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  const changedFiles = diff ? diff.split("\n").filter(Boolean) : [];

  const result = checkStateSync({ changedFiles });

  if (!result.ok) {
    console.error(`::error::check-state-sync: ${result.reason}`);
    process.exit(1);
  }

  console.log(`✓ check-state-sync: ${result.reason}`);
  process.exit(0);
}
