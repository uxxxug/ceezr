#!/usr/bin/env bun
/**
 * الغرض: تشغيلُ قواعدِ عقدِ سطحِ الحسابِ على المستودعِ الحقيقيِّ وإسقاطُ البناءِ
 *   عندَ نقضِ واحدةٍ (`SD-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `SD-12`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:account-surface` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * يُتوقع أن يستخدمه لاحقاً: أيُّ دورٍ ثالثٍ — يُزادُ في `ACCOUNT_ROLES`.
 * الحاكم: docs/adr/0126-one-account-core-two-roles.md
 *
 * ولماذا القراءةُ ههنا والحكمُ في `lib`: كي يُقاسَ الحكمُ بمدخلاتٍ مصنوعةٍ —
 * والقاعدةُ التي لا حالةَ سلبيّةَ لها **غيرُ مُنفَذةٍ** (`ح-7`).
 */

import { readFileSync } from "node:fs";
import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ROLES,
  type AccountSurfaceContractInput,
  accountSurfaceContractProblems,
  ALLOWED_PLACEHOLDERS,
  CORE_FILES,
  DOMAIN_ERASURE_REFUSALS,
  DOMAIN_EXPORT_REFUSALS,
  DOMAIN_RETENTION_BASES,
  ERASURE_SQL_FILES,
  receiptSectionsFromSql,
  ROLE_SURFACE_FILES,
  TRANSLATION_FILES,
} from "./lib/account-surface-contract.ts";
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

export function readRepository(): AccountSurfaceContractInput {
  const core: Record<string, string> = {};
  for (const path of CORE_FILES) core[path] = blankComments(readFileSync(path, "utf8"));

  const roleSurfaces: Record<string, string> = {};
  for (const path of ROLE_SURFACE_FILES) {
    roleSurfaces[path] = blankComments(readFileSync(path, "utf8"));
  }

  const sqlByPath: Record<string, string> = {};
  for (const path of ERASURE_SQL_FILES) sqlByPath[path] = readFileSync(path, "utf8");

  const translations: Record<string, Readonly<Record<string, string>>> = {};
  for (const [language, path] of Object.entries(TRANSLATION_FILES)) {
    translations[language] = readJson(path);
  }

  return {
    core,
    roleSurfaces,
    sqlByPath,
    translations,
    roles: ACCOUNT_ROLES,
    retentionBases: DOMAIN_RETENTION_BASES,
    erasureRefusals: DOMAIN_ERASURE_REFUSALS,
    exportRefusals: DOMAIN_EXPORT_REFUSALS,
    errorCodes: ACCOUNT_ERROR_CODES,
    allowedPlaceholders: ALLOWED_PLACEHOLDERS,
  };
}

if (import.meta.main) {
  const input = readRepository();
  const problems = accountSurfaceContractProblems(input);
  const sections = receiptSectionsFromSql(input.sqlByPath);
  if (problems.length === 0) {
    console.log(
      `حاجزُ عقدِ سطحِ الحسابِ: نجحَ — ${ACCOUNT_ROLES.length} دورَ حسابٍ ` +
        `(${ACCOUNT_ROLES.map((role) => role.keyPrefix).join(" · ")})، ` +
        `و${sections.length} قسمَ إيصالٍ مقروءاً من ${ERASURE_SQL_FILES.length} هجرةِ محوٍ، ` +
        `و${DOMAIN_RETENTION_BASES.length} أساسَ إبقاءٍ و${DOMAIN_ERASURE_REFUSALS.length} رفضَ محوٍ ` +
        `و${DOMAIN_EXPORT_REFUSALS.length} رفضَ تنزيلٍ و${ACCOUNT_ERROR_CODES.length} رمزَ عطبٍ ` +
        `بنصوصِها الثلاثةِ، وثمانِ قواعدَ مقيسةً: لا رمزَ بلا نصٍّ، ولا قسمَ بلا نصٍّ، ` +
        `ولا مفتاحَ بلا مقابلٍ، وسقوطٌ للمجهولِ، ولا نسخةَ مجالٍ في سطحٍ، ` +
        `ولا دورَ في اللبِّ، وبادئةٌ تنتهي بنقطةٍ، ولا نائبَ مجهولاً.`,
    );
  } else {
    console.error("حاجزُ عقدِ سطحِ الحسابِ: سقطَ.");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
