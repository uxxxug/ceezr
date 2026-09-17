#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ مشاركةِ الرحلةِ العشرِ على المستودعِ الحقيقيِّ
 *   وإسقاطُ البناءِ عندَ نقضِ واحدةٍ (البند `F2-09` · `F12-04` · الحاجز `UX-023`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:ride-share` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` يُضيفُ مِلفَّ حمولتِه إلى `PUBLIC_FILES`.
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import { SHARE_DISCLOSED, SHARE_WITHHELD } from "../packages/domain/transport/ride-share.ts";
import { blankComments } from "./lib/blank-comments.ts";
import {
  AGE_CONSTANT_FILE,
  DOMAIN_FILE,
  PUBLIC_FILES,
  type RideShareContractInput,
  rideShareContractProblems,
  SHARE_ROUTE_FILE,
  SHARE_SQL_FILES,
  SHARE_SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/ride-share-contract.ts";

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

/**
 * يُقرأُ الثابتُ **نصّاً** لا باستيرادِه: الحاجزُ يقيسُ ما في المستودعِ، ولو
 * استوردَه لَقاسَ ما يُصرِّفُه المُصرِّفُ — وهما يفترقانِ يومَ يُعادُ تعريفُه.
 */
export function readMaxAgeSeconds(): number | null {
  const source = readFileSync(AGE_CONSTANT_FILE, "utf8");
  const match = source.match(/DRIVER_POSITION_MAX_AGE_SECONDS\s*=\s*(\d+)/);
  return match === null ? null : Number(match[1]);
}

/** وكذا مهلةُ ما بعدَ الرحلةِ (`F12-04`): تُقرأُ نصّاً من النطاقِ لا استيراداً. */
export function readGraceMinutes(): number | null {
  const source = readFileSync(DOMAIN_FILE, "utf8");
  const match = source.match(/TRACKING_LINK_GRACE_MINUTES\s*=\s*(\d+)/);
  return match === null ? null : Number(match[1]);
}

export function readRepository(): RideShareContractInput {
  const publicFiles: Record<string, string> = {};
  for (const path of PUBLIC_FILES) publicFiles[path] = blankComments(readFileSync(path, "utf8"));

  const surface: Record<string, string> = {};
  for (const path of SHARE_SURFACE_FILES) surface[path] = blankComments(readFileSync(path, "utf8"));

  const sqlFiles: Record<string, string> = {};
  for (const path of SHARE_SQL_FILES) sqlFiles[path] = readFileSync(path, "utf8");

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    publicFiles,
    surface,
    sqlFiles,
    route: blankComments(readFileSync(SHARE_ROUTE_FILE, "utf8")),
    domain: readFileSync(DOMAIN_FILE, "utf8"),
    maxAgeSeconds: readMaxAgeSeconds(),
    graceMinutes: readGraceMinutes(),
    translations,
    disclosure: { shown: SHARE_DISCLOSED, hidden: SHARE_WITHHELD },
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = rideShareContractProblems(input);
  if (problems.length === 0) {
    const codes = input.disclosure.shown.length + input.disclosure.hidden.length;
    console.log(
      `حاجزُ عقدِ مشاركةِ الرحلةِ: نجحَ — ${PUBLIC_FILES.length} مِلفَّ حمولةٍ عامّةٍ، و${SHARE_SQL_FILES.length} هجرةَ مشاركةٍ بحكمِ آخرِ مُعرِّفٍ، و${codes} رمزَ إفصاحٍ بنصوصِها الثلاثةِ، وعشرُ قواعدَ مقيسةً: لا هويّةَ لغريبٍ، ولا موضعَ بلا عُمرِه، وحدُّ عُمرٍ واحدٌ، ولا رمزَ في قراءةٍ، وحَكَمٌ واحدٌ في القاعدةِ، ولا مفتاحَ ناقصاً، ولا إفصاحَ بلا نصٍّ، ولا دالّةَ بلا نزعِ تنفيذٍ، والحياةُ حكمٌ لا رايةٌ، ومهلةٌ واحدةٌ بعدَ الرحلةِ.`,
    );
  } else {
    console.error("حاجزُ عقدِ مشاركةِ الرحلةِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
