/**
 * # سوالبُ الحاجزِ الساكنِ لحدِّ بياناتِ الجلسةِ — `F1-09` (`ح-7`)
 *
 * كلُّ قاعدةٍ في `GUARD_RULE_NAMES` لها سالبةٌ مبذورةٌ تُثبِتُ سقوطَها، والسوالبُ
 * تُشغِّلُ **الحاجزَ عينَه** بحقنِ مدخلاتِه لا بإعادةِ بناءِ منطقِه في اختبارٍ —
 * فاختبارٌ يُعيدُ المنطقَ يبرهنُ على نفسِه لا على الحاجزِ.
 *
 * وحالةُ القرصِ الحقيقيّةُ تُفحَصُ مرّةً: `defaultInputs()` على المستودعِ كما هوَ
 * يجبُ أن تكونَ خضراءَ — وإلّا فالحاجزُ يُدقِّقُ ملفاتٍ غيرَ موجودةٍ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type AuditInputs,
  auditSessionDataBudget,
  defaultInputs,
  GUARD_RULE_NAMES,
} from "../../scripts/check-session-data-budget.ts";

/** أسماءُ القواعدِ المخروقةِ — مرتَّبةً لا مكرَّرةً. */
function rules(overrides: Partial<AuditInputs>): string[] {
  return [...new Set(auditSessionDataBudget(overrides).map((problem) => problem.rule))].sort();
}

/** نصُّ ملفِّ قياسٍ سليمٍ مُصطنَعٍ — منه تُشتَقُّ السوالبُ بحذفِ سطرٍ أو إضافتِه. */
function validTestSource(): string {
  return [
    `import { SESSION_DATA_BUDGET_BYTES, judgeSessionData } from "../../scripts/lib/session-data-budget.ts";`,
    `import { DEFAULT_RELAY_MIN_INTERVAL_MS } from "../../packages/application/tracking/customer-live-relay.ts";`,
    `import { BUDGET } from "../../scripts/lib/performance-budget.ts";`,
    `expect(verdict.totalBytes).toBeGreaterThan(0);`,
    `expect(verdict.violations).toEqual([]);`,
    `expect(verdict.totalBytes).toBeLessThanOrEqual(SESSION_DATA_BUDGET_BYTES);`,
  ].join("\n");
}

/** مدخلاتٌ سليمةٌ مُصطنَعةٌ بالكاملِ — لا قرصَ فيها، فالسالبةُ معزولةٌ. */
function healthyInputs(overrides: Partial<AuditInputs> = {}): Partial<AuditInputs> {
  return {
    testSource: validTestSource(),
    contract: "| استهلاك بيانات جلسة راكب 10 دقائق | ≤ 1.5 MB |",
    packageJson: `{"scripts":{"ci":"bun scripts/check-system-screens-policy.ts"}}`,
    budgetBytes: 1_572_864,
    windowMs: 600_000,
    judgeRuleCount: 7,
    eagerGzipBytes: 184_320,
    profile: [{ label: "GET /v1/me", callsInWindow: 1, reason: "أوّلُ نداءٍ بعدَ الجلسةِ" }],
    ...overrides,
  };
}

describe("check-session-data-budget — حاجزُ حدِّ بياناتِ جلسةِ الراكبِ", () => {
  it("القواعدُ كلُّها مبذورةٌ — لا تُضافُ قاعدةٌ بلا سالبةٍ", () => {
    const source = readFileSync(import.meta.path, "utf8");
    for (const rule of GUARD_RULE_NAMES) {
      expect(source).toContain(rule);
    }
  });

  it("الموجبةُ الحقيقيّةُ: المستودعُ كما هوَ أخضرُ على القرصِ", () => {
    expect(auditSessionDataBudget()).toEqual([]);
    const inputs = defaultInputs();
    expect(inputs.testSource).not.toBeNull();
    expect(inputs.contract).not.toBeNull();
    expect(inputs.packageJson).not.toBeNull();
  });

  it("الموجبةُ المُصطنَعةُ: مدخلاتٌ سليمةٌ تمرُّ بلا مخالفةٍ", () => {
    expect(auditSessionDataBudget(healthyInputs())).toEqual([]);
  });

  it("`guard.test-present` — غيابُ ملفِّ القياسِ يُنهي الفحصَ بمخالفةٍ واحدةٍ", () => {
    const problems = auditSessionDataBudget(healthyInputs({ testSource: null }));
    expect(problems.map((problem) => problem.rule)).toEqual(["guard.test-present"]);
  });

  it("`guard.imported` — قياسٌ لا يستوردُ حدَّه من مصدرِه الواحدِ", () => {
    const source = validTestSource().replace("../../scripts/lib/session-data-budget.ts", "./x.ts");
    expect(rules(healthyInputs({ testSource: source }))).toContain("guard.imported");
  });

  it("`guard.budget-asserted` — قياسٌ لا يذكرُ الحدَّ ولا الحكمَ", () => {
    const source = validTestSource()
      .replaceAll("SESSION_DATA_BUDGET_BYTES", "X")
      .replaceAll("judgeSessionData", "Y");
    expect(rules(healthyInputs({ testSource: source }))).toContain("guard.budget-asserted");
  });

  it("`guard.single-source` — قيمةُ الحدِّ مكتوبةٌ في القياسِ (بالفاصلِ أو بدونِه)", () => {
    expect(
      rules(healthyInputs({ testSource: `${validTestSource()}\nconst b = 1572864;` })),
    ).toContain("guard.single-source");
    expect(
      rules(healthyInputs({ testSource: `${validTestSource()}\nconst b = 1_572_864;` })),
    ).toContain("guard.single-source");
  });

  it("`guard.contract-row` — صفُّ العقدِ غائبٌ أو بلا رقمٍ أو مخالفٌ للمُنفَّذِ", () => {
    expect(rules(healthyInputs({ contract: null }))).toContain("guard.contract-row");
    expect(rules(healthyInputs({ contract: "| لا شيءَ | ≤ 1.5 MB |" }))).toContain(
      "guard.contract-row",
    );
    expect(
      rules(healthyInputs({ contract: "| استهلاك بيانات جلسة راكب 10 دقائق | معقولٌ |" })),
    ).toContain("guard.contract-row");
    expect(
      rules(healthyInputs({ contract: "| استهلاك بيانات جلسة راكب 10 دقائق | ≤ 3 MB |" })),
    ).toContain("guard.contract-row");
  });

  it("`guard.relay-imported` — مهلةُ المُرحِّلِ مكتوبةٌ رقماً لا مستوردةً", () => {
    const noSymbol = validTestSource().replaceAll("DEFAULT_RELAY_MIN_INTERVAL_MS", "5_000");
    expect(rules(healthyInputs({ testSource: noSymbol }))).toContain("guard.relay-imported");
    const noImport = validTestSource().replace("customer-live-relay.ts", "elsewhere.ts");
    expect(rules(healthyInputs({ testSource: noImport }))).toContain("guard.relay-imported");
  });

  it("`guard.first-load-imported` — سقفُ الحملِ الأوّلِ مكتوبٌ رقماً أو غيرُ مستوردٍ", () => {
    const noImport = validTestSource().replace("performance-budget.ts", "elsewhere.ts");
    expect(rules(healthyInputs({ testSource: noImport }))).toContain("guard.first-load-imported");
    expect(
      rules(healthyInputs({ testSource: `${validTestSource()}\nconst f = 184320;` })),
    ).toContain("guard.first-load-imported");
    expect(
      rules(healthyInputs({ testSource: `${validTestSource()}\nconst f = 180 * KB;` })),
    ).toContain("guard.first-load-imported");
  });

  it("`guard.facts-asserted` — لا توكيدَ على حقائقَ غيرِ فارغةٍ ولا على خلوِّ المخالفاتِ", () => {
    const source = validTestSource()
      .replace("expect(verdict.totalBytes).toBeGreaterThan(0);", "")
      .replace("expect(verdict.violations).toEqual([]);", "");
    expect(rules(healthyInputs({ testSource: source }))).toContain("guard.facts-asserted");
  });

  it("`guard.no-polling-guard` — زوالُ حاجزِ منعِ الاستقصاءِ يُبطِلُ سندَ عددِ النداءاتِ", () => {
    expect(rules(healthyInputs({ packageJson: `{"scripts":{"ci":"bun run test"}}` }))).toContain(
      "guard.no-polling-guard",
    );
    expect(rules(healthyInputs({ packageJson: null }))).toContain("guard.no-polling-guard");
  });

  it("`guard.budget-sane` — حدٌّ صفرٌ أو سالبٌ أو غيرُ منتهٍ، ونافذةٌ باطلةٌ، وحكمٌ بلا قاعدةٍ", () => {
    for (const budgetBytes of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(rules(healthyInputs({ budgetBytes }))).toContain("guard.budget-sane");
    }
    expect(rules(healthyInputs({ windowMs: 0 }))).toContain("guard.budget-sane");
    expect(rules(healthyInputs({ judgeRuleCount: 0 }))).toContain("guard.budget-sane");
  });

  it("`guard.profile-reasoned` — شكلٌ فارغٌ، أو نداءٌ بعددٍ باطلٍ، أو نداءٌ بلا سببٍ", () => {
    expect(rules(healthyInputs({ profile: [] }))).toContain("guard.profile-reasoned");
    expect(
      rules(healthyInputs({ profile: [{ label: "GET /v1/me", callsInWindow: 0, reason: "سببٌ" }] })),
    ).toContain("guard.profile-reasoned");
    expect(
      rules(
        healthyInputs({ profile: [{ label: "GET /v1/me", callsInWindow: 1.5, reason: "سببٌ" }] }),
      ),
    ).toContain("guard.profile-reasoned");
    expect(
      rules(healthyInputs({ profile: [{ label: "GET /v1/me", callsInWindow: 1, reason: "   " }] })),
    ).toContain("guard.profile-reasoned");
  });
});
