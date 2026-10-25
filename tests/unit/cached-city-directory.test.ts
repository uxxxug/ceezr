import { describe, expect, test } from "bun:test";
import type { CityDirectory, CityRef } from "../../packages/application/bots/types.ts";
import {
  CITY_DIRECTORY_CACHE_TTL_MS,
  createCachedCityDirectory,
} from "../../packages/infrastructure/geo/cached-city-directory.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const city = (id: string, code: string): CityRef => ({ id: id as CityId, code, name: code });

function fakeInner(responses: Array<"fail" | CityRef[]>) {
  let calls = 0;
  const pending: Array<() => void> = [];
  let gate = false;
  const inner: CityDirectory = {
    listActive: async () => {
      const r = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      if (gate) await new Promise<void>((resolve) => pending.push(resolve));
      if (r === "fail" || r === undefined) return err({ code: "STORE_ERROR" } as never);
      return ok(r);
    },
  };
  return {
    inner,
    calls: () => calls,
    hold: () => {
      gate = true;
    },
    release: () => {
      gate = false;
      for (const r of pending.splice(0)) r();
    },
  };
}

describe("LOAD-01 · cached city directory", () => {
  test("default staleness bound is 5 seconds", () => {
    expect(CITY_DIRECTORY_CACHE_TTL_MS).toBe(5_000);
  });

  test("serves from memory inside the TTL, re-reads at and after expiry", async () => {
    let now = 1_000;
    const f = fakeInner([[city("1", "JED")], [city("1", "JED"), city("2", "MKK")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 5_000, nowMs: () => now });
    const a = await dir.listActive();
    now += 4_999;
    const b = await dir.listActive();
    expect(f.calls()).toBe(1);
    expect(b).toEqual(a);
    now += 1; // = expiresAt: stale ⇒ must re-read (strict <)
    const c = await dir.listActive();
    expect(f.calls()).toBe(2);
    expect(c.ok && c.value.map((x) => x.code)).toEqual(["JED", "MKK"]);
  });

  test("a deactivated city disappears no later than TTL after the cached read", async () => {
    let now = 0;
    const f = fakeInner([[city("1", "JED"), city("2", "MKK")], [city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 5_000, nowMs: () => now });
    await dir.listActive();
    now = 5_000;
    const after = await dir.listActive();
    expect(after.ok && after.value.some((x) => x.code === "MKK")).toBe(false);
  });

  test("failures are never cached and never evict a previous value's semantics", async () => {
    let now = 0;
    const f = fakeInner(["fail", [city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 5_000, nowMs: () => now });
    const first = await dir.listActive();
    expect(first.ok).toBe(false);
    const second = await dir.listActive();
    expect(f.calls()).toBe(2);
    expect(second.ok).toBe(true);
    now += 10;
    await dir.listActive();
    expect(f.calls()).toBe(2);
  });

  test("concurrent misses share one underlying read (single flight)", async () => {
    const f = fakeInner([[city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 5_000, nowMs: () => 0 });
    f.hold();
    const all = Promise.all(Array.from({ length: 50 }, () => dir.listActive()));
    await Promise.resolve();
    f.release();
    const results = await all;
    expect(f.calls()).toBe(1);
    expect(results.every((r) => r.ok && r.value[0]?.code === "JED")).toBe(true);
  });

  test("a failed in-flight read lets the next call retry", async () => {
    const f = fakeInner(["fail", [city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 5_000, nowMs: () => 0 });
    f.hold();
    const both = Promise.all([dir.listActive(), dir.listActive()]);
    await Promise.resolve();
    f.release();
    const [x, y] = await both;
    expect(x.ok || y.ok).toBe(false);
    expect(f.calls()).toBe(1);
    expect((await dir.listActive()).ok).toBe(true);
    expect(f.calls()).toBe(2);
  });

  test("returned list and entries are frozen", async () => {
    const f = fakeInner([[city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { nowMs: () => 0 });
    const r = await dir.listActive();
    if (!r.ok) throw new Error("expected ok");
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value[0])).toBe(true);
  });

  test("ttlMs 0 disables caching (every call reads)", async () => {
    const f = fakeInner([[city("1", "JED")]]);
    const dir = createCachedCityDirectory(f.inner, { ttlMs: 0, nowMs: () => 0 });
    await dir.listActive();
    await dir.listActive();
    expect(f.calls()).toBe(2);
  });

  test("invalid ttl is rejected", () => {
    const f = fakeInner([[city("1", "JED")]]);
    expect(() => createCachedCityDirectory(f.inner, { ttlMs: -1 })).toThrow(RangeError);
    expect(() => createCachedCityDirectory(f.inner, { ttlMs: Number.NaN })).toThrow(RangeError);
  });
});
