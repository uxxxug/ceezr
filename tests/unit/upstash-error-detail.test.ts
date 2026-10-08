/**
 * الغرض: إثباتُ أنَّ عميلَ Upstash ينقلُ رسالةَ رفضِ المزوّدِ (`4xx` بجسمِ
 *   `{"error": "..."}`) إلى التفصيلِ **مُعقَّمةً** — PRD-001: كانَ الإنتاجُ يسجّلُ
 *   `HTTP 400` وحدَه فبقيَ سببُ `degradedChecks: ["redis"]` غيرَ مقروء.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  createUpstashRedis,
  sanitizeUpstashError,
} from "../../packages/infrastructure/redis/upstash.ts";

const URL_UNDER_TEST = "https://example.upstash.io";

function clientReturning(response: () => Response) {
  return createUpstashRedis({
    url: URL_UNDER_TEST,
    token: "test-token",
    fetchImpl: (async () => response()) as unknown as typeof fetch,
  });
}

describe("تفصيلُ رفضِ Upstash", () => {
  test("رسالةُ الخطأِ في جسمِ 400 تصلُ التفصيلَ", async () => {
    const client = clientReturning(
      () =>
        new Response(JSON.stringify({ error: "ERR max daily request limit exceeded" }), {
          status: 400,
        }),
    );
    const result = await client.command(["PING"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toEqual({
      kind: "http",
      detail: "HTTP 400: ERR max daily request limit exceeded",
    });
  });

  test("جسمٌ غيرُ JSON يُبقي رمزَ الحالةِ وحدَه", async () => {
    const client = clientReturning(() => new Response("nope", { status: 401 }));
    const result = await client.command(["PING"]);
    expect(!result.ok && result.error).toEqual({ kind: "http", detail: "HTTP 401" });
  });

  test("رمزٌ أو عنوانٌ في رسالةِ المزوّدِ يُحجَبُ ولا يصلُ التفصيلَ", async () => {
    const secret = "AXyZsecretTOKENvalue1234567890abcdef";
    const client = clientReturning(
      () =>
        new Response(
          JSON.stringify({ error: `WRONGPASS token ${secret} at https://x-1.upstash.io/path` }),
          { status: 401 },
        ),
    );
    const result = await client.command(["PING"]);
    const detail = !result.ok ? result.error.detail : "";
    expect(detail).not.toContain(secret);
    expect(detail).not.toContain("upstash.io");
    expect(detail).toContain("[redacted]");
    expect(detail).toContain("[url]");
  });

  test("الطولُ مقصوصٌ", () => {
    expect(sanitizeUpstashError("ERR ".repeat(200)).length).toBeLessThanOrEqual(160);
  });
});
