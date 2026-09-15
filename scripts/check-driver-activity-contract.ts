#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ حصيلةِ السائقِ على المستودعِ الحقيقيِّ وإسقاطُ البناءِ
 *   عندَ نقضِ واحدةٍ (البند `F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:driver-activity` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ شاشةِ أرقامٍ تُعرَضُ على مُشتَغِلٍ.
 * يحرسُه: tests/unit/check-driver-activity-contract.test.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";
import {
  APPLICATION_FILE,
  DOMAIN_FILE,
  type DriverActivityContractInput,
  driverActivityContractProblems,
  KEY_PREFIX,
  MIGRATION_FILE,
  ROUTE_FILE,
  STORE_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/driver-activity-contract.ts";

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

export function readRepository(): DriverActivityContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    domain: blankComments(readFileSync(DOMAIN_FILE, "utf8")),
    application: blankComments(readFileSync(APPLICATION_FILE, "utf8")),
    store: blankComments(readFileSync(STORE_FILE, "utf8")),
    route: blankComments(readFileSync(ROUTE_FILE, "utf8")),
    migrationSql: blankSqlComments(readFileSync(MIGRATION_FILE, "utf8")),
    translations,
  };
}

function main(): void {
  const input = readRepository();
  const problems = driverActivityContractProblems(input);
  if (problems.length === 0) {
    const keys = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith(KEY_PREFIX),
    ).length;
    console.log(
      `حاجزُ عقدِ حصيلةِ السائقِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keys} مفتاحَ نصٍّ بثلاثِ لغاتٍ، وتسعُ قواعدَ مقيسةً: المقامُ يُنشَرُ ويُوصَفُ ويُعرَضُ، ولا مبلغَ مُخترَعاً والغيابُ مُعلَنٌ بأساسِه، ولا رقمَ يرتدُّ إلى صفرٍ، وحُكمُ العرضِ دالّةٌ نقيّةٌ، وعواملُ الترتيبِ وأثرُ السلوكِ من الخادمِ، ولا هويّةَ راكبٍ في الشريحةِ، والمسافةُ موسومةٌ بأساسِها، والنافذةُ بمنطقةِ زمنٍ منشورةٍ، ولكلِّ رمزٍ نصُّه.`,
    );
    return;
  }
  console.error("حاجزُ عقدِ حصيلةِ السائقِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
