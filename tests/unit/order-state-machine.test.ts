/**
 * الغرض: اختبار آلة حالات الطلب — كل انتقال غير مشروع يجب أن يُرفض بلا throw.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: القيد orders_matched_requires_driver في القاعدة يحمي نفس القاعدة تخزينياً.
 */
import { describe, expect, it } from "bun:test";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import {
  canTransition,
  hasExhaustedBroadcastRounds,
  isTerminal,
  returnToSearching,
  transition,
  type Order,
  type OrderStatus,
} from "../../packages/domain/transport/entity.ts";
import { isErr, isOk } from "../../packages/shared/result/index.ts";

const DRIVER = "driver-1" as DriverId;

function order(over: Partial<Order> = {}): Order {
  return {
    id: "order-1" as OrderId,
    cityId: "city-jed" as CityId,
    service: "transport",
    status: "searching",
    pickup: { latitude: 21.4858, longitude: 39.1925 },
    dropoff: null,
    assignedDriverId: null,
    broadcastRound: 1,
    ...over,
  };
}

describe("canTransition", () => {
  const legal: [OrderStatus, OrderStatus][] = [
    ["searching", "matched"],
    ["searching", "cancelled"],
    ["searching", "failed"],
    ["matched", "in_progress"],
    ["matched", "searching"],
    ["in_progress", "completed"],
    ["failed", "searching"],
  ];
  const illegal: [OrderStatus, OrderStatus][] = [
    ["searching", "in_progress"],
    ["searching", "completed"],
    ["matched", "completed"],
    ["completed", "in_progress"],
    ["cancelled", "searching"],
    ["completed", "cancelled"],
  ];

  for (const [from, to] of legal) {
    it(`مشروع: ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
  for (const [from, to] of illegal) {
    it(`مرفوض: ${from} → ${to}`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }
});

describe("isTerminal", () => {
  it("completed و cancelled نهائيتان", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
  it("failed غير نهائية لأنها قابلة لإعادة البحث", () => {
    expect(isTerminal("failed")).toBe(false);
  });
});

describe("transition", () => {
  it("لا مطابقة بلا سائق مُسنَد", () => {
    const r = transition(order(), "matched");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe("MISSING_ASSIGNED_DRIVER");
  });

  it("مطابقة صحيحة مع سائق مُسنَد", () => {
    const r = transition(order({ assignedDriverId: DRIVER }), "matched");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.status).toBe("matched");
  });

  it("يرفض إنهاء رحلة لم تبدأ ويعيد سبباً واضحاً", () => {
    const r = transition(order({ status: "matched", assignedDriverId: DRIVER }), "completed");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("ILLEGAL_TRANSITION");
      if (r.error.code === "ILLEGAL_TRANSITION") {
        expect(r.error.from).toBe("matched");
        expect(r.error.to).toBe("completed");
      }
    }
  });

  it("المسار الكامل: searching → matched → in_progress → completed", () => {
    let current = order({ assignedDriverId: DRIVER });
    for (const next of ["matched", "in_progress", "completed"] as OrderStatus[]) {
      const r = transition(current, next);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) current = r.value;
    }
    expect(current.status).toBe("completed");
    expect(isTerminal(current.status)).toBe(true);
  });

  it("لا يعدّل الكائن الأصلي", () => {
    const original = order({ assignedDriverId: DRIVER });
    transition(original, "matched");
    expect(original.status).toBe("searching");
  });
});

describe("returnToSearching", () => {
  it("يزيد رقم الدورة ويُفرّغ السائق", () => {
    const r = returnToSearching(order({ status: "matched", assignedDriverId: DRIVER, broadcastRound: 1 }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.status).toBe("searching");
      expect(r.value.assignedDriverId).toBeNull();
      expect(r.value.broadcastRound).toBe(2);
    }
  });

  it("يرفض إعادة طلب منتهٍ للبحث", () => {
    expect(isErr(returnToSearching(order({ status: "completed", assignedDriverId: DRIVER })))).toBe(true);
  });
});

describe("hasExhaustedBroadcastRounds", () => {
  it("لم تُستنفد عند دورة واحدة من ثلاث", () => {
    expect(hasExhaustedBroadcastRounds(order({ broadcastRound: 1 }), 3)).toBe(false);
  });
  it("استُنفدت عند بلوغ الحد المبذور", () => {
    expect(hasExhaustedBroadcastRounds(order({ broadcastRound: 3 }), 3)).toBe(true);
  });
});
