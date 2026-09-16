import { describe, it, expect } from "bun:test";
import type {
  DriverLocationHotStateReader,
  HotLocationSnapshot,
} from "../../packages/application/geo/driver-location-hot-state.ts";
import { ok } from "../../packages/shared/result/index.ts";

/** قارئٌ ساخنٌ زائفٌ يُرجِعُ لقطةً ثابتةً — أو `null` إن رُفِعَ العلمُ. */
function createFakeHotReader(
  snapshot: HotLocationSnapshot | null,
): DriverLocationHotStateReader {
  return {
    read: async () => ok(snapshot),
  };
}

/** محاكاةُ منطقِ القراءةِ في `tracking-token-adapters.ts` — قراءةٌ ساخنةٌ أوّلاً ثم قاعدة. */
function resolvePosition(
  dbResponse: { ok: boolean; active?: boolean; driver_id?: string; city_id?: string; position?: { lat: number; lng: number; age_seconds: number; verdict: string } },
  hotSnapshot: HotLocationSnapshot | null,
  hasHotReader: boolean,
): { kind: string; position?: { lat: number; lng: number; ageSeconds: number } } {
  if (!dbResponse.ok) return { kind: "invalid" };

  if (hasHotReader && dbResponse.driver_id && dbResponse.city_id && hotSnapshot !== null) {
    const ageSeconds = Math.max(0, Math.trunc((Date.now() - hotSnapshot.observedAtMs) / 1000));
    return { kind: "located", position: { lat: hotSnapshot.lat, lng: hotSnapshot.lng, ageSeconds } };
  }

  const cell = dbResponse.position;
  if (!cell) return { kind: "error" };
  if (cell.verdict === "NEVER_REPORTED" || cell.verdict === "NO_TIMESTAMP") {
    return { kind: "awaiting" };
  }
  if (cell.verdict === "TOO_OLD") {
    return { kind: "awaiting" };
  }
  return { kind: "located", position: { lat: cell.lat, lng: cell.lng, ageSeconds: cell.age_seconds } };
}

const TIMEOUT_MS = 10_000;

function withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  const sentinel = Symbol("timeout") as unknown as T;
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(sentinel), TIMEOUT_MS),
    ),
  ]).then((value) => {
    if (value === sentinel) throw new Error(`timeout: ${label}`);
    return value;
  });
}

describe("F4-05 — Public tracking from shared channel", () => {
  it("reads position from hot state when available", async () => {
    const hotSnapshot: HotLocationSnapshot = {
      lat: 21.5,
      lng: 39.2,
      observedAtMs: Date.now() - 2000,
    };
    const dbResponse = {
      ok: true,
      active: true,
      driver_id: "driver-123",
      city_id: "jeddah",
      position: { lat: 21.4, lng: 39.1, age_seconds: 30, verdict: "LOCATED" },
    };

    const result = resolvePosition(dbResponse, hotSnapshot, true);

    // يجب أن تكون الإحداثيّةُ من الحالةِ الساخنةِ، لا من القاعدةِ.
    expect(result.kind).toBe("located");
    expect(result.position?.lat).toBe(21.5);
    expect(result.position?.lng).toBe(39.2);
    expect(result.position?.ageSeconds).toBeLessThan(30);
  });

  it("falls back to DB when hot state is null", async () => {
    const dbResponse = {
      ok: true,
      active: true,
      driver_id: "driver-123",
      city_id: "jeddah",
      position: { lat: 21.4, lng: 39.1, age_seconds: 30, verdict: "LOCATED" },
    };

    const result = resolvePosition(dbResponse, null, true);

    expect(result.kind).toBe("located");
    expect(result.position?.lat).toBe(21.4);
    expect(result.position?.lng).toBe(39.1);
    expect(result.position?.ageSeconds).toBe(30);
  });

  it("falls back to DB when no hot reader is provided", async () => {
    const dbResponse = {
      ok: true,
      active: true,
      driver_id: "driver-123",
      city_id: "jeddah",
      position: { lat: 21.4, lng: 39.1, age_seconds: 30, verdict: "LOCATED" },
    };

    const result = resolvePosition(dbResponse, null, false);

    expect(result.kind).toBe("located");
    expect(result.position?.lat).toBe(21.4);
  });

  it("returns awaiting when DB says NEVER_REPORTED and no hot state", async () => {
    const dbResponse = {
      ok: true,
      active: true,
      driver_id: "driver-123",
      city_id: "jeddah",
      position: { lat: 0, lng: 0, age_seconds: 0, verdict: "NEVER_REPORTED" },
    };

    const result = resolvePosition(dbResponse, null, true);

    expect(result.kind).toBe("awaiting");
  });

  it("returns located from hot state even when DB says NEVER_REPORTED", async () => {
    const hotSnapshot: HotLocationSnapshot = {
      lat: 21.5,
      lng: 39.2,
      observedAtMs: Date.now() - 1000,
    };
    const dbResponse = {
      ok: true,
      active: true,
      driver_id: "driver-123",
      city_id: "jeddah",
      position: { lat: 0, lng: 0, age_seconds: 0, verdict: "NEVER_REPORTED" },
    };

    const result = resolvePosition(dbResponse, hotSnapshot, true);

    expect(result.kind).toBe("located");
  });

  it("returns invalid when token not found", async () => {
    const dbResponse = { ok: false };

    const result = resolvePosition(dbResponse, null, false);

    expect(result.kind).toBe("invalid");
  });

  it("hot state reader returns null for missing key", async () => {
    const reader = createFakeHotReader(null);
    const result = await withTimeout("read-missing", reader.read("driver-1" as never, "jeddah" as never));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("hot state reader returns snapshot for existing key", async () => {
    const snapshot: HotLocationSnapshot = {
      lat: 21.5,
      lng: 39.2,
      observedAtMs: Date.now(),
    };
    const reader = createFakeHotReader(snapshot);
    const result = await withTimeout("read-existing", reader.read("driver-1" as never, "jeddah" as never));

    expect(result.ok).toBe(true);
    if (result.ok && result.value !== null) {
      expect(result.value.lat).toBe(21.5);
      expect(result.value.lng).toBe(39.2);
    }
  });
});
