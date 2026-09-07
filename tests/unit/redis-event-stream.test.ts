/**
 * الغرض: SCL-004 — اختبار وحدة لمجرى الأحداث المشترك عبر Redis Streams.
 *   يُثبت أن الناشر يُضيف إلى الـStream، وأن المستهلك يُسلّم ما ليس منشوراً محليّاً،
 *   وأن ما هو منشور محليّاً يُخطَّى.
 * الحالة: اختبار وحدة فعلي — لا يتطلب Redis حقيقي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { createRedisTrackingEventStream } from "../../packages/infrastructure/tracking/redis-event-stream.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

/** عميل Redis وهمي يسجّل الأوامر ويردّ ما نُعدّه. */
function mockRedis() {
  const commands: { args: readonly (string | number)[] }[] = [];
  let xaddResult = "stream-id-0";
  let xaddCounter = 0;
  let xreadResult: unknown = null;
  let xreadCallCount = 0;
  let xreadResultOnce: unknown = null;

  return {
    commands,
    setXReadResult(value: unknown): void {
      xreadResult = value;
    },
    setXReadResultOnce(value: unknown): void {
      xreadResultOnce = value;
    },
    client: {
      command: async (args: readonly (string | number)[]) => {
        commands.push({ args });
        const cmd = args[0] as string;

        if (cmd === "XADD") {
          xaddCounter += 1;
          xaddResult = `stream-id-${xaddCounter}`;
          return { ok: true, value: xaddResult, error: { detail: "", kind: "" } };
        }

        if (cmd === "XGROUP") {
          return { ok: true, value: "OK", error: { detail: "", kind: "" } };
        }

        if (cmd === "XREADGROUP") {
          xreadCallCount += 1;
          if (xreadResultOnce !== null && xreadCallCount === 1) {
            const result = xreadResultOnce;
            xreadResultOnce = null;
            return { ok: true, value: result, error: { detail: "", kind: "" } };
          }
          return { ok: true, value: xreadResult, error: { detail: "", kind: "" } };
        }

        if (cmd === "XACK") {
          return { ok: true, value: 1, error: { detail: "", kind: "" } };
        }

        return { ok: false, value: null, error: { detail: "unknown", kind: "redis" } };
      },
    },
  };
}

const sampleEvent = (overrides: Partial<TrackingEvent> = {}): TrackingEvent => ({
  type: "location_updated",
  driverId: "driver-1",
  tripId: "trip-1",
  sessionId: "session-1",
  sequence: 1,
  position: { lat: 21.5, lng: 39.1 },
  cityId: "city-1",
  timestamp: new Date(),
  ...overrides,
});

describe("SCL-004 — مجرى أحداث Redis Streams", () => {
  it("publish يُضيف الحدث إلى الـStream بـXADD", async () => {
    const mock = mockRedis();
    const stream = createRedisTrackingEventStream({
      redis: mock.client,
      pollIntervalMs: 10,
    });

    await stream.publish(sampleEvent());

    const xaddCalls = mock.commands.filter((c) => c.args[0] === "XADD");
    expect(xaddCalls).toHaveLength(1);
    expect(xaddCalls[0]?.args[1]).toBe("ceezr:tracking:events");
  });

  it("المستهلك يُسلّم حدثاً من نسخةٍ أخرى (ليس منشوراً محليّاً)", async () => {
    const mock = mockRedis();
    const delivered: TrackingEvent[] = [];
    const stream = createRedisTrackingEventStream({
      redis: mock.client,
      pollIntervalMs: 10,
    });

    const remoteEvent = sampleEvent({ sequence: 42 });
    mock.setXReadResultOnce([
      [
        "ceezr:tracking:events",
        [["remote-id-1", ["type", "location_updated", "data", JSON.stringify(remoteEvent)]]],
      ],
    ]);

    const stop = stream.startConsumer("group-a", "consumer-a", async (event) => {
      delivered.push(event);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    stop();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.sequence).toBe(42);
  });

  it("المستهلك يُخطّي حدثاً منشوراً محليّاً (لا يُسلّمه مرّتين)", async () => {
    const mock = mockRedis();
    const delivered: TrackingEvent[] = [];
    const stream = createRedisTrackingEventStream({
      redis: mock.client,
      pollIntervalMs: 10,
    });

    /** انشر حدثاً محليّاً — يُسجَّل معرّفه في المجموعة المحليّة. */
    await stream.publish(sampleEvent({ sequence: 1 }));
    const localId = mock.commands.find((c) => c.args[0] === "XADD");
    expect(localId).toBeDefined();
    /** المعرّف المُعاد من XADD هو stream-id-1. */

    /** والآن اجعل المستهلك يقرأ الحدث نفسه من الـStream. */
    mock.setXReadResultOnce([
      [
        "ceezr:tracking:events",
        [
          [
            "stream-id-1",
            ["type", "location_updated", "data", JSON.stringify(sampleEvent({ sequence: 1 }))],
          ],
        ],
      ],
    ]);

    const stop = stream.startConsumer("group-a", "consumer-a", async (event) => {
      delivered.push(event);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    stop();

    expect(delivered).toHaveLength(0);
  });

  it("المستهلك يستمرّ في الاستطلاع بعد قراءة فارغة", async () => {
    const mock = mockRedis();
    const delivered: TrackingEvent[] = [];
    const stream = createRedisTrackingEventStream({
      redis: mock.client,
      pollIntervalMs: 10,
    });

    mock.setXReadResult(null);

    const stop = stream.startConsumer("group-a", "consumer-a", async (event) => {
      delivered.push(event);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();

    expect(delivered).toHaveLength(0);
    /** استُدعِي XREADGROUP مرّتين على الأقل (استطلاعٌ متكرّر). */
    const readCalls = mock.commands.filter((c) => c.args[0] === "XREADGROUP");
    expect(readCalls.length).toBeGreaterThanOrEqual(2);
  });
});
