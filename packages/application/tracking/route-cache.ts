/**
 * الغرض: طبقةُ تخزينٍ مؤقّتٍ لنتائجِ التوجيه — تمنعُ نداءَ مزوّدِ التوجيهِ
 *   لكلِّ نبضةِ GPS، ولا تستدعيه إلا عند تغيُّرٍ ذي معنىً أو انتهاءِ مدّةِ الصلاحيّة.
 *   هذا هو بندُ CAP-012: «لا مسار إلا عند تغيّر ذي معنى؛ cache للمسارات».
 *
 * الحالة: منفّذ فعلياً — CAP-012.
 * ينتمي إلى: packages/application/tracking
 * يحكمُه: ADR 0024 (ETA = مدّة مسارٍ حقيقية أو لا شيء)
 *
 * ## لماذا هذه الطبقةُ موجودةٌ
 *
 * لأنّ البثَّ الحيَّ يُرسلُ موقعَ السائق كلَّ خمسِ ثوانٍ لكلِّ رحلةٍ جارية،
 * ونداءَ توجيهٍ في تلك الحلقةِ يعني طلبَ شبكةٍ لكلِّ رحلةٍ كلَّ خمسِ ثوانٍ.
 * وهذا ما يمنعُهُ CAP-012: لا نداءَ إلا عند تغيُّرٍ ذي معنى.
 *
 * ## التصميم
 *
 * الطبقةُ نقيّةٌ لا تحملُ حالةً: تُعطيها آخرَ نتيجةٍ مخزَّنةٍ وموقعَ السائقِ
 * الحاليَّ وموقعَ الوجهةِ، فتُقرّرُ هل يُستدعى المزوّدُ أم تُعادُ النتيجةُ المخزَّنة.
 * والتخزينُ الفعليُّ في الذاكرةِ أو في Redis يُتركُ للمُركِّبِ — الطبقةُ تُقرّرُ فقط.
 *
 * ## ما لا تفعلهُ هذه الطبقةُ
 *
 * - لا تُوصِلُ ETA بالبثِّ الحيِّ — ذلك قرارٌ يتوقّفُ على قياسِ الحملِ (ADR 0024).
 * - لا تُخزّنُ في Redis — الذاكرةُ كافيةٌ للنسخةِ الواحدة، والتوزيعُ يُتركُ لمرحلةٍ أخرى.
 * - لا تُخفّفُ سياسةَ ADR 0024 — المدّةُ المخزَّنةُ خضعتْ للسياسةِ قبل التخزين.
 */

import { haversineKm } from "../../domain/geo/index.ts";
import type { Coordinates } from "../../domain/geo/value-objects.ts";

/** مفتاحُ التخزين: السائقُ + الوجهةُ — لا الموقعُ اللحظيُّ. */
export interface RouteCacheKey {
  readonly driverId: string;
  readonly destination: Coordinates;
}

/** نتيجةُ مسارٍ مخزَّنةٌ مع موقعِ السائقِ لحظةَ الحسابِ والوقتِ. */
export interface CachedRoute {
  readonly key: RouteCacheKey;
  readonly driverPosition: Coordinates;
  readonly computedAt: number;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
}

/** عتباتُ التخزين — من platform_settings لا من ثوابت. */
export interface RouteCacheThresholds {
  /** أقلُّ مسافةٍ (بالمتر) يُعتبرُ تغيُّرُها ذا معنى. */
  readonly minChangeMeters: number;
  /** أقصى مدّةٍ (بالثواني) تُعتبرُ فيها النتيجةُ المخزَّنةُ صالحة. */
  readonly ttlSeconds: number;
}

/** عتباتٌ افتراضيّةٌ — تُستعملُ حين لا توجدُ إعداداتٌ في platform_settings. */
export const DEFAULT_ROUTE_CACHE_THRESHOLDS: RouteCacheThresholds = {
  minChangeMeters: 50,
  ttlSeconds: 60,
};

/**
 * هل تغيَّرَ موقعُ السائقِ تغيُّراً ذا معنى منذ آخر حسابٍ؟
 *
 * «ذا معنى» = تحرَّكَ أكثرَ من minChangeMeters أو انتهت مدّةُ صلاحيّةِ النتيجةِ.
 * والقياسُ هافرساينُ لا دقّةُ الطريقِ — يكفي للقرارِ لا للعرض.
 */
export function hasMeaningfulChange(
  cached: CachedRoute,
  currentPosition: Coordinates,
  now: number,
  thresholds: RouteCacheThresholds,
): boolean {
  const ageSeconds = (now - cached.computedAt) / 1000;
  if (ageSeconds >= thresholds.ttlSeconds) return true;

  const distanceMeters = haversineKm(cached.driverPosition, currentPosition) * 1000;
  return distanceMeters >= thresholds.minChangeMeters;
}

/**
 * هل ينبغي إعادةُ حسابِ المسار؟
 *
 * لا إن لم يكنْ مخزَّناً أصلاً — فلا شيءَ يُعاد.
 * نعم إن تغيَّرَ الموقعُ تغيُّراً ذا معنى أو انتهت مدّةُ الصلاحيّة.
 * لا إن لم يتغيَّرْ شيءٌ ذو معنى — فالنتيجةُ المخزَّنةُ كافية.
 */
export function shouldRecomputeRoute(
  cached: CachedRoute | null,
  currentPosition: Coordinates,
  _destination: Coordinates,
  now: number,
  thresholds: RouteCacheThresholds,
): boolean {
  if (cached === null) return true;
  if (hasMeaningfulChange(cached, currentPosition, now, thresholds)) return true;
  // الوجهةُ تغيَّرت؟ نعم — لكنّ المفتاحَ يضمُّ الوجهةَ، فلو تغيَّرتْ يُطلبُ مفتاحٌ آخر.
  return false;
}

/**
 * مخزنُ المساراتِ في الذاكرة — مفتاحُه السائقُ + الوجهة.
 *
 * خريطةٌ واحدةٌ لكلِّ نسخةٍ، ولا توزيعَ بين النسخ.
 * التوزيعُ يُتركُ لمرحلةٍ أخرى — اليومَ نسخةٌ واحدة.
 */
export class InMemoryRouteCache {
  private readonly store = new Map<string, CachedRoute>();
  private readonly thresholds: RouteCacheThresholds;

  constructor(thresholds: RouteCacheThresholds = DEFAULT_ROUTE_CACHE_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  private key(k: RouteCacheKey): string {
    return `${k.driverId}:${k.destination.latitude.toFixed(4)},${k.destination.longitude.toFixed(4)}`;
  }

  get(k: RouteCacheKey): CachedRoute | null {
    return this.store.get(this.key(k)) ?? null;
  }

  set(k: RouteCacheKey, route: Omit<CachedRoute, "key">): void {
    this.store.set(this.key(k), { ...route, key: k });
  }

  shouldRecompute(k: RouteCacheKey, currentPosition: Coordinates, now: number): boolean {
    const cached = this.get(k);
    return shouldRecomputeRoute(cached, currentPosition, k.destination, now, this.thresholds);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
