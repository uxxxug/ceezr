/**
 * الغرض: مجالُ امتثال PDPL — أساسُ المعالجةِ، حقوقُ أصحابِ البياناتِ،
 *   تقييمُ الأثرِ، وضوابطُ النقلِ خارجَ المملكةِ (F12-10).
 * الحالة: منفَّذٌ — البندُ F12-10.
 * ينتمي إلى: packages/domain/privacy
 * يُستخدم من: application/privacy/* · infrastructure/privacy/*
 * الحاكم: المادتان ٤ و١٠ و١٣ و١٨ و٢٢ و٢٩ و٣١ من نظام حماية البيانات الشخصيّة
 *
 * ## чому سجلٌّ قابلٌ للقياسِ لا نظامُ إدارةِ امتثالٍ كاملٌ
 *
 * هذا البندُ يُنشئُ طبقةَ تحكّمٍ قابلةً للقياسِ: جداولُ تسجّلُ أنشطةَ المعالجةِ
 * وطلباتِ أصحابِ البياناتِ وتقييماتِ الأثرِ والنقلَ خارجَ المملكةِ، ودوالُّ
 * تتحقَّقُ من الشروطِ في القاعدةِ. ولا يبني واجهةَ مستخدمٍ ولا إرسالاً خارجيّاً —
 * ذلك قدرةٌ تشغيليّةٌ لإدارةِ الامتثالِ.
 */

// ── أنواعُ أساسِ المعالجةِ (المادةُ ١٠) ─────────────────────────────────────

export type ProcessingBasis =
  | "consent"
  | "publicly_available"
  | "public_interest_security"
  | "vital_interests"
  | "public_health_safety"
  | "anonymised_form"
  | "legitimate_interests"
  | "legal_obligation"
  | "judicial_requirement";

export const PROCESSING_BASES: readonly ProcessingBasis[] = [
  "consent",
  "publicly_available",
  "public_interest_security",
  "vital_interests",
  "public_health_safety",
  "anonymised_form",
  "legitimate_interests",
  "legal_obligation",
  "judicial_requirement",
] as const;

// ── حالةُ النشاطِ ───────────────────────────────────────────────────────────

export type ActivityStatus = "draft" | "active" | "suspended" | "retired";

// ── حقوقُ أصحابِ البياناتِ (المادةُ ٤) ──────────────────────────────────────

export type SubjectRight =
  | "be_informed"
  | "access"
  | "obtain_copy"
  | "correct"
  | "complete"
  | "update"
  | "destroy"
  | "object_processing"
  | "withdraw_consent";

export const SUBJECT_RIGHTS: readonly SubjectRight[] = [
  "be_informed",
  "access",
  "obtain_copy",
  "correct",
  "complete",
  "update",
  "destroy",
  "object_processing",
  "withdraw_consent",
] as const;

export type RightRequestStatus =
  | "received"
  | "in_progress"
  | "fulfilled"
  | "refused"
  | "partially_fulfilled";

// ── تقييمُ الأثرِ (المادةُ ٢٢) ──────────────────────────────────────────────

export type DpiaRiskLevel = "high_risk" | "medium_risk" | "low_risk";

export type DpiaStatus = "required" | "in_progress" | "completed" | "approved" | "rejected";

// ── النقلُ خارجَ المملكةِ (المادةُ ٢٩) ──────────────────────────────────────

export type TransferBasis =
  | "treaty_obligation"
  | "ksa_interests"
  | "subject_contractual_obligation"
  | "other_regulated_purpose";

export const TRANSFER_BASES: readonly TransferBasis[] = [
  "treaty_obligation",
  "ksa_interests",
  "subject_contractual_obligation",
  "other_regulated_purpose",
] as const;

export type TransferStatus = "requested" | "approved" | "rejected" | "expired" | "revoked";

// ── المهلةُ: ٣٠ يوماً لطلباتِ أصحابِ البياناتِ ──────────────────────────────

export const RIGHT_REQUEST_DEADLINE_DAYS = 30;

// ── مهلةُ مراجعةِ تقييمِ الأثرِ: كلَّ سنتَينِ ──────────────────────────────────

export const DPIA_REVIEW_INTERVAL_YEARS = 2;

// ── مهلةُ انتهاءِ النقلِ خارجَ المملكةِ: سنةٌ ─────────────────────────────────

export const CROSS_BORDER_TRANSFER_EXPIRY_DAYS = 365;

// ── أنواعُ النتائجِ ─────────────────────────────────────────────────────────

export interface ProcessingActivity {
  readonly id: string;
  readonly cityId: string;
  readonly controllerContact: string;
  readonly purpose: string;
  readonly mandatoryDataCategories: readonly string[];
  readonly optionalDataCategories: readonly string[];
  readonly subjectCategories: readonly string[];
  readonly processingBasis: ProcessingBasis;
  readonly disclosureRecipients: readonly string[];
  readonly involvesCrossBorderTransfer: boolean;
  readonly expectedRetentionPeriod: string;
  readonly requiresDpia: boolean;
  readonly status: ActivityStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DpiaAssessment {
  readonly id: string;
  readonly cityId: string;
  readonly processingActivityId: string;
  readonly processingDescription: string;
  readonly identifiedRisks: string;
  readonly mitigationMeasures: string;
  readonly residualRiskLevel: DpiaRiskLevel;
  readonly status: DpiaStatus;
  readonly assessedBy: string;
  readonly approvedBy: string | null;
  readonly assessedAt: string;
  readonly approvedAt: string | null;
  readonly nextReviewDue: string;
}

export interface CrossBorderTransfer {
  readonly id: string;
  readonly cityId: string;
  readonly processingActivityId: string;
  readonly recipientCountry: string;
  readonly recipientEntity: string;
  readonly transferredDataCategories: readonly string[];
  readonly transferBasis: TransferBasis;
  readonly protectionSafeguards: string;
  readonly status: TransferStatus;
  readonly approvedAt: string | null;
  readonly expiresAt: string;
}

export interface DataSubjectRequest {
  readonly id: string;
  readonly cityId: string;
  readonly rightType: SubjectRight;
  readonly requesterTelegramId: string;
  readonly relatedExportReceipt: string | null;
  readonly relatedErasureReceipt: string | null;
  readonly status: RightRequestStatus;
  readonly receivedAt: string;
  readonly dueAt: string;
  readonly completedAt: string | null;
  readonly resultSummary: string | null;
  readonly refusalReason: string | null;
}
