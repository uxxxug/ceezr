import { describe, expect, it } from "bun:test";
import type {
  TicketThreadReader,
  TicketThreadStoreFailure,
  TicketThreadWriter,
} from "../../packages/application/dispute/ticket-threads.ts";
import {
  addTicketMessage,
  listTicketMessages,
  type TicketSenderType,
  type TicketThreadDeps,
} from "../../packages/application/dispute/ticket-threads.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function makeDeps(overrides: Partial<TicketThreadDeps> = {}): TicketThreadDeps {
  const noopReader: TicketThreadReader = {
    list: async () => ok([]),
  };
  const noopWriter: TicketThreadWriter = {
    add: async () => ok({ status: "added", messageId: "msg-1", createdAtMs: Date.now() }),
  };
  const noopSessions = {
    read: async () =>
      ok({
        telegramUserId: "123456789",
        bot: "rider",
        sessionId: "s1",
        issuedAtSeconds: 0,
        expiresAtSeconds: 9999999999,
      }),
  } as unknown as MiniAppSessionReader;
  return {
    sessions: noopSessions,
    reader: noopReader,
    writer: noopWriter,
    now: () => new Date(),
    ...overrides,
  } as TicketThreadDeps;
}

describe("DEC-43 list ticket messages", () => {
  it("قراءةُ الرسائلِ تُرجِعُها", async () => {
    const reader: TicketThreadReader = {
      list: async () =>
        ok([
          { id: "m1", senderType: "rider", message: "مرحباً", createdAtMs: 1000 },
          { id: "m2", senderType: "support", message: "أهلاً بك", createdAtMs: 2000 },
        ]),
    };
    const result = await listTicketMessages(makeDeps({ reader }), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider" as TicketSenderType,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBe(2);
  });

  it("معرّفُ UUID غيرُ الصالحِ يُرجِعُ TICKET_NOT_FOUND", async () => {
    const result = await listTicketMessages(makeDeps(), {
      accessToken: "token",
      ticketId: "not-a-uuid",
      senderType: "rider",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TICKET_NOT_FOUND");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await listTicketMessages(makeDeps(), {
      accessToken: undefined,
      ticketId: VALID_UUID,
      senderType: "rider",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });
});

describe("DEC-43 add ticket message", () => {
  it("إضافةُ رسالةٍ صحيحةٍ تُرجِعُ added", async () => {
    const result = await addTicketMessage(makeDeps(), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "هناك مشكلة في الرحلة" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("added");
  });

  it("رسالةٌ فارغةٌ تُرجِعُ MESSAGE_EMPTY", async () => {
    const result = await addTicketMessage(makeDeps(), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "   " },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MESSAGE_EMPTY");
  });

  it("رسالةٌ طويلةٌ جداً تُرجِعُ MESSAGE_TOO_LONG", async () => {
    const result = await addTicketMessage(makeDeps(), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "x".repeat(2001) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("MESSAGE_TOO_LONG");
  });

  it("غيابُ الجلسةِ يُرجِعُ SESSION_REQUIRED", async () => {
    const result = await addTicketMessage(makeDeps(), {
      accessToken: undefined,
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "test" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SESSION_REQUIRED");
  });

  it("تذكرةٌ مُغلَقةٌ تُرجِعُ TICKET_CLOSED", async () => {
    const writer: TicketThreadWriter = {
      add: async () =>
        err({
          code: "TICKET_THREAD_STORE_FAILED",
          reason: "TICKET_CLOSED",
        } as TicketThreadStoreFailure),
    };
    const result = await addTicketMessage(makeDeps({ writer }), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "test" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TICKET_CLOSED");
  });

  it("تذكرةٌ غيرُ موجودةٍ تُرجِعُ TICKET_NOT_FOUND", async () => {
    const writer: TicketThreadWriter = {
      add: async () =>
        err({
          code: "TICKET_THREAD_STORE_FAILED",
          reason: "TICKET_NOT_FOUND",
        } as TicketThreadStoreFailure),
    };
    const result = await addTicketMessage(makeDeps({ writer }), {
      accessToken: "token",
      ticketId: VALID_UUID,
      senderType: "rider",
      body: { message: "test" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("TICKET_NOT_FOUND");
  });
});
