/**
 * الغرض: اختبارُ وحدةٍ لحاجزِ `scripts/check-eco-user-cost.ts` — سالبةٌ لكلِّ قاعدةٍ
 *   (`ح-7`). كلُّ قاعدةٍ مزرُوعةٌ بمسبارٍ يُسقِطُ الحاجزَ عينَه لا نسخةً منه.
 *
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يحكمُه: `docs/adr/0154-eco-001-first-increment-active-user-and-ride-denominators.md`
 */

import { describe, expect, it } from "bun:test";
import { auditEcoUserCost, GUARD_RULE_NAMES } from "../../scripts/check-eco-user-cost.ts";
import { JUDGE_RULE_NAMES } from "../../scripts/lib/eco-user-cost.ts";

const VALID_SOURCE = `
import { judgeEcoUserCost } from "../../scripts/lib/eco-user-cost.ts";
import type { UnitPrices } from "../../scripts/lib/eco-user-cost.ts";

const from = new Date("2026-08-20T00:00:00Z");
const to = new Date("2026-09-20T00:00:00Z");

const activeUsers = await sql\`SELECT count(DISTINCT u.id) FROM users u WHERE u.id IN (SELECT r.user_id FROM orders o JOIN riders r ON r.id = o.rider_id WHERE o.created_at >= \${from} AND o.created_at < \${to}) OR u.id IN (SELECT d.user_id FROM orders o JOIN drivers d ON d.id = o.assigned_driver_id WHERE o.assigned_driver_id IS NOT NULL AND o.created_at >= \${from} AND o.created_at < \${to}) OR u.id IN (SELECT d.user_id FROM order_offers of JOIN drivers d ON d.id = of.driver_id WHERE of.created_at >= \${from} AND of.created_at < \${to})\`;
const activeDrivers = await sql\`SELECT count(DISTINCT d.id) FROM drivers d WHERE d.id IN (SELECT o.assigned_driver_id FROM orders o WHERE o.assigned_driver_id IS NOT NULL AND o.created_at >= \${from} AND o.created_at < \${to}) OR d.id IN (SELECT of.driver_id FROM order_offers of WHERE of.created_at >= \${from} AND of.created_at < \${to})\`;

const ordersCreated = await sql\`SELECT count(*) FROM orders WHERE created_at >= \${from} AND created_at < \${to}\`;
const completedRides = await sql\`SELECT count(*) FROM orders WHERE completed_at >= \${from} AND completed_at < \${to}\`;

const prices: UnitPrices = {};
const result = judgeEcoUserCost({ from, to }, activeUsers, perRideQuantities, prices);
expect(result.monetaryCost.status.status).toBe("blocked");
expect(result.monetaryCost.status.reason).toBe("REQ-09");
`;

const VALID_PACKAGE_JSON = `"check-eco-user-cost": "bun run scripts/check-eco-user-cost.ts"`;

describe("check-eco-user-cost", () => {
  it("يمرُّ على ملفِّ قياسٍ سليمٍ", () => {
    const problems = auditEcoUserCost({
      measurementSource: VALID_SOURCE,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems).toEqual([]);
  });

  it("يملكُ عددَ القواعدِ المُعلَنَ", () => {
    expect(GUARD_RULE_NAMES.length).toBe(11);
    expect(JUDGE_RULE_NAMES.length).toBe(10);
  });

  it("يسقطُ إذا غابَ ملفُّ القياسِ", () => {
    const problems = auditEcoUserCost({
      measurementSource: null,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.measurement-present")).toBe(true);
  });

  it("يسقطُ إذا لم يُستوردْ حَكَمُ التكلفةِ", () => {
    const source = VALID_SOURCE.replace(/from.*eco-user-cost.*\n/g, "");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.judge-imported")).toBe(true);
  });

  it("يسقطُ إذا غابتِ النافذةُ المحقونةُ", () => {
    const source = VALID_SOURCE.replace(/const from = new Date.*\n|const to = new Date.*\n/g, "");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.window-injected")).toBe(true);
  });

  it("يسقطُ إذا لم يُعدَّ الراكبونَ من `rider_id`", () => {
    const source = VALID_SOURCE.replace(/rider_id/g, "rider_account");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.riders-counted")).toBe(true);
  });

  it("يسقطُ إذا لم يُعدَّ السائقونَ كاتحادٍ على `users.id`", () => {
    const source = VALID_SOURCE.replace(/users/g, "accounts");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.drivers-counted")).toBe(true);
  });

  it("يسقطُ إذا لم يُعدَّ السائقونَ من `order_offers`", () => {
    const source = VALID_SOURCE.replace(/order_offers/g, "offer_table");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.drivers-from-offers")).toBe(true);
  });

  it("يسقطُ إذا لم تُفصَلِ الطلباتُ المُنشأةُ عن المُكمَّلةِ", () => {
    const source = VALID_SOURCE.replace(/ordersCreated|created_at/g, "order_timestamp");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.orders-separated")).toBe(true);
  });

  it("يسقطُ إذا استُعملَ `now()` في القياسِ", () => {
    const source = `${VALID_SOURCE}\nconst now = new Date(now());\n`;
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.no-now-in-measurement")).toBe(true);
  });

  it("يسقطُ إذا غابتِ الأسعارُ كمدخلاتٍ", () => {
    const source = VALID_SOURCE.replace(/UnitPrices|prices|price/g, "cost_input");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.prices-optional")).toBe(true);
  });

  it("يسقطُ إذا غابت حالةُ `blocked` عندَ غيابِ السعرِ", () => {
    const source = VALID_SOURCE.replace(/blocked|REQ-09/g, "unavailable");
    const problems = auditEcoUserCost({
      measurementSource: source,
      packageJson: VALID_PACKAGE_JSON,
    });
    expect(problems.some((p) => p.rule === "guard.blocked-when-missing")).toBe(true);
  });

  it("يسقطُ إذا لم يُوصلْ في سلسلةِ `ci`", () => {
    const problems = auditEcoUserCost({
      measurementSource: VALID_SOURCE,
      packageJson: '{"scripts": {}}',
    });
    expect(problems.some((p) => p.rule === "guard.self-enforced")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// اختباراتُ الحَكَمِ النقيِّ
// ═══════════════════════════════════════════════════════════════════════════

import {
  type ActiveUserCounts,
  calculateMonetaryCost,
  calculateMonthlyUsage,
  judgeEcoUserCost,
  type MonthlyWindow,
  type PerRideQuantities,
  summarizeEcoUserCost,
  type UnitPrices,
} from "../../scripts/lib/eco-user-cost.ts";

const window: MonthlyWindow = {
  from: new Date("2026-08-20T00:00:00Z"),
  to: new Date("2026-09-20T00:00:00Z"),
};

const activeUsers: ActiveUserCounts = {
  activeRiders: 10,
  activeDrivers: 5,
  totalActiveUsers: 15,
  ordersCreated: 100,
  completedRides: 80,
};

const perRideQuantities: PerRideQuantities = {
  databaseRows: 2403,
  databaseBlocks: 2509,
  queueMessages: 0,
  redisCommands: 142,
  networkBytes: 11862,
  storageRows: 1,
};

describe("eco-user-cost judge", () => {
  it("يحسبُ الكميّاتِ الشهريّةَ من كميّاتِ الرحلةِ × عددِ الرحلاتِ", () => {
    const usage = calculateMonthlyUsage(activeUsers, perRideQuantities);
    expect(usage.monthlyDatabaseRows).toBe(2403 * 100);
    expect(usage.monthlyRedisCommands).toBe(142 * 100);
    expect(usage.monthlyNetworkBytes).toBe(11862 * 100);
  });

  it("يحسبُ النِسبَ لكلِّ مستخدمٍ بقسمةِ الإجماليِّ على عددِ المستخدمينَ", () => {
    const usage = calculateMonthlyUsage(activeUsers, perRideQuantities);
    expect(usage.perUserDatabaseRows).toBe((2403 * 100) / 15);
    expect(usage.perUserRedisCommands).toBe((142 * 100) / 15);
  });

  it("يحسبُ التكلفةَ النقديّةَ عندَ توفُّرِ جميعِ الأسعارِ", () => {
    const usage = calculateMonthlyUsage(activeUsers, perRideQuantities);
    const prices: UnitPrices = {
      dbRowPrice: 0.0001,
      dbBlockPrice: 0.00005,
      queueMessagePrice: 0.001,
      redisCommandPrice: 0.00001,
      networkBytePrice: 0.00000001,
      storageRowPrice: 0.001,
    };
    const cost = calculateMonetaryCost(usage, prices, activeUsers, perRideQuantities);
    expect(cost.status.status).toBe("calculated");
    expect(cost.totalMonthlyCost).not.toBeNull();
    expect(cost.perUserCost).not.toBeNull();
    expect(cost.perRideCost).not.toBeNull();
  });

  it("يحجبُ التكلفةَ عندَ غيابِ سعرٍ واحدٍ على الأقلِّ", () => {
    const usage = calculateMonthlyUsage(activeUsers, perRideQuantities);
    const prices: UnitPrices = {
      dbRowPrice: 0.0001,
      // بقيةُ الأسعارِ غائبةٌ
    };
    const cost = calculateMonetaryCost(usage, prices, activeUsers, perRideQuantities);
    expect(cost.status.status).toBe("blocked");
    if (cost.status.status === "blocked") {
      expect(cost.status.reason).toBe("REQ-09");
    }
    expect(cost.perUserCost).toBeNull();
    expect(cost.perRideCost).toBeNull();
    expect(cost.totalMonthlyCost).toBeNull();
  });

  it("يحجبُ التكلفةَ عندَ غيابِ جميعِ الأسعارِ", () => {
    const usage = calculateMonthlyUsage(activeUsers, perRideQuantities);
    const prices: UnitPrices = {};
    const cost = calculateMonetaryCost(usage, prices, activeUsers, perRideQuantities);
    expect(cost.status.status).toBe("blocked");
  });

  it("يُنتجُ نتيجةً كاملةً من `judgeEcoUserCost`", () => {
    const prices: UnitPrices = {};
    const result = judgeEcoUserCost(window, activeUsers, perRideQuantities, prices);
    expect(result.window.from).toEqual(window.from);
    expect(result.window.to).toEqual(window.to);
    expect(result.activeUsers.totalActiveUsers).toBe(15);
    expect(result.monthlyUsage.monthlyDatabaseRows).toBe(2403 * 100);
    expect(result.monetaryCost.status.status).toBe("blocked");
  });

  it("يُلخِّصُ النتيجةَ في نصٍّ يحوي المقاماتِ والكميّاتِ", () => {
    const prices: UnitPrices = {};
    const result = judgeEcoUserCost(window, activeUsers, perRideQuantities, prices);
    const summary = summarizeEcoUserCost(result);
    expect(summary).toContain("15");
    expect(summary).toContain("مستخدم");
    expect(summary).toContain("100");
    expect(summary).toContain("محجوبة");
    expect(summary).toContain("REQ-09");
  });

  it("يتعاملُ مع مقامِ صفرٍ بلا قسمةٍ على صفرٍ", () => {
    const zeroUsers: ActiveUserCounts = {
      activeRiders: 0,
      activeDrivers: 0,
      totalActiveUsers: 0,
      ordersCreated: 0,
      completedRides: 0,
    };
    const usage = calculateMonthlyUsage(zeroUsers, perRideQuantities);
    expect(usage.perUserDatabaseRows).toBe(0);
    expect(usage.perUserRedisCommands).toBe(0);
  });
});
