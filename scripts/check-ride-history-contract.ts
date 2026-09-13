#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ سجلِّ الرحلاتِ وتفاصيلِ رحلةٍ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:ride-history` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` يُضيفُ مِلفَّ سطحِه إلى `SURFACE_FILES`
 *   ويُخرِجُ «المشاركةَ» من معجمِ المحظورِ **معَ مسارِها** لا قبلَه.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ في اختبارٍ بمدخلاتٍ
 * مصنوعةٍ — والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 * وهذا المِلفُّ **لا يحكمُ**: يقرأُ ويُمرِّرُ ويطبعُ.
 */

import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";
import {
  HISTORY_SQL_FILE,
  KEY_PREFIXES,
  type RideHistoryContractInput,
  rideHistoryContractProblems,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/ride-history-contract.ts";

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

export function readRepository(): RideHistoryContractInput {
  const surface: Record<string, string> = {};
  // التعليقُ يشرحُ المحظورَ بلفظِه، فلا يُقاسُ — وإلّا صارَ الشرحُ جُرماً.
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  // وتعليقُ الهجرةِ يُفرَّغُ كذلكَ: نصُّها يشرحُ **لماذا لا `offset`** بلفظِه،
  // فلو قُرِئَ لَسقطَ الحاجزُ على الشرحِ الذي يُثبِتُ التزامَه.
  return {
    surface,
    sql: blankSqlComments(readFileSync(HISTORY_SQL_FILE, "utf8")),
    translations,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = rideHistoryContractProblems(input);
  if (problems.length === 0) {
    const keyCount = Object.keys(input.translations.ar ?? {}).filter((key) =>
      KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ).length;
    console.log(
      `حاجزُ عقدِ السجلِّ والتفاصيلِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keyCount} مفتاحاً في ثلاثةِ قواميسَ، وثمانِ قواعدَ مقيسةً: لا مالَ، ولا خريطةَ موهومةً والغيابُ مُصرَّحٌ، ولا زرَّ لمسارٍ لم يُبنَ، ولا رقمَ غيرَ مقيسٍ، ولا ساعةَ جهازٍ، ولا ترقيمَ بإزاحةٍ، ولا مفتاحَ ناقصاً، ولا دالّةَ بلا نزعِ تنفيذٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ السجلِّ والتفاصيلِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
