/**
 * اختباراتُ عميلِ قناةِ الرحلةِ الآنيةِ — الاتّصالُ والفصلُ وتصفيةُ الرحلةِ
 * (البندانِ `F2-06` و`F4-04`).
 */

import { describe, expect, it } from "bun:test";
import {
  type RideChannelEvent,
  type RideChannelTransport,
  type SessionTokenReader,
  subscribeRideChannel,
} from "../../apps/miniapp/src/services/ride-channel-client.ts";

interface FakeSocket {
  listeners: Record<string, ((...args: unknown[]) => void)[]>;
  disconnected: boolean;
  on(event: string, fn: (...args: unknown[]) => void): void;
  disconnect(): void;
  removeAllListeners(): void;
  emit(event: string, ...args: unknown[]): void;
}

function fakeSocket(): FakeSocket {
  const sock: FakeSocket = {
    listeners: {},
    disconnected: false,
    on(event, fn) {
      const list = this.listeners[event] ?? [];
      list.push(fn);
      this.listeners[event] = list;
    },
    disconnect() {
      this.disconnected = true;
    },
    removeAllListeners() {
      this.listeners = {};
    },
    emit(event, ...args) {
      (this.listeners[event] ?? []).forEach((fn) => {
        fn(...args);
      });
    },
  };
  return sock;
}

function fakeTransport(): { transport: RideChannelTransport; socket: FakeSocket } {
  const socket = fakeSocket();
  return {
    transport: {
      connect: () => socket as unknown as import("socket.io-client").Socket,
    },
    socket,
  };
}

function sessionReader(token: string | null): SessionTokenReader {
  return { read: () => token };
}

describe("ride-channel-client", () => {
  it("لا اتصالَ بلا رمزِ جلسةٍ", () => {
    let connected = false;
    const { transport } = fakeTransport();
    const sub = subscribeRideChannel(
      { transport, sessions: sessionReader(null), baseUrl: "" },
      { orderId: "trip-1", onEvent: () => (connected = true) },
    );
    expect(connected).toBe(false);
    sub.disconnect();
  });

  it("يتّصلُ ويُمرِّرُ أحداثَ الرحلةِ المطابقةِ", () => {
    const { transport, socket } = fakeTransport();
    let received: RideChannelEvent | null = null;
    subscribeRideChannel(
      { transport, sessions: sessionReader("tok"), baseUrl: "" },
      { orderId: "trip-1", onEvent: (e) => (received = e) },
    );
    const evt: RideChannelEvent = {
      type: "location_updated",
      driverId: "drv-1",
      tripId: "trip-1",
      sessionId: "sess-1",
      sequence: 1,
      position: { lat: 21.5, lng: 39.2 },
      timestamp: new Date().toISOString(),
    };
    socket.emit("ride:event", evt);
    const got = received as unknown;
    expect(got).not.toBeNull();
    expect(got as RideChannelEvent).toEqual(evt);
  });

  it("يُسقِطُ أحداثَ رحلةٍ أخرى", () => {
    const { transport, socket } = fakeTransport();
    let received = false;
    subscribeRideChannel(
      { transport, sessions: sessionReader("tok"), baseUrl: "" },
      { orderId: "trip-1", onEvent: () => (received = true) },
    );
    socket.emit("ride:event", {
      type: "location_updated",
      driverId: "drv-1",
      tripId: "trip-2",
      sessionId: "sess-1",
      sequence: 1,
      position: { lat: 21.5, lng: 39.2 },
      timestamp: new Date().toISOString(),
    });
    expect(received).toBe(false);
  });

  it("الفصلُ يُزيلُ كلَّ المستمعين", () => {
    const { transport, socket } = fakeTransport();
    const sub = subscribeRideChannel(
      { transport, sessions: sessionReader("tok"), baseUrl: "" },
      { orderId: "trip-1", onEvent: () => {} },
    );
    sub.disconnect();
    expect(socket.disconnected).toBe(true);
    expect(Object.keys(socket.listeners).length).toBe(0);
  });
});
