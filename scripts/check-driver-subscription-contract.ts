#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ اشتراكِ السائقِ على المستودعِ الحقيقيِّ وإسقاطُ
 *   البناءِ عندَ نقضِ واحدةٍ (البند `F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: scripts
 * يُستخدم من: سلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يحرسُه: tests/unit/check-driver-subscription-contract.test.ts
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { blankComments } from "./lib/blank-comments.ts";
import {
  APPLICATION_FILE,
  DOMAIN_FILE,
  driverSubscriptionContractProblems,
  ROUTE_FILE,
  SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/driver-subscription-contract.ts";

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

export function readRepository() {
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
    route: blankComments(readFileSync(ROUTE_FILE, "utf8")),
    translations,
  };
}

function main(): void {
  const input = readRepository();
  const problems = driverSubscriptionContractProblems(input);
  if (problems.length === 0) {
    const keys = Object.keys(input.translations.ar ?? {}).filter((key) =>
      key.startsWith("driver.subscription."),
    ).length;
    console.log(
      `حاجزُ عقدِ اشتراكِ السائقِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، و${keys} مفتاحَ نصٍّ بثلاثِ لغاتٍ، وخمسُ قواعدَ مقيسةً: لا سعرَ مرمَّزٌ، والتأهيلُ من الرمزِ الموقَّعِ، والتجديدُ حاضرٌ ويفشلُ مُغلَقاً، وتاريخُ الدفعِ معروضٌ، ولكلِّ رمزٍ نصُّه.`,
    );
    return;
  }
  console.error("حاجزُ عقدِ اشتراكِ السائقِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
