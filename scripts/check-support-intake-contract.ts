#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ سطحِ الدعمِ على المستودعِ الحقيقيِّ وإسقاطُ البناءِ
 *   عندَ نقضِ واحدةٍ (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:support-intake` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` يُضيفُ مِلفّاتَه إلى `SURFACE_FILES`.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { blankComments } from "./lib/blank-comments.ts";
import {
  CATEGORIES,
  ERROR_CODES,
  REFERENCE_PATTERN,
  STATUSES,
  SUPPORT_SQL_FILE,
  SURFACE_FILES,
  type SupportIntakeContractInput,
  supportIntakeContractProblems,
  TRANSLATION_FILES,
} from "./lib/support-intake-contract.ts";

function readJson(path: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: قاموسٌ غيرُ صالحٍ.`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function readRepository(): SupportIntakeContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    sql: readFileSync(SUPPORT_SQL_FILE, "utf8"),
    translations,
    categories: CATEGORIES,
    statuses: STATUSES,
    errorCodes: ERROR_CODES,
    referencePattern: REFERENCE_PATTERN,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = supportIntakeContractProblems(input);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ سطحِ الدعمِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، ` +
        `و${CATEGORIES.length} صنفاً و${STATUSES.length} حالةً و${ERROR_CODES.length} رمزَ عطبٍ ` +
        `بنصوصِها الثلاثةِ، وسبعُ قواعدَ مقيسةً: لا رمزَ بلا نصٍّ، ولا مفتاحَ بلا مقابلٍ، ` +
        `وسقوطٌ للمجهولِ، ومرجعٌ منطوقٌ من متسلسلةٍ، ويُعرَضُ في الشاشةِ، ` +
        `ولا بابَ إرفاقٍ صوريَّ، ولا دالّةَ بلا نزعِ تنفيذٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ سطحِ الدعمِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
