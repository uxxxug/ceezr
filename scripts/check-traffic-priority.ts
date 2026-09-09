#!/usr/bin/env bun
/**
 * # حاجزُ أولويّةِ المرورِ — لا نوعَ إشعارٍ بلا رتبةٍ، ولا رتبةَ تُقالُ في مكانَينِ
 *
 * **الغرض:** يفرضُ البندَ `F6-07` (القسمَ ١٥ من الخارطةِ) بخمسِ دعاوى تُقرأُ
 * آليّاً، طرفُها الأوّلُ ثابتُ الكودِ (`packages/shared/config/traffic-priority.ts`)
 * وطرفُها الثاني **نصُّ الهجراتِ** (`scripts/lib/traffic-priority-sql.ts`):
 *
 * ١) كلُّ نوعٍ من `NOTIFICATION_KINDS` له رتبةٌ في الكودِ (لا نوعَ يُولَدُ بلا رتبةٍ).
 * ٢) رتبةُ كلِّ نوعٍ في القاعدةِ = رتبتُه في الكودِ، ولا نوعَ في أحدِ الطرفَينِ
 *    وحدَه، ولا رتبةَ خارجَ المجالِ ١..٤.
 * ٣) رتبةُ المجهولِ في القاعدةِ (`else`) = رتبةُ الحرجِ — فالسهوُ يُقدِّمُ لا يُؤخِّرُ.
 * ٤) `claim_notification_delivery` — **آخِرُ تعريفٍ لها** — تُرتِّبُ بالرتبةِ ثمَّ
 *    بالأقدميّةِ. فلا رتبةَ مُعلَنةً في القاعدةِ لا يقرأُها المُطالِبُ.
 * ٥) للترتيبِ الجديدِ فهرسٌ في طورِ `index` بـ`concurrently` — وإلّا فالرتبةُ
 *    صحيحةٌ وتُدفَعُ ثمناً بفَرزِ كلِّ المُعلَّقِ في كلِّ شوطٍ.
 *
 * **الحالة:** `F6-07` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** سلسلةَ `bun run ci` · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ نوعِ إشعارٍ جديدٍ، وأوّلُها أنواعُ `F8`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً.** أنَّ صفّاً حرجاً يُلتقَطُ قبلَ صفٍّ منخفضٍ أقدمَ منه
 *   يُثبَتُ في `tests/integration/traffic-priority-claim.test.ts` على PostgreSQL
 *   حقيقيٍّ في CI. النصُّ ههنا يُثبِتُ **الاتّساقَ** لا الأثرَ.
 * - **لا يحكمُ على صوابِ تصنيفٍ.** أنَّ `subscription_notice` متوسّطٌ لا حرجٌ حكمٌ
 *   مردودٌ إلى نصِّ القسمِ ١٥ ومُحتجٌّ له سطراً سطراً في ملفِّ الرتبةِ؛ المفروضُ
 *   ههنا أن يكونَ التصنيفُ **موجوداً ومُتّسقاً في الطرفَينِ**، لا صواباً.
 * - **لا يفحصُ حِصّةَ الدلوِ.** إنفاذُها في `outbound-rate-bucket.ts` ويُقاسُ في
 *   `tests/unit/traffic-priority.test.ts` وعلى Redis حقيقيٍّ في وظيفةِ
 *   `real-redis`؛ وهيَ رقمٌ في `platform_settings` لا قائمةٌ تُقابَلُ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "../packages/shared/config/notification-kinds.ts";
import {
  isDeferrableClass,
  NOTIFICATION_KIND_PRIORITY,
  TRAFFIC_PRIORITY_RANK,
} from "../packages/shared/config/traffic-priority.ts";
import {
  deferrableKindsFromMigrations,
  priorityMapFromMigrations,
  type SqlMigration,
} from "./lib/traffic-priority-sql.ts";

const MIGRATIONS_DIR = "supabase/migrations";

export function readMigrations(dir: string = MIGRATIONS_DIR): SqlMigration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}

/** الإعلانُ كما يُقرأُ من الكودِ — يُمرَّرُ وسيطاً كي تُختبَرَ الحالاتُ السالبةُ. */
export interface CodeDeclaration {
  readonly kinds: readonly string[];
  readonly ranks: Readonly<Record<string, number>>;
  readonly deferrable: readonly string[];
  readonly criticalRank: number;
}

export function codeDeclaration(): CodeDeclaration {
  const ranks: Record<string, number> = {};
  for (const kind of NOTIFICATION_KINDS) {
    ranks[kind] = TRAFFIC_PRIORITY_RANK[NOTIFICATION_KIND_PRIORITY[kind]];
  }
  return {
    kinds: NOTIFICATION_KINDS,
    ranks,
    deferrable: NOTIFICATION_KINDS.filter((kind: NotificationKind) =>
      isDeferrableClass(NOTIFICATION_KIND_PRIORITY[kind]),
    ),
    criticalRank: TRAFFIC_PRIORITY_RANK.critical,
  };
}

/** سطرُ ترتيبِ آخِرِ تعريفٍ لـ`claim_notification_delivery`، أو `null`. */
export function claimOrderClause(migrations: readonly SqlMigration[]): string | null {
  const pattern =
    /create or replace function\s+claim_notification_delivery\s*\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g;
  let body: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      if (match[1] !== undefined) body = match[1];
    }
  }
  if (body === null) return null;
  const order = /order by ([^\n]+)/.exec(body.replace(/--[^\n]*/g, ""));
  return order?.[1]?.trim() ?? null;
}

/** أَلَهُ فهرسٌ في طورِ `index` يبدأُ بالرتبةِ؟ */
export function hasPriorityIndex(migrations: readonly SqlMigration[]): boolean {
  return migrations.some(
    ({ sql }) =>
      /--\s*migration-phase:\s*index/.test(sql) &&
      /create index concurrently if not exists[\s\S]*?notification_outbox\s*\(\s*notification_kind_priority\s*\(\s*kind\s*\)\s*,\s*created_at\s*\)/.test(
        sql,
      ),
  );
}

export function findViolations(
  migrations: readonly SqlMigration[],
  declared: CodeDeclaration,
): string[] {
  const violations: string[] = [];
  const sql = priorityMapFromMigrations(migrations);

  // ١) كلُّ نوعٍ مُصنَّفٌ في الكودِ، ورتبتُه في المجالِ.
  for (const kind of declared.kinds) {
    const rank = declared.ranks[kind];
    if (rank === undefined) {
      violations.push(
        `النوعُ «${kind}» بلا رتبةٍ في NOTIFICATION_KIND_PRIORITY — نوعٌ يُولَدُ بلا أولويّةٍ يُقرأُ حرجاً في زمنِ التشغيلِ فيُزاحِمُ الاستغاثةَ.`,
      );
      continue;
    }
    if (!Number.isInteger(rank) || rank < 1 || rank > 4) {
      violations.push(`رتبةُ النوعِ «${kind}» (${rank}) خارجَ المجالِ ١..٤ في الكودِ.`);
    }
  }

  // ٢) الطرفانِ متطابقانِ رتبةً برتبةٍ.
  if (sql.ranks.size === 0) {
    violations.push(
      "لا تعريفَ لدالّةِ notification_kind_priority في الهجراتِ — الرتبةُ في الكودِ وحدَه لا تُرتِّبُ طابوراً.",
    );
  }
  for (const kind of declared.kinds) {
    const inCode = declared.ranks[kind];
    const inDb = sql.ranks.get(kind);
    if (inDb === undefined) {
      violations.push(
        `النوعُ «${kind}» مُصنَّفٌ في الكودِ ولا في دالّةِ notification_kind_priority — فيُقرأُ في القاعدةِ بقيمةِ else.`,
      );
      continue;
    }
    if (inDb !== inCode) {
      violations.push(
        `رتبةُ «${kind}» تفترقُ: ${String(inCode)} في الكودِ و${String(inDb)} في القاعدةِ — والقاعدةُ هيَ من يُرتِّبُ.`,
      );
    }
  }
  for (const [kind] of sql.ranks) {
    if (!declared.kinds.includes(kind)) {
      violations.push(
        `النوعُ «${kind}» مُصنَّفٌ في القاعدةِ وليسَ من أنواعِ الصندوقِ — مُدخلٌ ميّتٌ يُقرأُ تصنيفاً سارياً.`,
      );
    }
  }

  // ٣) المجهولُ حرجٌ لا منخفضٌ.
  if (sql.ranks.size > 0 && sql.fallback !== declared.criticalRank) {
    violations.push(
      `رتبةُ المجهولِ في القاعدةِ ${String(sql.fallback)} وليسَت رتبةَ الحرجِ (${String(declared.criticalRank)}) — نوعٌ نُسيَ تصنيفُه يجبُ أن يُقدَّمَ لا أن يُؤخَّرَ.`,
    );
  }

  // ٤) قائمةُ التأجيلِ مُشتقّةٌ في الطرفَينِ ومتطابقةٌ.
  const deferrableInDb = deferrableKindsFromMigrations(migrations);
  for (const kind of declared.deferrable) {
    if (!deferrableInDb.has(kind)) {
      violations.push(`«${kind}» قابلٌ للتأجيلِ في الكودِ ولا في القاعدةِ — الاشتقاقانِ افترقا.`);
    }
  }
  for (const kind of deferrableInDb) {
    if (!declared.deferrable.includes(kind)) {
      violations.push(`«${kind}» قابلٌ للتأجيلِ في القاعدةِ ولا في الكودِ — الاشتقاقانِ افترقا.`);
    }
  }

  // ٥) المُطالِبُ يقرأُ الرتبةَ فعلاً.
  const order = claimOrderClause(migrations);
  if (order === null) {
    violations.push("لا سطرَ ترتيبٍ في claim_notification_delivery — لا يُقرأُ حكمُه.");
  } else if (!/^notification_kind_priority\s*\(\s*n\.kind\s*\)\s*,\s*n\.created_at/.test(order)) {
    violations.push(
      `ترتيبُ المُطالِبِ «${order}» لا يبدأُ بالرتبةِ ثمَّ الأقدميّةِ — رتبةٌ مُعلَنةٌ لا يقرأُها المُطالِبُ رتبةٌ لا وجودَ لها.`,
    );
  }

  // ٦) فهرسُ الترتيبِ قائمٌ.
  if (!hasPriorityIndex(migrations)) {
    violations.push(
      "لا فهرسَ في طورِ `index` على (notification_kind_priority(kind), created_at) — المُطالِبُ يفرزُ كلَّ المُعلَّقِ في كلِّ شوطٍ.",
    );
  }

  return violations;
}

function main(): void {
  const migrations = readMigrations();
  const declared = codeDeclaration();
  const violations = findViolations(migrations, declared);

  if (violations.length > 0) {
    console.error("❌ حاجزُ أولويّةِ المرورِ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  console.log(
    `✅ أولويّةُ المرورِ مُتّسقةٌ — ${declared.kinds.length} نوعاً لكلٍّ رتبةٌ واحدةٌ متطابقةٌ في الكودِ والقاعدةِ، ` +
      `و${declared.deferrable.length} صنفاً قابلاً للتأجيلِ مُشتقّاً من الرتبةِ في الطرفَينِ، ` +
      "والمُطالِبُ يُرتِّبُ بالرتبةِ ثمَّ بالأقدميّةِ على فهرسٍ مبنيٍّ لذلكَ.",
  );
}

// لا يُشغَّل `main` عندَ الاستيرادِ من اختبارٍ: `process.exit` كانَ سيقتلُ المُشغِّل.
if (import.meta.main) main();
