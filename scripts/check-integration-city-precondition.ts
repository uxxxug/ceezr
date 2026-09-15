#!/usr/bin/env bun
/**
 * # الحاجزُ: لا اختبارَ تكاملٍ يستعيرُ شرطَه المسبقَ — `OPS-019`
 *
 * **الغرض:** قراءةُ القرصِ ومناداةُ الحَكَمِ. لا قاعدةَ حكمٍ في هذا الملفِّ —
 * القواعدُ كلُّها في `scripts/lib/city-precondition-audit.ts` كي تُزرَعَ فيها
 * حالاتُ السقوطِ بلا كتابةِ ملفٍّ على القرصِ.
 *
 * **الحالة:** `OPS-019` — مُنفَّذ · مُختبَر (`ADR 0116`).
 *
 * **ينتمي إلى:** الحجزُ `OPS-019` في `ROADMAP.md`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** خطوةٌ مسمّاةٌ في وظيفةِ `verify` وفي سلسلةِ
 * `ci` في `package.json`.
 *
 * **ملاحظات مستقبلية:** إن صارَ في المستودَعِ أكثرُ من معينِ شرطٍ مسبقٍ
 * (مركبةٌ، سائقٌ، اشتراكٌ) فالأمتنُ سجلٌّ واحدٌ لها لا حاجزٌ لكلِّ واحدٍ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AuditedFile,
  auditCityPrecondition,
  type CityPreconditionInput,
  HELPER_PATH,
  type PreconditionExemption,
} from "./lib/city-precondition-audit.ts";

const INTEGRATION_DIR = "tests/integration";

/**
 * سجلُّ الإعفاءاتِ المُعلَنةِ — **فارغٌ بقصدٍ**.
 *
 * وفراغُه ليسَ إهمالاً: القاعدةُ ٥ تُسقِطُ البناءَ على إعفاءٍ ميّتٍ، فوضعُ
 * مُدخلٍ «احتياطاً» يُخفِقُ فوراً. ومن احتاجَ إعفاءً كتبَه بسببِه ومالكِه
 * ههنا، فيُقرأُ في المراجعةِ سطراً واحداً لا يُبحَثُ عنه في ثمانيةِ ملفّاتٍ.
 */
export const EXEMPTIONS: readonly PreconditionExemption[] = [];

/**
 * قراءةُ المستودعِ كما هوَ — مُصدَّرةٌ كي يُنادِيَها اختبارُ الوحدةِ فيحكُمَ على
 * الشِّفرةِ الحقيقيّةِ لا على مُصنَّعٍ فقط (كما في `check-css-class-coverage.ts`).
 */
export function readRepository(): CityPreconditionInput {
  const names = readdirSync(INTEGRATION_DIR).filter((n) => n.endsWith(".test.ts"));
  const integrationFiles: AuditedFile[] = names.sort().map((name) => ({
    path: `${INTEGRATION_DIR}/${name}`,
    source: readFileSync(join(INTEGRATION_DIR, name), "utf8"),
  }));
  let helper: string | undefined;
  try {
    helper = readFileSync(HELPER_PATH, "utf8");
  } catch {
    helper = undefined;
  }
  return { integrationFiles, helper, exemptions: EXEMPTIONS };
}

function main(): void {
  let input: CityPreconditionInput;
  try {
    input = readRepository();
  } catch {
    console.error(`✗ لا يُقرأُ المجلَّدُ ${INTEGRATION_DIR} — وغيابُه لا يُقرأُ نجاحاً.`);
    process.exit(1);
  }
  const integrationFiles = input.integrationFiles;
  if (integrationFiles.length === 0) {
    console.error(`✗ لا ملفَّ اختبارٍ واحدٌ في ${INTEGRATION_DIR} — حاجزٌ بلا محروسٍ أخضرُ كاذبٌ، فيُخفِقُ.`);
    process.exit(1);
  }

  const violations = auditCityPrecondition(input);

  if (violations.length > 0) {
    console.error(
      `✗ الشرطُ المسبقُ للمدينةِ المفعَّلةِ (\`OPS-019\`): ${violations.length} خرقاً في ${integrationFiles.length} ملفّاً\n`,
    );
    for (const v of violations) {
      console.error(`  [القاعدةُ ${v.rule}] ${v.path}\n      ${v.message}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ الشرطُ المسبقُ للمدينةِ المفعَّلةِ (\`OPS-019\`): ${integrationFiles.length} ملفّاً — ` +
      `لا شرطَ مُستعارٌ، ولا تفعيلَ بلا ردٍّ، ولا إعفاءَ ميّتٌ.`,
  );
}

if (import.meta.main) main();
