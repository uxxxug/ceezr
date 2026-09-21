/**
 * اختبارُ دخانٍ لمحوّلِ مخزنِ إبطالِ الجلساتِ على Redis (`SEC-18`).
 *
 * الغرض: إثباتٌ سلوكيٌّ — الإبطالُ يكتبُ `SET key 1 EX ttl`، والفحصُ يقرأُ
 * `GET key`، والفشلُ في الوصولِ إغلاقٌ لا فتحٌ.
 *
 * ينتمي إلى: SEC-18 · ADR 0173
 */

import { describe, expect, it, mock } from "bun:test";
import { createRedisSessionRevocationStore } from "../../packages/infrastructure/identity/redis-session-revocation-store.ts";
import type { RedisClient } from "../../packages/infrastructure/redis/upstash.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

function fakeRedis(commands: Record<string, unknown>): RedisClient {
  return {
    command: mock(async (args: string[]) => {
      const cmd = args[0];
      if (cmd === "GET") {
        const key = args[1] ?? "";
        const val = commands[key];
        return ok(val as string | null);
      }
      if (cmd === "SET") {
        const key = args[1] ?? "";
        commands[key] = args[2];
        return ok("OK");
      }
      return ok(null);
    }),
  } as unknown as RedisClient;
}

describe("createRedisSessionRevocationStore", () => {
  it("يرفضُ الجلسةَ المُبطَلَة", async () => {
    const store = createRedisSessionRevocationStore(fakeRedis({ "revoked-session:abc": "1" }));
    const result = await store.isRevoked("abc");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it("يقبلُ الجلسةَ غيرَ المُبطَلَة", async () => {
    const store = createRedisSessionRevocationStore(fakeRedis({}));
    const result = await store.isRevoked("xyz");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });

  it("يُبطِلُ الجلسةَ بـ SET key 1 EX ttl", async () => {
    const commands: Record<string, unknown> = {};
    const store = createRedisSessionRevocationStore(fakeRedis(commands));
    const result = await store.revoke("abc", 3600, "security");
    expect(result.ok).toBe(true);
    expect(commands["revoked-session:abc"]).toBe("1");
  });

  it("يفشلُ مُغلقًا حينَ يتعذّرُ Redis", async () => {
    const failingRedis: RedisClient = {
      command: mock(async () =>
        err({ kind: "UNAVAILABLE" as const, detail: "connection refused" }),
      ),
    } as unknown as RedisClient;
    const store = createRedisSessionRevocationStore(failingRedis);
    const result = await store.isRevoked("abc");
    expect(result.ok).toBe(false);
  });
});
