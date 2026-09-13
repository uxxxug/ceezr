#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ شاشةِ الإنهاءِ والتقييمِ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F2-07` · `SR-07` · `SR-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-07`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:ride-summary` وسلسلةُ `ci` وخطوتانِ مُسمَّاتانِ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` يُضيفُ مِلفَّ سطحِه إلى `SURFACE_FILES`
 *   ويُخرِجُ «المشاركةَ» من معجمِ المحظورِ **معَ مسارِها** لا قبلَه.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ في اختبارٍ بمدخلاتٍ
 * مصنوعةٍ — والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 * وهذا المِلفُّ **لا يحكمُ**: يقرأُ ويُمرِّرُ ويطبعُ. فلو حكمَ لَما كانَ لحكمِه
 * حالةٌ سالبةٌ تُزرَعُ في وحدةٍ.
 */

import { readFileSync } from "node:fs";
import { blankComments } from "./lib/blank-comments.ts";
import {
  DOMAIN_FILE,
  KEY_PREFIX,
  type RideSummaryContractInput,
  rideSummaryContractProblems,
  SUMMARY_SQL_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
  VIEW_FILE,
} from "./lib/ride-summary-contract.ts";

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

export function readRepository(): RideSummaryContractInput {
  const surface: Record<string, string> = {};
  // التعليقُ يشرحُ المحظورَ بلفظِه، فلا يُقاسُ — وإلّا صارَ الشرحُ جُرماً.
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    sql: readFileSync(SUMMARY_SQL_FILE, "utf8"),
    domain: readFileSync(DOMAIN_FILE, "utf8"),
    view: blankComments(readFileSync(VIEW_FILE, "utf8")),
    translations,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = rideSummaryContractProblems(input);
  if (problems.length === 0) {
    const keyCount = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith(KEY_PREFIX),
    ).length;
    console.log(
      `حاجزُ عقدِ الإنهاءِ والتقييمِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keyCount} مفتاحاً في ثلاثةِ قواميسَ، وستُّ قواعدَ مقيسةً: لا مالَ، ولا مسافةَ تُدَّعى مقطوعةً، ومُعجَمُ وسومٍ واحدٌ، ولا مفتاحَ ناقصاً، ولا زرَّ لمسارٍ لم يُبنَ، ولا دالّةَ بلا نزعِ تنفيذٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ الإنهاءِ والتقييمِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
