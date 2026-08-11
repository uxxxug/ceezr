/**
 * الغرض: خدمة التتبّع المركزية — تستقبل تحديثات GPS وتتحقّق منها
 *   وتخزّن الموقع الحالي وتطلق الأحداث.
 *   الفصل الجوهري: GPS ← Tracking ← Realtime ← Map UI
 * الحالة: منفّذ فعلياً — المرحلة 2.
 * ينتمي إلى: packages/tracking
 */

import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsAssessment,
  type GpsPolicy,
  type PreviousFix,
} from "../domain/geo/gps-fix.ts";
import type { LatLng } from "../maps/core/types.ts";
import type { GpsUpdate, TrackingEvent, TrackingEventType } from "./types.ts";

/** منفذ تخزين الموقع الحالي (Redis عادةً). */
export interface LocationStore {
  /** يخزّن الموقع الحالي للسائق. */
  setCurrent(driverId: string, position: LatLng, metadata: Record<string, unknown>): Promise<void>;
  /** يقرأ الموقع الحالي للسائق. */
  getCurrent(
    driverId: string,
  ): Promise<{ position: LatLng; timestamp: number; metadata: Record<string, unknown> } | null>;
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
  /** حدود التحقّق من صحة GPS — سياسة المجال. */
  readonly validator: GpsPolicy;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  gpsIntervalSeconds: 3,
  idleIntervalSeconds: 20,
  minDistanceMeters: 15,
  validator: DEFAULT_GPS_POLICY,
};

export interface TrackingDeps {
  readonly store: LocationStore;
  readonly publisher: TrackingEventPublisher;
  readonly clock: Clock;
  readonly config: TrackingConfig;
}

/**
 * نوع الحدث يُشتقّ من رمز مُعرَّف لا من مطابقة نصّية على رسالة خطأ.
 * ما كان `reason?.includes("Teleport")` قراراً تشغيلياً معلّقاً على تهجئة نصّ.
 */
function alertEventType(assessment: GpsAssessment): TrackingEventType {
  return assessment.findings.some((f) => f.code === "DISPLACEMENT_IMPLAUSIBLE")
    ? "teleport_detected"
    : "speeding_detected";
}

/**
 * خدمة التتبّع — تتعامل مع تحديثات GPS الواردة.
 * ليست مسؤولة عن العرض (ذلك في طبقة Map UI).
 */
export class TrackingService {
  /**
   * ذاكرة داخل العملية — محدودية معروفة (P1-7): تضيع عند إعادة التشغيل
   * ولا تُشارَك بين نسخ. لم تُستبدَل هنا لأن مصدر الحقيقة للموقع قرار المرحلة ٤،
   * وإقحام مخزن هنا قبله يُنشئ مصدراً ثانياً.
   */
  private readonly previousPositions = new Map<string, PreviousFix>();

  constructor(private readonly deps: TrackingDeps) {}

  /** يعالج تحديث GPS واحد: يُقيّم، يخزّن، ينشر. */
  async handleGpsUpdate(
    update: GpsUpdate,
  ): Promise<{ accepted: boolean; assessment: GpsAssessment }> {
    const previous = this.previousPositions.get(update.driverId) ?? null;

    const assessment = assessGpsFix(
      {
        latitude: update.position.lat,
        longitude: update.position.lng,
        recordedAtMs: update.timestamp,
        accuracyMeters: update.accuracy,
        speedKmh: update.speed,
        headingDegrees: update.heading,
      },
      previous,
      this.deps.clock.now().getTime(),
      this.deps.config.validator,
    );

    // المرفوض بيانات فاسدة لا سلوك مريب: لا يُخزّن ولا يُنشَر عنه حدث تشغيلي.
    // إغراق العمليات بتنبيهات عن إحداثيات مشوّهة يدفن التنبيه الحقيقي.
    if (assessment.fix === null) {
      return { accepted: false, assessment };
    }

    const fix = assessment.fix;

    await this.deps.store.setCurrent(update.driverId, update.position, {
      heading: fix.headingDegrees,
      speed: fix.speedKmh,
      accuracy: fix.accuracyMeters,
      timestamp: fix.recordedAtMs,
      tripId: update.tripId,
      quality: assessment.verdict,
    });

    /**
     * المؤشّر السابق يتقدّم حتّى عند التنبيه. الطبقة القديمة لم تكن تقدّمه عند
     * الرفض، فأول قفزة تُجمّده عند نقطة ميتة ثم تُقاس عليها كل إصلاحة تالية
     * فتُرفض هي الأخرى — التتبّع يموت إلى آخر الجلسة.
     */
    this.previousPositions.set(update.driverId, {
      coordinates: fix.coordinates,
      recordedAtMs: fix.recordedAtMs,
    });

    if (assessment.verdict === "ALERT") {
      await this.deps.publisher.publish({
        type: alertEventType(assessment),
        driverId: update.driverId,
        tripId: update.tripId,
        position: update.position,
        timestamp: this.deps.clock.now(),
        metadata: { findings: assessment.findings },
      });
    }

    await this.deps.publisher.publish({
      type: "location_updated",
      driverId: update.driverId,
      tripId: update.tripId,
      position: update.position,
      timestamp: this.deps.clock.now(),
      metadata: {
        heading: fix.headingDegrees,
        speed: fix.speedKmh,
        accuracy: fix.accuracyMeters,
        quality: assessment.verdict,
        findings: assessment.findings.map((f) => f.code),
      },
    });

    return { accepted: true, assessment };
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
