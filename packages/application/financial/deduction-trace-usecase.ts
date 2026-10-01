/**
 * الغرض: منطقُ كشفِ الخصومِ التفصيليِّ للسائقِ (`DEC-37`) — يتحقّقُ من الجلسةِ
 *   ويُمرِّرُ المؤشِّرَ للمستودعِ. **قراءةٌ فقط**.
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: packages/application/financial
 */

import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  DEDUCTION_TRACE_DEFAULT_LIMIT,
  type DeductionEntry,
  type DeductionTracePage,
  type DeductionTracePublicErrorCode,
} from "./deduction-trace.ts";

/** مدخلاتُ كشفِ الخصومِ. */
export interface DeductionTraceInput {
  readonly accessToken: string | undefined;
  readonly limit: unknown;
  readonly cursorCreatedAt: unknown;
  readonly cursorId: unknown;
}

/** واجهةُ المستودعِ — تُحقَنُ لا تُستورَدُ. */
export interface DeductionTraceStore {
  listDeductions(input: {
    readonly telegramUserId: string;
    readonly limit: number;
    readonly cursor: { readonly createdAt: string; readonly id: string } | null;
  }): Promise<Result<DeductionTracePage, "STORE_ERROR">>;
}

/** تبعياتُ كشفِ الخصومِ. */
export interface DeductionTraceDeps {
  readonly sessions: MiniAppSessionReader;
  readonly now: () => Date;
  readonly store: DeductionTraceStore | null;
}

const DEFAULT_LIMIT = DEDUCTION_TRACE_DEFAULT_LIMIT;
const MAX_LIMIT = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** يُعيدُ كشفَ الخصومِ بترقيمِ مفتاحٍ. */
export async function listDeductionTrace(
  deps: DeductionTraceDeps,
  input: DeductionTraceInput,
): Promise<Result<DeductionTracePage, DeductionTracePublicErrorCode>> {
  if (input.accessToken === undefined || input.accessToken.length === 0) {
    return err("SESSION_REQUIRED");
  }
  const session = await deps.sessions.read(input.accessToken, deps.now().getTime());
  if (!session.ok) {
    switch (session.error.reason) {
      case "EXPIRED":
        return err("SESSION_EXPIRED");
      case "REVOKED":
        return err("SESSION_INVALID");
      case "MALFORMED":
      case "SIGNATURE_MISMATCH":
      case "UNSUPPORTED_VERSION":
      case "NOT_CONFIGURED":
        return err("SESSION_INVALID");
    }
  }

  if (deps.store === null) {
    return err("FINANCE_STORE_NOT_AVAILABLE");
  }

  let limit = DEFAULT_LIMIT;
  if (input.limit !== undefined && input.limit !== null && input.limit !== "") {
    const parsed = typeof input.limit === "number" ? input.limit : Number(input.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return err("LIMIT_OUT_OF_RANGE");
    }
    limit = parsed;
  }

  const hasCreatedAt =
    typeof input.cursorCreatedAt === "string" && input.cursorCreatedAt.length > 0;
  const hasId = typeof input.cursorId === "string" && input.cursorId.length > 0;
  if (hasCreatedAt !== hasId) return err("CURSOR_INVALID");

  let cursor: { readonly createdAt: string; readonly id: string } | null = null;
  if (hasCreatedAt && hasId) {
    const createdAt = input.cursorCreatedAt as string;
    const id = input.cursorId as string;
    if (Number.isNaN(new Date(createdAt).getTime()) || !UUID_PATTERN.test(id)) {
      return err("CURSOR_INVALID");
    }
    cursor = { createdAt, id };
  }

  const read = await deps.store.listDeductions({
    telegramUserId: session.value.telegramUserId,
    limit,
    cursor,
  });
  if (!read.ok) return err("FINANCE_STORE_NOT_AVAILABLE");

  return ok(read.value);
}

/** يُعيدُ قائمةَ الخصومِ كصفحةٍ — مُسهِّلٌ للاختبارِ. */
export function makeDeductionTracePage(
  deductions: readonly DeductionEntry[],
  hasMore: boolean,
): DeductionTracePage {
  const nextCursor =
    hasMore && deductions.length > 0
      ? {
          createdAt: deductions[deductions.length - 1]?.createdAt ?? "",
          id: deductions[deductions.length - 1]?.id ?? "",
        }
      : null;
  return { deductions, hasMore, nextCursor };
}
