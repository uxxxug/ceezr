import { describe, expect, it, mock } from "bun:test";
import type {
  OffersChannelDeps,
  OffersTransport,
} from "../../apps/miniapp/src/services/offers-channel-client.ts";
import { subscribeOffersChannel } from "../../apps/miniapp/src/services/offers-channel-client.ts";

interface MockSocket {
  readonly handlers: Map<string, ((...args: unknown[]) => void)[]>;
  on: ReturnType<typeof mock>;
  off: ReturnType<typeof mock>;
  removeAllListeners: ReturnType<typeof mock>;
  disconnect: ReturnType<typeof mock>;
  emit: ReturnType<typeof mock>;
  connected: boolean;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    handlers,
    on: mock((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    off: mock(() => {}),
    removeAllListeners: mock(() => handlers.clear()),
    disconnect: mock(() => {}),
    emit: mock(() => {}),
    connected: false,
  };
}

function fireHandlers(socket: MockSocket, event: string): void {
  const list = socket.handlers.get(event);
  if (list !== undefined) {
    for (const h of list) h();
  }
}

function createMockDeps(): {
  deps: OffersChannelDeps;
  socket: MockSocket;
} {
  const socket = createMockSocket();
  const transport: OffersTransport = {
    connect: mock(() => socket as unknown as import("socket.io-client").Socket),
  };
  const deps: OffersChannelDeps = {
    transport,
    sessions: { read: mock(() => "test-token") },
    baseUrl: "https://gateway.example.com",
  };
  return { deps, socket };
}

describe("subscribeOffersChannel", () => {
  it("يستدعي onUpdate عند ورودِ إشارةِ تحديثٍ", () => {
    const onUpdate = mock(() => {});
    const { deps, socket } = createMockDeps();
    const sub = subscribeOffersChannel(deps, { onUpdate });

    expect(socket.handlers.get("offers:update")).toBeDefined();
    fireHandlers(socket, "offers:update");

    expect(onUpdate).toHaveBeenCalledTimes(1);
    sub.disconnect();
  });

  it("لا يُجدِّدُ أكثرَ من مرّةٍ كلَّ ثانيتَين (منعُ الاندفاعِ)", () => {
    const onUpdate = mock(() => {});
    let now = 1000;
    const { deps, socket } = createMockDeps();
    const sub = subscribeOffersChannel(deps, { onUpdate, now: () => now });

    fireHandlers(socket, "offers:update");
    expect(onUpdate).toHaveBeenCalledTimes(1);

    now += 500;
    fireHandlers(socket, "offers:update");
    expect(onUpdate).toHaveBeenCalledTimes(1);

    now += 2000;
    fireHandlers(socket, "offers:update");
    expect(onUpdate).toHaveBeenCalledTimes(2);

    sub.disconnect();
  });

  it("يُعادُ بدونِ اتصالٍ حينَ لا رمزَ جلسةٍ", () => {
    const onUpdate = mock(() => {});
    const socket = createMockSocket();
    const transport: OffersTransport = {
      connect: mock(() => socket as unknown as import("socket.io-client").Socket),
    };
    const deps: OffersChannelDeps = {
      transport,
      sessions: { read: mock(() => null) },
      baseUrl: "https://gateway.example.com",
    };
    const sub = subscribeOffersChannel(deps, { onUpdate });

    expect(onUpdate).not.toHaveBeenCalled();
    sub.disconnect();
  });

  it("يُنظِّفُ المستمعين عند disconnect", () => {
    const onUpdate = mock(() => {});
    const { deps, socket } = createMockDeps();
    const sub = subscribeOffersChannel(deps, { onUpdate });

    sub.disconnect();

    expect(socket.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
