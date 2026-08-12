/**
 * الغرض: أحداث الدومين التي تصدرها وحدة safety — زر الطوارئ والسلامة
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً.
 * ينتمي إلى: domain/safety
 * يُتوقع أن يستخدمه لاحقاً: packages/application/safety/*, packages/infrastructure/safety/*
 * ملاحظات مستقبلية: أحداث التدقيق لا تتحول إلى محرك قرار آلي.
 */
export interface SafetyIncidentTriggered {
  readonly type: "safety.incident.triggered";
  readonly incidentId: string;
}
export interface SafetyIncidentResolved {
  readonly type: "safety.incident.resolved";
  readonly incidentId: string;
}
