/**
 * الغرض: قاعدةُ حاجزٍ واحدةٌ — **لا عمودَ من نوعِ `date` في عقدِ خرجِ دالّةِ
 *   قاعدةٍ** (`returns table( … )` أو مُعامِلٍ `out`). التاريخُ المجرَّدُ يعبرُ
 *   الحدَّ نصّاً بصيغةِ `YYYY-MM-DD` عبرَ `to_char(x, 'YYYY-MM-DD')`.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: scripts/check-date-only-boundary.ts و
 *   tests/unit/check-date-only-boundary.test.ts
 * يُتوقع أن يستخدمه لاحقاً: كلُّ دالّةٍ تُخرِجُ تاريخَ انتهاءٍ أو تاريخَ يومٍ —
 *   وهم كثيرٌ: الوثائقُ والاشتراكاتُ والتقاريرُ اليوميّةُ.
 * الحاكم: docs/adr/0121-a-bare-date-crosses-the-boundary-as-text.md
 *
 * ## لماذا وُجِدَ هذا الحاجزُ
 * سائقُ `postgres.js` يُحوِّلُ عمودَ `date` إلى `Date` في JavaScript عندَ
 * **منتصفِ ليلِ UTC**. ومحوِّلاتُ هذا المستودَعِ تقرأُ التواريخَ بدالّةٍ عقدُها
 * `string | null` — فتقرأُ الكائنَ `Date` **عَدَماً** بلا خطأٍ ولا سجلٍّ. وقد
 * دُفِعَ ثمنُ ذلكَ في البندِ `F3-07`: دالّةُ `driver_vehicle` أخرجَت ثلاثةَ
 * تواريخِ انتهاءٍ بنوعِ `date`، فكانَ المحوِّلُ يمحوها كلَّها صمتاً، **فشاشةُ
 * مركبةِ السائقِ تُخفي انتهاءَ رخصةِ السيرِ والتأمينِ والفحصِ** — وهي الحقيقةُ
 * التي تحجُبُ السائقَ عن العملِ (`ADR 0115`). ولم يُكشَف العطبُ إلّا لأنَّ
 * اختبارَ تكاملٍ قاسَ القيمةَ نصّاً فسقطَ في CI.
 *
 * وحتّى لو عُرِضَ الكائنُ، فالتاريخُ المجرَّدُ **لا لحظةَ له**: `2027-01-01`
 * بمنتصفِ ليلِ UTC يُقرأُ عندَ من يقرأُ بتوقيتِ الرياضِ (+03) صحيحاً، لكنَّ
 * أيَّ تنسيقٍ بتوقيتٍ غربَ غرينتش يُظهِرُ **اليومَ السابقَ**. فالنقلُ لحظةً
 * كذبٌ في النوعِ قبلَ أن يكونَ عطباً في العرضِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 * ــ **لا يمنعُ عمودَ `date` في جدولٍ**: التخزينُ تاريخاً مجرَّداً صوابٌ —
 *    المنعُ في **عقدِ الخرجِ** وحدَه حيثُ يمرُّ بسائقٍ.
 * ــ **لا يمنعُ مُعامِلَ دخلٍ من نوعِ `date`**: الدخلُ يُمرَّرُ نصّاً من العميلِ
 *    ويُحوِّلُه PostgreSQL، ولا سائقَ يُفسِّرُه في الاتّجاهِ الآخرِ.
 * ــ **لا يمسُّ `timestamptz`**: اللحظةُ لها لحظةٌ، وتحويلُها إلى `Date` صادقٌ.
 * ــ **لا يُصلِحُ آلياً**: صيغةُ العرضِ قرارُ بندٍ، والتخمينُ ههنا يُنتِجُ
 *    عطباً أهدأَ لا أقلَّ.
 */

import { toPosixPath } from "./repo-path.ts";

/** مجلَّدُ الهجراتِ المفحوصُ — لا سواه، إذ لا عقدَ خرجٍ خارجَه. */
export const MIGRATIONS_ROOT = "supabase/migrations";

/**
 * ملفُّ السالباتِ المزروعةِ وحدَه: واجبُهُ أن يحملَ النمطَ الممنوعَ نصّاً —
 * ومنهُ **العقدُ الذي أسقطَ CI بالفعلِ في `F3-07`** — وإلّا لم يُقَسِ الحاجزُ.
 */
export const PLANTED_NEGATIVE_FILES: ReadonlySet<string> = new Set([
  "tests/unit/check-date-only-boundary.test.ts",
]);

export interface DateOnlyViolation {
  readonly file: string;
  readonly line: number;
  readonly functionName: string;
  readonly column: string;
}

/** يمحو التعليقاتَ سطراً سطراً مع الحفاظِ على عددِ الأسطرِ ليصدُقَ رقمُ السطرِ. */
function blankSqlComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** اسمُ الدالّةِ الأقربُ قبلَ موضعٍ — ليقولَ الحكمُ **أيَّ** دالّةٍ لا «هجرةً ما». */
function functionNameBefore(source: string, index: number): string {
  const head = source.slice(0, index);
  const matches = [...head.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)/gi)];
  const last = matches.at(-1);
  return last?.[1]?.replace(/"/g, "") ?? "(دالّةٌ بلا اسمٍ مقروءٍ)";
}

/** يقرأُ جسمَ `returns table( … )` بموازنةِ الأقواسِ لا بجَشَعِ التعبيرِ النمطيِّ. */
function readBalanced(source: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** عمودٌ من نوعِ `date` مجرَّدٍ: `<اسم> date` ولا `timestamp` ولا `daterange`. */
const DATE_COLUMN = /^([a-z0-9_"]+)\s+date(\s*\[\s*\])?$/i;

/**
 * يقرأُ نصَّ هجرةٍ ويردُّ خرقَها. دالّةٌ خالصةٌ: الاختبارُ يزرعُ نصّاً ولا يحتاجُ
 * قرصاً — وبلا ذلكَ يصيرُ قياسُ الحاجزِ رهنَ ما يصادفُه في المستودَعِ (ح-٧).
 */
export function dateOnlyViolationsIn(file: string, source: string): readonly DateOnlyViolation[] {
  if (PLANTED_NEGATIVE_FILES.has(toPosixPath(file))) return [];
  const sql = blankSqlComments(source);
  const found: DateOnlyViolation[] = [];

  for (const match of sql.matchAll(/returns\s+table\s*\(/gi)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const balanced = readBalanced(sql, open);
    if (balanced === null) continue;
    const functionName = functionNameBefore(sql, match.index ?? 0);
    const lineOfOpen = sql.slice(0, open).split("\n").length;

    let depth = 0;
    let current = "";
    let offsetLine = 0;
    const columns: { text: string; line: number }[] = [];
    // سطرُ العمودِ هوَ سطرُ **أوّلِ حرفٍ منطوقٍ** فيه لا سطرُ الفاصلةِ قبلَه:
    // الفاصلةُ تسبقُ سطرَ العمودِ التاليِ، فحسابُها يُنقِصُ رقمَ السطرِ واحداً،
    // ورقمُ سطرٍ خاطئٌ يُهمَلُ كما تُهمَلُ رسالةٌ غامضةٌ.
    let columnStartLine: number | null = null;
    for (const ch of balanced.body) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        columns.push({ text: current, line: columnStartLine ?? lineOfOpen });
        current = "";
        columnStartLine = null;
        continue;
      }
      if (ch === "\n") {
        offsetLine += 1;
      } else if (columnStartLine === null && ch.trim().length > 0) {
        columnStartLine = lineOfOpen + offsetLine;
      }
      current += ch;
    }
    columns.push({ text: current, line: columnStartLine ?? lineOfOpen });

    for (const column of columns) {
      const text = column.text.trim().replace(/\s+/g, " ");
      if (text.length === 0) continue;
      const hit = DATE_COLUMN.exec(text);
      if (hit === null) continue;
      found.push({
        file,
        line: column.line,
        functionName,
        column: (hit[1] ?? "").replace(/"/g, ""),
      });
    }
  }

  return found;
}

/** رسالةُ الخرقِ — تقولُ البديلَ لا العيبَ وحدَه. */
export function describeDateOnlyViolation(violation: DateOnlyViolation): string {
  return [
    `${violation.file}:${String(violation.line)}: ` +
      `${violation.functionName} ⇒ ${violation.column} date`,
    "      عمودُ `date` في عقدِ خرجٍ يصلُ العميلَ كائنَ `Date` عندَ منتصفِ ليلِ UTC،",
    "      فيقرأُه المحوِّلُ الذي عقدُه `string | null` عَدَماً بلا خطأٍ ولا سجلٍّ.",
    "      البديلُ: أعلِن العمودَ `text` واقرأه " + "`to_char(<العمود>, 'YYYY-MM-DD')` (ADR 0121).",
  ].join("\n");
}
