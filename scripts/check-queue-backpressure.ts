#!/usr/bin/env bun
/**
 * # حاجزُ الضغطِ العكسيِّ — لا طابورَ يُولَدُ بلا حدودٍ، ولا حدَّ يُعلَنُ بلا موضعٍ
 *
 * **الغرض:** يفرضُ البندَ `F6-06` والقسمَ ١٤ من الخارطةِ («DLQ لكلِّ طابورٍ، ولا
 * إعادةَ محاولةٍ بلا حدٍّ») بخمسِ قواعدَ تُقرأُ من المستودعِ لا من نيّةِ كاتبٍ:
 *
 * ١) **كلُّ جدولٍ بنيتُه بنيةُ طابورٍ صامدٍ مُعلَنٌ**: إمّا في `DURABLE_QUEUES`
 *    بحدودِه الستّةِ، وإمّا في `RETIRED_QUEUES` بتاريخِ تقاعُدِه. وبنيةُ الطابورِ
 *    تُعرَفُ بالبناءِ لا بالتسميةِ: `attempts` و`claim_token` و`next_attempt_at`
 *    معاً في جدولٍ واحدٍ تعني أنَّ صفوفَه تُحجَزُ وتُعادُ وتموتُ — أي طابورٌ.
 *    وهذه هيَ القاعدةُ التي تجعلُ «لكلِّ طابورٍ» قابلاً للتحقّقِ: طابورٌ خامسٌ
 *    يُولَدُ غداً بلا حدودٍ يُسقِطُ CI في اللحظةِ نفسِها لا بعدَ حادثةٍ.
 *
 * ٢) **الطابورُ المتقاعدُ متقاعدٌ فعلاً**: لا `insert into` فيه في أيِّ هجرةٍ
 *    تالية لتاريخِ تقاعُدِه. فالتقاعدُ دعوى، ومن أعادَ الكتابةَ في جدولٍ مُعلَنٍ
 *    متقاعداً أعادَ طابوراً بلا ضغطٍ عكسيٍّ **وبقيَ الحاجزُ راضياً** لو لم تُفحَص
 *    الدعوى. والقاعدةُ منصوصةٌ على الهجراتِ لا على الشيفرةِ لأنَّ الكتابةَ في
 *    هذه الجداولِ كانت وتبقى داخلَ دوالِّ القاعدةِ.
 *
 * ٣) **كلُّ حدٍّ يسكنُ موضعاً حقيقيّاً**: مفتاحُ `platform_settings` مبذورٌ في
 *    هجرةٍ، وثابتُ الشيفرةِ مُصدَّرٌ من وحدتِه فعلاً. إعلانُ موضعٍ فارغٍ أسوأُ من
 *    غيابِ الإعلانِ: يُقرأُ في المراجعةِ تغطيةً وهوَ فراغٌ.
 *
 * ٤) **قائمةُ الأصنافِ القابلةِ للتأجيلِ متطابقةٌ في الطرفَينِ**: في TypeScript
 *    وفي دالّةِ `notification_kind_is_deferrable` في القاعدةِ. التكرارُ مقصودٌ —
 *    القاعدةُ تُنفِّذُ داخلَ المعاملةِ والشيفرةُ تُفسِّرُ وتقيسُ — **والتكرارُ بلا
 *    حارسٍ هوَ الافتراقُ نفسُه**. وهيَ مرآةُ القاعدةِ ٣ في حاجزِ `F6-05`.
 *
 * ٥) **ولا صنفٌ قابلٌ للتأجيلِ خارجَ أنواعِ الصندوقِ**: مُدخلٌ ميّتٌ يُقرأُ رخصةً
 *    سارية.
 *
 *    ولا يُفحَصُ ههنا أنَّ المؤجَّلَ «غيرُ حرجٍ» بقناةِ `F6-05`: قناةُ `critical`
 *    هناكَ تعني **مسلكَ التسليمِ** (تيليجرام مقابلَ مركزِ الإشعاراتِ) لا الرتبةَ،
 *    والأنواعُ الأحدَ عشرَ كلُّها مُعلَنةٌ `critical` عن قصدٍ. فقراءتُها رتبةً
 *    ههنا كانت ستَخلِطُ معنيَينِ وتمنعَ تأجيلَ البثِّ الذي أمرَ به القسمُ ١٥
 *    نصّاً. والرتبةُ الحقيقيّةُ عملُ `F6-07`، وحتّى ذلكَ تُقرأُ القائمةُ صريحةً
 *    بالأسماءِ ويُراجَعُ كلُّ اسمٍ فيها بيدِ مراجعٍ لا بقاعدةٍ مُشتَقّةٍ.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً.** يقرأُ نصَّ الهجراتِ والشيفرةِ. أنَّ المُطلِّبَ يُؤجِّلُ
 *   فعلاً، وأنَّ سقفَ التزامنِ يمنعُ التقاطاً، يُثبَتُ في اختبارِ تكاملٍ على
 *   PostgreSQL حقيقيٍّ لا ههنا.
 * - **لا يحكمُ على صوابِ رقمٍ.** أنَّ السعةَ خمسةُ آلافٍ حكمُ تشغيلٍ يُعايَرُ
 *   بالقياسِ (`F10-05`)؛ المفروضُ ههنا أن يكونَ الرقمُ **مُعلَناً في موضعٍ واحدٍ**،
 *   لا أن يكونَ صواباً.
 * - **لا يفحصُ الأولويّةَ.** رتبةُ الأصنافِ الأحدَ عشرَ حاجزُها
 *   `scripts/check-traffic-priority.ts` (`F6-07`). وما يفحصُه ههنا أنَّ **قائمةَ
 *   التأجيلِ** متطابقةٌ في الطرفَينِ — وقد صارَت (`F6-07`) تُشتَقُّ من الرتبةِ
 *   في الطرفَينِ كليهما، فالمُقابلةُ باقيةٌ لأنَّ الاشتقاقَينِ من مصدرَينِ
 *   مستقلَّينِ (ثابتُ كودٍ ، ونصُّ SQL) لا من مصدرٍ واحدٍ يُقارَنُ بنفسِه.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKPRESSURE_DIMENSIONS } from "../packages/application/scheduling/queue-backpressure.ts";
import { NOTIFICATION_KINDS } from "../packages/shared/config/notification-kinds.ts";
import {
  DEFERRABLE_UNDER_BACKPRESSURE_KINDS,
  DURABLE_QUEUES,
  QUEUE_BACKPRESSURE_DECLARATIONS,
  RETIRED_QUEUES,
} from "../packages/shared/config/queue-backpressure.ts";
import { deferrableKindsFromMigrations } from "./lib/traffic-priority-sql.ts";

const MIGRATIONS_DIR = "supabase/migrations";

export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

export function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/**
 * الإعلانُ كما يُقرأُ من المستودعِ — يُمرَّرُ وسيطاً كي تُختبَرَ الحالاتُ
 * السالبةُ بلا لمسِ ملفٍّ. حاجزٌ لا تُختبَرُ حالاتُه السالبةُ حاجزٌ بالاسمِ.
 */
export interface RepositoryDeclaration {
  readonly durableQueues: readonly string[];
  readonly retiredQueues: readonly { readonly table: string; readonly retiredIn: string }[];
  readonly declarations: typeof QUEUE_BACKPRESSURE_DECLARATIONS;
  readonly deferrableKinds: readonly string[];
  readonly notificationKinds: readonly string[];
  /** أسماءُ الثوابتِ المُصدَّرةِ لكلِّ وحدةٍ — تُقرأُ من نصِّ الوحدةِ. */
  readonly exportedConstants: Readonly<Record<string, readonly string[]>>;
}

/** جدولٌ بنيتُه بنيةُ طابورٍ صامدٍ: يُحجَزُ صفُّه، ويُعادُ، ويموتُ. */
export function queueShapedTables(migrations: readonly MigrationFile[]): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const { file, sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const name = match[1];
      const body = match[2];
      if (name === undefined || body === undefined) continue;
      const hasAll =
        /\battempts\b/.test(body) &&
        /\bclaim_token\b/.test(body) &&
        /\bnext_attempt_at\b/.test(body);
      if (hasAll && !found.has(name)) found.set(name, file);
    }
  }
  return found;
}

/**
 * الأصنافُ القابلةُ للتأجيلِ كما تُعلِنُها القاعدةُ — آخِرُ تعريفٍ هوَ الحاكمُ.
 *
 * والمنطقُ نُقِلَ (`F6-07`) إلى `scripts/lib/traffic-priority-sql.ts` لأنَّ الدالّةَ
 * في القاعدةِ صارَت تُشتَقُّ من `notification_kind_priority` بدلاً من قائمةٍ
 * صريحةٍ، فالقارئُ واحدٌ يفهمُ الصورتَينِ ويقرأُه حاجزانِ. وتبقى هذه الدالّةُ
 * مُصدَّرةً باسمِها لأنَّ اختبارَ الحاجزِ يُناديها مباشرةً.
 */
export function deferrableKindsFromFunction(migrations: readonly MigrationFile[]): Set<string> {
  return deferrableKindsFromMigrations(migrations);
}

/** مفاتيحُ `platform_settings` المبذورةُ في الهجراتِ. */
export function seededSettingKeys(migrations: readonly MigrationFile[]): Set<string> {
  const keys = new Set<string>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(
      /insert into platform_settings[\s\S]{0,400}?'([a-z0-9_]+)'\s*,\s*'/g,
    )) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/** هجراتٌ تُدرِجُ في جدولٍ بعينِه، بأسمائِها — كي يُقرأَ التاريخُ لا الوجودُ. */
export function migrationsInsertingInto(
  migrations: readonly MigrationFile[],
  table: string,
): string[] {
  const pattern = new RegExp(`insert\\s+into\\s+${table}\\b`, "i");
  return migrations.filter(({ sql }) => pattern.test(sql)).map(({ file }) => file);
}

function exportedNamesOf(module: string): readonly string[] {
  const source = readFileSync(module, "utf8");
  return [...source.matchAll(/export const ([A-Z0-9_]+)\s*[=:]/g)].map((m) => m[1] as string);
}

export function repositoryDeclaration(): RepositoryDeclaration {
  const modules = new Set<string>();
  for (const declaration of QUEUE_BACKPRESSURE_DECLARATIONS) {
    for (const dimension of BACKPRESSURE_DIMENSIONS) {
      const home = declaration[dimension];
      if (home.kind === "code_constant") modules.add(home.module);
    }
  }
  const exportedConstants: Record<string, readonly string[]> = {};
  for (const module of modules) exportedConstants[module] = exportedNamesOf(module);

  return {
    durableQueues: DURABLE_QUEUES,
    retiredQueues: RETIRED_QUEUES,
    declarations: QUEUE_BACKPRESSURE_DECLARATIONS,
    deferrableKinds: DEFERRABLE_UNDER_BACKPRESSURE_KINDS,
    notificationKinds: NOTIFICATION_KINDS,
    exportedConstants,
  };
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function findViolations(
  migrations: readonly MigrationFile[],
  declared: RepositoryDeclaration,
): string[] {
  const violations: string[] = [];

  // ١) كلُّ جدولٍ بنيتُه بنيةُ طابورٍ مُعلَنٌ — حيّاً أو متقاعداً.
  const retiredTables = new Set(declared.retiredQueues.map((entry) => entry.table));
  const durable = new Set(declared.durableQueues);
  for (const [table, file] of queueShapedTables(migrations)) {
    if (!durable.has(table) && !retiredTables.has(table)) {
      violations.push(
        `الجدولُ «${table}» (${file}) بنيتُه بنيةُ طابورٍ صامدٍ (attempts + claim_token + next_attempt_at) ` +
          `ولم يُعلَن في DURABLE_QUEUES بحدودِه الستّةِ ولا في RETIRED_QUEUES بتاريخِ تقاعُدِه — ` +
          `«DLQ لكلِّ طابورٍ» (القسم ١٤) لا تُفرَضُ على طابورٍ لا يُعرَفُ وجودُه.`,
      );
    }
  }

  // ولا إعلانَ لطابورٍ لا جدولَ له: مُدخلٌ ميّتٌ يُقرأُ تغطيةً كاذبةً.
  const shaped = new Set(queueShapedTables(migrations).keys());
  for (const table of [...durable, ...retiredTables]) {
    if (!shaped.has(table)) {
      violations.push(
        `الطابورُ «${table}» مُعلَنٌ ولا جدولَ بنيتُه بنيةُ طابورٍ يقابلُه في الهجراتِ — إعلانٌ معلَّقٌ في الهواءِ.`,
      );
    }
  }

  // ٢) المتقاعدُ متقاعدٌ فعلاً: لا إدراجَ فيه بعدَ تاريخِ تقاعُدِه.
  for (const { table, retiredIn } of declared.retiredQueues) {
    for (const file of migrationsInsertingInto(migrations, table)) {
      if (file >= retiredIn) {
        violations.push(
          `الجدولُ «${table}» مُعلَنٌ متقاعداً منذُ ${retiredIn} ومع ذلك تُدرِجُ فيه الهجرةُ «${file}» — ` +
            `طابورٌ يُكتَبُ فيه طابورٌ حيٌّ، فليُعلَن في DURABLE_QUEUES بحدودِه الستّةِ.`,
        );
      }
    }
  }

  // ٣) كلُّ حدٍّ يسكنُ موضعاً حقيقيّاً.
  const seeded = seededSettingKeys(migrations);
  for (const declaration of declared.declarations) {
    if (!durable.has(declaration.queue)) {
      violations.push(`الطابورُ «${declaration.queue}» له إعلانُ حدودٍ وليسَ في DURABLE_QUEUES.`);
    }
    for (const dimension of BACKPRESSURE_DIMENSIONS) {
      const home = declaration[dimension];
      if (home.kind === "platform_settings") {
        if (!seeded.has(home.key)) {
          violations.push(
            `حدُّ «${dimension}» للطابورِ «${declaration.queue}» مُعلَنٌ في مفتاحِ إعدادٍ «${home.key}» ` +
              `لا تبذُرُه هجرةٌ — مفتاحٌ غيرُ مبذورٍ يُقرأُ خرقاً دائماً في كلِّ مدينةٍ.`,
          );
        }
      } else {
        const names = declared.exportedConstants[home.module] ?? [];
        if (!names.includes(home.name)) {
          violations.push(
            `حدُّ «${dimension}» للطابورِ «${declaration.queue}» مُعلَنٌ في ثابتِ «${home.name}» ` +
              `غيرِ مُصدَّرٍ من «${home.module}».`,
          );
        }
      }
    }
  }
  for (const queue of durable) {
    if (!declared.declarations.some((entry) => entry.queue === queue)) {
      violations.push(
        `الطابورُ «${queue}» في DURABLE_QUEUES بلا إعلانِ حدودٍ في QUEUE_BACKPRESSURE_DECLARATIONS.`,
      );
    }
  }

  // ٤) قائمةُ الأصنافِ القابلةِ للتأجيلِ متطابقةٌ في الطرفَينِ.
  const inCode = new Set(declared.deferrableKinds);
  const inDb = deferrableKindsFromFunction(migrations);
  for (const missing of difference(inCode, inDb)) {
    violations.push(
      `الصنفُ «${missing}» قابلٌ للتأجيلِ في الكودِ ولا في دالّةِ notification_kind_is_deferrable — القائمتانِ افترقتا.`,
    );
  }
  for (const extra of difference(inDb, inCode)) {
    violations.push(`الصنفُ «${extra}» قابلٌ للتأجيلِ في القاعدةِ ولا في الكودِ — القائمتانِ افترقتا.`);
  }

  // ٥) ولا صنفٌ خارجَ الأنواعِ، ولا حرجٌ يُؤجَّل.
  const kinds = new Set(declared.notificationKinds);
  for (const kind of declared.deferrableKinds) {
    if (!kinds.has(kind)) {
      violations.push(
        `الصنفُ «${kind}» قابلٌ للتأجيلِ وليسَ من أنواعِ الصندوقِ — مُدخلٌ ميّتٌ يُقرأُ رخصةً سارية.`,
      );
    }
  }

  return violations;
}

function main(): void {
  const migrations = readMigrations();
  const violations = findViolations(migrations, repositoryDeclaration());

  if (violations.length > 0) {
    console.error("❌ حاجزُ الضغطِ العكسيِّ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  console.log(
    `✅ الضغطُ العكسيُّ مُعلَنٌ — ${DURABLE_QUEUES.length} طابوراً حيّاً لكلٍّ ${BACKPRESSURE_DIMENSIONS.length} حدودٍ في مواضعَ حقيقيّةٍ، ` +
      `و${RETIRED_QUEUES.length} طوابيرَ متقاعدةً لا يُكتَبُ فيها، و${DEFERRABLE_UNDER_BACKPRESSURE_KINDS.length} صنفاً قابلاً للتأجيلِ متطابقاً في الطرفَينِ.`,
  );
}

// لا يُشغَّل `main` عندَ الاستيرادِ من اختبارٍ: `process.exit` كانَ سيقتلُ المُشغِّل.
if (import.meta.main) main();
