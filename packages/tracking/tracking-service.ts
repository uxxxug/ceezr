/**
 * الغرض: خدمة التتبّع المركزية — تستقبل تحديثات GPS وتتحقّق منها
 *   وتخزّن الموقع الحالي وتطلق الأحداث.
 *   الفصل الجوهري: GPS ← Tracking ← Realtime ← Map UI
 * الحالة: منفّذ فعلياً — المرحلة 2.
 * ينتمي إلى: packages/tracking
 */

import type { LatLng } from "../maps/core/types.ts";
import type { GpsUpdate, TrackingEvent, ValidationResult } from "./types.ts";
import { validateGpsUpdate, type ValidatorConfig } from "./location-validator.ts";

/** منفذ تخزين الموقع الحالي (Redis عادةً). */
export interface LocationStore {
  /** يخزّن الموقع الحالي للسائق. */
  setCurrent(driverId: string, position: LatLng, metadata: Record<string, unknown>): Promise<void>;
  /** يقرأ الموقع الحالي للسائق. */
  getCurrent(driverId: string): Promise<{ position: LatLng; timestamp: number; metadata: Record<string, unknown> } | null>;
  /** يحذف الموقع عند انتهاء الجلسة. */
  clear(driverId: string): Promise<void>;
}

/** منفذ نشر أحداث التتبّع (WebSocket/SSE عادةً). */
export interface TrackingEventPublisher {
  publish(event: TrackingEvent): Promise<void>;
}

/** ساعة قابلة للحقن للاختبار. */
export interface Clock {
  now(): Date;
}

export interface TrackingConfig {
  /** معدّل التحديث أثناء القيادة بالثواني. */
  readonly gpsIntervalSeconds: number;
  /** معدّل التحديث أثناء الوقوف بالثواني. */
  readonly idleIntervalSeconds: number;
  /** الحد الأدنى للانزياف قبل الإرسال بالمتر. */
  readonly minDistanceMeters: number;
  /** إعدادات التحقّق من صحة GPS. */
  readonly validator: ValidatorConfig;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  gpsIntervalSeconds: 3,
  idleIntervalSeconds: 20,
  minDistanceMeters: 15,
  validator: {
    maxReasonableSpeedKmh: 200,
    teleportThresholdMeters: 5000,
    maxAccuracyMeters: 100,
    maxTimeDriftSeconds: 30,
  },
};

export interface TrackingDeps {
  readonly store: LocationStore;
  readonly publisher: TrackingEventPublisher;
  readonly clock: Clock;
  readonly config: TrackingConfig;
}

/**
 * خدمة التتبّع — تتعامل مع تحديثات GPS الواردة.
 * ليست مسؤولة عن العرض (ذلك في طبقة Map UI).
 */
export class TrackingService {
  private readonly previousPositions = new Map<string, { position: LatLng; timestamp: number }>();

  constructor(private readonly deps: TrackingDeps) {}

  /** يعالج تحديث GPS واحد: يتحقّق، يخزّن، ينشر. */
  async handleGpsUpdate(update: GpsUpdate): Promise<{ accepted: boolean; reason?: string | undefined }> {
    const previous = this.previousPositions.get(update.driverId) ?? null;

    // التحقّق من صحة الموقع
    const validation: ValidationResult = validateGpsUpdate(update, previous, this.deps.config.validator);
    if (!validation.valid) {
      // ننشر حدث تنبيه لكن لا نُخزّن الموقع الفاسد
      await this.deps.publisher.publish({
        type: validation.reason?.includes("Teleport") ? "teleport_detected" : "speeding_detected",
        driverId: update.driverId,
        tripId: update.tripId,
        position: update.position,
        timestamp: this.deps.clock.now(),
        metadata: { reason: validation.reason },
      });
      return { accepted: false, reason: validation.reason };
    }

    // تخزين الموقع الحالي
    await this.deps.store.setCurrent(update.driverId, update.position, {
      heading: update.heading ?? 0,
      speed: update.speed ?? 0,
      accuracy: update.accuracy ?? 0,
      timestamp: update.timestamp,
      tripId: update.tripId,
    });

    // تحديث الموقع السابق
    this.previousPositions.set(update.driverId, {
      position: update.position,
      timestamp: update.timestamp,
    });

    // نشر حدث تحديث الموقع
    await this.deps.publisher.publish({
      type: "location_updated",
      driverId: update.driverId,
      tripId: update.tripId,
      position: update.position,
      timestamp: this.deps.clock.now(),
      metadata: {
        heading: update.heading,
        speed: update.speed,
        accuracy: update.accuracy,
      },
    });

    return { accepted: true };
  }

  /** يبدأ جلسة تتبّع. */
  async startSession(driverId: string, tripId: string | null): Promise<void> {
    await this.deps.publisher.publish({
      type: "session_started",
      driverId,
      tripId,
      position: { lat: 0, lng: 0 },
      timestamp: this.deps.clock.now(),
    });
  }

  /** ينهي جلسة تتبّع ويمسح الموقع الحالي. */
  async endSession(driverId: string, tripId: string | null): Promise<void> {
    this.previousPositions.delete(driverId);
    await this.deps.store.clear(driverId);
    await this.deps.publisher.publish({
      type: "session_ended",
      driverId,
      tripId,
      position: { lat: 0, lng: 0 },
      timestamp: this.deps.clock.now(),
    });
  }
}
