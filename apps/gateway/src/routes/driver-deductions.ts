/**
 * الغرض: مسارُ كشفِ الخصومِ التفصيليِّ للسائقِ — `GET /v1/driver/deductions`
 *   (`DEC-37`). قراءةٌ فقط من سجلِّ المحفظةِ، لا اعتراضٌ ولا عكسُ قيدٍ.
 * الحالة: مُنفَّذٌ.
 * ينتمي إلى: apps/gateway/src/routes
 * الحاكم: `ADR 0161` — سطحُ المالِ للسائقِ.
 */

import type { Context } from "hono";
import { Hono } from "hono";
import type { DeductionTracePublicErrorCode } from "../../../../packages/application/financial/deduction-trace.ts";
import type { DeductionTraceDeps } from "../../../../packages/application/financial/deduction-trace-usecase.ts";
import { listDeductionTrace } from "../../../../packages/application/financial/deduction-trace-usecase.ts";

export interface DriverDeductionsRouteDependencies {
  /** غيابُها **يُعطّلُ المسارَ بـ503**. */
  readonly deductions?: DeductionTraceDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

const STATUS_BY_ERROR: Readonly<Record<DeductionTracePublicErrorCode, 401 | 403 | 422 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  FINANCE_STORE_NOT_AVAILABLE: 503,
  LIMIT_OUT_OF_RANGE: 422,
  CURSOR_INVALID: 422,
  NOT_A_DRIVER: 403,
};

function rejected(c: Context, error: DeductionTracePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export function createDriverDeductionsRoutes(deps: DriverDeductionsRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/driver/deductions", async (c) => {
    if (deps.deductions === undefined) {
      deps.log?.("driver_deductions.list_disabled", {});
      return rejected(c, "FINANCE_STORE_NOT_AVAILABLE");
    }

    const result = await listDeductionTrace(deps.deductions, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      limit: c.req.query("limit"),
      cursorCreatedAt: c.req.query("before_created_at"),
      cursorId: c.req.query("before_id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const page = result.value;
    return c.json({
      ok: true,
      deductions: page.deductions,
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
    });
  });

  return app;
}

/** يُستخرَجُ رمزُ الحاملِ من ترويسةِ التفويضِ. */
function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}
