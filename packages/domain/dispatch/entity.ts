/**
 * الغرض: قلب المطابقة — فلترة المرشحين، معادلة النقاط، الترتيب، واختيار دفعة البثّ.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (القسم 3.3 من الأمر الحاكم).
 * ينتمي إلى: domain/dispatch
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/match-order، apps/gateway، apps/workers
 * ملاحظات مستقبلية: كل الأوزان والحدود تُمرَّر من الخارج (مصدرها platform_settings).
 *   ممنوع منعاً باتاً كتابة أي وزن أو نصف قطر أو حجم دفعة داخل هذا الملف.
 */

import type { CityId, DriverId, ServiceType } from "../../shared/kernel/index.ts";
import type { DriverCapability } from "../capability/entity.ts";
import { canServe } from "../capability/entity.ts";
import { haversineKm, proximityFactor } from "../geo/index.ts";
import type { Coordinates, DistanceKm } from "../geo/value-objects.ts";
import { effectiveRating, normalizeRating } from "../reputation/entity.ts";
import { MAX_STARS } from "../reputation/value-objects.ts";
import type { Subscription } from "../subscription/entity.ts";
import { coversService } from "../subscription/entity.ts";

/**
 * الحد الأعلى لمقياس التقييم. مصدره وحدة reputation وحدها: مقياسان مختلفان في
 * وحدتين يعنيان ترتيباً خاطئاً صامتاً يوم يتغيّر أحدهما.
 */
export const MAX_RATING = MAX_STARS;

export interface MatchingParameters {
  /** platform_settings.search_radius_km */
  readonly searchRadiusKm: DistanceKm;
  /** platform_settings.match_weight_proximity */
  readonly weightProximity: number;
  /** platform_settings.match_weight_rating */
  readonly weightRating: number;
  /** platform_settings.broadcast_batch_size */
  readonly broadcastBatchSize: number;
  /** platform_settings.default_rating_for_new_driver */
  readonly defaultRating: number;
  /** platform_settings.rating_min_count_for_trust */
  readonly ratingMinCountForTrust: number;
}

export interface DriverCandidate {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly location: Coordinates;
  readonly isAvailable: boolean;
  readonly isVerified: boolean;
  readonly ratingAverage: number | null;
  /** عدد التقييمات غير المُعلَّمة — بلا عدد لا يُعرف هل المتوسط يُعتدّ به. */
  readonly ratingCount: number;
  readonly capabilities: readonly DriverCapability[];
  readonly subscription: Subscription | null;
}

export interface OrderContext {
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  /** السائقون المستبعدون من هذه الدورة (رفضوا أو انتهت مهلتهم سابقاً). */
  readonly excludedDriverIds: readonly DriverId[];
}

export type RejectionReason =
  | "CITY_MISMATCH"
  | "NOT_VERIFIED"
  | "NOT_AVAILABLE"
  | "SERVICE_NOT_ENABLED"
  | "NO_LIVE_SUBSCRIPTION"
  | "OUT_OF_RADIUS"
  | "EXCLUDED_THIS_ROUND";

export interface ScoredCandidate {
  readonly driverId: DriverId;
  readonly distanceKm: DistanceKm;
  readonly score: number;
  /** التقييم الذي دخل المعادلة فعلاً — يُبيّن هل رُتّب بمتوسطه أم بالافتراضي. */
  readonly effectiveRating: number;
  readonly ratingCount: number;
}

export interface CandidateEvaluation {
  readonly eligible: readonly ScoredCandidate[];
  readonly rejected: readonly { readonly driverId: DriverId; readonly reason: RejectionReason }[];
}

/**
 * سبب استبعاد المرشح، أو null إن كان مؤهلاً.
 * الترتيب مقصود: الأرخص فحصاً أولاً، والمسافة أخيراً.
 */
export function rejectionReasonFor(
  candidate: DriverCandidate,
  order: OrderContext,
  params: MatchingParameters,
  now: Date,
): RejectionReason | null {
  if (candidate.cityId !== order.cityId) return "CITY_MISMATCH";
  if (order.excludedDriverIds.includes(candidate.driverId)) return "EXCLUDED_THIS_ROUND";
  if (!candidate.isVerified) return "NOT_VERIFIED";
  if (!candidate.isAvailable) return "NOT_AVAILABLE";
  if (!canServe(candidate.capabilities, order.service)) return "SERVICE_NOT_ENABLED";
  if (candidate.subscription === null) return "NO_LIVE_SUBSCRIPTION";
  if (!coversService(candidate.subscription, order.service, now)) return "NO_LIVE_SUBSCRIPTION";
  if (haversineKm(order.pickup, candidate.location) > params.searchRadiusKm) {
    return "OUT_OF_RADIUS";
  }
  return null;
}

/**
 * معادلة النقاط (القسم 3.3.2):
 *   score = (وزن القرب × دالة القرب) + (وزن التقييم × التقييم المعياري)
 * كلا المكوّنين في مدى [0,1]، فتبقى النتيجة قابلة للتفسير والمقارنة.
 */
export function scoreCandidate(
  distanceKm: DistanceKm,
  ratingAverage: number | null,
  params: MatchingParameters,
  ratingCount = 0,
): number {
  const proximity = proximityFactor(distanceKm, params.searchRadiusKm);
  const rating = effectiveRating(
    { average: ratingAverage, count: ratingCount },
    params.ratingMinCountForTrust,
    params.defaultRating,
  );
  return params.weightProximity * proximity + params.weightRating * normalizeRating(rating);
}

/** تقييم كل المرشحين: المؤهلون مرتَّبون تنازلياً بالنقاط، والمستبعدون بأسبابهم. */
export function evaluateCandidates(
  candidates: readonly DriverCandidate[],
  order: OrderContext,
  params: MatchingParameters,
  now: Date,
): CandidateEvaluation {
  const eligible: ScoredCandidate[] = [];
  const rejected: { driverId: DriverId; reason: RejectionReason }[] = [];

  for (const candidate of candidates) {
    const reason = rejectionReasonFor(candidate, order, params, now);
    if (reason !== null) {
      rejected.push({ driverId: candidate.driverId, reason });
      continue;
    }
    const distanceKm = haversineKm(order.pickup, candidate.location);
    const snapshot = { average: candidate.ratingAverage, count: candidate.ratingCount };
    eligible.push({
      driverId: candidate.driverId,
      distanceKm,
      score: scoreCandidate(distanceKm, candidate.ratingAverage, params, candidate.ratingCount),
      effectiveRating: effectiveRating(
        snapshot,
        params.ratingMinCountForTrust,
        params.defaultRating,
      ),
      ratingCount: candidate.ratingCount,
    });
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // كسر التعادل بالأقرب، ثم بالمعرّف لضمان ترتيب حتمي قابل للاختبار
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0;
  });

  return { eligible, rejected };
}

/** دفعة البثّ: أفضل N مرشح، وحجم الدفعة من platform_settings. */
export function selectBroadcastBatch(
  evaluation: CandidateEvaluation,
  params: MatchingParameters,
): readonly ScoredCandidate[] {
  const size = Math.max(0, Math.trunc(params.broadcastBatchSize));
  return evaluation.eligible.slice(0, size);
}
