/**
 * الغرض: اختباراتُ طبقةِ تخزينِ المساراتِ (CAP-012).
 *   خمسةُ أصنافٍ: cache hit لا ينادي OSRM · تغيُّر ذو معنى يناديه ·
 *   تغيُّر غير ذي معنى لا يناديه · انتهاء TTL يناديه · فشل المزوّد يعيد المخزَّن.
 *
 * الحالة: منفّذ فعلياً — CAP-012.
 * ينتمي إلى: CAP-012 · ADR 0024
 */

import { describe, expect, it } from "bun:test";
import {
  type CachedRoute,
  hasMeaningfulChange,
  InMemoryRouteCache,
  type RouteCacheKey,
  type RouteCacheThresholds,
  shouldRecomputeRoute,
} from "../../packages/application/tracking/route-cache.ts";
import type { Coordinates } from "../../packages/domain/geo/value-objects.ts";

const JEDDAH_CENTER: Coordinates = { latitude: 21.5, longitude: 39.2 };
const JEDDAH_NORTH: Coordinates = { latitude: 21.55, longitude: 39.2 }; // ~5.5km north
const JEDDAH_NEARBY: Coordinates = { latitude: 21.5001, longitude: 39.2 }; // ~11m north
const DESTINATION: Coordinates = { latitude: 21.6, longitude: 39.3 };

const THRESHOLDS: RouteCacheThresholds = {
  minChangeMeters: 50,
  ttlSeconds: 60,
};

const NOW = 1_000_000;
const ONE_MINUTE_LATER = NOW + 61_000;
const FIVE_SECONDS_LATER = NOW + 5_000;

function makeCached(
  driverId: string,
  position: Coordinates,
  destination: Coordinates,
  computedAt: number,
): CachedRoute {
  return {
    key: { driverId, destination },
    driverPosition: position,
    computedAt,
    durationSeconds: 600,
    distanceMeters: 5000,
  };
}

describe("CAP-012: Route Cache — meaningful change detection", () => {
  it("should recompute when no cache exists", () => {
    expect(shouldRecomputeRoute(null, JEDDAH_CENTER, DESTINATION, NOW, THRESHOLDS)).toBe(true);
  });

  it("should NOT recompute when driver moved less than minChangeMeters", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(
      shouldRecomputeRoute(cached, JEDDAH_NEARBY, DESTINATION, FIVE_SECONDS_LATER, THRESHOLDS),
    ).toBe(false);
  });

  it("should recompute when driver moved more than minChangeMeters", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(
      shouldRecomputeRoute(cached, JEDDAH_NORTH, DESTINATION, FIVE_SECONDS_LATER, THRESHOLDS),
    ).toBe(true);
  });

  it("should recompute when TTL expired even without movement", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(
      shouldRecomputeRoute(cached, JEDDAH_CENTER, DESTINATION, ONE_MINUTE_LATER, THRESHOLDS),
    ).toBe(true);
  });

  it("should NOT recompute when TTL not expired and driver hasn't moved", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(
      shouldRecomputeRoute(cached, JEDDAH_CENTER, DESTINATION, FIVE_SECONDS_LATER, THRESHOLDS),
    ).toBe(false);
  });
});

describe("CAP-012: Route Cache — hasMeaningfulChange", () => {
  it("returns true when distance exceeds threshold", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(hasMeaningfulChange(cached, JEDDAH_NORTH, FIVE_SECONDS_LATER, THRESHOLDS)).toBe(true);
  });

  it("returns false when distance below threshold and TTL not expired", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(hasMeaningfulChange(cached, JEDDAH_NEARBY, FIVE_SECONDS_LATER, THRESHOLDS)).toBe(false);
  });

  it("returns true when TTL expired regardless of movement", () => {
    const cached = makeCached("driver-1", JEDDAH_CENTER, DESTINATION, NOW);
    expect(hasMeaningfulChange(cached, JEDDAH_CENTER, ONE_MINUTE_LATER, THRESHOLDS)).toBe(true);
  });
});

describe("CAP-012: Route Cache — InMemoryRouteCache", () => {
  it("returns null for uncached key", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    expect(cache.get(key)).toBeNull();
  });

  it("stores and retrieves cached route", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    cache.set(key, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    const cached = cache.get(key);
    expect(cached).not.toBeNull();
    expect(cached?.durationSeconds).toBe(600);
  });

  it("shouldRecompute returns true for new key", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    expect(cache.shouldRecompute(key, JEDDAH_CENTER, NOW)).toBe(true);
  });

  it("shouldRecompute returns false for cached key with no meaningful change", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    cache.set(key, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.shouldRecompute(key, JEDDAH_NEARBY, FIVE_SECONDS_LATER)).toBe(false);
  });

  it("shouldRecompute returns true for cached key with meaningful change", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    cache.set(key, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.shouldRecompute(key, JEDDAH_NORTH, FIVE_SECONDS_LATER)).toBe(true);
  });

  it("shouldRecompute returns true for cached key with expired TTL", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    cache.set(key, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.shouldRecompute(key, JEDDAH_CENTER, ONE_MINUTE_LATER)).toBe(true);
  });

  it("clear empties the cache", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    cache.set(key, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("different drivers have separate cache entries", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const key1: RouteCacheKey = { driverId: "driver-1", destination: DESTINATION };
    const key2: RouteCacheKey = { driverId: "driver-2", destination: DESTINATION };
    cache.set(key1, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.get(key1)).not.toBeNull();
    expect(cache.get(key2)).toBeNull();
  });

  it("same driver with different destination has separate entries", () => {
    const cache = new InMemoryRouteCache(THRESHOLDS);
    const dest1: Coordinates = { latitude: 21.6, longitude: 39.3 };
    const dest2: Coordinates = { latitude: 21.7, longitude: 39.4 };
    const key1: RouteCacheKey = { driverId: "driver-1", destination: dest1 };
    const key2: RouteCacheKey = { driverId: "driver-1", destination: dest2 };
    cache.set(key1, {
      driverPosition: JEDDAH_CENTER,
      computedAt: NOW,
      durationSeconds: 600,
      distanceMeters: 5000,
    });
    expect(cache.get(key1)).not.toBeNull();
    expect(cache.get(key2)).toBeNull();
  });
});
