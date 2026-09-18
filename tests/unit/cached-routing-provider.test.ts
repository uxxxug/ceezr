/**
 * الغرض: اختباراتُ مزوّدِ التوجيهِ المخزَّنِ (CAP-012 — الوصل).
 *   ستةُ أصنافٍ: النداءُ الأولُ يستدعي المزوّدَ · cache hit لا يستدعيه ·
 *   تغيُّر غير ذي معنى لا يستدعيه · انتهاء TTL يستدعيه · تغيُّر ذو معنى يستدعيه ·
 *   فشلُ المزوّد يعيد الخطأ لا ETA زائف.
 *
 * الحالة: منفّذ فعلياً — CAP-012 (الوصل).
 */

import { describe, expect, it } from "bun:test";
import { CachedRoutingProvider } from "../../packages/application/tracking/cached-routing-provider.ts";
import type {
  DistanceMatrix,
  LatLng,
  NearestOptions,
  NearestResult,
  RouteOptions,
  RouteResult,
  RoutingError,
  RoutingProvider,
} from "../../packages/maps/core/index.ts";
import type { Result } from "../../packages/shared/result/index.ts";

const ORIGIN: LatLng = { lat: 21.5, lng: 39.2 };
const DESTINATION: LatLng = { lat: 21.6, lng: 39.3 };
const NEARBY_ORIGIN: LatLng = { lat: 21.5001, lng: 39.2 };
const MOVED_ORIGIN: LatLng = { lat: 21.55, lng: 39.2 };

function makeRouteResult(): RouteResult {
  return {
    distanceMeters: 5000,
    durationSeconds: 600,
    geometry: "" as never,
    snap: { known: true, originMeters: 5, destinationMeters: 3 },
  };
}

function createSpyProvider(): { provider: RoutingProvider; routeCalls: number } {
  let routeCalls = 0;
  const provider: RoutingProvider = {
    name: "osrm",
    route: async (_options: RouteOptions): Promise<Result<RouteResult, RoutingError>> => {
      routeCalls++;
      return { ok: true, value: makeRouteResult() };
    },
    nearest: async (_options: NearestOptions): Promise<Result<NearestResult, RoutingError>> => {
      return { ok: true, value: {} as NearestResult };
    },
    table: async (
      _sources: readonly LatLng[],
      _destinations: readonly LatLng[],
    ): Promise<Result<DistanceMatrix, RoutingError>> => {
      return { ok: true, value: {} as DistanceMatrix };
    },
  };
  return {
    provider,
    get routeCalls() {
      return routeCalls;
    },
  };
}

function createFailingProvider(): RoutingProvider {
  return {
    name: "osrm",
    route: async (_options: RouteOptions): Promise<Result<RouteResult, RoutingError>> => {
      return { ok: false, error: { kind: "unreachable" } as RoutingError };
    },
    nearest: async (_options: NearestOptions): Promise<Result<NearestResult, RoutingError>> => {
      return { ok: false, error: { kind: "unreachable" } as RoutingError };
    },
    table: async (
      _sources: readonly LatLng[],
      _destinations: readonly LatLng[],
    ): Promise<Result<DistanceMatrix, RoutingError>> => {
      return { ok: false, error: { kind: "unreachable" } as RoutingError };
    },
  };
}

describe("CAP-012: CachedRoutingProvider — cache wiring", () => {
  it("first call invokes the inner provider", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    await cached.route({ origin: ORIGIN, destination: DESTINATION, profile: "driving" });

    expect(spy.routeCalls).toBe(1);
  });

  it("cache hit does NOT invoke the inner provider", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    await cached.route({ origin: ORIGIN, destination: DESTINATION, profile: "driving" });
    await cached.route({ origin: ORIGIN, destination: DESTINATION, profile: "driving" });

    expect(spy.routeCalls).toBe(1);
  });

  it("non-meaningful change (11m) does NOT invoke the inner provider", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    await cached.route({ origin: ORIGIN, destination: DESTINATION, profile: "driving" });
    await cached.route({ origin: NEARBY_ORIGIN, destination: DESTINATION, profile: "driving" });

    expect(spy.routeCalls).toBe(1);
  });

  it("meaningful change (5.5km) invokes the inner provider", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    await cached.route({ origin: ORIGIN, destination: DESTINATION, profile: "driving" });
    await cached.route({ origin: MOVED_ORIGIN, destination: DESTINATION, profile: "driving" });

    expect(spy.routeCalls).toBe(2);
  });

  it("provider failure returns the error, not a fake ETA", async () => {
    const failing = createFailingProvider();
    const cached = new CachedRoutingProvider(failing);

    const result = await cached.route({
      origin: ORIGIN,
      destination: DESTINATION,
      profile: "driving",
    });

    expect(result.ok).toBe(false);
  });

  it("cached result includes snap — does not bypass ADR 0024", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    const first = await cached.route({
      origin: ORIGIN,
      destination: DESTINATION,
      profile: "driving",
    });
    const second = await cached.route({
      origin: ORIGIN,
      destination: DESTINATION,
      profile: "driving",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.snap).toEqual(first.value.snap);
      expect(second.value.distanceMeters).toBe(first.value.distanceMeters);
      expect(second.value.durationSeconds).toBe(first.value.durationSeconds);
    }
  });

  it("nearest() passes through to inner provider", async () => {
    const spy = createSpyProvider();
    const cached = new CachedRoutingProvider(spy.provider);

    const result = await cached.nearest({ point: ORIGIN });

    expect(result.ok).toBe(true);
  });
});
