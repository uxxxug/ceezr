/**
 * الغرض: كائنات القيمة الثابتة (Value Objects) لوحدة safety — زر الطوارئ والسلامة
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً.
 * ينتمي إلى: domain/safety
 * يُتوقع أن يستخدمه لاحقاً: packages/application/safety/*, packages/infrastructure/safety/*
 * ملاحظات مستقبلية: قيمة القرار مقيدة بقرار الإنسان المسجل في القاعدة.
 */
export type SafetyReporterRole = "rider" | "driver";
export type SafetyIncidentStatus = "open" | "received" | "closed";
export type SafetyDecision = "close" | "block_reporter";
export type SafetyDecisionReason =
  | "resolved"
  | "false_report"
  | "duplicate"
  | "escalated"
  | "safety_risk"
  | "policy_violation";
/**
 * جنسُ البلاغِ (`PD-020` · `ADR 0159`): استغاثةُ سلامةٍ أو تعذُّرُ إكمالٍ من
 * السائقِ. لا يُختَرَقُ المجالُ — قيمةٌ خارجُهُ تُقرَأُ عطبَ عقدٍ لا حالةً
 * تُطوى، فبطاقةُ الفريقِ تُختارُ بهذا الحقلِ.
 */
export type SafetyIncidentReason = "sos" | "driver_cannot_complete";
export const SAFETY_INCIDENT_REASONS: readonly SafetyIncidentReason[] = [
  "sos",
  "driver_cannot_complete",
];
export const isSafetyIncidentReason = (value: unknown): value is SafetyIncidentReason =>
  typeof value === "string" && SAFETY_INCIDENT_REASONS.some((candidate) => candidate === value);
export const isSafetyDecision = (value: string): value is SafetyDecision =>
  value === "close" || value === "block_reporter";
export const SAFETY_DECISION_REASONS: readonly SafetyDecisionReason[] = [
  "resolved",
  "false_report",
  "duplicate",
  "escalated",
  "safety_risk",
  "policy_violation",
];
export const isSafetyDecisionReason = (value: unknown): value is SafetyDecisionReason =>
  typeof value === "string" && SAFETY_DECISION_REASONS.some((r) => r === value);
