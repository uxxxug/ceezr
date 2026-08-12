/**
 * الغرض: أخطاء العمل المتوقعة لوحدة safety تُعاد عبر نمط Result بلا throw — زر الطوارئ والسلامة
 * الحالة: منفّذ فعلياً في 2026-08-13؛ كان هيكلاً.
 * ينتمي إلى: domain/safety
 * يُتوقع أن يستخدمه لاحقاً: packages/application/safety/*, packages/infrastructure/safety/*
 * ملاحظات مستقبلية: تفاصيل الرفض مأخوذة من RPC ولا تُترجم في طبقة المجال.
 */
export type SafetyIncidentFailure =
  | "ORDER_NOT_FOUND"
  | "ACTOR_NOT_FOUND"
  | "ACTOR_BLOCKED"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_ASSIGNED"
  | "ESCALATION_GROUP_MISSING"
  | "INCIDENT_NOT_FOUND"
  | "INCIDENT_ALREADY_CLAIMED"
  | "INCIDENT_ALREADY_CLOSED"
  | "INCIDENT_NOT_CLAIMED_BY_ACTOR"
  | "ACTOR_NOT_AUTHORIZED"
  | "INVALID_DECISION";
