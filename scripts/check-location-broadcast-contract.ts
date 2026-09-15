#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ بثِّ موقعِ السائقِ على المستودعِ الحقيقيِّ وإسقاطُ
 *   البناءِ عندَ نقضِ واحدةٍ (البند `F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:location-broadcast` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ بثٍّ دوريٍّ آخرَ يُضيفُ مِلفَّ سطحِه ههنا.
 * يحرسُه: tests/unit/check-location-broadcast-contract.test.ts
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";
import {
  CONTRACT_FILE,
  DOMAIN_FILE,
  KEY_PREFIX,
  type LocationBroadcastContractInput,
  locationBroadcastContractProblems,
  MIGRATION_FILE,
  ROUTE_FILE,
  STORE_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/location-broadcast-contract.ts";

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

export function readRepository(): LocationBroadcastContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    domain: blankComments(readFileSync(DOMAIN_FILE, "utf8")),
    store: blankComments(readFileSync(STORE_FILE, "utf8")),
    route: blankComments(readFileSync(ROUTE_FILE, "utf8")),
    contract: blankComments(readFileSync(CONTRACT_FILE, "utf8")),
    migrationSql: blankSqlComments(readFileSync(MIGRATION_FILE, "utf8")),
    translations,
  };
}

function main(): void {
  const input = readRepository();
  const problems = locationBroadcastContractProblems(input);
  if (problems.length === 0) {
    const keys = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith(KEY_PREFIX),
    ).length;
    console.log(
      `حاجزُ عقدِ بثِّ الموقعِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keys} مفتاحَ نصٍّ بثلاثِ لغاتٍ، وثمانُ قواعدَ مقيسةً: الكتلةُ منشورةٌ في الجذرِ في المَخرجَينِ، ولا مُدّةَ مُخترَعةً ولا اسمَ إعدادٍ في عميلٍ، ولا غيابَ يُقرأُ صفراً وكتلةٌ مُشوَّهةٌ تُسقِطُ القراءةَ، والقرارُ دالّةٌ نقيّةٌ بلا ساعةٍ ولا مؤقّتٍ، والسببُ من الخادمِ لا من مقارنةِ حالةٍ، والتراجعُ بسقفٍ مُصرَّحٍ ورموزٌ قاتلةٌ تُوقِفُ، ومُرسِلٌ واحدٌ إلى مسارِ F4-01 القائمِ، ولكلِّ سببِ بثٍّ وسكونٍ نصُّه.`,
    );
    return;
  }
  console.error("حاجزُ عقدِ بثِّ الموقعِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
