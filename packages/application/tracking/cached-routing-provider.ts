/**
 * الغرض: مزوّدُ توجيهٍ مخزَّنٌ — يغلِّفُ أيَّ `RoutingProvider` بطبقةِ تخزينِ
 *   المساراتِ (CAP-012)، فلا يُستدعى المزوّدُ الأصليُّ إلّا عند تغيُّرٍ ذي معنى.
 *
 * الحالة: منفّذ فعلياً — CAP-012 (الوصل).
 * ينتمي إلى: packages/application/tracking
 * يحكمُه: ADR 0024 (ETA = مدّة مسارٍ حقيقية أو لا شيء)
 *
 * ## التصميم
 *
 * يُغلِّفُ `RoutingProvider.route()` بـ`InMemoryRouteCache`: يُخزِّنُ نتيجةَ
 * المسارِ الكاملةَ (بما فيها `snap`) لكلِّ سائقٍ + وجهة، ولا يُعيدُ نداءَ
 * المزوّدِ إلّا عند تغيُّرٍ ذي معنى. والنتيجةُ المخزَّنةُ هي `RouteResult` كاملةً
 * فلا يُتجاوزُ تحقُّقُ الإلصاقِ في ADR 0024.
 *
 * ## ما لا يفعله
 *
 * - لا يُخفِّفُ سياسةَ ADR 0024 — المدّةُ المخزَّنةُ خضعتْ للسياسةِ قبل التخزين.
 * - لا يُوصِلُ ETA بالبثِّ الحيِّ — ذلك قرارٌ يتوقّفُ على قياسِ الحملِ (ADR 0024).
 * - لا يُخزِّنُ في Redis — الذاكرةُ كافيةٌ للنسخةِ الواحدة.
 */

import type {
  DistanceMatrix,
  LatLng,
  NearestOptions,
  NearestResult,
  RouteOptions,
  RouteResult,
  RoutingError,
  RoutingProvider,
} from "../../maps/core/index.ts";
import type { Result } from "../../shared/result/index.ts";
import {
  InMemoryRouteCache,
  type RouteCacheKey,
  type RouteCacheThresholds,
} from "./route-cache.ts";

/**
 * مفتاحُ التخزين من خياراتِ المسار: الأصلُ + الوجهة.
 * فالسائقُ يُعرَّفُ بموضعِه، وكلُّ موضعٍ له مسارُه الخاص.
 */
function keyFromRoute(origin: LatLng, destination: LatLng): RouteCacheKey {
  return {
    driverId: `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`,
    destination: {
      latitude: destination.lat,
      longitude: destination.lng,
    },
  };
}

/** نتيجةُ مسارٍ مخزَّنةٌ كاملةً — بما فيها `snap` و`geometry`. */
interface CachedRouteResult {
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly geometry: RouteResult["geometry"];
  readonly snap: RouteResult["snap"];
  readonly legs: RouteResult["legs"] | undefined;
}

/**
 * مُغلِّفٌ يُخزِّنُ نتائجَ `route()` ولا يُمرِّرُ النداءَ إلّا عند تغيُّرٍ ذي معنى.
 *
 * `nearest()` و`table()` لا يُخزَّنان: الأولى نادرةٌ (نقطةٌ واحدة)، والثانية
 * لا تُستدعى في مسارِ ETA.
 */
export class CachedRoutingProvider implements RoutingProvider {
  readonly name = "osrm" as const;
  private readonly inner: RoutingProvider;
  private readonly cache: InMemoryRouteCache;
  private readonly fullCache = new Map<string, CachedRouteResult>();

  constructor(inner: RoutingProvider, thresholds?: RouteCacheThresholds) {
    this.inner = inner;
    this.cache = new InMemoryRouteCache(thresholds);
  }

  private cacheKey(origin: LatLng, destination: LatLng): string {
    return `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}:${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;
  }

  async route(options: RouteOptions): Promise<Result<RouteResult, RoutingError>> {
    const origin = options.origin;
    const destination = options.destination;
    const key = this.cacheKey(origin, destination);
    const now = Date.now();

    if (
      !this.cache.shouldRecompute(
        keyFromRoute(origin, destination),
        { latitude: origin.lat, longitude: origin.lng },
        now,
      )
    ) {
      const cached = this.fullCache.get(key);
      if (cached !== undefined) {
        return {
          ok: true,
          value: {
            distanceMeters: cached.distanceMeters,
            durationSeconds: cached.durationSeconds,
            geometry: cached.geometry,
            snap: cached.snap,
            ...(cached.legs ? { legs: cached.legs } : {}),
          },
        };
      }
    }

    const result = await this.inner.route(options);
    if (result.ok) {
      this.cache.set(keyFromRoute(origin, destination), {
        driverPosition: { latitude: origin.lat, longitude: origin.lng },
        computedAt: now,
        durationSeconds: result.value.durationSeconds,
        distanceMeters: result.value.distanceMeters,
      });
      this.fullCache.set(key, {
        durationSeconds: result.value.durationSeconds,
        distanceMeters: result.value.distanceMeters,
        geometry: result.value.geometry,
        snap: result.value.snap,
        legs: result.value.legs,
      });
    }
    return result;
  }

  async nearest(options: NearestOptions): Promise<Result<NearestResult, RoutingError>> {
    return this.inner.nearest(options);
  }

  async table(
    sources: readonly LatLng[],
    destinations: readonly LatLng[],
  ): Promise<Result<DistanceMatrix, RoutingError>> {
    return this.inner.table(sources, destinations);
  }

  /** للتشخيص: عددُ المساراتِ المخزَّنة. */
  get cacheSize(): number {
    return this.fullCache.size;
  }
}
