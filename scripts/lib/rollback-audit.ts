/**
 * # قراءةُ الهجراتِ بحثاً عمّا يُفقِد نسخةً سابقةً ما كانت تعتمد عليه
 *
 * **الغرض:** البندُ `OPS-010` يطلب أن يكون **لكلِّ نشرٍ مسارُ عودةٍ مُختبَرٌ لا
 * يكسر المخطّطَ**. ووحدةُ النشرِ عندنا **صورةُ شيفرةٍ** (`render.yaml`:
 * `autoDeploy: false`)، أمّا المخطّطُ فيمضي إلى الأمامِ ولا يُعكَس. ومعنى ذلك أنّ
 * مسارَ العودةِ الحقيقيَّ هو **إعادةُ نشرِ الصورةِ السابقةِ على مخطّطٍ متقدِّمٍ** —
 * فلا يصحُّ إلّا إن كان المخطّطُ الجديدُ **يُبقي كلَّ ما كانت الصورةُ السابقةُ
 * تعتمد عليه**.
 *
 * فهذه الوحدةُ تقرأ ملفّاتَ الهجرةِ **بترتيبِها** وتبني خطَّ زمنٍ لِما أُنشئ ومتى،
 * ثمّ تُخرِج **مجموعةَ الخطرِ**: كلُّ تغييرٍ **يُضيِّق أو يُزيل** شيئاً كان موجوداً
 * **قبلَ** الهجرةِ التي تحمله. وما أُنشئ وضُيِّق في الهجرةِ نفسِها **ليس خطراً**
 * لأنّ نسخةً سابقةً لم تكن تعرفه أصلاً — وهذا تدقيقٌ في القاعدةِ لا تخفيفٌ لها.
 *
 * **الحالة:** `OPS-010` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** `scripts/lib` · البند `OPS-010` (القسم 11-د) · `F11-09`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** `scripts/check-rollback-safety.ts` (الحاجزُ
 * الساكنُ) · `scripts/rollback-schema-drill.ts` (التمرينُ على قاعدةٍ حقيقيةٍ
 * يُقابِل نتيجةَ القراءةِ الساكنةِ بما في `pg_catalog` فعلاً) · اختباراتُ الوحدة.
 *
 * **ملاحظات مستقبلية:** لو صار في المستودعِ هجراتُ عودةٍ (`down`) فالصوابُ
 * قاعدةٌ جديدةٌ تُلزِم وجودَها، لا تخفيفُ هذه. ومتى أُضيف مُحلِّلُ SQL حقيقيٌّ
 * وجب أن يكون بـADR لأنّه تبعيّةٌ جديدةٌ في مسارِ CI.
 *
 * **ما لا تفعله هذه الوحدةُ عن قصدٍ — وحدودُها مُعلَنةٌ لا مضمرةٌ:**
 * - **ليست مُحلِّلَ SQL.** مطابقةٌ نصّيّةٌ على نصٍّ فُرِّغت تعليقاتُه. فتغييرٌ
 *   يُبنى بنصٍّ مُركَّبٍ (`execute 'drop ta' || 'ble x'`) **يُفلِت** — سلبيٌّ كاذبٌ
 *   مُعلَنٌ ومُثبَّتٌ في اختبارٍ، ولذلك وُجِد التمرينُ على قاعدةٍ حقيقيةٍ.
 * - **لا تحكم على البياناتِ.** تقرأ المخطّطَ لا الصفوفَ؛ فهجرةٌ تُفسِد بياناتٍ بلا
 *   لمسِ مخطّطٍ لا تراها هذه الوحدةُ (وهي مسؤوليةُ `OPS-008`/النسخِ الاحتياطيّ).
 * - **لا تعرف نسخةَ الشيفرةِ السابقةَ.** لا تقرأ تاريخَ `git` ولا الوسومَ؛ تعرف
 *   ترتيبَ الهجراتِ وحدَه، و«السابق» عندها = ما قبلَ هذه الهجرةِ في الترتيب.
 * - **لا تحرس شيئاً.** القواعدُ تُفرَض في الحاجزِ وحدَه.
 */

import { blankSqlComments } from "./blank-comments.ts";

/** وسمٌ يُقرأ في البلاغِ ويُطابَق في السجلِّ: نوعُ التغييرِ ثمّ هدفُه. */
export type ChangeKind =
  | "drop_table"
  | "drop_column"
  | "drop_view"
  | "drop_type"
  | "drop_function"
  | "drop_policy"
  | "drop_trigger"
  | "rename"
  | "set_not_null"
  | "set_data_type"
  | "drop_default"
  | "revoke_schema"
  | "revoke_all_in_schema"
  | "revoke_function"
  | "revoke_table"
  | "truncate"
  | "stub_function";

/** تغييرٌ واحدٌ قُرِئ من نصِّ هجرةٍ واحدةٍ. */
export interface SchemaChange {
  readonly migration: string;
  readonly kind: ChangeKind;
  /** هدفُ التغييرِ كما يُطابَق في السجلِّ: `orders`، `db_backups.city_id`، `f(3)`. */
  readonly target: string;
  readonly line: number;
}

/** ما أنشأته هجرةٌ: يُستعمَل لمعرفةِ «هل كان الهدفُ موجوداً قبلَ هذه الهجرة؟». */
export interface CreatedObjects {
  readonly tables: ReadonlySet<string>;
  readonly columns: ReadonlySet<string>;
  readonly functions: ReadonlySet<string>;
  readonly policies: ReadonlySet<string>;
  readonly triggers: ReadonlySet<string>;
  readonly schemaGrants: ReadonlySet<string>;
}

/** ملفُّ هجرةٍ واحدٌ كما تقرؤه هذه الوحدة. */
export interface MigrationSource {
  readonly file: string;
  readonly sql: string;
}

function lineOf(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < sql.length; i += 1) if (sql[i] === "\n") line += 1;
  return line;
}

/** يُجرِّد اسماً من مخطّطِه ومن علاماتِ الاقتباسِ ويُوحِّد حالةَ الأحرف. */
export function bareName(raw: string): string {
  const withoutSchema = raw.includes(".") ? (raw.split(".").pop() ?? raw) : raw;
  return withoutSchema.replace(/["']/g, "").trim().toLowerCase();
}

/**
 * عددُ وسائطِ دالّةٍ من قائمتِها النصّيّةِ. الوسائطُ **تُعَدُّ ولا تُقرأ أنواعُها**:
 * الاسمُ مع العددِ يكفي لمطابقةِ «هل أُعيدت الدالّةُ نفسُها؟»، وقراءةُ الأنواعِ تحتاج
 * مُحلِّلاً — وحدُّ ذلك مُعلَنٌ: تغييرُ نوعِ وسيطٍ مع بقاءِ العددِ **يُفلِت** من هذه
 * القراءةِ الساكنةِ، ويوقعه التمرينُ على قاعدةٍ حقيقيةٍ لأنّه يقرأ التوقيعَ كاملاً.
 */
export function countArguments(argumentList: string): number {
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of argumentList) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter((part) => part.trim().length > 0).length;
}

const NAME = String.raw`(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?`;

/** ما أنشأته هجرةٌ واحدةٌ في نصِّها. */
export function createdBy(sql: string): CreatedObjects {
  const tables = new Set<string>();
  const columns = new Set<string>();
  const functions = new Set<string>();
  const policies = new Set<string>();
  const triggers = new Set<string>();
  const schemaGrants = new Set<string>();

  for (const match of sql.matchAll(
    new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${NAME}`, "gi"),
  )) {
    if (match[1] !== undefined) tables.add(bareName(match[1]));
  }
  for (const match of sql.matchAll(
    new RegExp(
      String.raw`alter\s+table\s+(?:if\s+exists\s+)?${NAME}[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?`,
      "gi",
    ),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      columns.add(`${bareName(match[1])}.${bareName(match[2])}`);
  }
  for (const match of sql.matchAll(
    new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?function\s+${NAME}\s*\(([\s\S]*?)\)\s*returns`,
      "gi",
    ),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      functions.add(`${bareName(match[1])}(${countArguments(match[2])})`);
  }
  for (const match of sql.matchAll(
    new RegExp(String.raw`create\s+policy\s+"?([^"\s]+)"?\s+on\s+${NAME}`, "gi"),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      policies.add(`${bareName(match[2])}.${bareName(match[1])}`);
  }
  for (const match of sql.matchAll(
    new RegExp(String.raw`create\s+trigger\s+"?([a-z_][a-z0-9_]*)"?[\s\S]*?\son\s+${NAME}`, "gi"),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      triggers.add(`${bareName(match[2])}.${bareName(match[1])}`);
  }
  for (const match of sql.matchAll(/grant\s+usage\s+on\s+schema\s+([a-z_][a-z0-9_]*)/gi)) {
    if (match[1] !== undefined) schemaGrants.add(bareName(match[1]));
  }
  return { tables, columns, functions, policies, triggers, schemaGrants };
}

/**
 * كلُّ تغييرٍ **مُضيِّقٍ** في نصِّ هجرةٍ واحدةٍ — بلا حكمٍ بعدُ على كونِه خطراً.
 * والحكمُ يأتي في `findRollbackRisks` لأنّه يحتاج ما قبلَ الهجرةِ لا الهجرةَ وحدَها.
 */
export function narrowingChanges(migration: string, rawSql: string): SchemaChange[] {
  const sql = blankSqlComments(rawSql);
  const found: SchemaChange[] = [];
  const push = (kind: ChangeKind, target: string, index: number): void => {
    found.push({ migration, kind, target, line: lineOf(sql, index) });
  };

  const simple: readonly (readonly [ChangeKind, RegExp])[] = [
    ["drop_table", new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?${NAME}`, "gi")],
    ["drop_view", new RegExp(String.raw`drop\s+view\s+(?:if\s+exists\s+)?${NAME}`, "gi")],
    ["drop_type", new RegExp(String.raw`drop\s+type\s+(?:if\s+exists\s+)?${NAME}`, "gi")],
    ["truncate", new RegExp(String.raw`truncate\s+(?:table\s+)?${NAME}`, "gi")],
  ];
  for (const [kind, pattern] of simple) {
    for (const match of sql.matchAll(pattern)) {
      if (match[1] !== undefined) push(kind, bareName(match[1]), match.index);
    }
  }

  for (const match of sql.matchAll(
    new RegExp(
      String.raw`alter\s+table\s+(?:if\s+exists\s+)?${NAME}\s+drop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?`,
      "gi",
    ),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("drop_column", `${bareName(match[1])}.${bareName(match[2])}`, match.index);
  }

  for (const match of sql.matchAll(
    new RegExp(
      String.raw`alter\s+table\s+(?:if\s+exists\s+)?${NAME}\s+(?:alter\s+column\s+)?"?([a-z_][a-z0-9_]*)"?\s+(set\s+not\s+null|set\s+data\s+type|type\s+|drop\s+default)`,
      "gi",
    ),
  )) {
    const table = match[1];
    const column = match[2];
    const action = match[3];
    if (table === undefined || column === undefined || action === undefined) continue;
    const kind: ChangeKind = action.startsWith("set not null")
      ? "set_not_null"
      : action.startsWith("drop")
        ? "drop_default"
        : "set_data_type";
    push(kind, `${bareName(table)}.${bareName(column)}`, match.index);
  }

  for (const match of sql.matchAll(
    new RegExp(String.raw`alter\s+\w+\s+${NAME}[\s\S]{0,120}?rename\s+(?:column\s+)?`, "gi"),
  )) {
    if (match[1] !== undefined) push("rename", bareName(match[1]), match.index);
  }

  for (const match of sql.matchAll(
    new RegExp(String.raw`drop\s+function\s+(?:if\s+exists\s+)?${NAME}\s*\(([\s\S]*?)\)`, "gi"),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("drop_function", `${bareName(match[1])}(${countArguments(match[2])})`, match.index);
  }

  for (const match of sql.matchAll(
    new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?"?([^"\s]+)"?\s+on\s+${NAME}`, "gi"),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("drop_policy", `${bareName(match[2])}.${bareName(match[1])}`, match.index);
  }

  for (const match of sql.matchAll(
    new RegExp(
      String.raw`drop\s+trigger\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+on\s+${NAME}`,
      "gi",
    ),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("drop_trigger", `${bareName(match[2])}.${bareName(match[1])}`, match.index);
  }

  /**
   * السحبُ **الجامعُ**: `revoke … on all functions in schema public from public`.
   * لا اسمَ كائنٍ فيه يُطابَق بخطِّ الزمنِ، وأثرُه أوسعُ من كلِّ سحبٍ مسمّىً:
   * يمسُّ كلَّ ما في المخطّطِ وقتَ تطبيقِه، بما فيه كائناتُ امتدادٍ لم تُنشِئْها هجرةٌ.
   * فيُعَدُّ خطراً **دائماً** ولا يُسأل عنه خطُّ الزمنِ. ولولا هذه القاعدةُ لأفلت
   * أكبرُ تضييقٍ في المستودعِ — وقد أفلت فعلاً حتّى أوقعه تمرينُ القاعدةِ الحقيقيةِ.
   */
  for (const match of sql.matchAll(
    /revoke\s+[\s\S]{0,80}?on\s+all\s+([a-z]+)\s+in\s+schema\s+([a-z_][a-z0-9_]*)/gi,
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("revoke_all_in_schema", `${match[1].toLowerCase()}:${bareName(match[2])}`, match.index);
  }
  for (const match of sql.matchAll(/revoke\s+[\s\S]{0,80}?on\s+schema\s+([a-z_][a-z0-9_]*)/gi)) {
    if (match[1] !== undefined) push("revoke_schema", bareName(match[1]), match.index);
  }
  for (const match of sql.matchAll(
    new RegExp(String.raw`revoke\s+[\s\S]{0,80}?on\s+function\s+${NAME}\s*\(([\s\S]*?)\)`, "gi"),
  )) {
    if (match[1] !== undefined && match[2] !== undefined)
      push("revoke_function", `${bareName(match[1])}(${countArguments(match[2])})`, match.index);
  }
  for (const match of sql.matchAll(
    new RegExp(String.raw`revoke\s+[\s\S]{0,80}?on\s+table\s+${NAME}`, "gi"),
  )) {
    if (match[1] !== undefined) push("revoke_table", bareName(match[1]), match.index);
  }

  for (const stub of stubbedFunctions(sql)) push("stub_function", stub.target, stub.index);

  return found;
}

/**
 * **دالّةٌ أُوقِفت لا أُزيلت:** جسدُها استُبدِل بجسدٍ يبدأ بـ`raise exception`. وهي
 * لا تظهر في أيِّ `drop`، ولا يراها فحصُ التوقيعاتِ في القاعدةِ لأنّ التوقيعَ
 * باقٍ والصلاحيةَ باقيةٌ — ومع ذلك **تكسر كلَّ نسخةٍ سابقةٍ كانت تناديها**. فهذا
 * أخطرُ ما في البابِ وأخفاه، ولذلك له قاعدةٌ خاصّةٌ لا يكفي فيها البحثُ عن الحذف.
 *
 * والقاعدةُ **نصّيّةٌ ومُعلَنةٌ**: يُقرأ جسدُ الدالّةِ، فإن كان أوّلَ ما فيه بعدَ
 * `begin` رفعَ خطأٍ فهي موقوفةٌ. ودالّةٌ ترفع الخطأَ بعدَ شرطٍ (تحقُّقٌ مشروعٌ)
 * **لا تُعَدُّ موقوفةً** — وذاك حدٌّ مقصودٌ: القاعدةُ تُصيب الإيقافَ الصريحَ ولا
 * تُغرِق البلاغَ بكلِّ دالّةٍ تتحقَّق من مدخلاتِها.
 */
export function stubbedFunctions(sql: string): readonly { target: string; index: number }[] {
  const out: { target: string; index: number }[] = [];
  const pattern = new RegExp(
    String.raw`create\s+or\s+replace\s+function\s+${NAME}\s*\(([\s\S]*?)\)\s*returns[\s\S]*?as\s+(\$[a-z_]*\$)([\s\S]*?)\3`,
    "gi",
  );
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    const args = match[2];
    const body = match[4];
    if (name === undefined || args === undefined || body === undefined) continue;
    const afterBegin = /\bbegin\b([\s\S]*)$/i.exec(body);
    if (afterBegin === null || afterBegin[1] === undefined) continue;
    const firstStatement = afterBegin[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"))
      .join(" ")
      .toLowerCase();
    if (!firstStatement.startsWith("raise exception")) continue;
    out.push({ target: `${bareName(name)}(${countArguments(args)})`, index: match.index });
  }
  return out;
}

/** هل يُعيد نصُّ الهجرةِ نفسُه إنشاءَ ما أزاله؟ */
function recreatedInSameMigration(change: SchemaChange, created: CreatedObjects): boolean {
  switch (change.kind) {
    case "drop_function":
      return created.functions.has(change.target);
    case "drop_policy":
      return created.policies.has(change.target);
    case "drop_trigger":
      return created.triggers.has(change.target);
    case "drop_table":
      return created.tables.has(change.target);
    default:
      return false;
  }
}

/** هل كان هدفُ التغييرِ موجوداً **قبلَ** هذه الهجرةِ؟ */
function existedBefore(change: SchemaChange, before: CreatedObjects): boolean {
  const table = change.target.split(".")[0] ?? change.target;
  switch (change.kind) {
    case "drop_table":
    case "truncate":
    case "revoke_table":
    case "rename":
    case "drop_view":
    case "drop_type":
      return before.tables.has(change.target);
    case "drop_column":
    case "set_not_null":
    case "set_data_type":
    case "drop_default":
      return before.tables.has(table) || before.columns.has(change.target);
    case "drop_function":
    case "revoke_function":
    case "stub_function":
      return before.functions.has(change.target);
    case "drop_policy":
      return before.policies.has(change.target);
    case "drop_trigger":
      return before.triggers.has(change.target);
    /**
     * `public` يملك `usage` على المخطّطِ `public` بحكمِ PostgreSQL نفسِه لا بمنحٍ
     * من هجرةٍ؛ فسحبُه تضييقٌ وإن لم يرَ خطُّ الزمنِ منحاً سابقاً.
     */
    case "revoke_schema":
      return change.target === "public" || before.schemaGrants.has(change.target);
    case "revoke_all_in_schema":
      return true;
    default:
      return false;
  }
}

function union(sets: readonly CreatedObjects[]): CreatedObjects {
  const merge = (pick: (value: CreatedObjects) => ReadonlySet<string>): Set<string> => {
    const out = new Set<string>();
    for (const set of sets) for (const value of pick(set)) out.add(value);
    return out;
  };
  return {
    tables: merge((value) => value.tables),
    columns: merge((value) => value.columns),
    functions: merge((value) => value.functions),
    policies: merge((value) => value.policies),
    triggers: merge((value) => value.triggers),
    schemaGrants: merge((value) => value.schemaGrants),
  };
}

/**
 * **مجموعةُ الخطرِ**: كلُّ تغييرٍ يُضيِّق أو يُزيل شيئاً كان موجوداً قبلَ هجرتِه
 * ولم تُعِد الهجرةُ نفسُها إنشاءَه. وهي بعينِها ما يجب أن يُعلَن في السجلِّ.
 *
 * والملفّاتُ تُقرأ **بترتيبِ أسمائِها** لأنّ ذلك هو ترتيبُ تطبيقِها في CI وفي
 * الإنتاجِ؛ ولو تغيّر الترتيبُ لتغيّر معنى «قبل».
 */
export function findRollbackRisks(migrations: readonly MigrationSource[]): SchemaChange[] {
  const ordered = [...migrations].sort((left, right) => left.file.localeCompare(right.file));
  const perFile = ordered.map((migration) => createdBy(blankSqlComments(migration.sql)));
  const risks: SchemaChange[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const migration = ordered[index];
    const created = perFile[index];
    if (migration === undefined || created === undefined) continue;
    const before = union(perFile.slice(0, index));
    for (const change of narrowingChanges(migration.file, migration.sql)) {
      if (recreatedInSameMigration(change, created)) continue;
      if (!existedBefore(change, before)) continue;
      risks.push(change);
    }
  }
  return risks;
}

/** وسمُ المطابقةِ بين مجموعةِ الخطرِ ومداخلِ السجلِّ. */
export function riskTag(change: Pick<SchemaChange, "migration" | "kind" | "target">): string {
  return `${change.migration}::${change.kind}:${change.target}`;
}

/**
 * وسومُ الخطرِ **بلا تكرارٍ** وبترتيبِ أوّلِ ظهورٍ. والتكرارُ واقعٌ: ثلاثةُ أسطرِ
 * `revoke` على دالّةٍ واحدةٍ لثلاثةِ أدوارٍ هي **خطرٌ واحدٌ** لا ثلاثةٌ، فلو طُلِب
 * لكلِّ سطرٍ مدخلٌ لصار السجلُّ نسخاً مكرّراً يُقرأ بلا معنى.
 */
export function uniqueRiskTags(risks: readonly SchemaChange[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const risk of risks) {
    const tag = riskTag(risk);
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
