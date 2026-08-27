import { describe, expect, test, beforeEach } from "bun:test";
import { apiFetch, ApiError } from "./client.ts";
import { clearSession, setSession } from "../identity/session.ts";

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
      })) as typeof fetch;

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
      refreshToken: "r",
      expiresAt: Date.now() + 60_000,
      role: "rider",
    });

    let seenAuth: string | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("Authorization");
      return new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await apiFetch("/v1/me");
      expect(seenAuth).toBe("Bearer tok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
