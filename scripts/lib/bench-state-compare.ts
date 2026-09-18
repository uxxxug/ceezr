/**
 * دوالُّ صرفةٌ لمقارنةِ حالةِ قاعدةِ القياس — بلا قاعدةِ بيانات.
 *
 * وُضِعَت ههنا لتُختبَر وتُستوردَ بلا خرقِ منطقةِ التأجيل: `state.ts` في
 * `deferred/` يستوردُ هذه الدوالَ، واختباراتُ الوحدةِ تستوردُها من ههنا.
 */

import { createHash } from "node:crypto";

/** أعمدةٌ تُكتَب من ساعة الجدار، فلا تدخل بصمةَ الحالة المنطقيّة. */
export const VOLATILE_COLUMNS = ["created_at", "updated_at"] as const;

export interface TableState {
  readonly table: string;
  readonly rows: number;
  readonly digest: string;
  readonly portableDigest: string;
}

export const PORTABLE_DIGEST_ROW_LIMIT = 250_000;

export interface StateSnapshot {
  readonly database: string;
  readonly capturedAt: string;
  readonly tables: readonly TableState[];
  readonly preserved: readonly TableState[];
  readonly totalRows: number;
}

export type StateDifferenceKind =
  | "missing_table"
  | "extra_table"
  | "row_count"
  | "content"
  | "identity_only";

export interface StateDifference {
  readonly kind: StateDifferenceKind;
  readonly table: string;
  readonly detail: string;
}

export interface StateComparison {
  readonly identical: boolean;
  readonly differences: readonly StateDifference[];
  readonly identityOnly: readonly StateDifference[];
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * يستبدل في نصّ الصفّ كلَّ معرّفٍ مُسنَدٍ من القاعدة باسمه المنطقيّ.
 *
 * دالّةٌ صرفةٌ عن قصد: منطقُ التقييس هو موضعُ الخطأ المحتمل.
 */
export function canonicalizeRowJson(json: string, aliases: ReadonlyMap<string, string>): string {
  if (aliases.size === 0) return json;
  return json.replace(UUID_PATTERN, (match) => aliases.get(match.toLowerCase()) ?? match);
}

/**
 * مقارنةٌ آليّةٌ لا بصريّة، وتُسمّي ما اختلف لا أنّه اختلف.
 *
 * والمقارنةُ تجري على **البصمة المنقولة**، لأنّ السّؤال المقصود دائماً هو هل
 * الحالةُ المنطقيّة واحدة، لا هل أسندت القاعدةُ المعرّفاتِ العشوائيّة نفسَها.
 */
export function compareStates(before: StateSnapshot, after: StateSnapshot): StateComparison {
  const differences: StateDifference[] = [];
  const identityOnly: StateDifference[] = [];
  const beforeMap = new Map([...before.tables, ...before.preserved].map((t) => [t.table, t]));
  const afterMap = new Map([...after.tables, ...after.preserved].map((t) => [t.table, t]));

  for (const [table, left] of beforeMap) {
    const right = afterMap.get(table);
    if (right === undefined) {
      differences.push({
        kind: "missing_table",
        table,
        detail: `كان فيه ${left.rows} صفّاً وصار فارغاً`,
      });
      continue;
    }
    if (left.rows !== right.rows) {
      differences.push({
        kind: "row_count",
        table,
        detail: `عدد الصفوف ${left.rows} ← ${right.rows}`,
      });
      continue;
    }
    if (left.portableDigest !== right.portableDigest) {
      differences.push({
        kind: "content",
        table,
        detail: `العدد نفسه (${left.rows}) لكن المحتوى مختلف: ${left.portableDigest.slice(0, 12)} ← ${right.portableDigest.slice(0, 12)}`,
      });
      continue;
    }
    if (left.digest !== right.digest) {
      identityOnly.push({
        kind: "identity_only",
        table,
        detail: `الحالة المنطقيّة نفسُها (${left.rows} صفّاً)، واختلفت المعرّفاتُ المُسنَدة: ${left.digest.slice(0, 12)} ← ${right.digest.slice(0, 12)}`,
      });
    }
  }

  for (const [table, right] of afterMap) {
    if (!beforeMap.has(table)) {
      differences.push({
        kind: "extra_table",
        table,
        detail: `كان فارغاً وصار فيه ${right.rows} صفّاً`,
      });
    }
  }

  return { identical: differences.length === 0, differences, identityOnly };
}

export function formatComparison(comparison: StateComparison): string {
  const lines = [...comparison.differences, ...comparison.identityOnly].map(
    (d) => `- [${d.kind}] ${d.table}: ${d.detail}`,
  );
  if (comparison.identical) {
    return comparison.identityOnly.length === 0
      ? "الحالتان متطابقتان منطقيّاً."
      : `الحالتان متطابقتان منطقيّاً، مع اختلاف معرّفاتٍ مُسنَدةٍ من القاعدة:\n${lines.join("\n")}`;
  }
  return lines.join("\n");
}

export function emptyDigest(): string {
  return createHash("md5").update("").digest("hex");
}
