/**
 * الغرض: مستودعُ كشفِ الخصومِ — يقرأُ من `subscription_wallet_entries` عبرَ
 *   دالّةِ PostgreSQL `driver_deduction_trace` (`DEC-37`).
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: packages/infrastructure/financial
 */

import type { Sql } from "postgres";
import type {
  DeductionEntry,
  DeductionTracePage,
} from "../../application/financial/deduction-trace.ts";
import type { DeductionTraceStore } from "../../application/financial/deduction-trace-usecase.ts";
import { err, ok } from "../../shared/result/index.ts";

interface DeductionRow {
  readonly id: string;
  readonly reference: string | null;
  readonly entry_kind: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly reason: string | null;
  readonly created_at: string;
}

interface FunctionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly deductions?: readonly DeductionRow[];
  readonly has_more?: boolean;
  readonly next_cursor?: { readonly created_at: string; readonly id: string } | null;
}

export function createDeductionTraceStore(sql: Sql): DeductionTraceStore {
  return {
    async listDeductions(input) {
      let rows: { result: FunctionResult }[];
      try {
        rows = await sql<{ result: FunctionResult }[]>`
          select driver_deduction_trace(
            ${input.telegramUserId}::bigint,
            ${input.limit}::integer,
            ${input.cursor?.createdAt ?? null}::timestamptz,
            ${input.cursor?.id ?? null}::uuid
          ) as result
        `;
      } catch {
        return err("STORE_ERROR");
      }

      const result = rows[0]?.result;
      if (result === undefined || result.ok !== true) {
        return err("STORE_ERROR");
      }

      const deductions: readonly DeductionEntry[] = (result.deductions ?? []).map((r) => ({
        id: r.id,
        reference: r.reference,
        entryKind: r.entry_kind,
        amountMinor: r.amount_minor,
        currency: r.currency,
        reason: r.reason,
        createdAt: r.created_at,
      }));

      const nextCursor = result.next_cursor ?? null;
      const page: DeductionTracePage = {
        deductions,
        hasMore: result.has_more ?? false,
        nextCursor:
          nextCursor === null ? null : { createdAt: nextCursor.created_at, id: nextCursor.id },
      };

      return ok(page);
    },
  };
}
