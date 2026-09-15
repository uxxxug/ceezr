#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ عروضِ السائقِ على المستودعِ الحقيقيِّ وإسقاطُ البناءِ
 *   عندَ نقضِ واحدةٍ (البند `F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:driver-offers` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` يُضيفُ مِلفَّ سطحِه إلى `SURFACE_FILES`.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`). والتعليقاتُ
 * تُمحى قبلَ القياسِ: حاجزٌ يقرأُ شرحاً يُسقِطُ نصّاً يُعلِّلُ **غيابَ** الأجرةِ.
 */

import { readFileSync } from "node:fs";
import { DRIVER_OFFER_PUBLIC_ERROR_CODES } from "../packages/application/driver/driver-offers.ts";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";
import {
  APPLICATION_FILE,
  DOMAIN_FILE,
  type DriverOffersContractInput,
  driverOffersContractProblems,
  FUNCTIONS_SQL_FILE,
  ROUTE_FILE,
  STORE_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/driver-offers-contract.ts";

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

export function readRepository(): DriverOffersContractInput {
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
    publicErrorCodes: DRIVER_OFFER_PUBLIC_ERROR_CODES,
    translations,
  };
}

function main(): void {
  const input = readRepository();
  const problems = driverOffersContractProblems(input);
  if (problems.length === 0) {
    const keys = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith("driver.offers."),
    ).length;
    console.log(
      `حاجزُ عقدِ عروضِ السائقِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keys} مفتاحَ نصٍّ بثلاثِ لغاتٍ، و${input.publicErrorCodes.length} رمزَ خطأٍ عامّاً بنصوصِها وحالاتِها، وثمانُ قواعدَ مقيسةً: لا مفتاحَ ناقصاً، ولا رمزَ بلا نصٍّ، ولا لفظَ مالٍ في شريحةٍ طبقتُها الماليّةُ غائبةٌ بإعلانٍ، ولا ذرّيّةَ ثانيةً للإيكالِ، ولا دالّةَ بلا نزعِ تنفيذٍ ومنحٍ، ولا ساعةَ جهازٍ في حكمٍ ولا مسافةً بلا وسمٍ، ولا رمزاً بلا حالةِ HTTP، ولا هويّةَ راكبٍ في حمولةِ عرضٍ.`,
    );
    return;
  }
  console.error("حاجزُ عقدِ عروضِ السائقِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
