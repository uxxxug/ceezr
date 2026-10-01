import { describe, expect, it, mock } from "bun:test";
import type {
  OffersChannelDeps,
  OffersSessionVerifier,
} from "../../apps/gateway/src/realtime/offers-channel.ts";
import { createOffersChannel } from "../../apps/gateway/src/realtime/offers-channel.ts";

interface MockSocket {
  readonly joinedRooms: string[];
  readonly emitted: { readonly event: string; readonly data: unknown }[];
  readonly handlers: Map<string, ((...args: unknown[]) => void)[]>;
  readonly handshake: { readonly auth?: { readonly sessionToken?: string } };
  on: ReturnType<typeof mock>;
  join: ReturnType<typeof mock>;
  emit: ReturnType<typeof mock>;
}

interface MockIoServer {
  readonly connectionHandlers: ((socket: MockSocket) => void)[];
  readonly rooms: Map<string, Set<MockSocket>>;
  on: ReturnType<typeof mock>;
  off: ReturnType<typeof mock>;
  to: ReturnType<typeof mock>;
}

function createMockSocket(sessionToken?: string): MockSocket {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const emitted: { readonly event: string; readonly data: unknown }[] = [];
  const joinedRooms: string[] = [];
  return {
    joinedRooms,
    emitted,
    handlers,
    handshake: { auth: sessionToken !== undefined ? { sessionToken } : {} },
    on: mock((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    join: mock((room: string) => {
      joinedRooms.push(room);
    }),
    emit: mock((event: string, data?: unknown) => {
      emitted.push({ event, data });
    }),
  };
}

function createMockIo(): MockIoServer {
  const connectionHandlers: ((socket: MockSocket) => void)[] = [];
  const rooms = new Map<string, Set<MockSocket>>();
  return {
    connectionHandlers,
    rooms,
    on: mock((event: string, handler: (socket: MockSocket) => void) => {
      if (event === "connection") connectionHandlers.push(handler);
    }),
    off: mock((event: string, handler: (socket: MockSocket) => void) => {
      if (event === "connection") {
        const idx = connectionHandlers.indexOf(handler);
        if (idx >= 0) connectionHandlers.splice(idx, 1);
      }
    }),
    to: mock((room: string) => ({
      emit: (event: string, data?: unknown) => {
        const sockets = rooms.get(room);
        if (sockets !== undefined) {
          for (const s of sockets) s.emit(event, data);
        }
      },
    })),
  };
}

function createMockDeps(verifier: OffersSessionVerifier): {
  deps: OffersChannelDeps;
  io: MockIoServer;
} {
  const io = createMockIo();
  const deps: OffersChannelDeps = {
    io: io as unknown as OffersChannelDeps["io"],
    sessions: verifier,
  };
  return { deps, io };
}

describe("createOffersChannel", () => {
  it("ينضمُّ السائقُ إلى غرفتِه عند offers:join بجلسةٍ صالحة", async () => {
    const verifier: OffersSessionVerifier = {
      verify: mock(() => Promise.resolve({ telegramUserId: "123456" })),
    };
    const { deps, io } = createMockDeps(verifier);
    const channel = createOffersChannel(deps);
    channel.start();

    const socket = createMockSocket("valid-token");
    for (const handler of io.connectionHandlers) handler(socket);

    const joinHandler = socket.handlers.get("offers:join")?.[0];
    expect(joinHandler).toBeDefined();
    if (joinHandler !== undefined) await joinHandler();

    expect(socket.join).toHaveBeenCalledWith("driver-offers:123456");
    const joined = socket.emitted.find((e) => e.event === "offers:joined");
    expect(joined).toBeDefined();
    channel.stop();
  });

  it("يرفضُ بلا جلسةٍ عند offers:join", async () => {
    const verifier: OffersSessionVerifier = {
      verify: mock(() => Promise.resolve({ telegramUserId: "123" })),
    };
    const { deps, io } = createMockDeps(verifier);
    const channel = createOffersChannel(deps);
    channel.start();

    const socket = createMockSocket(undefined);
    for (const handler of io.connectionHandlers) handler(socket);

    const joinHandler = socket.handlers.get("offers:join")?.[0];
    if (joinHandler !== undefined) await joinHandler();

    const error = socket.emitted.find((e) => e.event === "offers:error");
    expect(error).toBeDefined();
    const errorData = error?.data as { code: string } | undefined;
    expect(errorData?.code).toBe("NO_SESSION");
    channel.stop();
  });

  it("يرفضُ بجلسةٍ غيرِ صالحةٍ", async () => {
    const verifier: OffersSessionVerifier = {
      verify: mock(() => Promise.resolve(null)),
    };
    const { deps, io } = createMockDeps(verifier);
    const channel = createOffersChannel(deps);
    channel.start();

    const socket = createMockSocket("bad-token");
    for (const handler of io.connectionHandlers) handler(socket);

    const joinHandler = socket.handlers.get("offers:join")?.[0];
    if (joinHandler !== undefined) await joinHandler();

    const error = socket.emitted.find((e) => e.event === "offers:error");
    expect(error).toBeDefined();
    const errorData = error?.data as { code: string } | undefined;
    expect(errorData?.code).toBe("INVALID_SESSION");
    channel.stop();
  });

  it("notifyDriver يبثُّ offers:update إلى غرفةِ السائقِ", async () => {
    const verifier: OffersSessionVerifier = {
      verify: mock(() => Promise.resolve({ telegramUserId: "123456" })),
    };
    const { deps, io } = createMockDeps(verifier);
    const channel = createOffersChannel(deps);
    channel.start();

    const socket = createMockSocket("valid-token");
    for (const handler of io.connectionHandlers) handler(socket);
    const joinHandler = socket.handlers.get("offers:join")?.[0];
    if (joinHandler !== undefined) await joinHandler();

    // سجِّل المقبس في الغرفة يدويًّا (mock io.to)
    const room = "driver-offers:123456";
    if (!io.rooms.has(room)) io.rooms.set(room, new Set());
    io.rooms.get(room)?.add(socket);

    channel.notifyDriver("123456");

    const update = socket.emitted.find((e) => e.event === "offers:update");
    expect(update).toBeDefined();
    channel.stop();
  });
});
