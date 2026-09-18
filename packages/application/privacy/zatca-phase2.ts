/**
 * الغرض: حالاتُ استخدامِ امتثال ZATCA المرحلة الثانية — التحقُّق من السلسلة
 *   والإبلاغ (F12-12).
 * الحالة: منفَّذٌ — البندُ F12-12.
 * ينتمي إلى: packages/application/privacy
 * الحاكم: ADR 0127 · ADR 0039
 */

import type { ReportingStatus } from "../../domain/privacy/zatca-phase2.ts";
import type { Result } from "../../shared/result/index.ts";

export interface ZatcaPhase2Store {
  /** التحقُّقُ من سلامةِ سلسلةِ تجزئةِ الفواتيرِ في مدينة */
  verifyInvoiceChain(cityId: string): Promise<Result<ChainVerificationResult, StoreError>>;
  /** تسجيلُ حالةِ إبلاغِ فاتورةٍ */
  markInvoiceReported(
    invoiceId: string,
    status: ReportingStatus,
    zatcaUuid?: string,
  ): Promise<Result<ReportingResult, StoreError>>;
}

export interface ChainVerificationResult {
  ok: boolean;
  total: number;
  broken: number;
}

export interface ReportingResult {
  ok: boolean;
  previousStatus: string;
  newStatus: string;
}

export type StoreError = {
  reason: "STORE_ERROR" | "NOT_FOUND" | "ALREADY_REPORTED" | "INVALID_STATUS";
};
