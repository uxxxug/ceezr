/**
 * الغرض: مصادقة التتبّع — تمنع العميل من انتحال هوية سائق آخر.
 *   الرمز يصدره الخادم ويخزّنه (Redis عادةً)، ويربطه بـ driverId + tripId + انتهاء.
 *   المسار يشتقّ الهوية من الرمز لا من body.
 * الحالة: **منطق الترويسة منفّذ — المخزن واجهةٌ بلا تنفيذ** — المرحلة P0.
 *   `extractBearerToken` و `toAuthResult` دوالٌ خالصة مختبرة. أمّا
 *   `TrackingTokenStore` فلا يُنفّذه أيّ محوّل في `packages/infrastructure`، ولا يوجد
 *   في المستودع من يستدعي `issue` ليمنح سائقاً رمزاً. فمن يوصِل
 *   `routes/tracking.ts` عليه أن يبني المخزن والمُصدِر أولاً — وإلا فكلّ طلبٍ
 *   يُردّ 401 وحسب.
 * ينتمي إلى: packages/tracking
 */

/** منفذ إصدار/التحقق من رموز التتبّع. */
export interface TrackingTokenStore {
  /** يصدر رمزاً مرتبطاً بسائق ورحلة وانتهاء. يُرجع الرمز المُنشأ. */
  issue(driverId: string, tripId: string | null, ttlSeconds: number): Promise<string>;
  /** يتحقق من رمز ويُرجع الهوية المرتبطة به، أو null. */
  verify(token: string): Promise<TrackingTokenPayload | null>;
  /** يُبطل رمزاً (عند انتهاء الجلسة). */
  revoke(token: string): Promise<void>;
}

/** حمولة الرمز بعد التحقق. */
export interface TrackingTokenPayload {
  readonly driverId: string;
  readonly tripId: string | null;
  readonly expiresAt: number;
}

/** خطأ مصادقة التتبّع. */
export type TrackingAuthError =
  | "MISSING_TOKEN"
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "TOKEN_REVOKED";

/** نتيجة التحقق من الرمز. */
export type TrackingAuthResult =
  | { readonly ok: true; readonly payload: TrackingTokenPayload }
  | { readonly ok: false; readonly error: TrackingAuthError };

/**
 * يستخرج رمز التتبّع من ترويسة Authorization.
 * الصيغة: `Authorization: Bearer <token>`
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (authHeader === undefined || authHeader === "") return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  const token = parts[1];
  if (token === undefined || token === "") return null;
  return token;
}

/**
 * يحوّل نتيجة التحقق من المخزن إلى نتيجة مصادقة موحّدة.
 */
export function toAuthResult(payload: TrackingTokenPayload | null): TrackingAuthResult {
  if (payload === null) {
    return { ok: false, error: "INVALID_TOKEN" };
  }
  if (payload.expiresAt < Date.now()) {
    return { ok: false, error: "EXPIRED_TOKEN" };
  }
  return { ok: true, payload };
}
