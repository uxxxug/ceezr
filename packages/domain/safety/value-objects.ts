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
export const isSafetyDecision = (value: string): value is SafetyDecision =>
  value === "close" || value === "block_reporter";
