/**
 * الغرض: سالبةٌ مبذورةٌ لكلِّ قاعدةٍ في `scripts/check-cost-sensitivity.ts`
 *   (`ح-7`). كلُّ اختبارٍ يُشغِّلُ الحاجزَ عينَه بمدخلاتٍ محقونةٍ تُخالِفُ قاعدةً
 *   واحدةً، فلا تمرَّ سالبةٌ إلّا على الحاجزِ الحقيقيِّ لا على نسخةٍ منه.
 *
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ.
 * ينتمي إلى: tests/unit
 * يحرسُه: سلسلةُ `ci` (خطوةٌ مُسمّاةٌ في `verify`).
 */

import { describe, expect, it } from "bun:test";
import {
  auditCostSensitivity,
  defaultInputs,
  GUARD_RULE_NAMES,
  type Problem,
} from "../../scripts/check-cost-sensitivity.ts";

const validSource = `
import { buildContainer } from "../../apps/gateway/src/container.ts";
import {
  judgeCostSensitivity,
  volumeBudgets,
  SENSITIVITY_VOLUME_MULTIPLIER,
  RIDE_RESOURCE_PROFILE,
} from "../../scripts/lib/cost-sensitivity.ts";
import { createSql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("ECO-008", () => {
  it("عشر رحلات متتابعة تحت سقوف حجمية", async () => {
    const sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const before = await sql\`select tup_returned, tup_fetched, blks_read, blks_hit from pg_stat_database where datname = current_database()\`;
    const container = buildContainer(config, { redis: countingRedis });
    const res = await app.fetch(new Request("http://localhost/v1/rides/quote", { method: "POST", body: JSON.stringify({}) }));
    const networkBytes = new TextEncoder().encode(await res.text()).byteLength;
    const after = await sql\`select tup_returned, tup_fetched, blks_read, blks_hit from pg_stat_database where datname = current_database()\`;
    const outbox = await sql\`select count(*)::int from notification_outbox\`;
    const offers = await sql\`select count(*)::int from order_offers\`;
    const inserts = await sql\`select count(*)::int from orders\`;
    const facts = {
      measured: true,
      rideCount: completedRides,
      databaseRowsTouched: after[0].tup_returned - before[0].tup_returned + after[0].tup_fetched - before[0].tup_fetched,
      databaseBlocksTouched: after[0].blks_read - before[0].blks_read + after[0].blks_hit - before[0].blks_hit,
      queueMessagesEnqueued: outbox[0].count + offers[0].count,
      redisCommandsExecuted: countingRedis.commandCount,
      networkBytesTransferred: networkBytes,
      storageRowsInserted: inserts[0].count,
      windowMs: RIDE_RESOURCE_PROFILE.windowMs * SENSITIVITY_VOLUME_MULTIPLIER,
    };
    expect(facts.rideCount).toBe(SENSITIVITY_VOLUME_MULTIPLIER);
    const violations = judgeCostSensitivity({
      facts,
      profile: RIDE_RESOURCE_PROFILE,
      multiplier: SENSITIVITY_VOLUME_MULTIPLIER,
      budgets: volumeBudgets(SENSITIVITY_VOLUME_MULTIPLIER, RIDE_RESOURCE_PROFILE),
    });
    expect(violations).toEqual([]);
  });
});
`.trim();

const validPackageJson = JSON.stringify({
  scripts: {
    ci: "check-cost-sensitivity",
    "check:cost-sensitivity": "bun run scripts/check-cost-sensitivity.ts",
  },
});

function baseOverrides() {
  const defaults = defaultInputs();
  return {
    ...defaults,
    measurementSource: validSource,
    packageJson: validPackageJson,
  };
}

function rulePresent(problems: Problem[], rule: string): boolean {
  return problems.some((p) => p.rule === rule);
}

describe("حاجزُ حسّاسيّةِ شكلِ التكلفةِ عندَ ١٠x (ECO-008)", () => {
  it("يمرُّ بمدخلاتٍ سليمةٍ", () => {
    const problems = auditCostSensitivity(baseOverrides());
    expect(problems).toEqual([]);
  });

  it("يسقطُ إن غابَ ملفُّ القياسِ", () => {
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: null });
    expect(rulePresent(problems, "guard.measurement-present")).toBe(true);
  });

  it("يسقطُ إن لم يُستورَدِ الحَكَمُ", () => {
    const src = validSource.replace(/from\s+["'`][^"'`]*cost-sensitivity/, 'from "nowhere"');
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.judge-imported")).toBe(true);
  });

  it("يسقطُ إن حُذِفَ رمزُ السقوفِ الحجميّةِ من القياسِ", () => {
    const src = validSource.replaceAll("volumeBudgets", "myOwnBudgets");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.judge-imported")).toBe(true);
  });

  it("يسقطُ إن لم يستورد الحَكَمُ النقيُّ سقوفَ الرحلةِ من مصدرِها الواحدِ", () => {
    const judge = (baseOverrides().judgeSource ?? "").replace(
      'from "./resource-usage-budget.ts"',
      'from "./somewhere-else.ts"',
    );
    const problems = auditCostSensitivity({ ...baseOverrides(), judgeSource: judge });
    expect(rulePresent(problems, "guard.budgets-single-sourced")).toBe(true);
  });

  it("يسقطُ إن حُذِفَ اشتقاقُ سقفٍ من دوالِّ الرحلةِ الواحدةِ", () => {
    const judge = (baseOverrides().judgeSource ?? "").replaceAll(
      "redisCommandBudget",
      "redisBudget2",
    );
    const problems = auditCostSensitivity({ ...baseOverrides(), judgeSource: judge });
    expect(rulePresent(problems, "guard.budgets-single-sourced")).toBe(true);
  });

  it("يسقطُ إن غابَ مصدرُ سقوفِ الرحلةِ الواحدةِ", () => {
    const problems = auditCostSensitivity({ ...baseOverrides(), rideBudgetSource: null });
    expect(rulePresent(problems, "guard.budgets-single-sourced")).toBe(true);
  });

  it("يسقطُ إن حُذِفَ توكيدُ حجمِ النافذةِ", () => {
    const src = validSource.replace(
      "expect(facts.rideCount).toBe(SENSITIVITY_VOLUME_MULTIPLIER);",
      "",
    );
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.volume-measured")).toBe(true);
  });

  it("يسقطُ إن شُغِّلَتِ الرحلاتُ بتزامنٍ — ادّعاءُ حملٍ بلا قياسِ حملٍ", () => {
    const src = validSource.replace(
      "const container = buildContainer(config, { redis: countingRedis });",
      "await Promise.all([buildContainer(config, { redis: countingRedis })]);",
    );
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.sequential-only")).toBe(true);
  });

  it("يسقطُ إن لم تُقرأْ وحدّةُ قياسِ القاعدةِ (`pg_stat_database`)", () => {
    const src = validSource.replaceAll("pg_stat_database", "some_other_view");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.database-measured")).toBe(true);
  });

  it("يسقطُ إن لم تُقرأْ عدّاداتُ الصفوفِ", () => {
    const src = validSource.replaceAll("tup_returned", "colA").replaceAll("tup_fetched", "colB");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.database-measured")).toBe(true);
  });

  it("يسقطُ إن لم يُعَدْ صندوقُ الصادرِ", () => {
    const src = validSource.replaceAll("notification_outbox", "some_table");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.queue-measured")).toBe(true);
  });

  it("يسقطُ إن لم تُعَدْ عروضُ السائقينَ", () => {
    const src = validSource.replaceAll("order_offers", "some_offers");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.queue-offers-measured")).toBe(true);
  });

  it("يسقطُ إن غابَ عدُّ أوامرِ Redis", () => {
    const src = validSource
      .replaceAll("countingRedis", "someClient")
      .replaceAll("redis: ", "client: ")
      .replaceAll("redisCommandsExecuted", "commandsExecuted");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.redis-instrumented")).toBe(true);
  });

  it("يسقطُ إن لم يُقَسْ طولُ الردودِ بالبايت", () => {
    const src = validSource.replace(".encode(await res.text()).byteLength", "");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.network-measured")).toBe(true);
  });

  it("يسقطُ إن لم يُعَدْ إدخالُ صفوفِ التخزينِ", () => {
    const src = validSource
      .replaceAll("inserts", "counts")
      .replace("storageRowsInserted", "rowsWritten");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.storage-measured")).toBe(true);
  });

  it("يسقطُ إن فُرِّغَ توكيدُ الحكمِ", () => {
    const src = validSource.replace("expect(violations).toEqual([]);", "");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.assertion-intact")).toBe(true);
  });

  it("يسقطُ إن لم تُعلِنِ الحقائقُ أنَّ القياسَ جرى", () => {
    const src = validSource.replace("measured: true", "measured: false");
    const problems = auditCostSensitivity({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.assertion-intact")).toBe(true);
  });

  it("يسقطُ إن لم يُوصَلِ الحاجزُ في سلسلةِ `ci`", () => {
    const problems = auditCostSensitivity({
      ...baseOverrides(),
      packageJson: JSON.stringify({ scripts: { ci: "check-something-else" } }),
    });
    expect(rulePresent(problems, "guard.self-enforced")).toBe(true);
  });

  it("يعرِّفُ قواعدَ الحاجزِ المُعلَنةَ كلَّها", () => {
    expect(GUARD_RULE_NAMES.length).toBe(13);
    expect(GUARD_RULE_NAMES).toContain("guard.sequential-only");
    expect(GUARD_RULE_NAMES).toContain("guard.budgets-single-sourced");
  });
});
