/**
 * الغرض: سالبةٌ مبذورةٌ لكلِّ قاعدةٍ في `scripts/lib/resource-usage-budget.ts`
 *   (`ح-7`). كلُّ اختبارٍ يُمرِّرُ حقائقَ محقونةً تُخالِفُ قاعدةً واحدةً، فلا
 *   تمرَّ سالبةٌ إلّا على الحَكَمِ الحقيقيِّ.
 *
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  databaseBlockBudget,
  databaseRowBudget,
  JUDGE_RULE_NAMES,
  judgeResourceUsage,
  networkByteBudget,
  queueMessageBudget,
  type ResourceUsageFacts,
  RIDE_RESOURCE_PROFILE,
  redisCommandBudget,
  storageRowBudget,
} from "../../scripts/lib/resource-usage-budget.ts";

function validFacts(): ResourceUsageFacts {
  return {
    measured: true,
    databaseRowsTouched: 10,
    databaseBlocksTouched: 7,
    queueMessagesEnqueued: 5,
    redisCommandsExecuted: 30,
    networkBytesTransferred: 1024,
    storageRowsInserted: 15,
    windowMs: RIDE_RESOURCE_PROFILE.windowMs,
  };
}

function validInputs() {
  return {
    facts: validFacts(),
    profile: RIDE_RESOURCE_PROFILE,
    databaseRowsBudget: databaseRowBudget(),
    databaseBlocksBudget: databaseBlockBudget(),
    queueMessagesBudget: queueMessageBudget(),
    redisCommandsBudget: redisCommandBudget(),
    networkBytesBudget: networkByteBudget(),
    storageRowsBudget: storageRowBudget(),
  };
}

describe("حَكَمُ مواردِ الرحلةِ (ECO-004)", () => {
  it("يمرُّ بحقائقَ سليمةٍ", () => {
    const violations = judgeResourceUsage(validInputs());
    expect(violations).toEqual([]);
  });

  it("يسقطُ إن لم يجرِ القياسُ", () => {
    const facts = { ...validFacts(), measured: false };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "facts.measured")).toBe(true);
  });

  it("يسقطُ إن كانَ عددٌ سالباً", () => {
    const facts = { ...validFacts(), databaseRowsTouched: -1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.sane")).toBe(true);
  });

  it("يسقطُ إن كانَ عددٌ غيرَ صحيحٍ", () => {
    const facts = { ...validFacts(), redisCommandsExecuted: 1.5 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.sane")).toBe(true);
  });

  it("يسقطُ إن تجاوزَتِ الصفوفُ السقفَ", () => {
    const facts = { ...validFacts(), databaseRowsTouched: databaseRowBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "database.within-budget")).toBe(true);
  });

  it("يسقطُ إن تجاوزَتِ الكُتَلُ السقفَ", () => {
    const facts = { ...validFacts(), databaseBlocksTouched: databaseBlockBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "database.within-budget")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ الطابورُ السقفَ", () => {
    const facts = { ...validFacts(), queueMessagesEnqueued: queueMessageBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "queue.within-budget")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ Redis السقفَ", () => {
    const facts = { ...validFacts(), redisCommandsExecuted: redisCommandBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "redis.within-budget")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ النقلُ السقفَ", () => {
    const facts = { ...validFacts(), networkBytesTransferred: networkByteBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "network.within-budget")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ التخزينُ السقفَ", () => {
    const facts = { ...validFacts(), storageRowsInserted: storageRowBudget() + 1 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "storage.within-budget")).toBe(true);
  });

  it("يسقطُ إن لم يُطابِقِ السقفُ المُشتَقَّ", () => {
    const violations = judgeResourceUsage({
      ...validInputs(),
      databaseRowsBudget: databaseRowBudget() + 100,
    });
    expect(violations.some((v) => v.rule === "budget.derived")).toBe(true);
  });

  it("يسقطُ إن خالَفَتِ النافذةُ المُعلَنةَ", () => {
    const facts = { ...validFacts(), windowMs: 5 * 60 * 1000 };
    const violations = judgeResourceUsage({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "window.declared")).toBe(true);
  });

  it("السقوفُ المُشتَقَّةُ متسقةٌ مع الشكلِ", () => {
    const totalApiCalls =
      RIDE_RESOURCE_PROFILE.heartbeatCount +
      RIDE_RESOURCE_PROFILE.activeReadCount +
      RIDE_RESOURCE_PROFILE.lifecycleTransitionCount +
      2;
    const rowsPerCall =
      RIDE_RESOURCE_PROFILE.inboundUpdateCount * RIDE_RESOURCE_PROFILE.lifecycleTransitionCount * 5;
    expect(databaseRowBudget()).toBe(totalApiCalls * rowsPerCall + 100);
    expect(databaseBlockBudget()).toBe(Math.ceil(databaseRowBudget() * 0.72));
    expect(queueMessageBudget()).toBe(RIDE_RESOURCE_PROFILE.lifecycleTransitionCount + 2);
    expect(redisCommandBudget()).toBe(
      (RIDE_RESOURCE_PROFILE.heartbeatCount +
        RIDE_RESOURCE_PROFILE.activeReadCount +
        RIDE_RESOURCE_PROFILE.lifecycleTransitionCount +
        2) *
        2 +
        10,
    );
    expect(storageRowBudget()).toBe(RIDE_RESOURCE_PROFILE.lifecycleTransitionCount * 4);
  });

  it("قواعدُ الحَكَمِ بعددٍ معلومٍ", () => {
    expect(JUDGE_RULE_NAMES.length).toBe(9);
  });
});
