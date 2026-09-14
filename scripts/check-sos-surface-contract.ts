#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ سطحِ الاستغاثةِ على المستودعِ الحقيقيِّ وإسقاطُ
 *   البناءِ عندَ نقضِ واحدةٍ (البند `F2-10` · `SR-14` · الحاجز `UX-024`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:sos-surface` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ يُضيفُ مِلفّاتَه إلى `SURFACE_FILES`.
 * الحاكم: docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { blankComments } from "./lib/blank-comments.ts";
import {
  DISCLOSURE_CODES,
  SOS_ROUTE_FILE,
  SOS_SQL_FILE,
  type SosSurfaceContractInput,
  SURFACE_FILES,
  sosSurfaceContractProblems,
  TRANSLATION_FILES,
} from "./lib/sos-surface-contract.ts";

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

export function readRepository(): SosSurfaceContractInput {
  const surface: Record<string, string> = {};
  for (const path of SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    surface,
    sql: readFileSync(SOS_SQL_FILE, "utf8"),
    route: blankComments(readFileSync(SOS_ROUTE_FILE, "utf8")),
    translations,
    disclosureCodes: DISCLOSURE_CODES,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = sosSurfaceContractProblems(input);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ سطحِ الاستغاثةِ: نجحَ — ${SURFACE_FILES.length} مِلفَّ سطحٍ، ` +
        `و${DISCLOSURE_CODES.length} رمزَ إفصاحٍ بنصوصِها الثلاثةِ، وستُّ قواعدَ مقيسةً: ` +
        `لا وعدَ اتّصالٍ، ولا رمزَ بلا نصٍّ، ونفيُ الاتّصالِ منشورٌ، ` +
        `ولا ساعةَ جهازٍ في العُمرِ، ولا مُعرِّفَ طلبٍ من الشاشةِ، ولا دالّةَ بلا نزعِ تنفيذٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ سطحِ الاستغاثةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
