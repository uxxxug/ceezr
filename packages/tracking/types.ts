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

/**
 * المرحلة ٥ — حالة الجلسة تُعرَّف في المجال لا هنا.
 *
 * كان هنا `TrackingStatus = "active" | "idle" | "ended"`: تعريف ثانٍ لحالة
 * الجلسة، بمفرداتٍ مختلفة عن مفردات المجال (`idle` مقابل `STALE`) وبلا آلة
 * انتقالات ولا شرطٍ لأيٍّ منها. ولم يكن يُحسَب في موضع واحد من المستودع.
 *
 * ونوعان للحالة نفسها مخالفةٌ للقاعدة ٥ حتى لو كان أحدهما ميتاً: أوّل من
 * يُنفّذ الجلسة يختار أقربهما إلى يده، فتنقسم المفردات بين طبقتين.
 */
export type {
  SessionEndReason,
  TrackingSessionFacts,
  TrackingSessionState,
} from "../domain/tracking/session.ts";

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
  /**
   * المرحلة ٥ — `null` لحدثٍ لا موضع له.
   *
   * كانت الحقول إلزامية، فكان بدء الجلسة وإنهاؤها يُنشران `{lat: 0, lng: 0}`
   * حشواً. وهي ليست قيمةً فارغة بل نقطةٌ حقيقية في خليج غينيا: أي مستهلكٍ
   * يرسم الأحداث على خريطة كان يضع السائق قبالة سواحل أفريقيا عند كل بدء
   * جلسة، وأي حسابِ مسافةٍ على تلك النقطة يُنتج آلاف الكيلومترات.
   *
   * والصفر أخطر من الغياب لأنه يمرّ من كل تحقّق: الإحداثية ضمن المدى، والنوع
   * صحيح، ولا شيء يُميّزها عن موقعٍ حقيقي إلا معرفة أنها لم تكن موجودة أصلاً.
   */
  readonly position: LatLng | null;
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
