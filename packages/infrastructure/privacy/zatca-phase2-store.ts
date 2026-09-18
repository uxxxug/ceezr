/**
 * الغرض: مخزنُ PostgREST لامتثال ZATCA المرحلة الثانية (F12-12).
 * الحالة: منفَّذٌ — البندُ F12-12.
 * ينتمي إلى: packages/infrastructure/privacy
 * الحاكم: ADR 0127 · ADR 0039
 */

import type {
  ChainVerificationResult,
  ReportingResult,
  StoreError,
  ZatcaPhase2Store,
} from "../../application/privacy/zatca-phase2.ts";
import type { ReportingStatus } from "../../domain/privacy/zatca-phase2.ts";
import type { Result } from "../../shared/result/index.ts";

type PostgrestClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function ok<T>(value: T): Result<T, StoreError> {
  return { ok: true, value };
}

function err(reason: StoreError["reason"]): Result<never, StoreError> {
  return { ok: false, error: { reason } };
}

export function createPostgrestZatcaPhase2Store(client: PostgrestClient): ZatcaPhase2Store {
  return {
    async verifyInvoiceChain(cityId: string): Promise<Result<ChainVerificationResult, StoreError>> {
      const { data, error } = await client.rpc("zatca_verify_invoice_chain", { p_city_id: cityId });
      if (error) return err("STORE_ERROR");
      const result = data as ChainVerificationResult;
      return ok(result);
    },

    async markInvoiceReported(
      invoiceId: string,
      status: ReportingStatus,
      zatcaUuid?: string,
    ): Promise<Result<ReportingResult, StoreError>> {
      const { data, error } = await client.rpc("mark_subscription_invoice_reported", {
        p_invoice_id: invoiceId,
        p_status: status,
        p_zatca_uuid: zatcaUuid ?? null,
      });
      if (error) return err("STORE_ERROR");
      const result = data as ReportingResult;
      if (!result.ok) {
        if (result.newStatus === "INVALID_STATUS") return err("INVALID_STATUS");
        if (result.previousStatus === "PENDING") return err("ALREADY_REPORTED");
        return err("NOT_FOUND");
      }
      return ok(result);
    },
  };
}
