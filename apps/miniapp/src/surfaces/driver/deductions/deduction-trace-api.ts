/**
 * الغرض: نداءُ كشفِ الخصومِ التفصيليِّ للسائقِ — `GET /v1/driver/deductions`
 *   (`DEC-37`). قراءةٌ فقط من سجلِّ المحفظةِ.
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/deductions
 */

export const DRIVER_DEDUCTIONS_PATH = "/v1/driver/deductions";

export interface DeductionTraceEntry {
  readonly id: string;
  readonly reference: string | null;
  readonly entryKind: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface DeductionTraceResponse {
  readonly ok: true;
  readonly deductions: readonly DeductionTraceEntry[];
  readonly has_more: boolean;
  readonly next_cursor: { readonly created_at: string; readonly id: string } | null;
}

export async function readDeductionTrace(input: {
  readonly accessToken: string | null;
  readonly limit?: number;
  readonly cursorCreatedAt?: string | null;
  readonly cursorId?: string | null;
}): Promise<DeductionTraceResponse> {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursorCreatedAt) params.set("before_created_at", input.cursorCreatedAt);
  if (input.cursorId) params.set("before_id", input.cursorId);

  const qs = params.toString();
  const url = `${DRIVER_DEDUCTIONS_PATH}${qs.length > 0 ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: input.accessToken ? { authorization: `Bearer ${input.accessToken}` } : {},
  });

  const body = (await res.json()) as DeductionTraceResponse | { ok: false; error: string };
  if (!("ok" in body) || !body.ok) {
    throw new Error("DEDUCTION_TRACE_FAILED");
  }

  return body;
}
