/**
 * # منطقُ سلامةِ الهجراتِ — قواعدُ `CAP-007` مقروءةً من نصِّ الهجرةِ وحدَه
 *
 * **الغرض:** هذا الملفُّ **مصدرُ الحقيقةِ الوحيدُ** لسؤالِ «هل هذه الهجرةُ آمنةٌ
 * على إنتاجٍ حيٍّ؟». يقرأُه اثنانِ لا واحدٌ: الحاجزُ الساكنُ في CI
 * (`scripts/check-migration-safety.ts`)، **والمُطبِّقُ نفسُه**
 * (`scripts/migrate.ts`) قبلَ أن يُخاطِبَ قاعدةً. فلا قاعدةَ مكتوبةٌ مرّتَينِ،
 * ولا مُطبِّقٌ يُطبِّقُ ما يرفضُه الحاجزُ.
 *
 * **الحالة:** `F7-07` / `CAP-007` — مُنفَّذ · مُختبَر.
 *
 * **ينتمي إلى:** `scripts/lib`.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** كلُّ هجرةٍ جديدةٍ بعدَ حدِّ التقادمِ في
 * `migration-baseline.ts`.
 *
 * **ملاحظات مستقبلية:** التقسيمُ الزمنيُّ (`F7-03`) سيُدخِلُ `attach partition`
 * وهي عمليّةٌ لها قفلُها الخاصُّ؛ فتُضافُ قاعدةٌ سادسةٌ حينَها لا تُخفَّفُ الخمسُ.
 *
 * **ما لا يفعله هذا المنطقُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً ولا يعرفُ حجمَ جدولٍ.** حكمُه على النصِّ: «هذه العبارةُ
 *   تأخذُ قفلاً حاجزاً على جدولٍ قد يكونَ كبيراً»، لا «هذه العبارةُ ستُعطِّلُ
 *   الإنتاجَ اليومَ».
 * - **لا يقرأُ نصّاً مُركَّباً في زمنِ التشغيلِ.** هجرةٌ تبني DDL بـ
 *   `execute format(…)` تُفلِتُ من كلِّ مطابقةٍ نصّيّةٍ — وهذا حدٌّ معروفٌ
 *   مشتركٌ معَ `check-rollback-safety`، ومَن يقيسُ الفعلَ لا النصَّ هو
 *   `rollback-schema-drill` على قاعدةٍ حقيقيّةٍ.
 * - **لا يحكمُ على صحّةِ الهجرةِ منطقيّاً.** `check-migrations` يفرضُ `city_id`
 *   و`RLS`، وهذا يفرضُ القفلَ والاسترجاعَ — بابانِ لا بابٌ واحدٌ يُوسَّعُ.
 */

/** أطوارُ نمطِ expand → backfill → validate → switch → contract (`CAP-007`). */
export const MIGRATION_PHASES = [
  "expand",
  "backfill",
  "validate",
  "switch",
  "contract",
  "index",
] as const;

export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

/** الصيغةُ الحرفيّةُ التي تُصرِّحُ بالطورِ — سطرُ تعليقٍ لا اسمُ ملفٍّ. */
export const PHASE_DECLARATION_PREFIX = "-- migration-phase:";

export interface SafetyFinding {
  /** رمزٌ ثابتٌ يُقرأُ آليّاً ولا يُترجَمُ. */
  readonly code: SafetyCode;
  /** رقمُ السطرِ في الملفِّ (يبدأُ من واحدٍ) أو `null` لحكمٍ على الملفِّ كلِّه. */
  readonly line: number | null;
  /** سببٌ بالعربيّةِ للقارئِ البشريِّ. */
  readonly reason: string;
}

export type SafetyCode =
  | "PHASE_MISSING"
  | "PHASE_UNKNOWN"
  | "INDEX_NOT_CONCURRENT"
  | "CONCURRENT_INDEX_NOT_ALONE"
  | "CONCURRENT_INDEX_WRONG_PHASE"
  | "CONSTRAINT_NOT_VALID_MISSING"
  | "SET_NOT_NULL_FORBIDDEN"
  | "DESTRUCTIVE_OUTSIDE_CONTRACT"
  | "NOT_IDEMPOTENT"
  | "EXPLICIT_TRANSACTION";

/**
 * قسمةُ نصِّ SQL إلى عباراتٍ على الفاصلةِ المنقوطةِ **خارجَ** الاقتباسِ
 * والتعليقِ والاقتباسِ بالدولارِ.
 *
 * وهذه القسمةُ ليست ترفاً: دوالُّ PL/pgSQL في هذا المستودعِ أجسامُها
 * `$$ … ; … $$`، فقسمةٌ ساذجةٌ على `;` تشطُرُ دالّةً نصفَينِ فتُفشِلُ الهجرةَ
 * بخطأٍ نحويٍّ غامضٍ. والمُطبِّقُ يحتاجُها لأنَّ `create index concurrently` **لا
 * تُقبَلُ داخلَ معاملةٍ**، فلا بدَّ من إرسالِها وحدَها.
 */
export function splitStatements(sql: string): { text: string; line: number }[] {
  const statements: { text: string; line: number }[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  let index = 0;
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  const flush = (): void => {
    if (buffer.trim().length > 0) statements.push({ text: buffer.trim(), line: startLine });
    buffer = "";
    startLine = line;
  };
  /**
   * موضعُ العبارةِ سطرُ أوّلِ حرفٍ غيرِ فارغٍ فيها لا سطرُ الفاصلةِ التي قبلَها؛
   * فالحكمُ يُقرأُ في السطرِ الذي يراهُ المراجعُ.
   */
  const noteStart = (char: string): void => {
    if (buffer.trim().length === 0 && char.trim().length > 0) startLine = line;
  };

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (inLineComment) {
      buffer += char;
      if (char === "\n") {
        inLineComment = false;
        line += 1;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      buffer += char;
      if (char === "\n") line += 1;
      if (char === "*" && next === "/") {
        buffer += next;
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buffer += char;
      if (char === "\n") line += 1;
      index += 1;
      continue;
    }
    if (inSingleQuote) {
      buffer += char;
      if (char === "\n") line += 1;
      if (char === "'") {
        // `''` هَربٌ داخلَ النصِّ لا نهايةٌ له.
        if (next === "'") {
          buffer += next;
          index += 2;
          continue;
        }
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      noteStart(char);
      inLineComment = true;
      buffer += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      noteStart(char);
      inBlockComment = true;
      buffer += char;
      index += 1;
      continue;
    }
    if (char === "'") {
      noteStart(char);
      inSingleQuote = true;
      buffer += char;
      index += 1;
      continue;
    }
    if (char === "$") {
      const tag = /^\$[a-z_]*\$/i.exec(sql.slice(index));
      if (tag !== null) {
        noteStart(char);
        dollarTag = tag[0];
        buffer += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }
    if (char === ";") {
      buffer += char;
      flush();
      index += 1;
      continue;
    }
    noteStart(char);
    if (char === "\n") line += 1;
    buffer += char;
    index += 1;
  }
  flush();
  return statements;
}

/** النصُّ بلا تعليقاتٍ ولا نصوصٍ مقتبسةٍ — لمطابقةِ الأنماطِ بلا نجاحٍ كاذبٍ. */
function strippedOf(statement: string): string {
  return statement
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, " ")
    .replace(/'(?:[^']|'')*'/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** الطورُ المُصرَّحُ في رأسِ الملفِّ، أو `null` إن لم يُصرَّح. */
export function declaredPhase(sql: string): { value: string | null; known: MigrationPhase | null } {
  for (const rawLine of sql.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith(PHASE_DECLARATION_PREFIX)) continue;
    const value = trimmed.slice(PHASE_DECLARATION_PREFIX.length).trim();
    const known = (MIGRATION_PHASES as readonly string[]).includes(value)
      ? (value as MigrationPhase)
      : null;
    return { value, known };
  }
  return { value: null, known: null };
}

/** هل هذه العبارةُ `create index concurrently`؟ (لا تُقبَلُ داخلَ معاملةٍ) */
export function isConcurrentIndex(statement: string): boolean {
  return /\bcreate\s+(unique\s+)?index\s+concurrently\b/.test(strippedOf(statement));
}

/** هل العبارةُ تُنشئُ فهرساً أصلاً — متزامناً كانَ أو حاجزاً؟ */
function isIndexCreation(stripped: string): boolean {
  return /\bcreate\s+(unique\s+)?index\b/.test(stripped);
}

/**
 * القواعدُ الستُّ على عبارةٍ واحدةٍ، مُعلَّلةً كلُّ واحدةٍ بالقفلِ الذي تمنعُه.
 */
function judgeStatement(
  statement: string,
  line: number,
  phase: MigrationPhase | null,
  statementCount: number,
): SafetyFinding[] {
  const found: SafetyFinding[] = [];
  const s = strippedOf(statement);
  if (s.trim().length === 0) return found;

  if (/^\s*(begin|commit|rollback|start\s+transaction)\b/.test(s)) {
    found.push({
      code: "EXPLICIT_TRANSACTION",
      line,
      reason:
        "المعاملةُ يملكُها المُطبِّقُ لا الملفُّ: معاملةٌ مكتوبةٌ في الهجرةِ تُبطِلُ مهلةَ القفلِ التي يضبطُها المُطبِّقُ، وتمنعُ الفهرسَ المتزامنَ.",
    });
  }

  if (isIndexCreation(s)) {
    if (!/\bconcurrently\b/.test(s)) {
      found.push({
        code: "INDEX_NOT_CONCURRENT",
        line,
        reason:
          "`create index` بلا `concurrently` تأخذُ قفلاً يمنعُ الكتابةَ على الجدولِ حتّى تنتهي — على جدولٍ حارٍّ ذلكَ توقُّفُ خدمةٍ (CAP-007).",
      });
    } else {
      if (statementCount !== 1) {
        found.push({
          code: "CONCURRENT_INDEX_NOT_ALONE",
          line,
          reason:
            "`create index concurrently` لا تُقبَلُ داخلَ معاملةٍ، والمُطبِّقُ يُرسِلُ الملفَّ متعدِّدَ العباراتِ في معاملةٍ واحدةٍ؛ فليكن الفهرسُ المتزامنُ في ملفٍّ وحدَه.",
        });
      }
      if (phase !== "index") {
        found.push({
          code: "CONCURRENT_INDEX_WRONG_PHASE",
          line,
          reason: "ملفُّ الفهرسِ المتزامنِ يُصرِّحُ `-- migration-phase: index` ليُطبَّقَ بلا معاملةٍ.",
        });
      }
    }
  }

  if (/\badd\s+constraint\b/.test(s) && /\b(check|foreign\s+key)\b/.test(s)) {
    if (!/\bnot\s+valid\b/.test(s)) {
      found.push({
        code: "CONSTRAINT_NOT_VALID_MISSING",
        line,
        reason:
          "قيدٌ يُضافُ بلا `not valid` يمسحُ الجدولَ كلَّه تحتَ قفلٍ حاجزٍ؛ فيُضافُ `not valid` ثمَّ يُصادَقُ في طورِ `validate` بقفلٍ أخفَّ.",
      });
    }
  }

  if (/\balter\s+(table|column)\b/.test(s) && /\bset\s+not\s+null\b/.test(s)) {
    found.push({
      code: "SET_NOT_NULL_FORBIDDEN",
      line,
      reason:
        "`set not null` مسحٌ كاملٌ تحتَ قفلٍ حاجزٍ؛ والبديلُ المُعتمَدُ قيدُ `check (col is not null) not valid` ثمَّ `validate constraint` ثمَّ التبديلُ.",
    });
  }

  if (/\b(drop\s+table|drop\s+column|drop\s+constraint|rename\s+(to|column))\b/.test(s)) {
    if (phase !== "contract") {
      found.push({
        code: "DESTRUCTIVE_OUTSIDE_CONTRACT",
        line,
        reason:
          "الحذفُ وإعادةُ التسميةِ يكسرانِ النسخةَ العاملةَ إن سبقا نشرَها؛ فمحلُّهما ملفُّ طورِ `contract` وحدَه بعدَ التبديلِ.",
      });
    }
  }

  const idempotence = judgeIdempotence(s);
  if (idempotence !== null) found.push({ code: "NOT_IDEMPOTENT", line, reason: idempotence });

  return found;
}

/**
 * الاسترجاعُ (idempotence) شرطٌ لا ترفٌ في هذا المستودعِ: لا سجلَّ هجراتٍ
 * مُطبَّقةٍ (وذلكَ قرارٌ مُعلَنٌ في ADR — القاعدةُ 0.4 السياديّةُ تفرضُ `city_id`
 * على كلِّ جدولٍ، وسجلُّ الهجراتِ ليسَ بياناً مدينيّاً، وتوسيعُ الاستثناءِ قرارُ
 * مالكٍ). فالمُطبِّقُ يُعيدُ الملفّاتِ كلَّها في كلِّ تشغيلٍ، وأمانُ ذلكَ يُفرَضُ
 * ههنا نصّاً ويُقاسُ في CI بتطبيقٍ مرّتَينِ على قاعدةٍ حقيقيّةٍ.
 */
function judgeIdempotence(s: string): string | null {
  if (/\bcreate\s+table\b/.test(s) && !/\bcreate\s+table\s+if\s+not\s+exists\b/.test(s)) {
    return "`create table` بلا `if not exists`: المُطبِّقُ يُعيدُ كلَّ ملفٍّ في كلِّ تشغيلٍ فتسقطُ الهجرةُ في الجولةِ الثانيةِ.";
  }
  if (
    /\bcreate\s+(unique\s+)?index\b/.test(s) &&
    !/\bcreate\s+(unique\s+)?index\s+(concurrently\s+)?if\s+not\s+exists\b/.test(s)
  ) {
    return "`create index` بلا `if not exists`: تسقطُ في الجولةِ الثانيةِ من التطبيقِ.";
  }
  if (
    /\bdrop\s+(table|column|constraint|index|type|function)\b/.test(s) &&
    !/\bif\s+exists\b/.test(s)
  ) {
    return "`drop` بلا `if exists`: تسقطُ في الجولةِ الثانيةِ من التطبيقِ.";
  }
  if (
    /\binsert\s+into\b/.test(s) &&
    !/\bon\s+conflict\b/.test(s) &&
    !/\bselect\b[\s\S]*\bwhere\s+not\s+exists\b/.test(s)
  ) {
    return "`insert` بلا `on conflict` ولا `where not exists`: البذرُ يتضاعفُ في الجولةِ الثانيةِ.";
  }
  return null;
}

/** حكمُ ملفٍّ كاملٍ: الطورُ أوّلاً ثمَّ عباراتُه واحدةً واحدةً. */
export function judgeMigration(sql: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const phase = declaredPhase(sql);
  if (phase.value === null) {
    findings.push({
      code: "PHASE_MISSING",
      line: null,
      reason: `الطورُ غيرُ مُصرَّحٍ: يلزمُ سطرُ \`${PHASE_DECLARATION_PREFIX} <${MIGRATION_PHASES.join("|")}>\` في رأسِ الملفِّ.`,
    });
  } else if (phase.known === null) {
    findings.push({
      code: "PHASE_UNKNOWN",
      line: null,
      reason: `طورٌ غيرُ معروفٍ «${phase.value}»؛ المسموحُ: ${MIGRATION_PHASES.join(" · ")}.`,
    });
  }

  const statements = splitStatements(sql).filter((s) => strippedOf(s.text).trim().length > 0);
  for (const statement of statements) {
    findings.push(
      ...judgeStatement(statement.text, statement.line, phase.known, statements.length),
    );
  }
  return findings;
}

/** خُطّةُ تطبيقِ ملفٍّ: هل يُغلَّفُ بمعاملةٍ أم يُرسَلُ عبارةً عبارةً بلا معاملةٍ؟ */
export interface ApplyPlan {
  readonly transactional: boolean;
  readonly statements: readonly string[];
}

/**
 * طورُ `index` وحدَه يُطبَّقُ بلا معاملةٍ (شرطُ `concurrently`)، وما سواه يُغلَّفُ
 * بمعاملةٍ واحدةٍ فيسقطُ كلُّه أو ينجحُ كلُّه — لا مخطَّطَ نصفَ مُطبَّقٍ.
 */
export function planFor(sql: string): ApplyPlan {
  const phase = declaredPhase(sql).known;
  const statements = splitStatements(sql)
    .map((s) => s.text)
    .filter((text) => strippedOf(text).trim().length > 0);
  const concurrent = phase === "index" || statements.some((text) => isConcurrentIndex(text));
  return { transactional: !concurrent, statements };
}
