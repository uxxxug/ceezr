/**
 * الغرض: اختباراتُ وحدةٍ لقناةِ الرحلةِ الآنيةِ (F4-04).
 * الحالة: منفّذ فعلياً — المرحلة F4-04.
 * ينتمي إلى: tests/unit
 */

import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import { Server as IoServer } from "socket.io";
import { io as IoClient, type Socket as IoClientSocket } from "socket.io-client";
import {
  type ActiveRideResolver,
  createRideChannel,
  type RideChannelSessionVerifier,
} from "../../apps/gateway/src/realtime/ride-channel.ts";
import type {
  TrackingEventBus,
  TrackingEventSink,
} from "../../packages/infrastructure/tracking/event-bus.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const PORT = 9123;
const TIMEOUT = 5000;

interface FakeBusInternals {
  subscribers: Map<symbol, (event: TrackingEvent) => void>;
}

function createFakeBus(): TrackingEventBus & FakeBusInternals {
  const subscribers = new Map<symbol, (event: TrackingEvent) => void>();
  return {
    subscribers,
    publish: mock(async (_event: TrackingEvent) => {}),
    subscribe: (_subscription: { kind: string }, sink: TrackingEventSink) => {
      const key = Symbol("test-sub");
      subscribers.set(key, (event: TrackingEvent) => sink.deliver(event));
      return () => {
        subscribers.delete(key);
      };
    },
    get subscriberCount() {
      return subscribers.size;
    },
  } as unknown as TrackingEventBus & FakeBusInternals;
}

function emitEvent(bus: TrackingEventBus & FakeBusInternals, event: TrackingEvent): void {
  for (const sink of bus.subscribers.values()) {
    sink(event);
  }
}

function makeEvent(type: string, tripId: string, driverId = "drv-1"): TrackingEvent {
  return {
    type: type as TrackingEvent["type"],
    driverId,
    tripId,
    sessionId: "sess-1",
    sequence: 1,
    position: { lat: 21.5, lng: 39.2 },
    cityId: "city-1",
    timestamp: new Date("2026-09-16T10:00:00Z"),
  };
}

/** Race a promise against a timeout — resolves to the value or a sentinel. */
function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT): Promise<T | { _timeout: true }> {
  return Promise.race([
    promise,
    new Promise<{ _timeout: true }>((resolve) => setTimeout(() => resolve({ _timeout: true }), ms)),
  ]);
}

describe("RideChannel (F4-04)", () => {
  let httpServer: HttpServer;
  let io: IoServer;
  let bus: ReturnType<typeof createFakeBus>;
  let channel: ReturnType<typeof createRideChannel>;
  let rides: ActiveRideResolver;
  let sessions: RideChannelSessionVerifier;

  beforeAll(() => {
    httpServer = createServer((_, res) => {
      res.writeHead(404).end();
    });
    io = new IoServer(httpServer, { cors: { origin: "*" } });

    bus = createFakeBus();
    rides = {
      resolve: mock(async (riderId: string, hintTripId?: string) => {
        if (riderId === "rider-no-ride") return null;
        if (hintTripId === "trip-999") return null;
        return {
          tripId: hintTripId ?? "trip-123",
          driverId: "drv-1",
          status: "in_progress" as const,
        };
      }),
    };

    sessions = {
      verify: mock(async (token: string) => {
        if (token === "bad-token") return null;
        if (token === "rider-no-ride") return { riderId: "rider-no-ride" };
        return { riderId: "rider-1" };
      }),
    };

    channel = createRideChannel({ io, eventBus: bus, rides, sessions });
    channel.start();
    httpServer.listen(PORT);
  });

  afterAll(() => {
    channel.stop();
    httpServer.close();
  });

  async function connectClient(auth?: { sessionToken: string }): Promise<IoClientSocket> {
    const client = IoClient(`http://localhost:${PORT}`, {
      transports: ["websocket"],
      auth: auth ?? { sessionToken: "good-token" },
    });
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        client.on("connect", resolve);
        client.on("connect_error", reject);
      }),
    );
    return client;
  }

  it("rejects connection without session token", async () => {
    const client = IoClient(`http://localhost:${PORT}`, {
      transports: ["websocket"],
      auth: {},
    });
    await new Promise<void>((resolve) => {
      client.on("connect", resolve);
    });

    client.emit("ride:join", {});
    const error = (await withTimeout(
      new Promise<{ code: string }>((resolve) => {
        client.on("ride:error", resolve);
      }),
    )) as { code: string };

    expect(error.code).toBe("NO_SESSION");
    client.disconnect();
  });

  it("rejects invalid session token", async () => {
    const client = await connectClient({ sessionToken: "bad-token" });
    client.emit("ride:join", {});
    const error = (await withTimeout(
      new Promise<{ code: string }>((resolve) => {
        client.on("ride:error", resolve);
      }),
    )) as { code: string };

    expect(error.code).toBe("INVALID_SESSION");
    client.disconnect();
  });

  it("joins ride room and receives ride:joined", async () => {
    const client = await connectClient();
    client.emit("ride:join", { tripId: "trip-123" });
    const joined = (await withTimeout(
      new Promise<{ tripId: string; driverId: string }>((resolve) => {
        client.on("ride:joined", resolve);
      }),
    )) as { tripId: string; driverId: string };

    expect(joined.tripId).toBe("trip-123");
    expect(joined.driverId).toBe("drv-1");
    client.disconnect();
  });

  it("forwards location_updated events to ride room", async () => {
    const client = await connectClient();
    client.emit("ride:join", { tripId: "trip-456" });
    await withTimeout(
      new Promise<void>((resolve) => {
        client.on("ride:joined", () => resolve());
      }),
    );

    emitEvent(bus, makeEvent("location_updated", "trip-456"));

    const event = (await withTimeout(
      new Promise<{ type: string; tripId: string }>((resolve) => {
        client.on("ride:event", resolve);
      }),
    )) as { type: string; tripId: string };

    expect(event.type).toBe("location_updated");
    expect(event.tripId).toBe("trip-456");
    client.disconnect();
  });

  it("does not forward non-ride events (session_ended)", async () => {
    const client = await connectClient();
    client.emit("ride:join", { tripId: "trip-789" });
    await withTimeout(
      new Promise<void>((resolve) => {
        client.on("ride:joined", () => resolve());
      }),
    );

    // session_ended should NOT be forwarded
    emitEvent(bus, makeEvent("session_ended", "trip-789"));

    // But location_updated should
    emitEvent(bus, makeEvent("location_updated", "trip-789"));

    const events: { type: string }[] = [];
    client.on("ride:event", (e: { type: string }) => events.push(e));

    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    // Should have received location_updated but NOT session_ended
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("location_updated");
    client.disconnect();
  });

  it("rejects join when rider has no active ride", async () => {
    const client = await connectClient({ sessionToken: "rider-no-ride" });
    client.emit("ride:join", {});
    const error = (await withTimeout(
      new Promise<{ code: string }>((resolve) => {
        client.on("ride:error", resolve);
      }),
    )) as { code: string };

    expect(error.code).toBe("NO_ACTIVE_RIDE");
    client.disconnect();
  });
});
