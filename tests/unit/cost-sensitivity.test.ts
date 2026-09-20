/**
 * الغرض: سالبةٌ مبذورةٌ لكلِّ قاعدةٍ في `scripts/lib/cost-sensitivity.ts` (`ح-7`).
 *   كلُّ اختبارٍ يُمرِّرُ حقائبَ وحقائقَ محقونةً تُخالِفُ قاعدةً واحدةً، فلا تمرَّ
 *   سالبةٌ إلّا على الحَكَمِ الحقيقيِّ عينِهِ — لا على نسخةٍ منهِ.
 *
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ ولا قرصَ.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type CostSensitivityFacts,
  JUDGE_RULE_NAMES,
  judgeCostSensitivity,
  SENSITIVITY_VOLUME_MULTIPLIER,
  volumeBudgets,
} from "../../scripts/lib/cost-sensitivity.ts";
import {
  databaseBlockBudget,
  databaseRowBudget,
  networkByteBudget,
  queueMessageBudget,
  RIDE_RESOURCE_PROFILE,
  redisCommandBudget,
  storageRowBudget,
} from "../../scripts/lib/resource-usage-budget.ts";

function validFacts(): CostSensitivityFacts {
  return {
    measured: true,
    rideCount: SENSITIVITY_VOLUME_MULTIPLIER,
    databaseRowsTouched: 10_000,
    databaseBlocksTouched: 9_000,
    queueMessagesEnqueued: 5,
    redisCommandsExecuted: 1_400,
    networkBytesTransferred: 100_000,
    storageRowsInserted: 10,
    windowMs: RIDE_RESOURCE_PROFILE.windowMs * SENSITIVITY_VOLUME_MULTIPLIER,
  };
}

function validInputs() {
  return {
    facts: validFacts(),
    profile: RIDE_RESOURCE_PROFILE,
    multiplier: SENSITIVITY_VOLUME_MULTIPLIER,
    budgets: volumeBudgets(SENSITIVITY_VOLUME_MULTIPLIER, RIDE_RESOURCE_PROFILE),
  };
}

describe("حَكَمُ حسّاسيّةِ شكلِ التكلفةِ عندَ ١٠x (ECO-008)", () => {
  it("يمرُّ بحقائقَ سليمةٍ تحتَ السقوفِ الحجميّةِ", () => {
    const violations = judgeCostSensitivity(validInputs());
    expect(violations).toEqual([]);
  });

  it("يسقطُ إن لم يجرِ القياسُ", () => {
    const facts = { ...validFacts(), measured: false };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "facts.measured")).toBe(true);
  });

  it("يسقطُ إن كانَ عددٌ سالباً", () => {
    const facts = { ...validFacts(), databaseRowsTouched: -1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.sane")).toBe(true);
  });

  it("يسقطُ إن كانَ عددُ الرحلاتِ غيرَ صحيحٍ", () => {
    const facts = { ...validFacts(), rideCount: 10.5 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.sane")).toBe(true);
  });

  it("يسقطُ إن كانَ سطحٌ صفرَ الموردِ — الأخضرُ الفارغُ لا يُقرأُ ثباتاً", () => {
    const facts = { ...validFacts(), databaseRowsTouched: 0 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.nonempty")).toBe(true);
  });

  it("يسقطُ إن كانَ نصيبُ النقلِ صفراً معَ قياسٍ مُعلَنٍ", () => {
    const facts = { ...validFacts(), networkBytesTransferred: 0 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "counts.nonempty")).toBe(true);
  });

  it("يسقطُ إن حملَتِ النافذةُ حجمًا غيرَ المُعلَنِ", () => {
    const facts = { ...validFacts(), rideCount: SENSITIVITY_VOLUME_MULTIPLIER - 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "volume.exact")).toBe(true);
  });

  it("يسقطُ إن تجاوزَتِ الصفوفُ السقفَ الحجميَّ — نموٌّ فائقُ الخطّيّةِ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), databaseRowsTouched: budgets.databaseRows + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "database.linear")).toBe(true);
  });

  it("يسقطُ إن تجاوزَتِ الكُتَلُ السقفَ الحجميَّ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), databaseBlocksTouched: budgets.databaseBlocks + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "blocks.linear")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ الطابورُ السقفَ الحجميَّ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), queueMessagesEnqueued: budgets.queueMessages + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "queue.linear")).toBe(true);
  });

  it("يسقطُ إن تجاوزَتْ أوامرُ Redis السقفَ الحجميَّ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), redisCommandsExecuted: budgets.redisCommands + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "redis.linear")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ النقلُ السقفَ الحجميَّ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), networkBytesTransferred: budgets.networkBytes + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "network.linear")).toBe(true);
  });

  it("يسقطُ إن تجاوزَ التخزينُ السقفَ الحجميَّ", () => {
    const budgets = volumeBudgets();
    const facts = { ...validFacts(), storageRowsInserted: budgets.storageRows + 1 };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "storage.linear")).toBe(true);
  });

  it("يسقطُ إن كُتِبَ سقفٌ حجميٌّ يدويّاً لا مُشتَقًّا من سقفِ الرحلةِ", () => {
    const budgets = { ...volumeBudgets(), databaseRows: volumeBudgets().databaseRows + 10_000 };
    const violations = judgeCostSensitivity({ ...validInputs(), budgets });
    expect(violations.some((v) => v.rule === "budget.volume-derived")).toBe(true);
  });

  it("يسقطُ إن خالَفَتْ نافذةُ القياسِ المُعلَنةَ (شكلُ الرحلةِ × الحجمُ)", () => {
    const facts = { ...validFacts(), windowMs: RIDE_RESOURCE_PROFILE.windowMs };
    const violations = judgeCostSensitivity({ ...validInputs(), facts });
    expect(violations.some((v) => v.rule === "window.declared")).toBe(true);
  });

  it("يستوردُ سقوفَه من سقوفِ الرحلةِ الواحدةِ فتتبعُها — لا رقمًا مكتوبًا", () => {
    const budgets = volumeBudgets(SENSITIVITY_VOLUME_MULTIPLIER, RIDE_RESOURCE_PROFILE);
    // الاستيرادُ لا النسخُ: السقفُ الحجميُّ هوَ الحجمُ × سقفُ الرحلةِ من مصدرِها
    // الواحدِ، فمن غيَّرَ سقفَ الرحلةِ تغيَّرَ السقفُ الحجميُّ معَهُ بلا يدٍ هنا.
    expect(budgets.databaseRows).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * databaseRowBudget(RIDE_RESOURCE_PROFILE),
    );
    expect(budgets.databaseBlocks).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * databaseBlockBudget(RIDE_RESOURCE_PROFILE),
    );
    expect(budgets.queueMessages).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * queueMessageBudget(RIDE_RESOURCE_PROFILE),
    );
    expect(budgets.redisCommands).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * redisCommandBudget(RIDE_RESOURCE_PROFILE),
    );
    expect(budgets.networkBytes).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * networkByteBudget(RIDE_RESOURCE_PROFILE),
    );
    expect(budgets.storageRows).toBe(
      SENSITIVITY_VOLUME_MULTIPLIER * storageRowBudget(RIDE_RESOURCE_PROFILE),
    );
  });

  it("يعرِّفُ القواعدَ المُعلَنةَ كلَّها — لا قاعدةً بلا اسمٍ", () => {
    expect(JUDGE_RULE_NAMES).toContain("facts.measured");
    expect(JUDGE_RULE_NAMES).toContain("volume.exact");
    expect(JUDGE_RULE_NAMES).toContain("budget.volume-derived");
    expect(JUDGE_RULE_NAMES.length).toBe(12);
  });
});
