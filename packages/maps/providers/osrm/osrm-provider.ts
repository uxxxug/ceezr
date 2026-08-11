/**
 * الغرض: مزوّد OSRM للتوجيه — أول تنفيذ فعلي لواجهة RoutingProvider.
 *   OSRM مفتوح المصدر، يدعم Route/Table/Nearest/Match.
 *   يعمل عبر HTTP، ولا يحتاج مفتاح API للخوادم ذاتية الاستضافة.
 * الحالة: منفّذ فعلياً — المرحلة 4.
 * ينتمي إلى: packages/maps/providers/osrm
 * يُتوقع أن يستخدمه لاحقاً: packages/tracking، apps/gateway
 */

import { err, ok, type Result } from "../../../shared/result/index.ts";
import {
  type DistanceMatrix,
  type DistanceMatrixRow,
  type NearestOptions,
  type RouteOptions,
  RoutingError,
  type RoutingProvider,
} from "../../core/routing-provider.ts";
import type {
  LatLng,
  NearbyDriver,
  NearestResult,
  ProviderName,
  RouteResult,
} from "../../core/types.ts";

export interface OsrmConfig {
  /** عنوان خادم OSRM (مثال: http://router.project-osrm.org). */
  readonly baseUrl: string;
  /** الملف الشخصي الافتراضي (driving افتراضياً). */
  readonly defaultProfile?: "driving" | "walking" | "cycling";
}

/** استجابة OSRM للمسار. */
interface OsrmRouteResponse {
  code: string;
  routes: readonly {
    distance: number;
    duration: number;
    geometry: { coordinates: readonly [number, number][] };
  }[];
}

/** استجابة OSRM للأقرب. */
interface OsrmNearestResponse {
  code: string;
  waypoints: readonly {
    location: readonly [number, number];
    distance: number;
    hint?: string;
  }[];
}

/** استجابة OSRM للجدول. */
interface OsrmTableResponse {
  code: string;
  distances: readonly (readonly number[])[];
  durations: readonly (readonly number[])[];
}

export function createOsrmProvider(config: OsrmConfig): RoutingProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  async function fetchJson<T>(path: string): Promise<Result<T, RoutingError>> {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        return err(new RoutingError("osrm", `HTTP ${res.status}: ${res.statusText}`));
      }
      const data = (await res.json()) as T;
      return ok(data);
    } catch (e) {
      return err(
        new RoutingError("osrm", `fetch failed: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  function coordStr(p: LatLng): string {
    return `${p.lng},${p.lat}`;
  }

  return {
    name: "osrm" as ProviderName,

    route: async (options: RouteOptions): Promise<Result<RouteResult, RoutingError>> => {
      const points = [options.origin, ...(options.waypoints ?? []), options.destination];
      const coords = points.map(coordStr).join(";");
      const overview = options.steps ? "full" : "simplified";
      const geoms = "geojson";

      const result = await fetchJson<OsrmRouteResponse>(
        `/route/v1/driving/${coords}?overview=${overview}&geometries=${geoms}&steps=${options.steps ? "true" : "false"}`,
      );
      if (!result.ok) return err(result.error);

      const route = result.value.routes[0];
      if (!route) {
        return err(new RoutingError("osrm", "no route found"));
      }

      return ok({
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: {
          points: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        },
      });
    },

    nearest: async (options: NearestOptions): Promise<Result<NearestResult, RoutingError>> => {
      const count = options.count ?? 1;
      const result = await fetchJson<OsrmNearestResponse>(
        `/nearest/v1/driving/${coordStr(options.point)}?number=${count}`,
      );
      if (!result.ok) return err(result.error);

      const drivers: NearbyDriver[] = result.value.waypoints.map((wp, i) => ({
        driverId: `nearest-${i}`,
        position: { lat: wp.location[1], lng: wp.location[0] },
        distanceMeters: wp.distance,
        durationSeconds: 0,
      }));

      return ok({ drivers });
    },

    table: async (
      sources: readonly LatLng[],
      destinations: readonly LatLng[],
    ): Promise<Result<DistanceMatrix, RoutingError>> => {
      const srcIdx = sources.map((_, i) => i).join(";");
      const allPoints = [...sources, ...destinations].map(coordStr).join(";");
      const destStart = sources.length;

      const result = await fetchJson<OsrmTableResponse>(
        `/table/v1/driving/${allPoints}?sources=${srcIdx}&destinations=${destStart};${destinations.length - 1}&annotations=duration,distance`,
      );
      if (!result.ok) return err(result.error);

      const rows: DistanceMatrixRow[] = result.value.distances.map((row, i) => ({
        elements: row.map((dist, j) => ({
          distanceMeters: dist,
          durationSeconds: result.value.durations[i]?.[j] ?? 0,
          status: "ok" as const,
        })),
      }));

      return ok({ rows });
    },
  };
}
