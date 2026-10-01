/**
 * الغرض: اختباراتُ مساراتِ الدعمِ من داخلِ التطبيق — نشرُ بطاقةِ التذكرةِ بعدَ الفتحِ (DEC-26).
 * الحالة: مبنيٌّ — البند DEC-26.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it, mock } from "bun:test";
import type { Hono } from "hono";
import {
  createSupportRoutes,
  type SupportRouteDependencies,
} from "../../apps/gateway/src/routes/support-tickets.ts";
import type { PostDisputeCardDependencies } from "../../packages/application/dispute/post-dispute-card.ts";

// ── Stubs ──────────────────────────────────────────────────────────────────

function makeRiderDeps(): unknown {
  return {
    sessions: {
      read: async () => ({
        ok: true,
        value: { telegramUserId: "111", userId: "user-1", role: "rider" },
      }),
    },
    store: {
      openTicket: async () => ({
        ok: true,
        value: {
          ticketId: "aaaaaaaa-0000-0000-0000-000000000001",
          reference: "AAAA0001",
          category: "app_problem",
          createdAt: "2026-10-01T00:00:00Z",
        },
      }),
      listTickets: async () => ({
        ok: true,
        value: {
          tickets: [],
          hasMore: false,
          nextCursor: null,
          expectedResponseMinutes: 30,
        },
      }),
    },
    now: () => new Date("2026-10-01T00:00:00Z"),
  };
}

function makeDriverDeps(): unknown {
  return {
    sessions: {
      read: async () => ({
        ok: true,
        value: { telegramUserId: "222", userId: "user-2", role: "driver" },
      }),
    },
    store: {
      openTicket: async () => ({
        ok: true,
        value: {
          ticketId: "bbbbbbbb-0000-0000-0000-000000000002",
          reference: "BBBB0002",
          category: "deduction",
          createdAt: "2026-10-01T00:00:00Z",
        },
      }),
      listTickets: async () => ({
        ok: true,
        value: {
          tickets: [],
          hasMore: false,
          nextCursor: null,
          expectedResponseMinutes: 30,
        },
      }),
    },
    now: () => new Date("2026-10-01T00:00:00Z"),
  };
}

function makeCardDeps(published: boolean): PostDisputeCardDependencies {
  const ctx = published
    ? {
        ticket: {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          type: "ride_dispute",
          status: "open",
          message: "test",
          orderId: null,
          createdAt: new Date("2026-10-01T00:00:00Z"),
          owner: {
            telegramId: "111",
            fullName: "Test",
            phone: "",
            telegramUsername: null,
            languageCode: "ar",
          },
          cityName: "Test City",
          subscription: null,
          attachmentFileId: null,
        },
        groupId: "group-1",
      }
    : null;

  return {
    context: {
      read: async () => ({ ok: true as const, value: ctx as unknown as never }),
    },
    publisher: {
      publish: async () => ({
        ok: true as const,
        value: published ? "msg-123" : null,
      }),
    },
    recorder: {
      attach: async () => ({ ok: true as const, value: undefined }),
    },
  };
}

function makeApp(deps: SupportRouteDependencies): Hono {
  return createSupportRoutes(deps);
}

async function postTicket(app: Hono, path: string, body: object): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("مسارات الدعم — نشر البطاقة بعد الفتح (DEC-26)", () => {
  it("ينشر بطاقة التذكرة في قروب الدعم بعد فتح تذكرة راكب", async () => {
    const publishMock = mock(() => Promise.resolve({ ok: true as const, value: "msg-123" }));
    const cardDeps = makeCardDeps(true);
    cardDeps.publisher.publish = publishMock;

    const app = makeApp({
      support: makeRiderDeps() as never,
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة في التطبيق",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; reference: string };
    expect(body.ok).toBe(true);
    expect(body.reference).toBe("AAAA0001");
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("ينشر بطاقة التذكرة في قروب الدعم بعد فتح تذكرة سائق", async () => {
    const publishMock = mock(() => Promise.resolve({ ok: true as const, value: "msg-456" }));
    const cardDeps = makeCardDeps(true);
    cardDeps.publisher.publish = publishMock;

    const app = makeApp({
      driverSupport: makeDriverDeps() as never,
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/driver/support/tickets", {
      category: "deduction",
      message: "خصم غير صحيح",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; reference: string };
    expect(body.ok).toBe(true);
    expect(body.reference).toBe("BBBB0002");
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("يعيد 201 حتى لو فشل نشر البطاقة — التذكرة قائمة", async () => {
    const cardDeps = makeCardDeps(false);

    const app = makeApp({
      support: makeRiderDeps() as never,
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("يعمل بلا card dependency — التذكرة تُفتَح ولا تُنشَر بطاقتُها", async () => {
    const app = makeApp({
      support: makeRiderDeps() as never,
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
