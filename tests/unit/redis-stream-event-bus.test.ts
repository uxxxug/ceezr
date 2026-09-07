/**
 * الغرض: اختبارُ وحدةٍ لناقلِ أحداثِ التتبّعِ الموزَّعِ عبر Redis Streams (`SCL-004`)
 *   بعميلِ Redis مزيفٍ يحاكي المجرى — لا يتطلّبُ خادمَ Redis حقيقيّاً.
 * الحالة: اختبارُ وحدةٍ فعليّ — بلا قاعدةٍ ولا شبكة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { RedisClient, RedisFailure } from "../../apps/gateway/src/redis/upstash.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";
import {
  createRedisStreamTrackingEventBus,
  type RedisStreamTrackingEventBus,
} from "../../packages/infrastructure/tracking/redis-stream-event-bus.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const DRIVER = "driver-1";
const TRIP = "trip-1";
const CITY = "city-jed";

const positionEvent = (
  over: Partial<TrackingEvent> & { sequence: number; sessionId: string },
): TrackingEvent => ({
  type: "location_updated",
  driverId: DRIVER,
  tripId: TRIP,
  cityId: CITY,
  position: { lat: 21.5471, lng: 39.1751 },
  timestamp: new Date(),
  ...over,
});

/**
 * مخزنُ مجرى مزيفٌ مشتركٌ بينَ النسخِ — يحاكي ما يفعلهُ خادمُ Redis: يُخزّنُ
 * الإدخالاتِ بمعرّفاتٍ متزايدةٍ، ويُعيدُ ما بعدَ المؤشّرِ عندَ `XREAD`.
 */
interface FakeStreamStore {
  readonly entries: Array<{ id: string; fields: Map<string, string> }>;
  nextId(): string;
}

function createStore(): FakeStreamStore {
  const entries: FakeStreamStore["entries"] = [];
  let counter = 0;
  return {
    entries,
    nextId: () => {
      counter += 1;
      return `${Date.now()}-${counter}`;
    },
  };
}

/** عميلُ Redis مزيفٌ يُخاطبُ المخزنَ المشتركَ — يُفسّرُ `XADD` و`XREAD` فقط. */
function fakeRedis(store: FakeStreamStore): RedisClient {
  return {
    command: async (args: readonly (string | number)[]): Promise<Result<unknown, RedisFailure>> => {
      const [cmd] = args;
      if (cmd === "XADD") {
        // XADD streamKey MAXLEN ~ N * origin <id> payload <json>
        const maxlenIdx = args.indexOf("MAXLEN");
        const starIdx = args.indexOf("*");
        const fields = args.slice(starIdx + 1);
        const id = store.nextId();
        const fieldMap = new Map<string, string>();
        for (let i = 0; i + 1 < fields.length; i += 2) {
          const k = fields[i];
          const v = fields[i + 1];
          if (typeof k === "string" && typeof v === "string") fieldMap.set(k, v);
        }
        store.entries.push({ id, fields: fieldMap });
        void maxlenIdx;
        return ok(id);
      }
      if (cmd === "XREAD") {
        // XREAD COUNT n STREAMS streamKey cursor
        const streamsIdx = args.indexOf("STREAMS");
        const keyName = args[streamsIdx + 1];
        const cursor = args[streamsIdx + 2];
        if (typeof cursor !== "string" || typeof keyName !== "string") return ok(null);
        const after = store.entries.filter((e) => e.id > cursor);
        if (after.length === 0) return ok(null);
        return ok([[keyName, after.map((e) => [e.id, [...e.fields.entries()].flat()])]]);
      }
      return err({ kind: "redis", detail: `unknown command: ${String(cmd)}` });
    },
  };
}

const sinkCollector = (): {
  sink: { deliver: (e: TrackingEvent) => void };
  received: TrackingEvent[];
} => {
  const received: TrackingEvent[] = [];
  return {
    received,
    sink: {
      deliver: (e: TrackingEvent) => {
        received.push(e);
      },
    },
  };
};

describe("RedisStreamTrackingEventBus (SCL-004)", () => {
  it("يُسلِّمُ حدثًا نشرتْه نسخةٌ أ إلى مشتركٍ في نسخةٍ ب عبرَ المجرى", async () => {
    const store = createStore();
    const streamKey = "t:test:cross-instance";

    const localA = createTrackingEventBus();
    const localB = createTrackingEventBus();
    const busA = createRedisStreamTrackingEventBus({
      local: localA,
      redis: fakeRedis(store),
      streamKey,
      instanceId: "A",
      pollMs: 5,
      startCursor: "$",
    });
    const busB = createRedisStreamTrackingEventBus({
      local: localB,
      redis: fakeRedis(store),
      streamKey,
      instanceId: "B",
      pollMs: 5,
      startCursor: "0-0",
    });

    const collector = sinkCollector();
    // B يشتركُ كمشغّل (دائماً مسموحٌ له) قبلَ بدءِ الماسح.
    localB.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, collector.sink);
    busB.start();

    await busA.publish(positionEvent({ sequence: 1, sessionId: "s1" }));

    // أعطِ الماسحَ وقتًا لدورةٍ واحدةٍ على الأقل.
    await new Promise((resolve) => setTimeout(resolve, 30));
    busB.stop();

    expect(collector.received.length).toBeGreaterThanOrEqual(1);
    expect(collector.received[0]?.tripId).toBe(TRIP);
    expect(collector.received[0]?.sequence).toBe(1);
  });

  it("لا يُكرِّرُ حدثًا صدرَ من النسخةِ نفسِها (تجاوزُ المصدر)", async () => {
    const store = createStore();
    const streamKey = "t:test:own-origin";
    const local = createTrackingEventBus();
    const bus = createRedisStreamTrackingEventBus({
      local,
      redis: fakeRedis(store),
      streamKey,
      instanceId: "X",
      pollMs: 5,
      startCursor: "0-0",
    });

    const collector = sinkCollector();
    local.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, collector.sink);
    bus.start();

    await bus.publish(positionEvent({ sequence: 1, sessionId: "s1" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    bus.stop();

    // مرّةٌ واحدةٌ فقط: من `local.publish` عندَ الإصدار، ولا تكرارًا من الماسح.
    expect(collector.received.length).toBe(1);
  });

  it("يتجاوزُ الإدخالَ السيّئَ بلا أن يُسقطَ الماسح", async () => {
    const store = createStore();
    // ادفعْ إدخالاً سيّئاً يدويّاً (JSON غيرُ صالح).
    store.entries.push({
      id: "1-0",
      fields: new Map([
        ["origin", "Y"],
        ["payload", "{not json"],
      ]),
    });
    // ثمّ إدخالاً صالحًا بعده.
    store.entries.push({
      id: "2-0",
      fields: new Map([
        ["origin", "Y"],
        [
          "payload",
          JSON.stringify({ ...positionEvent({ sequence: 5, sessionId: "s5" }), origin: "Y" }),
        ],
      ]),
    });

    const streamKey = "t:test:malformed";
    const local = createTrackingEventBus();
    const bus = createRedisStreamTrackingEventBus({
      local,
      redis: fakeRedis(store),
      streamKey,
      instanceId: "X",
      pollMs: 5,
      startCursor: "0-0",
    });
    const collector = sinkCollector();
    local.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, collector.sink);
    bus.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    bus.stop();

    // الإدخالُ السيّئُ تجاوزَ، والصالحُ وصل.
    expect(collector.received.length).toBe(1);
    expect(collector.received[0]?.sequence).toBe(5);
  });

  it("يُفوِّضُ الاشتراكَ وعددَ المشتركينَ إلى الناقلِ المحليّ", () => {
    const store = createStore();
    const local = createTrackingEventBus();
    const bus = createRedisStreamTrackingEventBus({
      local,
      redis: fakeRedis(store),
      streamKey: "t:test:delegate",
      instanceId: "D",
    });
    expect(bus.subscriberCount).toBe(0);
    const unsub = local.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      sinkCollector().sink,
    );
    expect(bus.subscriberCount).toBe(1);
    unsub();
    expect(bus.subscriberCount).toBe(0);
  });

  it("start/stop مُتسامحانِ مع التكرارِ ويُضبطانِ isPolling", () => {
    const store = createStore();
    const local = createTrackingEventBus();
    const bus = createRedisStreamTrackingEventBus({
      local,
      redis: fakeRedis(store),
      streamKey: "t:test:lifecycle",
      instanceId: "L",
    });
    expect(bus.isPolling).toBe(false);
    bus.start();
    expect(bus.isPolling).toBe(true);
    bus.start(); // مرّتَين بلا أثر.
    expect(bus.isPolling).toBe(true);
    bus.stop();
    expect(bus.isPolling).toBe(false);
    bus.stop(); // مرّتَين بلا أثر.
    expect(bus.isPolling).toBe(false);
  });
});

// تُستخدمُ في الكتابةِ النمطيّةِ فقط — تضمنُ أنّ النوعَ يُحقَّقُ في وقتِ الترجمة.
void ((): RedisStreamTrackingEventBus | null => null);
