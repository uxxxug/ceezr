#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ شاشةِ الرحلةِ النشطةِ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F2-06` · الحاجز `UX-022`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:active-ride` وسلسلةُ `ci` وخطوتانِ مُسمَّاتانِ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يُضيفُ مِلفَّ سطحِه إلى `SURFACE_FILES`.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ في اختبارٍ بمدخلاتٍ
 * مصنوعةٍ — والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import {
  type ActiveRideContractInput,
  activeRideContractProblems,
  CONTRACT_FILE,
  KEY_PREFIX,
  PORTS_FILE,
  SCREEN_FILE,
  SNAPSHOT_SQL_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/active-ride-contract.ts";
import { blankComments } from "./lib/blank-comments.ts";

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

export function readRepository(): ActiveRideContractInput {
  const surface: Record<string, string> = {};
  // التعليقُ يشرحُ المحظورَ بلفظِه، فلا يُقاسُ — وإلّا صارَ الشرحُ جُرماً.
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    sql: readFileSync(SNAPSHOT_SQL_FILE, "utf8"),
    ports: readFileSync(PORTS_FILE, "utf8"),
    contract: readFileSync(CONTRACT_FILE, "utf8"),
    screen: blankComments(readFileSync(SCREEN_FILE, "utf8")),
    translations,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = activeRideContractProblems(input);
  if (problems.length === 0) {
    const keyCount = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith(KEY_PREFIX),
    ).length;
    console.log(
      `حاجزُ عقدِ الرحلةِ النشطةِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keyCount} مفتاحاً في ثلاثةِ قواميسَ، وستُّ قواعدَ مقيسةً: لا مالَ، ولا سائقَ بلا إسنادٍ، ولا موضعَ بلا عُمرِه، ولا مفتاحَ ناقصاً، ولا زرَّ لمسارٍ لم يُبنَ، ولا دالّةَ بلا نزعِ تنفيذٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ الرحلةِ النشطةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
