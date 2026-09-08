/**
 * الغرض: إثباتُ `SCL-005` — مخزنُ البثّ المشترك والادّعاءُ الذرّيُّ لبدءِ البثّ.
 *
 * ثلاثُ مجموعاتٍ هنا:
 *   (١) مخزنُ الذاكرة: عمليّاتُ get/save/delete/claimStart/releaseClaim.
 *   (٢) مخزنُ Redis بعميلٍ مزوّر: الادّعاءُ ينجحُ مرّةً، والتحريرُ الآمنُ بالرمز.
 *   (٣) مُرحِّلانِ يتشاركانِ مخزناً واحداً: بدءُ بثٍّ واحدٌ لا اثنان،
 *       وتعديلُ الرسالةِ نفسِها، والإغلاقُ مرّةً واحدة.
 *
 * الحالة: اختبار وحدة فعلي — لا يتطلب قاعدة ولا Redis.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { RedisClient, RedisFailure } from "../../apps/gateway/src/redis/upstash.ts";
import { createCustomerLiveRelay } from "../../packages/application/tracking/customer-live-relay.ts";
import { createInMemoryLiveBroadcastStore } from "../../packages/application/tracking/in-memory-live-broadcast-store.ts";
import type { LiveBroadcastStore } from "../../packages/application/tracking/live-broadcast-store.ts";
import { createRedisLiveBroadcastStore } from "../../packages/infrastructure/tracking/redis-live-broadcast-store.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const TRIP = "trip-1";
const RIDER = "rider-1";
const DRIVER = "driver-1";
const SESSION = "11111111-1111-4111-8111-111111111111";

const positionEvent = (over: Partial<TrackingEvent> = {}): TrackingEvent => ({
  type: "location_updated",
  driverId: DRIVER,
  tripId: TRIP,
  sessionId: SESSION,
  sequence: 1,
  cityId: "city-jed",
  position: { lat: 21.5471, lng: 39.1751 },
  timestamp: new Date(0),
  ...over,
});

interface ChannelCall {
  readonly op: "start" | "update" | "stop";
  readonly messageId?: string;
}

function captureChannel() {
  const calls: ChannelCall[] = [];
  let next = 0;
  return {
    calls,
    channel: {
      start: async (_chatId: string, _position: { lat: number; lng: number }) => {
        next += 1;
        const id = `msg-${next}`;
        calls.push({ op: "start", messageId: id });
        return id;
      },
      update: async (
        _chatId: string,
        messageId: string,
        _position: { lat: number; lng: number },
      ) => {
        calls.push({ op: "update", messageId });
        return true;
      },
      stop: async (_chatId: string, messageId: string) => {
        calls.push({ op: "stop", messageId });
        return true;
      },
    },
  };
}

const target = {
  tripId: TRIP,
  riderId: RIDER,
  riderTelegramId: "555",
  driverId: DRIVER,
  riderLanguage: "ar",
  status: "in_progress" as const,
};

function buildRelay(
  store: LiveBroadcastStore,
  channel: ReturnType<typeof captureChannel>["channel"],
  nowMsRef: { value: number },
) {
  const relay = createCustomerLiveRelay({
    channel,
    customers: { resolve: async () => target },
    clock: { now: () => new Date(nowMsRef.value) },
    livePeriodSeconds: 3600,
    store,
  });
  return relay;
}

// ─────────────────────────────────────────────────────────────────────────────
// (١) مخزن الذاكرة
// ─────────────────────────────────────────────────────────────────────────────

describe("مخزنُ البثّ الذاكريّ — `SCL-005`", () => {
  it("يُعيد null لرحلةٍ بلا بثّ", async () => {
    const store = createInMemoryLiveBroadcastStore();
    expect(await store.get(TRIP)).toBeNull();
  });

  it("يحفظُ ويقرأُ الحالة", async () => {
    const store = createInMemoryLiveBroadcastStore();
    await store.save(
      TRIP,
      {
        chatId: "555",
        messageId: "msg-1",
        sentAtMs: 1000,
        lat: 21.5,
        lng: 39.1,
        sessionId: SESSION,
        lastAppliedSeq: 5,
      },
      60_000,
    );
    const state = await store.get(TRIP);
    expect(state?.messageId).toBe("msg-1");
    expect(state?.lastAppliedSeq).toBe(5);
  });

  it("الادّعاءُ ينجحُ مرّةً واحدةً لكلِّ رحلة", async () => {
    const store = createInMemoryLiveBroadcastStore();
    expect(await store.claimStart(TRIP, "tok-a", 10_000)).toBe(true);
    expect(await store.claimStart(TRIP, "tok-b", 10_000)).toBe(false);
  });

  it("التحريرُ الآمنُ: يحذفُ الادّعاءَ فقط إن كان الرمزُ صاحبَه", async () => {
    const store = createInMemoryLiveBroadcastStore();
    await store.claimStart(TRIP, "tok-a", 10_000);
    await store.releaseClaim(TRIP, "tok-b"); // رمزٌ مغاير — لا يُحرَّر
    expect(await store.claimStart(TRIP, "tok-c", 10_000)).toBe(false); // لا يزال مشغولاً
    await store.releaseClaim(TRIP, "tok-a"); // الرمزُ الصحيح — يُحرَّر
    expect(await store.claimStart(TRIP, "tok-d", 10_000)).toBe(true); // صار متاحاً
  });

  it("الحذفُ يُزيل الحالة", async () => {
    const store = createInMemoryLiveBroadcastStore();
    await store.save(
      TRIP,
      {
        chatId: "555",
        messageId: "msg-1",
        sentAtMs: 1000,
        lat: 21.5,
        lng: 39.1,
        sessionId: SESSION,
        lastAppliedSeq: 5,
      },
      60_000,
    );
    await store.delete(TRIP);
    expect(await store.get(TRIP)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (٢) مخزن Redis بعميلٍ مزوّر
// ─────────────────────────────────────────────────────────────────────────────

interface FakeRedis {
  readonly values: Map<string, string>;
  readonly commands: {
    args: readonly (string | number)[];
    result: Result<unknown, RedisFailure>;
  }[];
}

function fakeRedisClient(redis: FakeRedis): RedisClient {
  return {
    command: async (args: readonly (string | number)[]): Promise<Result<unknown, RedisFailure>> => {
      redis.commands.push({ args, result: ok(null) });
      const op = String(args[0]);
      const key = String(args[1]);
      if (op === "GET") {
        return ok(redis.values.get(key) ?? null);
      }
      if (op === "SET") {
        // [SET, key, value, (NX)?, (PX)?, ttl?]
        const value = String(args[2]);
        const hasNx = args.includes("NX");
        if (hasNx && redis.values.has(key)) {
          return ok(null); // لم يُضَف — المفتاحُ موجودٌ مسبقاً
        }
        redis.values.set(key, value);
        return ok("OK");
      }
      if (op === "DEL") {
        redis.values.delete(key);
        return ok(1);
      }
      if (op === "EVAL") {
        // محاكاةُ سكربتِ Lua: احذف إن كان الرمزُ صاحبَه.
        const key2 = String(args[3]);
        const token = String(args[4]);
        if (redis.values.get(key2) === token) {
          redis.values.delete(key2);
          return ok(1);
        }
        return ok(0);
      }
      return ok(null);
    },
  };
}

describe("مخزنُ البثّ في Redis (عميلٌ مزوّر) — `SCL-005`", () => {
  it("claimStart ينجحُ مرّةً واحدةً ويعيد false بعدها", async () => {
    const redis: FakeRedis = { values: new Map(), commands: [] };
    const store = createRedisLiveBroadcastStore(fakeRedisClient(redis));
    expect(await store.claimStart(TRIP, "tok-a", 10_000)).toBe(true);
    expect(await store.claimStart(TRIP, "tok-b", 10_000)).toBe(false);
  });

  it("releaseClaim يحرّرُ فقط بالرمزِ الصحيح", async () => {
    const redis: FakeRedis = { values: new Map(), commands: [] };
    const store = createRedisLiveBroadcastStore(fakeRedisClient(redis));
    await store.claimStart(TRIP, "tok-a", 10_000);
    await store.releaseClaim(TRIP, "tok-b"); // مغاير — لا شيء
    expect(await store.claimStart(TRIP, "tok-c", 10_000)).toBe(false);
    await store.releaseClaim(TRIP, "tok-a"); // صحيح
    expect(await store.claimStart(TRIP, "tok-d", 10_000)).toBe(true);
  });

  it("save ثم get يُعيدان الحالة", async () => {
    const redis: FakeRedis = { values: new Map(), commands: [] };
    const store = createRedisLiveBroadcastStore(fakeRedisClient(redis));
    await store.save(
      TRIP,
      {
        chatId: "555",
        messageId: "msg-1",
        sentAtMs: 1000,
        lat: 21.5,
        lng: 39.1,
        sessionId: SESSION,
        lastAppliedSeq: 5,
      },
      60_000,
    );
    const state = await store.get(TRIP);
    expect(state?.messageId).toBe("msg-1");
    expect(state?.lastAppliedSeq).toBe(5);
  });

  it("get على مفتاحٍ غير موجود يعيد null", async () => {
    const redis: FakeRedis = { values: new Map(), commands: [] };
    const store = createRedisLiveBroadcastStore(fakeRedisClient(redis));
    expect(await store.get(TRIP)).toBeNull();
  });

  it("get على قيمةٍ مشوّهةٍ يعيد null لا يرمي", async () => {
    const redis: FakeRedis = { values: new Map(), commands: [] };
    redis.values.set("live:broadcast:state:trip-1", "{not json");
    const store = createRedisLiveBroadcastStore(fakeRedisClient(redis));
    expect(await store.get(TRIP)).toBeNull();
  });

  it("claimStart عند فشلِ الشبكة يعيد false لا يرمي", async () => {
    const failingClient: RedisClient = {
      command: async () => err({ kind: "network", detail: "offline" }),
    };
    const store = createRedisLiveBroadcastStore(failingClient);
    expect(await store.claimStart(TRIP, "tok-a", 10_000)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (٣) مُرحِّلانِ يتشاركانِ مخزناً واحداً
// ─────────────────────────────────────────────────────────────────────────────

describe("مُرحِّلانِ يتشاركانِ مخزنَ بثٍّ مشتركاً — `SCL-005`", () => {
  it("أوّلُ حدثينِ متزامنينِ يفتحانِ بثّاً واحداً لا اثنين", async () => {
    const store = createInMemoryLiveBroadcastStore();
    const a = captureChannel();
    const b = captureChannel();
    const now = { value: 1_000_000 };
    const relayA = buildRelay(store, a.channel, now);
    const relayB = buildRelay(store, b.channel, now);

    // حدثانِ متزامنانِ للرحلةِ نفسِها قبلَ أن يحفظَ أيُّهما الحالة.
    await Promise.all([
      relayA.handle(positionEvent({ sequence: 1 })),
      relayB.handle(positionEvent({ sequence: 2 })),
    ]);

    const starts = [...a.calls, ...b.calls].filter((c) => c.op === "start");
    expect(starts.length).toBe(1);
  });

  it("النسخةُ الثانيةُ تُعدِّلُ الرسالةَ نفسَها لا تفتحُ رسالةً جديدة", async () => {
    const store = createInMemoryLiveBroadcastStore();
    const a = captureChannel();
    const b = captureChannel();
    const now = { value: 1_000_000 };
    const relayA = buildRelay(store, a.channel, now);
    const relayB = buildRelay(store, b.channel, now);

    // النسخةُ أ تبدأُ البثَّ أوّلاً.
    await relayA.handle(positionEvent({ sequence: 1 }));
    const startId = a.calls.find((c) => c.op === "start")?.messageId;
    expect(startId).toBeDefined();

    // الزمنُ يتقدّمُ فوقَ حدِّ الخنقِ (٥ ثوانٍ) حتى يمرَّ التعديل.
    now.value += 10_000;
    // النسخةُ ب ترى الحالةَ في المخزنِ فتُعدِّلُ الرسالةَ نفسَها.
    await relayB.handle(positionEvent({ sequence: 2, position: { lat: 21.6, lng: 39.2 } }));
    const bStarts = b.calls.filter((c) => c.op === "start");
    expect(bStarts.length).toBe(0); // لم تفتح رسالةً جديدة
    const bUpdates = b.calls.filter((c) => c.op === "update");
    expect(bUpdates.length).toBe(1);
    expect(bUpdates[0]?.messageId).toBe(startId);
  });

  it("الإغلاقُ من نسخةٍ أخرى يُوقفُ البثَّ مرّةً واحدة", async () => {
    const store = createInMemoryLiveBroadcastStore();
    const a = captureChannel();
    const b = captureChannel();
    const now = { value: 1_000_000 };
    const relayA = buildRelay(store, a.channel, now);
    const relayB = buildRelay(store, b.channel, now);

    await relayA.handle(positionEvent({ sequence: 1 }));
    await relayB.handle({
      type: "session_ended",
      driverId: DRIVER,
      tripId: TRIP,
      sessionId: SESSION,
      sequence: 4,
      position: null,
      cityId: "city-jed",
      timestamp: new Date(0),
    });

    const stops = [...a.calls, ...b.calls].filter((c) => c.op === "stop");
    expect(stops.length).toBe(1);
    expect(await store.get(TRIP)).toBeNull();
  });

  it("تسلسلٌ قديمٌ من نسخةٍ أخرى يُتجاهَلُ بحسبِ lastAppliedSeq", async () => {
    const store = createInMemoryLiveBroadcastStore();
    const a = captureChannel();
    const b = captureChannel();
    const now = { value: 1_000_000 };
    const relayA = buildRelay(store, a.channel, now);
    const relayB = buildRelay(store, b.channel, now);

    // النسخةُ أ تطبّقُ التسلسلَ ٣.
    await relayA.handle(positionEvent({ sequence: 3 }));
    // النسخةُ ب ترى التسلسلَ ٢ (أقدم) — يُسقَط.
    await relayB.handle(positionEvent({ sequence: 2 }));
    const bStarts = b.calls.filter((c) => c.op === "start");
    expect(bStarts.length).toBe(0);
    const bUpdates = b.calls.filter((c) => c.op === "update");
    expect(bUpdates.length).toBe(0);
  });
});
