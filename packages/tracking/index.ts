/**
 * التحقّق من صحة GPS يُعاد تصديره من المجال ولا يُنفَّذ هنا.
 * كان في هذه الطبقة `location-validator.ts` نسخة ثانية أضعف من التحقّق القائم
 * في `domain/geo` — بلا فحص انتهاء ولا حدود — فحُذفت في المرحلة ٣ لصالح المصدر الواحد.
 */
export {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsAssessment,
  type GpsFinding,
  type GpsFindingCode,
  type GpsPolicy,
  type GpsSeverity,
  hasFinding,
  type PreviousFix,
  type RawGpsFix,
  requireValidGpsFix,
  type ValidatedGpsFix,
} from "../domain/geo/gps-fix.ts";
export { haversineKm } from "../domain/geo/index.ts";
export {
  extractBearerToken,
  type TrackingAuthError,
  type TrackingAuthResult,
  type TrackingTokenPayload,
  type TrackingTokenStore,
  toAuthResult,
} from "./tracking-auth.ts";
export {
  type Clock,
  DEFAULT_TRACKING_CONFIG,
  type LocationStore,
  type TrackingConfig,
  type TrackingDeps,
  type TrackingEventPublisher,
  TrackingService,
} from "./tracking-service.ts";
export type {
  GpsUpdate,
  TrackingEvent,
  TrackingEventType,
  TrackingSession,
  TrackingStatus,
  ValidationResult,
} from "./types.ts";
