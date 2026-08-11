export {
  DEFAULT_VALIDATOR_CONFIG,
  haversineMeters,
  isSpeeding,
  type ValidatorConfig,
  validateGpsUpdate,
} from "./location-validator.ts";
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
export {
  extractBearerToken,
  toAuthResult,
  type TrackingAuthError,
  type TrackingAuthResult,
  type TrackingTokenPayload,
  type TrackingTokenStore,
} from "./tracking-auth.ts";
