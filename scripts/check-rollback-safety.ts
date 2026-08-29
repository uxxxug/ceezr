#!/usr/bin/env bun
/**
 * # حاجزُ مسارِ العودة — لا تضييقَ في المخطّطِ بلا مسارِ عودةٍ مُعلَنٍ وموثَّقٍ
 *
 * **الغرض:** يفرض البندَ `OPS-010` («كلُّ نشرٍ له مسارُ عودةٍ مُختبَرٌ لا يكسر
 * المخطّطَ») بأربعِ قواعدَ تُقرأ من المستودعِ لا من ذاكرةِ كاتبٍ:
 * ١) كلُّ تغييرٍ مُضيِّقٍ في الهجراتِ **مُعلَنٌ** في `rollback-registry.ts`.
 * ٢) وكلُّ مدخلٍ في السجلِّ **يقابله تضييقٌ قائمٌ** — فلا مدخلَ ميّتاً يُطمئن كذباً.
 * ٣) ومدخلٌ يقول «يكسر نسخةً سابقةً» **يلزمه** نشرٌ مقرونٌ وإجراءٌ موثَّقٌ بعنوانٍ
 *    مُطابَقٍ حرفياً في `docs/rollback.md`.
 * ٤) و`code-only`/`expand-contract` **لا يجتمعان** مع «يكسر نسخةً سابقةً»؛ فلا
 *    يُوسَم كسرٌ بأنّه آمنٌ.
 * ثمّ يتحقّق أنّ النشرَ **بأمرٍ لا تلقائيٌّ** (`autoDeploy: false`) لأنّ النشرَ
 * المقرونَ لا يُضمَن مع نشرٍ تلقائيٍّ بكلِّ دفعةٍ.
 *
 * **الحالة:** `OPS-010` — مُنفَّذ · مُختبَر (ADR 0047) · وله برهانُ سقوطٍ في
 * `docs/evidence/correctness/OPS-010-20260830.md`.
 *
 * **ينتمي إلى:** سلسلةَ `bun run ci` · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ هجرةٍ جديدةٍ تمرّ به قبلَ الدمج.
 *
 * **ملاحظات مستقبلية:** التحقّقُ من أنّ العودةَ **تعمل فعلاً** ليس ههنا بل في
 * `scripts/rollback-schema-drill.ts` على قاعدةٍ حقيقيةٍ؛ وهذا الحاجزُ يقرأ نصّاً.
 *
 * **ما لا يفعله هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يمنع التضييقَ.** التضييقُ لازمٌ أحياناً؛ الممنوعُ أن يكون **صامتاً**.
 * - **لا يقرأ تاريخَ `git` ولا الوسومَ.** «النسخةُ السابقةُ» عندَه إعلانُ كاتبِ
 *   المدخلِ لا استنتاجٌ؛ والحاجزُ يفرض **اتّساقَ** الإعلانِ لا صدقَه.
 * - **لا يلمس قاعدةً.** ولا يعرف ما في الإنتاجِ.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findRollbackRisks,
  type MigrationSource,
  riskTag,
  type SchemaChange,
  uniqueRiskTags,
} from "./lib/rollback-audit.ts";
import {
  CRITICAL_PATHS,
  declarationTag,
  ROLLBACK_DECLARATIONS,
  ROLLBACK_OWNERS,
  ROLLBACK_PATHS,
  type RollbackDeclaration,
} from "./lib/rollback-registry.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const ROLLBACK_DOC = "docs/rollback.md";
const RENDER_FILE = "render.yaml";

/** أقسامٌ لا تكون الوثيقةُ وثيقةَ عودةٍ بلا واحدٍ منها. */
const REQUIRED_DOC_SECTIONS = [
  "وحدةُ النشرِ ووحدةُ العودة",
  "أمرُ العودة",
  "قاعدةُ المخطّطِ: توسيعٌ ثمّ تقليصٌ",
  "شجرةُ القرارِ عندَ فشلِ نشرٍ",
  "ما لا يُغطّيه هذا المسار",
] as const;

export function readMigrations(root: string): readonly MigrationSource[] {
  const dir = join(root, MIGRATIONS_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ file: name, sql: readFileSync(join(dir, name), "utf8") }));
}

export interface AuditInput {
  readonly risks: readonly SchemaChange[];
  readonly declarations: readonly RollbackDeclaration[];
  readonly migrationFiles: readonly string[];
  readonly rollbackDoc: string | null;
  readonly renderFile: string | null;
}

/** كلُّ المخالفاتِ تُجمَع ثمّ تُطبَع مرّةً واحدةً: قارئُ البلاغِ يرى الصورةَ كاملةً. */
export function auditRollbackSafety(input: AuditInput): readonly string[] {
  const violations: string[] = [];
  const riskTags = uniqueRiskTags(input.risks);
  const riskSet = new Set(riskTags);
  const declared = new Map<string, RollbackDeclaration>();

  for (const declaration of input.declarations) {
    const tag = declarationTag(declaration);
    if (declared.has(tag)) {
      violations.push(`مدخلٌ مكرّرٌ في السجلِّ: ${tag} — والمدخلُ الواحدُ لتغييرٍ واحدٍ.`);
      continue;
    }
    declared.set(tag, declaration);

    if (!input.migrationFiles.includes(declaration.migration)) {
      violations.push(
        `${declaration.migration}: مُعلَنٌ في السجلِّ ولا ملفَّ هجرةٍ بهذا الاسمِ — سجلٌّ يشير إلى معدومٍ.`,
      );
    }
    if (!ROLLBACK_PATHS.includes(declaration.rollbackPath)) {
      violations.push(`${tag}: مسارُ عودةٍ خارجَ القائمةِ المغلقةِ (${declaration.rollbackPath}).`);
    }
    if (!ROLLBACK_OWNERS.includes(declaration.owner)) {
      violations.push(`${tag}: مالكٌ خارجَ القائمةِ المغلقةِ (${declaration.owner}).`);
    }
    if (declaration.criticalPath !== null && !CRITICAL_PATHS.includes(declaration.criticalPath)) {
      violations.push(`${tag}: مسارٌ حرجٌ خارجَ القائمةِ المغلقةِ (${declaration.criticalPath}).`);
    }
    if (declaration.why.trim().length < 40) {
      violations.push(`${tag}: السببُ أقصرُ من أن يُقرأ وحدَه — والسجلُّ يُقرأ بلا الهجرة.`);
    }

    if (declaration.breaksPreviousRelease) {
      if (declaration.rollbackPath !== "forward-only") {
        violations.push(
          `${tag}: يكسر نسخةً سابقةً ومسارُه «${declaration.rollbackPath}» — والكسرُ لا يُوسَم آمناً.`,
        );
      }
      if (!declaration.coupledDeploy) {
        violations.push(
          `${tag}: يكسر نسخةً سابقةً بلا نشرٍ مقرونٍ — فصلُ الشيفرةِ عن المخطّطِ ههنا يُنتِج نشراً بلا عودةٍ.`,
        );
      }
      if (declaration.documentedIn === null) {
        violations.push(`${tag}: يكسر نسخةً سابقةً ولا إجراءَ موثَّقاً له في ${ROLLBACK_DOC}.`);
      }
    } else if (declaration.documentedIn !== null) {
      violations.push(
        `${tag}: عنوانٌ موثَّقٌ لتغييرٍ لا يكسر شيئاً — عنوانٌ ميّتٌ في الوثيقةِ يُوهِم إجراءً لا لزومَ له.`,
      );
    }

    if (!riskSet.has(tag)) {
      violations.push(
        `${tag}: مدخلٌ في السجلِّ ولا تضييقَ يقابله في الهجراتِ — يُحذَف، فالمدخلُ الميّتُ يُطمئن كذباً.`,
      );
    }
  }

  for (const tag of riskTags) {
    if (declared.has(tag)) continue;
    const risk = input.risks.find((candidate) => riskTag(candidate) === tag);
    const where = risk === undefined ? "" : ` (سطر ${risk.line})`;
    violations.push(
      `${tag}${where}: تضييقٌ في المخطّطِ غيرُ مُعلَنٍ في ${"scripts/lib/rollback-registry.ts"} — يُعلَن مسارُ عودتِه أو لا يُدمَج.`,
    );
  }

  if (input.rollbackDoc === null) {
    violations.push(`${ROLLBACK_DOC}: لا وثيقةَ عودةٍ — والبندُ يطلب مساراً **موثَّقاً**.`);
  } else {
    for (const section of REQUIRED_DOC_SECTIONS) {
      if (!input.rollbackDoc.includes(section)) {
        violations.push(`${ROLLBACK_DOC}: ينقصه القسمُ «${section}».`);
      }
    }
    if (!input.rollbackDoc.includes("render rollback")) {
      violations.push(`${ROLLBACK_DOC}: لا أمرَ عودةٍ حرفياً — إجراءٌ بلا أمرٍ لا يُنفَّذ تحتَ ضغطٍ.`);
    }
    for (const declaration of input.declarations) {
      if (declaration.documentedIn === null) continue;
      if (!input.rollbackDoc.includes(declaration.documentedIn)) {
        violations.push(
          `${ROLLBACK_DOC}: ينقصه العنوانُ «${declaration.documentedIn}» المُشار إليه من السجلِّ.`,
        );
      }
      if (!input.rollbackDoc.includes(declaration.migration)) {
        violations.push(
          `${ROLLBACK_DOC}: لا يُسمّي الهجرةَ ${declaration.migration} وهي تكسر نسخةً سابقةً.`,
        );
      }
    }
  }

  const coupled = input.declarations.some((declaration) => declaration.coupledDeploy);
  if (coupled) {
    if (input.renderFile === null) {
      violations.push(`${RENDER_FILE}: لم يُقرأ — ولا يُتحقّق نشرٌ مقرونٌ بلا وصفِ نشرٍ.`);
    } else if (!/autoDeploy:\s*false/.test(input.renderFile)) {
      violations.push(
        `${RENDER_FILE}: نشرٌ مقرونٌ مُعلَنٌ في السجلِّ و\`autoDeploy\` ليس \`false\` — النشرُ التلقائيُّ يفصل الشيفرةَ عن المخطّطِ بلا قرارٍ.`,
      );
    }
  }

  return violations;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function main(): void {
  const root = process.cwd();
  if (!existsSync(join(root, MIGRATIONS_DIR))) {
    console.error(`✗ لم يُقرأ ${MIGRATIONS_DIR} — ولا يُتحقّق مسارُ عودةٍ بلا هجرات.`);
    process.exit(1);
  }
  const migrations = readMigrations(root);
  if (migrations.length === 0) {
    console.error(`✗ لا ملفَّ هجرةٍ واحداً في ${MIGRATIONS_DIR} — القراءةُ معطوبةٌ.`);
    process.exit(1);
  }

  const risks = findRollbackRisks(migrations);
  const violations = auditRollbackSafety({
    risks,
    declarations: ROLLBACK_DECLARATIONS,
    migrationFiles: migrations.map((migration) => migration.file),
    rollbackDoc: readOrNull(join(root, ROLLBACK_DOC)),
    renderFile: readOrNull(join(root, RENDER_FILE)),
  });

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} مخالفةً في مسارِ العودة (OPS-010):\n`);
    for (const violation of violations) console.error(`  • ${violation}\n`);
    process.exit(1);
  }

  const tags = uniqueRiskTags(risks);
  const breaking = ROLLBACK_DECLARATIONS.filter((entry) => entry.breaksPreviousRelease);
  console.log(
    `✅ مسارُ العودةِ مُعلَنٌ لكلِّ تضييقٍ: ${migrations.length} هجرةً · ${tags.length} تضييقاً مُعلَناً، ` +
      `منها ${breaking.length} يكسر نسخةً سابقةً ولكلٍّ منها إجراءٌ موثَّقٌ ونشرٌ مقرونٌ.`,
  );
  for (const entry of breaking) {
    console.log(
      `⚠ ${entry.migration} — ${entry.change}: ${entry.rollbackPath}، مالكُه ${entry.owner}.`,
    );
  }
}

if (import.meta.main) main();
