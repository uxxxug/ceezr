#!/usr/bin/env bun
/**
 * # حاجزُ تصنيفِ الإشعاراتِ — لا نوعَ بلا قناةٍ مُعلَنةٍ، ولا بلاغَ مجموعةٍ يُهدَّأ
 *
 * **الغرض:** يفرضُ البندَ `F6-05` / `TG-002` بأربعِ قواعدَ تُقرأُ من المستودعِ:
 *
 * ١) **كلُّ نوعٍ في قيدِ `notification_outbox_kind_check` له إعلانُ قناةٍ** في
 *    `packages/shared/config/notification-kinds.ts` وصفُّ بذرٍ في هجرةِ `F6-05`.
 *    النوعُ بلا سياسةٍ يُرسَلُ افتراضاً — وهوَ الميلُ الآمنُ — لكنَّه يُرسَلُ **بلا
 *    أن يقرّرَ أحدٌ**، فيبقى قرارُ منتَجٍ مؤجَّلاً بلا أثرٍ يُقرأ.
 *
 * ٢) **ولا إعلانَ لنوعٍ غيرِ موجودٍ**: مُدخلٌ ميّتٌ يوسّعُ السطحَ بلا مقابلٍ،
 *    ويُقرأُ في المراجعةِ دليلَ تغطيةٍ كاذبٍ.
 *
 * ٣) **قائمةُ الأنواعِ المُوجَّهةِ إلى مجموعةٍ متطابقةٌ في الطرفَينِ**: في
 *    TypeScript وفي دالّةِ `notification_kind_is_group_addressed` في القاعدةِ.
 *    التكرارُ مقصودٌ — القاعدةُ تمنعُ الصفَّ الخاطئَ وقتَ الكتابةِ وهذا الحاجزُ
 *    يمنعُ افتراقَ القائمتَينِ — **والتكرارُ بلا حارسٍ هوَ الافتراقُ نفسُه**.
 *
 * ٤) **ولا نوعٌ مُوجَّهٌ إلى مجموعةٍ مُعلَنٌ `in_app`**: لا صندوقَ واردٍ شخصيَّ له،
 *    فتصنيفُه داخلَ التطبيقِ **إعدامٌ صامتٌ**: لا رسالةٌ تُرسَلُ ولا مدخلُ مركزٍ
 *    يُقيَّد. و`safety_incident` — بلاغُ استغاثةٍ — هوَ عينُ هذا الصنفِ اليوم.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوةً مُسمّاةً في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً.** يقرأُ نصَّ الهجراتِ؛ فما في قاعدةٍ حيّةٍ خارجَ علمِه،
 *   وإثباتُ أنَّ المُطلِقَ يعملُ فعلاً في اختبارِ التكاملِ لا ههنا.
 * - **لا يحكمُ على صوابِ التصنيفِ.** أنَّ `offer` حرجٌ حكمُ منتَجٍ لا نصٍّ؛
 *   المفروضُ ههنا أن يكونَ الحكمُ **مُعلَناً ومتّسقاً**، لا أن يكونَ صواباً.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GROUP_ADDRESSED_KINDS,
  NOTIFICATION_KINDS,
  SEEDED_NOTIFICATION_CHANNELS,
} from "../packages/shared/config/notification-kinds.ts";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * أنماطُ بذرِ السياسةِ التي تُقرأُ: كتلةُ `cross join (values ...) as k(kind,
 * description_ar)` نفسُها التي في هجرةِ `F6-05`، أيًّا كانَ ملفُّها. والقراءةُ من
 * كلِّ الهجراتِ لا من `F6-05` وحدَها: الهجراتُ تُضافُ ولا تُحرَّفُ، فكلُّ نوعٍ جديدٍ
 * يُبذَرُ في هجرتِهِ هو، والحاجزُ يقرأُ الاتّحادَ كلَّهُ لا آخرَ ملفٍّ فقط. ولو قرأَ
 * `F6-05` وحدهُ لكانَ كلُّ نوعٍ يُضافُ بعدَهُ يُخفِقُ الحاجزَ أو يُلجئُ إلى تحريفِ ملفٍّ
 * منشورٍ — وكلاهُما عيبٌ.
 */
const SEEDED_KINDS_PATTERN = /cross join \(values([\s\S]*?)\) as k\(kind, description_ar\)/g;

function readMigrations(): { readonly file: string; readonly sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

/**
 * آخِرُ تعريفٍ لقيدِ النوعِ هوَ الحاكمُ: الهجراتُ تُعيدُ تعريفَه موسَّعاً، فقراءةُ
 * الأوّلِ كانت ستُنتِجُ قائمةً بائدةً يُقارَنُ بها فيُخفِقُ الحاجزُ على الصواب.
 */
function kindsFromConstraint(migrations: readonly { file: string; sql: string }[]): Set<string> {
  const pattern = /notification_outbox_kind_check\s+check\s*\(\s*kind\s+in\s*\(([\s\S]*?)\)\s*\)/g;
  let last: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const body = match[1];
      if (body !== undefined) last = body;
    }
  }
  if (last === null) return new Set();
  return new Set([...last.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string));
}

function groupKindsFromFunction(migrations: readonly { file: string; sql: string }[]): Set<string> {
  const pattern =
    /function\s+notification_kind_is_group_addressed[\s\S]*?select\s+p_kind\s+in\s*\(([^)]*)\)/g;
  let last: string | null = null;
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(pattern)) {
      const body = match[1];
      if (body !== undefined) last = body;
    }
  }
  if (last === null) return new Set();
  return new Set([...last.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string));
}

/**
 * أنواعُ السياسةِ المبذورةِ — اتحادُ كلِّ كتلةِ `cross join (values ...) as
 * k(kind, description_ar)` في كلِّ هجرةٍ. كانت تُقرأُ من هجرةِ `F6-05` وحدَها، فكانَ
 * كلُّ نوعٍ جديدٍ بعدَها يُلجئُ إلى تحريفِ ملفٍّ منشورٍ أو إخفاقِ الحاجزِ. والقراءةُ
 * من كلِّ الهجراتِ تحفظُ النصَّ نفسَهُ وتُمَكِّنُ كلَّ نوعٍ جديدٍ من بذرِ سياستِهِ في
 * هجرتِهِ هو.
 */
function seededKindsFromMigration(
  migrations: readonly { file: string; sql: string }[],
): Set<string> {
  const kinds = new Set<string>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(SEEDED_KINDS_PATTERN)) {
      const body = match[1];
      if (body === undefined) continue;
      for (const kindMatch of body.matchAll(/\(\s*'([a-z_]+)'/g)) {
        const kind = kindMatch[1];
        if (kind !== undefined) kinds.add(kind);
      }
    }
  }
  return kinds;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

/** ما يُعلِنُه الكودُ — يُمرَّرُ صراحةً لتُختبَرَ الحالاتُ السالبةُ بلا لمسِ ملفّاتٍ. */
export interface DeclaredClassification {
  readonly kinds: readonly string[];
  readonly channels: Readonly<Record<string, string>>;
  readonly groupAddressed: readonly string[];
}

export const REPOSITORY_DECLARATION: DeclaredClassification = {
  kinds: NOTIFICATION_KINDS,
  channels: SEEDED_NOTIFICATION_CHANNELS,
  groupAddressed: GROUP_ADDRESSED_KINDS,
};

/**
 * الفحصُ **دالّةٌ نقيّةٌ**: تأخذُ نصوصَ الهجراتِ والإعلانَ وتُعيدُ الخروقَ. وحارسٌ
 * لا يُختبَرُ سالباً حارسٌ مُدَّعىً — قد يمرُّ لأنَّ نمطَه لا يطابقُ شيئاً أبداً،
 * فتُقرأُ خُضرةُ CI أماناً وهيَ صمتٌ.
 */
export function findViolations(
  migrations: readonly { readonly file: string; readonly sql: string }[],
  declared: DeclaredClassification,
): string[] {
  const violations: string[] = [];

  const constraintKinds = kindsFromConstraint(migrations);
  if (constraintKinds.size === 0) {
    violations.push("لم يُعثر على قيدِ `notification_outbox_kind_check` في أيِّ هجرةٍ.");
  }

  const declaredKinds = new Set<string>(declared.kinds);
  const seededKinds = seededKindsFromMigration(migrations);
  if (seededKinds.size === 0) {
    violations.push(
      `لم يُعثر على كتلةِ بذرِ السياسةِ (cross join (values ...) as k(kind, description_ar)) في أيِّ هجرةٍ.`,
    );
  }

  for (const missing of difference(constraintKinds, declaredKinds)) {
    violations.push(`النوعُ «${missing}» في قيدِ القاعدةِ ولا إعلانَ قناةٍ له في القائمةِ المغلقةِ.`);
  }
  for (const extra of difference(declaredKinds, constraintKinds)) {
    violations.push(`النوعُ «${extra}» مُعلَنٌ في القائمةِ المغلقةِ ولا وجودَ له في قيدِ القاعدةِ.`);
  }
  for (const missing of difference(constraintKinds, seededKinds)) {
    violations.push(`النوعُ «${missing}» في قيدِ القاعدةِ ولا صفَّ بذرِ سياسةٍ له في أيِّ هجرةٍ.`);
  }
  for (const extra of difference(seededKinds, constraintKinds)) {
    violations.push(`النوعُ «${extra}» مبذورٌ في هجرةٍ ولا وجودَ له في قيدِ القاعدةِ.`);
  }

  for (const kind of declared.kinds) {
    if (declared.channels[kind] === undefined) {
      violations.push(`النوعُ «${kind}» بلا قناةٍ مُعلَنةٍ في SEEDED_NOTIFICATION_CHANNELS.`);
    }
  }

  const groupInCode = new Set<string>(declared.groupAddressed);
  const groupInDb = groupKindsFromFunction(migrations);
  for (const missing of difference(groupInCode, groupInDb)) {
    violations.push(
      `النوعُ «${missing}» مُوجَّهٌ إلى مجموعةٍ في الكودِ ولا في دالّةِ القاعدةِ — القائمتانِ افترقتا.`,
    );
  }
  for (const extra of difference(groupInDb, groupInCode)) {
    violations.push(
      `النوعُ «${extra}» مُوجَّهٌ إلى مجموعةٍ في القاعدةِ ولا في الكودِ — القائمتانِ افترقتا.`,
    );
  }
  for (const kind of declared.groupAddressed) {
    const channel = declared.channels[kind];
    if (channel !== "critical") {
      violations.push(
        `النوعُ «${kind}» مُوجَّهٌ إلى مجموعةٍ ومُعلَنٌ «${channel ?? "بلا قناةٍ"}» — لا صندوقَ واردٍ شخصيَّ له فتصنيفُه داخلَ التطبيقِ إعدامٌ صامتٌ.`,
      );
    }
  }

  return violations;
}

function main(): void {
  const migrations = readMigrations();
  const violations = findViolations(migrations, REPOSITORY_DECLARATION);

  if (violations.length > 0) {
    console.error("❌ حاجزُ تصنيفِ الإشعاراتِ أخفقَ:");
    for (const violation of violations) console.error(`   - ${violation}`);
    process.exit(1);
  }

  console.log(
    `✅ تصنيفُ الإشعاراتِ متّسقٌ — ${kindsFromConstraint(migrations).size} نوعاً لكلٍّ قناةٌ مُعلَنةٌ وصفُّ بذرٍ، و${GROUP_ADDRESSED_KINDS.length} نوعاً مُوجَّهاً إلى مجموعةٍ لا يُصنَّفُ داخلَ التطبيقِ.`,
  );
}

// لا يُشغَّل `main` عندَ الاستيرادِ من اختبارٍ: `process.exit` كانَ سيقتلُ المُشغِّل.
if (import.meta.main) main();
