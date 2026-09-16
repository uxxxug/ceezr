#!/usr/bin/env bun
/**
 * الغرض: بوّابةُ CI لـ`SEC-12` — **تكتشفُ** من ملفّاتِ الهجراتِ كلَّ دالَّةٍ تحكُمُ
 *   بدورٍ مُتسلِّطٍ وتكتبُ في المحرِّكِ، وتُطابِقُها بسِجلِّ الأفعالِ المُدقَّقةِ
 *   المغلقِ، وتشترطُ أثراً في `audit_log` باسمِ فعلٍ **مُعلَنٍ**.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-12` من `F8-08`).
 * ينتمي إلى: scripts
 * الحاكم: ADR 0136 · `ح-7`
 *
 * لا يُؤمِّنُ هذا الحاجزُ صفَّ تدقيقٍ. يمنعُ **فعلاً مُتسلِّطاً جديداً يُولَدُ بلا
 * أثرٍ** ولا شيءَ يكشفُه — وذاكَ عطبٌ لا يُخفِقُ اختباراً ولا يُبطِئُ طلباً، ولا
 * يُكتَشَفُ إلّا يومَ يُسألُ «مَن فعلَ هذا؟» فلا يُوجَدُ جوابٌ.
 *
 * ولِمَ تُقرأُ الهجراتُ لا الكاتالوجُ الحيُّ: البوّابةُ تعملُ في وظيفةِ `verify`
 * **بلا قاعدةٍ**، والهجراتُ هيَ مصدرُ الحقيقةِ الذي يُراجَعُ في الطلبِ. وأمّا أنَّ
 * المحرِّكَ يُطابِقُ الهجراتِ فيُقاسُ على قاعدةٍ حقيقيّةٍ في
 * `tests/integration/audit-trail-authority.test.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS,
  AUDITED_PRIVILEGED_ACTIONS,
  auditActionViolations,
  describeAuditViolation,
  type FunctionDefinitionFacts,
} from "./lib/audit-actions-registry.ts";

const repoRoot = resolve(import.meta.dir, "..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");

/**
 * يلتقطُ كلَّ `create [or replace] function public.name(…) … $tag$ … $tag$`.
 * والملفّاتُ تُقرأُ **بترتيبِ الطابعِ الزمنيِّ**، فآخرُ تعريفٍ لاسمٍ يغلِبُ ما قبلَه
 * — وهوَ ما يفعلُهُ المحرِّكُ نفسُه عندَ `or replace`.
 */
const DEFINITION_PATTERN =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi;

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const latest = new Map<string, FunctionDefinitionFacts>();
for (const file of files) {
  const source = readFileSync(resolve(migrationsDir, file), "utf8");
  for (const match of source.matchAll(DEFINITION_PATTERN)) {
    const fn = match[1];
    const body = match[3];
    if (fn === undefined || body === undefined) continue;
    latest.set(fn, { fn, migration: file, body });
  }
}

const definitions = [...latest.values()];
const violations = auditActionViolations(definitions);

if (violations.length > 0) {
  console.error(`✗ أثرُ الأفعالِ المُتسلِّطةِ (SEC-12): ${violations.length} خرقاً.`);
  for (const violation of violations) {
    console.error(describeAuditViolation(violation));
  }
  process.exit(1);
}

const actionCount = AUDITED_PRIVILEGED_ACTIONS.reduce(
  (total, entry) => total + entry.actions.length,
  0,
);

console.log(
  `✓ SEC-12: ${definitions.length} تعريفَ دالَّةٍ مقروءاً من ${files.length} هجرةً — ` +
    `${AUDITED_PRIVILEGED_ACTIONS.length} دالَّةَ فاعلٍ مُتسلِّطٍ كلُّها تكتبُ أثراً ` +
    `بـ${actionCount} اسمَ فعلٍ مُعلَنٍ مُطابِقاً لِما يُكتَبُ، و` +
    `${AUDIT_EXEMPT_PRIVILEGED_FUNCTIONS.length} إعفاءً بسببٍ مكتوبٍ.`,
);
console.log(
  "  ولا يُدَّعى أنَّ الصفَّ يُكتَبُ فعلاً: هذا قياسُ نصِّ الهجرةِ. أثرُ النجاحِ " +
    "وصمتُ الرفضِ يُقاسانِ على قاعدةٍ حقيقيّةٍ في audit-trail-authority.test.ts.",
);
console.log(
  "  ولا يُدَّعى شمولُ أفعالِ المستخدمِ على بياناتِ نفسِه — فجوةٌ باقيةٌ مُسمّاةٌ: " +
    "record_user_consent · update_driver_vehicle · update_driver_vehicle_assets.",
);
