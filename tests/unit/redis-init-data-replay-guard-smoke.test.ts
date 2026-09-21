import { describe, expect, it } from "bun:test";
import { createRedisInitDataReplayGuard } from "../../packages/infrastructure/identity/redis-init-data-replay-guard.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

describe("createRedisInitDataReplayGuard (smoke)", () => {
  it("creates a guard without connecting", () => {
    const guard = createRedisInitDataReplayGuard({
      command: () => Promise.resolve(ok("OK")),
    });
    expect(typeof guard.consume).toBe("function");
  });

  it("fails closed when Redis is unreachable", async () => {
    const guard = createRedisInitDataReplayGuard({
      command: () => Promise.resolve(err({ kind: "network", detail: "ECONNREFUSED" })),
    });
    const result = await guard.consume("test-fingerprint", 300);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("STORE_UNAVAILABLE");
    }
  });

  it("rejects replay when key already exists (NX returns null)", async () => {
    const guard = createRedisInitDataReplayGuard({
      command: () => Promise.resolve(ok(null)),
    });
    const result = await guard.consume("test-fingerprint", 300);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("REPLAYED");
    }
  });

  it("accepts first use when NX returns OK", async () => {
    const guard = createRedisInitDataReplayGuard({
      command: () => Promise.resolve(ok("OK")),
    });
    const result = await guard.consume("test-fingerprint", 300);
    expect(result.ok).toBe(true);
  });
});
