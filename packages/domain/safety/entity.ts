/**
 * الغرض: الكيانات الجذرية (Aggregates/Entities) لوحدة safety — زر الطوارئ والسلامة
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً.
 * ينتمي إلى: domain/safety
 * يُتوقع أن يستخدمه لاحقاً: packages/application/safety/*, packages/infrastructure/safety/*
 * ملاحظات مستقبلية: التحولات المسموحة تعكسها قيود/RPC قاعدة البيانات.
 */
import type { SafetyIncidentStatus, SafetyReporterRole } from "./value-objects.ts";
export interface SafetyIncident {
  readonly id: string;
  readonly orderId: string;
  readonly cityId: string;
  readonly reporterRole: SafetyReporterRole;
  readonly status: SafetyIncidentStatus;
}
