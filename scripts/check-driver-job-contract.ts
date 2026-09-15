#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ مَهمّةِ السائقِ النشطةِ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:driver-job` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06`/`SD-09` يُضيفانِ مِلفَّ سطحِهما إلى
 *   `SURFACE_FILES` إن شاركا آلةَ الأطوارِ عينَها.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`). والتعليقاتُ
 * تُمحى قبلَ القياسِ: حاجزٌ يقرأُ شرحاً يُسقِطُ نصّاً يُعلِّلُ **غيابَ** المسافةِ.
 */

import { readFileSync } from "node:fs";
import { DRIVER_JOB_PUBLIC_ERROR_CODES } from "../packages/application/driver/driver-job.ts";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";
import {
  APPLICATION_FILE,
  DOMAIN_FILE,
  type DriverJobContractInput,
  driverJobContractProblems,
  FUNCTIONS_SQL_FILE,
  KEY_PREFIX,
  ROUTE_FILE,
  STORE_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/driver-job-contract.ts";

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

export function readRepository(): DriverJobContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    route: blankComments(readFileSync(ROUTE_FILE, "utf8")),
    domain: blankComments(readFileSync(DOMAIN_FILE, "utf8")),
    application: blankComments(readFileSync(APPLICATION_FILE, "utf8")),
    store: blankComments(readFileSync(STORE_FILE, "utf8")),
    functionsSql: blankSqlComments(readFileSync(FUNCTIONS_SQL_FILE, "utf8")),
    publicErrorCodes: DRIVER_JOB_PUBLIC_ERROR_CODES,
    translations,
  };
}

function main(): void {
  const input = readRepository();
  const problems = driverJobContractProblems(input);
  if (problems.length === 0) {
    const keys = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith(KEY_PREFIX),
    ).length;
    console.log(
      `حاجزُ عقدِ مَهمّةِ السائقِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keys} مفتاحَ نصٍّ بثلاثِ لغاتٍ، و${input.publicErrorCodes.length} رمزَ خطأٍ عامّاً بنصوصِها وحالاتِها، وتسعُ قواعدَ مقيسةً: لا مفتاحَ ناقصاً، ولا رمزَ بلا نصٍّ أو بنصٍّ لا يُعرَضُ، ولا لفظَ مالٍ في شريحةٍ طبقتُها الماليّةُ غائبةٌ بإعلانٍ، ولا كاتبَ ثانياً لانتقالٍ ولا لِـarrived_at، ولا دالّةَ بلا نزعِ تنفيذٍ ومنحٍ، ولا ساعةَ جهازٍ ولا استنتاجَ طَورٍ من قُربٍ ولا آلةَ حالاتٍ في العميلِ، ولا رمزاً بلا حالةِ HTTP، ولا هويّةَ راكبٍ خارجَ الاسمِ الأوّلِ واللغةِ، ولا عنوانَ مطلقاً في حزمةِ المصغَّرِ — رابطُ الملاحةِ يُنشَرُ من البوّابةِ.`,
    );
    return;
  }
  console.error("حاجزُ عقدِ مَهمّةِ السائقِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
