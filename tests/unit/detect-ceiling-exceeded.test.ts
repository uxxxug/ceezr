/**
 * الغرض: قياسُ عاملِ كشفِ تجاوزِ السقفِ (`F12-20`) — تصعيدٌ لا إلغاءٌ.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */

import { describe, expect, it } from "bun:test";
import { detectCeilingExceededOrders } from "../../apps/workers/src/jobs/detect-ceiling-exceeded.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CeilingExceededOrderRpcPort } from "../../packages/application/tracking/ceiling-exceeded-ports.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import type { Result } from "../../packages/shared/result/index.ts";

const cityId = "city-1" as CityId;

function makeDeps(
  rows: readonly {
    orderId: OrderId;
    status: string;
    startedAt: string;
    elapsedMinutes: number;
    ceilingMinutes: number;
    ceilingSource: string;
  }[],
  fail = false,
): { detector: CeilingExceededOrderRpcPort; escalate: (fields: Record<string, unknown>) => void } {
  const escalated: Record<string, unknown>[] = [];
  const detector: CeilingExceededOrderRpcPort = {
    async listCeilingExceeded(
      _cityId: CityId,
      _limit: number,
    ): Promise<Result<typeof rows, PortFailureError>> {
      if (fail) return { ok: false, error: new PortFailureError("test", "fail") };
      return { ok: true, value: rows };
    },
  };
  return {
    detector,
    escalate: (fields) => {
      escalated.push(fields);
    },
  };
}

describe("F12-20 — detectCeilingExceededOrders", () => {
  it("يُصعِّدُ صفاً مُهيكَلاً لكلِّ طلبٍ متجاوزٍ", async () => {
    const rows = [
      {
        orderId: "order-1" as OrderId,
        status: "in_progress",
        startedAt: "2026-09-30T00:00:00Z",
        elapsedMinutes: 721,
        ceilingMinutes: 720,
        ceilingSource: "SETTING",
      },
    ];
    const deps = makeDeps(rows);
    const result = await detectCeilingExceededOrders(cityId, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exceeded).toBe(1);
      expect(result.value.worstElapsedMinutes).toBe(721);
    }
  });

  it("يُعيدُ صفراً حينَ لا يتجاوزُ أحدٌ", async () => {
    const deps = makeDeps([]);
    const result = await detectCeilingExceededOrders(cityId, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exceeded).toBe(0);
      expect(result.value.worstElapsedMinutes).toBeNull();
    }
  });

  it("يُمرِّرُ الخطأَ ولا يُخفيه", async () => {
    const deps = makeDeps([], true);
    const result = await detectCeilingExceededOrders(cityId, deps);
    expect(result.ok).toBe(false);
  });
});
