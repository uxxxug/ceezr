export type {
  GpsUpdate,
  TrackingSession,
  TrackingStatus,
  ValidationResult,
  TrackingEvent,
  TrackingEventType,
} from "./types.ts";

export {
  validateGpsUpdate,
  isSpeeding,
  haversineMeters,
  DEFAULT_VALIDATOR_CONFIG,
  type ValidatorConfig,
} from "./location-validator.ts";

export {
  TrackingService,
  DEFAULT_TRACKING_CONFIG,
  type TrackingDeps,
  type TrackingConfig,
  type LocationStore,
  type TrackingEventPublisher,
  type Clock,
} from "./tracking-service.ts";
