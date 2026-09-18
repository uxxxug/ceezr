/**
 * الغرض: تطبيقُ امتثال PDPL — حالاتُ استخدامٍ للتحقُّقِ من أنشطةِ المعالجةِ
 *   وطلباتِ أصحابِ البياناتِ وتقييماتِ الأثرِ والنقلِ خارجَ المملكةِ (F12-10).
 * الحالة: منفَّذٌ — البندُ F12-10.
 * ينتمي إلى: packages/application/privacy
 * يُستخدم من: infrastructure/privacy/*
 * الحاكم: المادتان ٤ و١٠ و١٣ و١٨ و٢٢ و٢٩ و٣١ من PDPL
 */

import type {
  ProcessingActivity,
  RightRequestStatus,
  SubjectRight,
} from "../../domain/privacy/pdpl-compliance.ts";
import type { Result } from "../../shared/result/index.ts";

export interface PdplComplianceStore {
  // ── أنشطةُ المعالجةِ
  getProcessingActivity(id: string): Promise<Result<ProcessingActivity | null, StoreError>>;
  isActivityAllowed(activityId: string): Promise<Result<boolean, StoreError>>;

  // ── تقييمُ الأثرِ
  dpiaRequired(activityId: string): Promise<Result<boolean, StoreError>>;
  dpiaIsApproved(activityId: string): Promise<Result<boolean, StoreError>>;
  highRiskRequiresDpia(activityId: string): Promise<Result<boolean, StoreError>>;

  // ── النقلُ خارجَ المملكةِ
  isCrossBorderTransferAllowed(transferId: string): Promise<Result<boolean, StoreError>>;
  isCrossBorderTransferExpired(transferId: string): Promise<Result<boolean, StoreError>>;

  // ── طلباتُ أصحابِ البياناتِ
  recordRightRequest(input: {
    cityId: string;
    rightType: SubjectRight;
    requesterTelegramId: string;
    createdBy: string;
  }): Promise<Result<string, StoreError>>;
  closeRightRequest(input: {
    requestId: string;
    status: RightRequestStatus;
    resultSummary: string;
    refusalReason?: string | null;
  }): Promise<Result<void, StoreError>>;
  isRightRequestOverdue(requestId: string): Promise<Result<boolean, StoreError>>;
}

export interface StoreError {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT" | "NOT_FOUND";
}

// ── حالاتُ الاستخدامِ ──────────────────────────────────────────────────────

export async function checkActivityAllowed(
  store: PdplComplianceStore,
  activityId: string,
): Promise<Result<boolean, StoreError>> {
  return store.isActivityAllowed(activityId);
}

export async function checkDpiaRequired(
  store: PdplComplianceStore,
  activityId: string,
): Promise<Result<boolean, StoreError>> {
  return store.highRiskRequiresDpia(activityId);
}

export async function checkCrossBorderTransferAllowed(
  store: PdplComplianceStore,
  transferId: string,
): Promise<Result<boolean, StoreError>> {
  const allowed = await store.isCrossBorderTransferAllowed(transferId);
  if (!allowed.ok) return allowed;
  if (!allowed.value) return { ok: false, error: { reason: "NOT_FOUND" } };
  return { ok: true, value: true };
}

export async function checkRightRequestOverdue(
  store: PdplComplianceStore,
  requestId: string,
): Promise<Result<boolean, StoreError>> {
  return store.isRightRequestOverdue(requestId);
}

export async function submitRightRequest(
  store: PdplComplianceStore,
  input: {
    cityId: string;
    rightType: SubjectRight;
    requesterTelegramId: string;
    createdBy: string;
  },
): Promise<Result<string, StoreError>> {
  return store.recordRightRequest(input);
}
