/**
 * الغرض: سالبةٌ مبذورةٌ لكلِّ قاعدةٍ في `scripts/check-resource-usage-budget.ts`
 *   (`ح-7`). كلُّ اختبارٍ يُشغِّلُ الحاجزَ عينَه بمدخلاتٍ محقونةٍ تُخالِفُ قاعدةً
 *   واحدةً، فلا تمرَّ سالبةٌ إلّا على الحاجزِ الحقيقيِّ لا على نسخةٍ منه.
 *
 * الحالة: اختبار وحدة — لا قاعدةَ ولا شبكةَ.
 * ينتمي إلى: tests/unit
 * يحرسُه: سلسلةُ `ci` (خطوةٌ مُسمّاةٌ في `verify`).
 */

import { describe, expect, it } from "bun:test";
import {
  auditResourceUsageBudget,
  defaultInputs,
  GUARD_RULE_NAMES,
  type Problem,
} from "../../scripts/check-resource-usage-budget.ts";
import {
  JUDGE_RULE_NAMES,
  RIDE_RESOURCE_PROFILE,
} from "../../scripts/lib/resource-usage-budget.ts";

const validSource = `
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { judgeResourceUsage, RIDE_RESOURCE_PROFILE } from "../../scripts/lib/resource-usage-budget.ts";
import { createSql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("موارد الرحلة", () => {
  it("يعد الموارد على السلك", async () => {
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
      databaseRowsTouched: after[0].tup_returned - before[0].tup_returned + after[0].tup_fetched - before[0].tup_fetched,
      databaseBlocksTouched: after[0].blks_read - before[0].blks_read + after[0].blks_hit - before[0].blks_hit,
      queueMessagesEnqueued: outbox[0].count + offers[0].count,
      redisCommandsExecuted: countingRedis.commandCount,
      networkBytesTransferred: networkBytes,
      storageRowsInserted: inserts[0].count,
      windowMs: RIDE_RESOURCE_PROFILE.windowMs,
    };
    const violations = judgeResourceUsage({ facts, profile: RIDE_RESOURCE_PROFILE, databaseRowsBudget: databaseRowBudget(), databaseBlocksBudget: databaseBlockBudget(), queueMessagesBudget: queueMessageBudget(), redisCommandsBudget: redisCommandBudget(), networkBytesBudget: networkByteBudget(), storageRowsBudget: storageRowBudget() });
    expect(violations).toEqual([]);
  });
});
`.trim();

const validPackageJson = JSON.stringify({
  scripts: {
    ci: "check-resource-usage-budget",
    "check:resource-usage-budget": "bun run scripts/check-resource-usage-budget.ts",
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

describe("حاجزُ مواردِ الرحلةِ (ECO-004)", () => {
  it("يمرُّ بمدخلاتٍ سليمةٍ", () => {
    const problems = auditResourceUsageBudget(baseOverrides());
    expect(problems).toEqual([]);
  });

  it("يسقطُ إن غابَ ملفُّ القياسِ", () => {
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: null });
    expect(rulePresent(problems, "guard.measurement-present")).toBe(true);
  });

  it("يسقطُ إن لم يُستورَدِ الحَكَمُ", () => {
    const src = validSource.replace(/from\s+["'`][^"'`]*resource-usage-budget/, 'from "nowhere"');
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.judge-imported")).toBe(true);
  });

  it("يسقطُ إن لم يُذكرْ `judgeResourceUsage`", () => {
    const src = validSource.replaceAll("judgeResourceUsage", "judgeNothing");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.judge-imported")).toBe(true);
  });

  it("يسقطُ إن لم يُقرأْ `pg_stat_database`", () => {
    const src = validSource.replace(/pg_stat_database/g, "pg_stat_user_tables");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.database-measured")).toBe(true);
  });

  it("يسقطُ إن لم تُقرأْ `tup_returned` أو `tup_fetched`", () => {
    const src = validSource.replaceAll(/tup_returned|tup_fetched/g, "tup_updated");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.database-measured")).toBe(true);
  });

  it("يسقطُ إن لم يُعدَّ `notification_outbox`", () => {
    const src = validSource.replace(/notification_outbox/g, "something_else");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.queue-measured")).toBe(true);
  });

  it("يسقطُ إن لم يُذكرْ `Redis`", () => {
    const src = validSource.replace(/redis|Redis/g, "cache");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.redis-instrumented")).toBe(true);
  });

  it("يسقطُ إن لم يُقَسْ طولُ الردودِ بالبايت", () => {
    const src = validSource.replace(/byteLength|content-length|Content-Length/g, "something");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.network-measured")).toBe(true);
  });

  it("يسقطُ إن لم تُعَدَّ الصفوفُ المُدخَلةُ", () => {
    const src = validSource.replace(/insert|INSERT|storageRowsInserted/g, "something");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.storage-measured")).toBe(true);
  });

  it("يسقطُ إن لم يُوكَّدْ خلوُّ الحكمِ من المخالفاتِ", () => {
    const src = validSource.replace(
      /expect\(\s*violations\s*\)\.toEqual\(\[\]\)/,
      "expect(violations).toBeUndefined()",
    );
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.assertion-intact")).toBe(true);
  });

  it("يسقطُ إن لم تُعلِنِ الحقائقُ `measured: true`", () => {
    const src = validSource.replace("measured: true", "measured: false");
    const problems = auditResourceUsageBudget({ ...baseOverrides(), measurementSource: src });
    expect(rulePresent(problems, "guard.assertion-intact")).toBe(true);
  });

  it("يسقطُ إن كانَ سقفُ الصفوفِ غيرَ صالحٍ", () => {
    const problems = auditResourceUsageBudget({ ...baseOverrides(), databaseRowsBudget: 0 });
    expect(rulePresent(problems, "guard.budget-sane")).toBe(true);
  });

  it("يسقطُ إن كانَ سقفُ الطابورِ سالباً", () => {
    const problems = auditResourceUsageBudget({ ...baseOverrides(), queueMessagesBudget: -1 });
    expect(rulePresent(problems, "guard.budget-sane")).toBe(true);
  });

  it("يسقطُ إن كانَ شكلُ النافذةِ بلا انتقالاتِ حياةٍ", () => {
    const problems = auditResourceUsageBudget({
      ...baseOverrides(),
      profile: { ...RIDE_RESOURCE_PROFILE, lifecycleTransitionCount: 0 },
    });
    expect(rulePresent(problems, "guard.budget-sane")).toBe(true);
  });

  it("يسقطُ إن لم يُوصلِ الحاجزُ في سلسلةِ `ci`", () => {
    const pkg = JSON.stringify({ scripts: { ci: "something-else" } });
    const problems = auditResourceUsageBudget({ ...baseOverrides(), packageJson: pkg });
    expect(rulePresent(problems, "guard.self-enforced")).toBe(true);
  });

  it("يسقطُ إن كانَ عددُ قواعدِ الحَكَمِ صفراً", () => {
    const problems = auditResourceUsageBudget({ ...baseOverrides(), judgeRuleCount: 0 });
    expect(rulePresent(problems, "guard.budget-sane")).toBe(true);
  });

  it("قواعدُ الحاجزِ بعددٍ معلومٍ", () => {
    expect(GUARD_RULE_NAMES.length).toBe(10);
  });

  it("قواعدُ الحَكَمِ بعددٍ معلومٍ", () => {
    expect(JUDGE_RULE_NAMES.length).toBe(9);
  });
});
