/**
 * الغرض: اختبارُ بوّابةِ السحبِ الخاملِ (`PRD-001`) في محوّلِ الحالةِ الساخنةِ:
 *    لا يُرسَلُ `EVAL` السحبِ على قائمةٍ يُعلَمُ فراغُها، ويُرسَلُ فوراً بعدَ نبضةٍ
 *    «queued» أو إعادةِ إصلاحاتٍ أو سحبٍ غيرِ فارغٍ أو فشلٍ، وعندَ بلوغِ السقفِ.
 * الحالة: اختبار فعلي — Redis مُزيَّفٌ يَعُدُّ الأوامرَ، بلا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * والسببُ المقيسُ حيّاً (2026-10-08): مهمّةُ `flush-driver-locations` كانت تُرسِلُ
 * `EVAL` لكلِّ مدينةٍ كلَّ ~20ث وهيَ خاملةٌ — ~21.6K أمرٍ/يوم، فوقَ حصّةِ
 * Upstash المجانيّةِ (500K/شهر) التي استُنفِدَت من قبلُ.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { HotLocationFix } from "../../packages/application/geo/driver-location-hot-state.ts";
import type { SettingsRepository } from "../../packages/application/ports/index.ts";
import {
  createRedisDriverLocationHotState,
  resetDriverLocationDrainGateForTests,
} from "../../packages/infrastructure/geo/redis-driver-location-hot-state.ts";
import type { RedisClient } from "../../packages/infrastructure/redis/upstash.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY = "00000000-0000-4000-8000-000000000001" as CityId;
const DRIVER = "00000000-0000-4000-8000-0000000000d1" as DriverId;
const CEILING_MS = 120_000;

type Kind = "record" | "drain" | "requeue";

function fakeRedis(drainReply: () => unknown[] | "fail") {
  const calls: Kind[] = [];
  const redis: RedisClient = {
    command: async (args) => {
      const kind: Kind = args[2] === "3" ? "record" : args.length === 6 ? "drain" : "requeue";
      calls.push(kind);
      if (kind === "record") return ok(["queued", 1, Number(args[6])]);
      if (kind === "drain") {
        const reply = drainReply();
        if (reply === "fail")
          return { ok: false, error: { kind: "network", detail: "x" } } as never;
        return ok(reply);
      }
      return ok(1);
    },
  };
  return { redis, drains: () => calls.filter((k) => k === "drain").length };
}

const settings: SettingsRepository = {
  findByCity: async (cityId) =>
    ok([
      { cityId, key: "driver_location_hot_ttl_seconds", value: 120, valueType: "number" },
      { cityId, key: "driver_location_flush_interval_seconds", value: 10, valueType: "number" },
      { cityId, key: "driver_location_flush_batch_size", value: 200, valueType: "number" },
      { cityId, key: "driver_location_backlog_limit", value: 5_000, valueType: "number" },
    ]),
} as SettingsRepository;

function clockAt(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now) }, advance: (ms: number) => (now += ms) };
}

function fix(at: number): HotLocationFix {
  return {
    cityId: CITY,
    driverId: DRIVER,
    latitude: 24.47,
    longitude: 39.61,
    recordedAtMs: at,
    observedAtMs: at,
    accuracyMeters: 10,
    verdict: "ok",
  } as unknown as HotLocationFix;
}

beforeEach(() => resetDriverLocationDrainGateForTests());

describe("PRD-001 — بوّابةُ السحبِ الخامل", () => {
  it("١) بلا السقفِ: كلُّ سحبٍ أمرٌ — السلوكُ السابقُ حرفيّاً", async () => {
    const { redis, drains } = fakeRedis(() => []);
    const t = clockAt(1_000_000);
    const hot = createRedisDriverLocationHotState({ redis, settings, clock: t.clock });
    for (let i = 0; i < 5; i += 1) await hot.drain(CITY, 200);
    expect(drains()).toBe(5);
  });

  it("٢) خاملٌ: السحبُ الأوّلُ فقط، ثمّ لا أمرَ حتّى السقف", async () => {
    const { redis, drains } = fakeRedis(() => []);
    const t = clockAt(1_000_000);
    const hot = createRedisDriverLocationHotState({
      redis,
      settings,
      clock: t.clock,
      idleDrainCeilingMs: CEILING_MS,
    });
    const first = await hot.drain(CITY, 200);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      t.advance(20_000);
      const r = await hot.drain(CITY, 200);
      expect(r.ok && r.value.length === 0).toBe(true);
    }
    expect(drains()).toBe(1);
    t.advance(20_000); // 120ث منذ السحبِ الأوّل
    await hot.drain(CITY, 200);
    expect(drains()).toBe(2);
  });

  it("٣) نبضةٌ «queued» من محوّلٍ آخرَ في العمليّةِ نفسِها تُوقِظُ السحبَ فوراً", async () => {
    const { redis, drains } = fakeRedis(() => []);
    const t = clockAt(1_000_000);
    const worker = createRedisDriverLocationHotState({
      redis,
      settings,
      clock: t.clock,
      idleDrainCeilingMs: CEILING_MS,
    });
    const gateway = createRedisDriverLocationHotState({ redis, settings, clock: t.clock });
    await worker.drain(CITY, 200);
    t.advance(20_000);
    await worker.drain(CITY, 200);
    expect(drains()).toBe(1);

    const recorded = await gateway.record({
      ...fix(t.clock.now().getTime()),
      previousRecordedAtMs: null,
    });
    expect(recorded.ok && recorded.value.kind).toBe("queued");
    t.advance(1_000);
    await worker.drain(CITY, 200);
    expect(drains()).toBe(2);
    t.advance(20_000);
    await worker.drain(CITY, 200);
    expect(drains()).toBe(2);
  });

  it("٤) سحبٌ غيرُ فارغٍ يُبقي السحبَ التاليَ مستحقّاً (قد يبقى ما فوقَ الدفعة)", async () => {
    const encoded = JSON.stringify({ c: CITY, d: DRIVER, lat: 24.4, lng: 39.6, at: 1, v: "ok" });
    const replies: unknown[][] = [[encoded], []];
    const { redis, drains } = fakeRedis(() => replies.shift() ?? []);
    const t = clockAt(1_000_000);
    const hot = createRedisDriverLocationHotState({
      redis,
      settings,
      clock: t.clock,
      idleDrainCeilingMs: CEILING_MS,
    });
    await hot.drain(CITY, 200);
    t.advance(20_000);
    await hot.drain(CITY, 200);
    t.advance(20_000);
    await hot.drain(CITY, 200);
    expect(drains()).toBe(2);
  });

  it("٥) فشلُ السحبِ أو إعادةُ الإصلاحاتِ يُبقي السحبَ مستحقّاً — لا يُفقَدُ موضعٌ", async () => {
    let fail = true;
    const { redis, drains } = fakeRedis(() => (fail ? "fail" : []));
    const t = clockAt(1_000_000);
    const hot = createRedisDriverLocationHotState({
      redis,
      settings,
      clock: t.clock,
      idleDrainCeilingMs: CEILING_MS,
    });
    const failed = await hot.drain(CITY, 200);
    expect(failed.ok).toBe(false);
    fail = false;
    t.advance(20_000);
    await hot.drain(CITY, 200);
    expect(drains()).toBe(2);

    t.advance(20_000);
    await hot.drain(CITY, 200);
    expect(drains()).toBe(2);
    const requeued = await hot.requeue([fix(5)]);
    expect(requeued.ok).toBe(true);
    t.advance(20_000);
    await hot.drain(CITY, 200);
    expect(drains()).toBe(3);
  });
});
