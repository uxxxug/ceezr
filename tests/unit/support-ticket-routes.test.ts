/**
 * الغرض: اختباراتُ مساراتِ الدعمِ من داخلِ التطبيق — نشرُ بطاقةِ التذكرةِ بعدَ الفتحِ (DEC-26).
 * الحالة: مبنيٌّ — البند DEC-26.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it, mock } from "bun:test";
import type { Hono } from "hono";
import {
  createSupportRoutes,
  type DriverSupportDeps,
  type RiderSupportDeps,
  type SupportRouteDependencies,
} from "../../apps/gateway/src/routes/support-tickets.ts";
import type { PostDisputeCardDependencies } from "../../packages/application/dispute/post-dispute-card.ts";
import type {
  OpenedSupportTicketOf,
  SupportTicketsPage,
  SupportTicketType,
} from "../../packages/domain/support/ticket-types.ts";

// ── Stubs ──────────────────────────────────────────────────────────────────

function makeRiderDeps(): RiderSupportDeps {
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
        } as OpenedSupportTicketOf<SupportTicketType>,
      }),
      listTickets: async () => ({
        ok: true,
        value: { tickets: [], hasMore: false, nextCursor: null } as SupportTicketsPage,
      }),
    },
    now: () => new Date("2026-10-01T00:00:00Z"),
  } as unknown as RiderSupportDeps;
}

function makeDriverDeps(): DriverSupportDeps {
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
        } as OpenedSupportTicketOf<SupportTicketType>,
      }),
      listTickets: async () => ({
        ok: true,
        value: { tickets: [], hasMore: false, nextCursor: null } as SupportTicketsPage,
      }),
    },
    now: () => new Date("2026-10-01T00:00:00Z"),
  } as unknown as DriverSupportDeps;
}

function makeCardDeps(published: boolean): PostDisputeCardDependencies {
  return {
    context: {
      read: async () => ({
        ok: true,
        value: published
          ? {
              ticket: {
                id: "aaaaaaaa-0000-0000-0000-000000000001",
                type: "ride",
                message: "test",
                owner: {
                  telegramId: "111",
                  fullName: "Test",
                  phone: "",
                  telegramUsername: null,
                },
                cityName: "Test City",
                subscription: null,
                attachmentFileId: null,
              },
              groupId: "group-1",
            }
          : null,
      }),
    },
    publisher: {
      publish: async () => ({
        ok: true,
        value: published ? "msg-123" : null,
      }),
    },
    recorder: {
      attach: async () => ({ ok: true, value: undefined }),
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
      support: makeRiderDeps(),
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة في التطبيق",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reference).toBe("AAAA0001");
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("ينشر بطاقة التذكرة في قروب الدعم بعد فتح تذكرة سائق", async () => {
    const publishMock = mock(() => Promise.resolve({ ok: true as const, value: "msg-456" }));
    const cardDeps = makeCardDeps(true);
    cardDeps.publisher.publish = publishMock;

    const app = makeApp({
      driverSupport: makeDriverDeps(),
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/driver/support/tickets", {
      category: "deduction",
      message: "خصم غير صحيح",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reference).toBe("BBBB0002");
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("يعيد 201 حتى لو فشل نشر البطاقة — التذكرة قائمة", async () => {
    const cardDeps = makeCardDeps(false);

    const app = makeApp({
      support: makeRiderDeps(),
      card: cardDeps,
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("يعمل بلا card dependency — التذكرة تُفتَح ولا تُنشَر بطاقتُها", async () => {
    const app = makeApp({
      support: makeRiderDeps(),
    });

    const res = await postTicket(app, "/v1/support/tickets", {
      category: "app_problem",
      message: "مشكلة",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
