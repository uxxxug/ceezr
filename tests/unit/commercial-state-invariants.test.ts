/**
 * الغرض: سالباتٌ مبذورةٌ (`ح-7`) لحَكَمِ `F11-03` — كلُّ قاعدةٍ تسقطُ على لقطةٍ
 *   فاسدةٍ بعينِها، واللقطةُ السليمةُ تمرُّ. فالأخضرُ في وظيفةِ Redis الحقيقيِّ لا
 *   يُقرأ حُكماً من حَكَمٍ لا يُسقِطُ شيئاً.
 * الحالة: منفّذ فعلياً — `ADR 0193`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ على `scripts/lib/commercial-state-invariants.ts`.
 * ملاحظات مستقبلية: قاعدةٌ تُضافُ إلى الحَكَمِ تُضافُ لها سالبةٌ ههنا في الالتزامِ نفسِه.
 */

import { describe, expect, it } from "bun:test";
import {
  type CommercialExpectation,
  type CommercialSnapshot,
  judgeCommercialState,
} from "../../scripts/lib/commercial-state-invariants.ts";

const RIDER = "rider-1";
const D1 = "driver-1";
const D2 = "driver-2";
const ORDER = "order-1";
const MONEY = { ledger_entries: 0, payment_transactions: 0, subscriptions: 2 };

const healthy: CommercialSnapshot = {
  orders: [{ id: ORDER, riderId: RIDER, status: "completed", assignedDriverId: D1 }],
  offers: [
    { orderId: ORDER, driverId: D1, status: "accepted" },
    { orderId: ORDER, driverId: D2, status: "cancelled" },
  ],
  moneyBefore: MONEY,
  moneyAfter: MONEY,
  notices: { acceptance: 1, completion: 1 },
};

const expectation: CommercialExpectation = {
  riderId: RIDER,
  expectedOrders: 1,
  expectedStatus: "completed",
  cutCommands: 12,
  expectedNotices: { acceptance: 1, completion: 1 },
};

const rulesOf = (snapshot: CommercialSnapshot, wanted = expectation): string[] =>
  judgeCommercialState(snapshot, wanted).violations.map((violation) => violation.rule);

describe("حَكَمُ الحالةِ التجاريّةِ بعدَ فقدانِ Redis — F11-03", () => {
  it("اللقطةُ السليمةُ تمرُّ بلا مخالفةٍ", () => {
    const verdict = judgeCommercialState(healthy, expectation);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("فقدانٌ لم يُحقَنْ قطُّ يُسقِطُ القياسَ: redis.cut-injected", () => {
    expect(rulesOf(healthy, { ...expectation, cutCommands: 0 })).toEqual(["redis.cut-injected"]);
  });

  it("طلبٌ مُكرَّرٌ من إعادةِ تسليمٍ يسقطُ: order.count", () => {
    const duplicated: CommercialSnapshot = {
      ...healthy,
      orders: [
        ...healthy.orders,
        { id: "order-2", riderId: RIDER, status: "searching", assignedDriverId: null },
      ],
    };
    expect(rulesOf(duplicated)).toContain("order.count");
  });

  it("طلبٌ ضاعَ فلم يُكتَبْ يسقطُ: order.count", () => {
    expect(rulesOf({ ...healthy, orders: [], offers: [] })).toContain("order.count");
  });

  it("رحلةٌ لم تبلغْ ما طلبَه السائقُ آخرَ الأمرِ تسقطُ: order.status", () => {
    const stuck: CommercialSnapshot = {
      ...healthy,
      orders: [{ id: ORDER, riderId: RIDER, status: "in_progress", assignedDriverId: D1 }],
    };
    expect(rulesOf(stuck)).toContain("order.status");
  });

  it("عرضانِ مقبولانِ على طلبٍ واحدٍ يسقطانِ: offer.single-accepted", () => {
    const doubleClaim: CommercialSnapshot = {
      ...healthy,
      offers: [
        { orderId: ORDER, driverId: D1, status: "accepted" },
        { orderId: ORDER, driverId: D2, status: "accepted" },
      ],
    };
    expect(rulesOf(doubleClaim)).toContain("offer.single-accepted");
  });

  it("المقبولُ غيرُ المُسنَدِ يسقطُ: offer.accepted-is-assigned", () => {
    const crossed: CommercialSnapshot = {
      ...healthy,
      orders: [{ id: ORDER, riderId: RIDER, status: "completed", assignedDriverId: D2 }],
    };
    expect(rulesOf(crossed)).toContain("offer.accepted-is-assigned");
  });

  it("رحلةٌ مُسنَدةٌ بلا عرضٍ مقبولٍ تسقطُ: offer.accepted-is-assigned", () => {
    const orphanAssignment: CommercialSnapshot = {
      ...healthy,
      offers: [{ orderId: ORDER, driverId: D1, status: "cancelled" }],
    };
    expect(rulesOf(orphanAssignment)).toContain("offer.accepted-is-assigned");
  });

  it("رحلةٌ خارجَ البحثِ بلا سائقٍ مُسنَدٍ تسقطُ: order.assigned-driver", () => {
    const unassigned: CommercialSnapshot = {
      ...healthy,
      orders: [{ id: ORDER, riderId: RIDER, status: "completed", assignedDriverId: null }],
      offers: [],
    };
    expect(rulesOf(unassigned)).toContain("order.assigned-driver");
  });

  it("عرضٌ معلَّقٌ على طلبٍ خرجَ من البحثِ يسقطُ: offer.no-pending-after-search", () => {
    const dangling: CommercialSnapshot = {
      ...healthy,
      offers: [
        { orderId: ORDER, driverId: D1, status: "accepted" },
        { orderId: ORDER, driverId: D2, status: "pending" },
      ],
    };
    expect(rulesOf(dangling)).toContain("offer.no-pending-after-search");
  });

  it("سائقٌ برحلتينِ نشطتينِ يسقطُ: driver.single-active", () => {
    const busy: CommercialSnapshot = {
      ...healthy,
      orders: [
        { id: ORDER, riderId: RIDER, status: "in_progress", assignedDriverId: D1 },
        { id: "order-9", riderId: "rider-9", status: "matched", assignedDriverId: D1 },
      ],
      offers: [
        { orderId: ORDER, driverId: D1, status: "accepted" },
        { orderId: "order-9", driverId: D1, status: "accepted" },
      ],
    };
    expect(rulesOf(busy, { ...expectation, expectedStatus: "in_progress" })).toEqual([
      "driver.single-active",
    ]);
  });

  it("حركةٌ ماليّةٌ لم تُطلَبْ تسقطُ: money.unmoved", () => {
    expect(rulesOf({ ...healthy, moneyAfter: { ...MONEY, ledger_entries: 1 } })).toEqual([
      "money.unmoved",
    ]);
  });

  it("جدولٌ ماليٌّ لم يُقرَأْ في إحدى اللقطتين يسقطُ: money.unmoved", () => {
    const { subscriptions: _dropped, ...partial } = MONEY;
    expect(rulesOf({ ...healthy, moneyAfter: partial })).toEqual(["money.unmoved"]);
  });

  it("لا جداولَ ماليّةً مقروءةً أصلاً يُسقِطُ القياسَ الأعمى: money.unmoved", () => {
    expect(rulesOf({ ...healthy, moneyBefore: {}, moneyAfter: {} })).toEqual(["money.unmoved"]);
  });

  it("إخطارٌ مُكرَّرٌ من إعادةِ تسليمٍ يسقطُ: notice.single-effect", () => {
    expect(rulesOf({ ...healthy, notices: { acceptance: 2, completion: 1 } })).toEqual([
      "notice.single-effect",
    ]);
  });

  it("إخطارٌ مبتلَعٌ يسقطُ: notice.single-effect", () => {
    expect(rulesOf({ ...healthy, notices: { acceptance: 1 } })).toEqual(["notice.single-effect"]);
  });

  it("لا آثارَ ظاهرةً مطلوبةً يُسقِطُ القياسَ الأعمى: notice.single-effect", () => {
    expect(rulesOf(healthy, { ...expectation, expectedNotices: {} })).toEqual([
      "notice.single-effect",
    ]);
  });
});
