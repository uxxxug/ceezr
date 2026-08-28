import { beforeEach, describe, expect, test } from "bun:test";
import { clearSession, setSession } from "../identity/session.ts";
import { type ApiError, apiFetch } from "./client.ts";

beforeEach(() => {
  clearSession();
});

describe("apiFetch session guard (ADR 0035 check #2)", () => {
  test("rejects product calls without Waslah session", async () => {
    await expect(apiFetch("/v1/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "SESSION_REQUIRED",
    } satisfies Partial<ApiError>);
  });

  test("allows public session exchange path flag", async () => {
    // Without a real server this will fail at network; we only assert the
    // session guard is skipped (no SESSION_REQUIRED). Mock fetch.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      const result = await apiFetch<{ ok: boolean }>("/v1/session/telegram", {
        public: true,
        method: "POST",
        body: { initData: "x" },
      });
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("attaches bearer when session is valid", async () => {
    setSession({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
      role: "rider",
    });

    // Held in an object: a plain `let` assigned only inside the callback is
    // narrowed to `null` by control-flow analysis at the assertion site.
    const seen: { auth: string | null } = { auth: null };
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.auth = headers.get("Authorization");
      return new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await apiFetch("/v1/me");
      expect(seen.auth).toBe("Bearer tok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
