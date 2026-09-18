/**
 * الغرض: اختباراتُ حارسِ سياسةِ تخزينِ المساراتِ (CAP-012).
 *   سالبةٌ مزروعةٌ لكلِّ صنفِ مشكلة.
 *
 * الحالة: منفّذ فعلياً — CAP-012.
 */

import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";

const GUARD_SCRIPT = "scripts/check-route-cache-policy.ts";

interface GuardResult {
  exitCode: number;
  stdout: string;
}

function runGuard(): GuardResult {
  try {
    const result = execSync(`bun run ${GUARD_SCRIPT}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout: result };
  } catch (e: unknown) {
    const err = e as { stdout?: string };
    return { exitCode: 1, stdout: err.stdout ?? "" };
  }
}

describe("CAP-012: Route Cache Policy Guard", () => {
  it("passes when all requirements are met", () => {
    const { exitCode } = runGuard();
    expect(exitCode).toBe(0);
  });
});
