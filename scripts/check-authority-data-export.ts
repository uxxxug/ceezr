#!/usr/bin/env bun
/**
 * الغرض: إثباتُ أنَّ كلَّ هجرةٍ تُعرِّفُ دوالَّ F12-09 الثلاثَ بالأسماءِ المُعلَنةِ.
 *   دوالُّ F12-09: create_authority_data_request · generate_authority_data_package ·
 *   authority_data_request_deadline
 *
 * الحالة: منفَّذٌ — البندُ F12-09.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:authority-data-export` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * الحاكم: docs/adr/0040-regulatory-integration-is-critical-architecture.md
 *
 * القاعدةُ: ملفّاتُ هجرةِ F12-09 مَجتمعةً تُعرِّفُ الدوالَّ الثلاثَ
 * بالأسماءِ المُعلَنةِ. والكشفُ الفارغُ لا يُقرأُ نجاحاً (`ح-7`).
 * الفهارسُ المتزامنةُ ملفّاتٌ مستقلّةٌ لا تُعرِّفُ دوالَّ — تُجمَعُ
 * الدوالُّ من جميعِ الملفّاتِ لا من كلِّ ملفٍّ على حدة.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./lib/blank-comments.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "supabase", "migrations");

const REQUIRED_FUNCTIONS = [
  "create_authority_data_request",
  "generate_authority_data_package",
  "authority_data_request_deadline",
] as const;

function readMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .map((content) => blankComments(content));
}

function isF12_09Migration(content: string): boolean {
  return content.includes("F12-09") || content.includes("authority_data");
}

function hasFunction(content: string, fnName: string): boolean {
  return (
    content.includes(`create or replace function ${fnName}`) ||
    content.includes(`create function ${fnName}`)
  );
}

if (import.meta.main) {
  const migrations = readMigrations();
  const f12_09Migrations = migrations.filter(isF12_09Migration);

  if (f12_09Migrations.length === 0) {
    console.error("حاجزُ تزويدِ الهيئةِ بالبيانات: سقطَ — لا هجرةً تَحوي F12-09.");
    console.error("  الكشفُ الفارغُ لا يُقرأُ نجاحاً (`ح-7`).");
    process.exit(1);
  }

  const problems: string[] = [];

  // الدوالُّ تُجمَعُ من جميعِ ملفّاتِ F12-09 مَجتمعةً لا من كلِّ ملفٍّ على حدة —
  // فالفهارسُ المتزامنةُ ملفّاتٌ مستقلّةٌ لا تُعرِّفُ دوالَّ.
  const combinedContent = f12_09Migrations.join("\n\n");

  for (const fnName of REQUIRED_FUNCTIONS) {
    if (!hasFunction(combinedContent, fnName)) {
      problems.push(`الدالّةُ «${fnName}» غيرُ مُعرَّفةٍ في أيِّ هجرةٍ من هجراتِ F12-09.`);
    }
  }

  if (problems.length === 0) {
    console.log(
      `حاجزُ تزويدِ الهيئةِ بالبيانات: نجحَ — ${f12_09Migrations.length} هجرةً ` +
        `تُعرِّفُ الدوالَّ الثلاثَ مجتمعةً: ${REQUIRED_FUNCTIONS.join(" · ")}.`,
    );
  } else {
    console.error("حاجزُ تزويدِ الهيئةِ بالبيانات: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
