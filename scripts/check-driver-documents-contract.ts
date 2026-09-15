#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ وثائقِ السائقِ على المستودعِ الحقيقيِّ وإسقاطُ البناءِ
 *   عندَ نقضِ واحدةٍ (البند `F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:driver-documents` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` يُضيفُ مِلفَّ سطحِه إلى `SURFACE_FILES`.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { DRIVER_DOCUMENT_PUBLIC_ERROR_CODES } from "../packages/application/driver/driver-documents.ts";
import {
  DRIVER_BLOCK_CODES,
  DRIVER_DOCUMENT_STATUSES,
  DRIVER_DOCUMENT_TYPES,
} from "../packages/domain/driver/driver-documents.ts";
import { blankComments } from "./lib/blank-comments.ts";
import {
  type DriverDocumentsContractInput,
  driverDocumentsContractProblems,
  FUNCTIONS_SQL_FILE,
  ROUTE_FILE,
  SURFACE_FILES,
  TABLE_SQL_FILE,
  TRANSLATION_FILES,
} from "./lib/driver-documents-contract.ts";

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

export function readRepository(): DriverDocumentsContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    route: blankComments(readFileSync(ROUTE_FILE, "utf8")),
    functionsSql: readFileSync(FUNCTIONS_SQL_FILE, "utf8"),
    tableSql: readFileSync(TABLE_SQL_FILE, "utf8"),
    documentTypes: DRIVER_DOCUMENT_TYPES,
    documentStatuses: DRIVER_DOCUMENT_STATUSES,
    blockCodes: DRIVER_BLOCK_CODES,
    publicErrorCodes: DRIVER_DOCUMENT_PUBLIC_ERROR_CODES,
    translations,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = driverDocumentsContractProblems(input);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ وثائقِ السائقِ: نجحَ — ${input.documentTypes.length} نوعَ وثيقةٍ، و${input.documentStatuses.length} حالةً، و${input.blockCodes.length} رمزَ حجبٍ، و${input.publicErrorCodes.length} رمزَ خطأٍ عامّاً بنصوصِها الثلاثةِ، وسبعُ قواعدَ مقيسةً: لا مفتاحَ ناقصاً، ولا نوعَ بلا نصٍّ، ولا رمزَ بلا نصٍّ، ولا دالّةَ بلا نزعِ تنفيذٍ، ولا تفويضَ ذاهباً إلى مضيفِ المخزنِ، ولا مسارَ ولا إذناً في سجلٍّ، ولا نوعَ يفترقُ بينَ القاعدةِ والنطاقِ.`,
    );
  } else {
    console.error("حاجزُ عقدِ وثائقِ السائقِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
