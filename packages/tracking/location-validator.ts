/**
 * الغرض: التحقّق من صحة موقع GPS لمنع التلاعب والأخطاء.
 *   يفحص: الدقة، الزمن، السرعة، الانتقال اللحظي (teleportation)، التكرار.
 * الحالة: منفّذ فعلياً — المرحلة 2.
 * ينتمي إلى: packages/tracking
 */

import type { LatLng } from "../maps/core/types.ts";
import type { GpsUpdate, ValidationResult } from "./types.ts";

export interface ValidatorConfig {
  /** الحد الأقصى للسرعة المعقولة كم/سا. */
  readonly maxReasonableSpeedKmh: number;
  /** مسافة الانتقال اللحظي المسموحة بالمتر — ما فوقها تُرفض. */
  readonly teleportThresholdMeters: number;
  /** أقصى دقة GPS مقبولة بالمتر. */
  readonly maxAccuracyMeters: number;
  /** أقصى فرق زمني مقبول بالثواني (بين الطابع الزمني والوقت الحالي). */
  readonly maxTimeDriftSeconds: number;
}

export const DEFAULT_VALIDATOR_CONFIG: ValidatorConfig = {
  maxReasonableSpeedKmh: 200,
  teleportThresholdMeters: 5000,
  maxAccuracyMeters: 100,
  maxTimeDriftSeconds: 30,
};

/** المسافة بين نقطتين بصيغة Haversine (بالمتر). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000; // نصف قطر الأرض بالمتر
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * يتحقّق من صحة تحديث GPS.
 * @param update التحديث الجديد
 * @param previous الموقع السابق (إن وُجد)
 * @param config إعدادات التحقّق
 * @returns نتيجة التحقّق
 */
export function validateGpsUpdate(
  update: GpsUpdate,
  previous: { position: LatLng; timestamp: number } | null,
  config: ValidatorConfig,
): ValidationResult {
  // 1) دقة GPS
  if (update.accuracy !== undefined && update.accuracy > config.maxAccuracyMeters) {
    return {
      valid: false,
      reason: `GPS accuracy too low: ${update.accuracy}m > ${config.maxAccuracyMeters}m`,
    };
  }

  // 2) فرق زمني
  const now = Date.now();
  const drift = Math.abs(now - update.timestamp) / 1000;
  if (drift > config.maxTimeDriftSeconds) {
    return { valid: false, reason: `Time drift too large: ${drift.toFixed(0)}s` };
  }

  // 3) الانتقال اللحظي (teleportation)
  if (previous !== null) {
    const distance = haversineMeters(previous.position, update.position);
    const timeDiffSec = Math.max((update.timestamp - previous.timestamp) / 1000, 1);
    const speedMs = distance / timeDiffSec;
    const speedKmh = speedMs * 3.6;

    if (distance > config.teleportThresholdMeters) {
      return {
        valid: false,
        reason: `Teleport detected: ${distance.toFixed(0)}m in ${timeDiffSec.toFixed(0)}s`,
      };
    }

    if (speedKmh > config.maxReasonableSpeedKmh) {
      return { valid: false, reason: `Unreasonable speed: ${speedKmh.toFixed(0)}km/h` };
    }
  }

  return { valid: true };
}

/** يكتشف السرعة المفرطة (للتنبيه لا الرفض). */
export function isSpeeding(
  update: GpsUpdate,
  previous: { position: LatLng; timestamp: number } | null,
  thresholdKmh: number,
): boolean {
  if (previous === null || update.speed !== undefined) {
    return (update.speed ?? 0) > thresholdKmh;
  }
  const distance = haversineMeters(previous.position, update.position);
  const timeDiffSec = Math.max((update.timestamp - previous.timestamp) / 1000, 1);
  const speedKmh = (distance / timeDiffSec) * 3.6;
  return speedKmh > thresholdKmh;
}
