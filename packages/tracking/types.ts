/**
 * الغرض: الأنواع المشتركة لطبقة التتبّع اللحظي.
 *   تحديث موقع GPS، جلسة تتبّع، أحداث التتبّع.
 * الحالة: منفّذ فعلياً — المرحلة 2.
 * ينتمي إلى: packages/tracking
 */

import type { LatLng } from "../maps/core/types.ts";

/** معرّف سائق (إعادة تصدير للوضوح). */
export type { LatLng } from "../maps/core/types.ts";

/** تحديث موقع GPS من السائق. */
export interface GpsUpdate {
  readonly driverId: string;
  readonly tripId: string | null;
  readonly position: LatLng;
  /** الاتجاه بالدرجات (0-359). */
  readonly heading?: number;
  /** السرعة كم/سا. */
  readonly speed?: number;
  /** دقة GPS بالمتر. */
  readonly accuracy?: number;
  /** الطابع الزمني من الجهاز (epoch ms). */
  readonly timestamp: number;
}

/** جلسة تتبّع نشطة. */
export interface TrackingSession {
  readonly driverId: string;
  readonly tripId: string | null;
  readonly startedAt: Date;
  readonly lastPosition: LatLng | null;
  readonly lastUpdatedAt: Date | null;
  readonly status: TrackingStatus;
}

export type TrackingStatus = "active" | "idle" | "ended";

/** نتيجة التحقّق من صحة موقع GPS. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly corrected?: LatLng;
}

/** حدث تتبّع — يُطلق عند تغيّر حالة الرحلة. */
export interface TrackingEvent {
  readonly type: TrackingEventType;
  readonly driverId: string;
  readonly tripId: string | null;
  readonly position: LatLng;
  readonly timestamp: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type TrackingEventType =
  | "session_started"
  | "session_ended"
  | "location_updated"
  | "driver_arrived_pickup"
  | "driver_left_pickup"
  | "driver_near_customer"
  | "driver_arrived_customer"
  | "speeding_detected"
  | "teleport_detected"
  | "connection_lost"
  | "connection_restored";
