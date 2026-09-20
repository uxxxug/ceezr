/**
 * الغرض: برهانُ سقوطِ حاجزِ عدِّ نداءاتِ التوجيهِ (`ECO-002`): لكلِّ قاعدةٍ من
 *   قواعدِه **سالبةٌ مبذورةٌ** تُشغِّلُ **الحاجزَ عينَه** — لا نسخةً من منطقِه
 *   ههنا (`ح-7`). والمدخلاتُ محقونةٌ فلا قرصَ في المسارِ المقيسِ.
 * الحالة: منفّذ فعلياً — `ECO-002`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (وظيفةُ `verify`)
 *
 * ## ما لا يُقاسُ ههنا
 *
 * لا يُقاسُ أنَّ الرحلةَ ضمنَ السقفِ: ذاكَ عدٌّ على السِلكِ في
 * `tests/integration/routing-call-budget.test.ts`. والمقيسُ **أنَّ الحاجزَ
 * يحجزُ**: حاجزٌ أخضرُ على ملفِّ قياسٍ مفرَّغٍ أسوأُ من غيابِه.
 */

import { describe, expect, it } from "bun:test";
import {
  type AuditInputs,
  auditRoutingCallBudget,
  defaultInputs,
  GUARD_RULE_NAMES,
  type GuardRuleName,
} from "../../scripts/check-routing-call-budget.ts";

/** المدخلاتُ الحقيقيّةُ من القرصِ: هيَ عينُها ما تقرؤُه سلسلةُ `ci`. */
const REAL = defaultInputs();

function rulesOf(problems: readonly { readonly rule: GuardRuleName }[]): readonly GuardRuleName[] {
  return [...new Set(problems.map((problem) => problem.rule))].sort();
}

function audit(overrides: Partial<AuditInputs>): readonly GuardRuleName[] {
  return rulesOf(auditRoutingCallBudget(overrides));
}

describe("ECO-002 — الحاجزُ أخضرُ على المستودَعِ كما هوَ", () => {
  it("لا مخالفةَ في الحالِ الراهنِ — وإلّا فالسلسلةُ مخروقةٌ الآنَ", () => {
    expect(auditRoutingCallBudget()).toEqual([]);
  });

  it("المدخلاتُ الحقيقيّةُ غيرُ فارغةٍ: حاجزٌ يقرأُ `null` يمرُّ بلا فحصٍ", () => {
    expect(REAL.measurementSource).not.toBeNull();
    expect(REAL.packageJson).not.toBeNull();
    expect(REAL.judgeRuleCount).toBeGreaterThan(0);
  });
});

describe("ECO-002 — لكلِّ قاعدةِ حاجزٍ سالبةٌ مبذورةٌ", () => {
  it("«guard.measurement-present» — ملفُّ القياسِ محذوفٌ", () => {
    expect(audit({ measurementSource: null })).toEqual(["guard.measurement-present"]);
  });

  it("«guard.judge-imported» — قياسٌ يبني حَكَمَه بيدِه", () => {
    const source = (REAL.measurementSource ?? "")
      .replace(/judgeRoutingCalls/g, "myOwnJudge")
      .replace(/routing-call-budget/g, "routing-call-budget-copy");
    expect(audit({ measurementSource: source })).toContain("guard.judge-imported");
  });

  it("«guard.wire-counted» — عدٌّ بلا خادمٍ يُصغي", () => {
    const source = (REAL.measurementSource ?? "")
      .replace(/Bun\.serve\(/g, "fakeProvider(")
      .replace(/calls \+= 1/g, "");
    expect(audit({ measurementSource: source })).toContain("guard.wire-counted");
  });

  it("«guard.container-wired» — مزوّدٌ مبنيٌّ باليدِ لا من الحاويةِ", () => {
    const source = (REAL.measurementSource ?? "").replace(/buildContainer/g, "handRolledProvider");
    expect(audit({ measurementSource: source })).toContain("guard.container-wired");
  });

  it("«guard.phases-measured» — مرحلةُ النبضاتِ محذوفةٌ من القياسِ", () => {
    const source = (REAL.measurementSource ?? "").replace(/\/v1\/driver\/location/g, "/v1/me");
    expect(audit({ measurementSource: source })).toContain("guard.phases-measured");
  });

  it("«guard.assertion-intact» — تأكيدٌ مفرَّغٌ", () => {
    const source = (REAL.measurementSource ?? "").replace(
      /expect\(violations\)\.toEqual\(\[\]\)/g,
      "console.log(violations)",
    );
    expect(audit({ measurementSource: source })).toContain("guard.assertion-intact");
  });

  it("«guard.thresholds-imported» — عتبةٌ منسوخةٌ رقماً في ملفِّ القياسِ", () => {
    const source = `${REAL.measurementSource ?? ""}\nconst copied = { minChangeMeters: ${String(
      REAL.thresholds.minChangeMeters,
    )} };\n`;
    expect(audit({ measurementSource: source })).toContain("guard.thresholds-imported");
  });

  it("«guard.cache-policy-guard» — سندُ التخزينِ مُنتَزَعٌ من السلسلةِ", () => {
    const pkg = (REAL.packageJson ?? "").replace(/check-route-cache-policy/g, "check-nothing");
    expect(audit({ packageJson: pkg })).toContain("guard.cache-policy-guard");
  });

  it("«guard.self-enforced» — الحاجزُ نفسُه مُنتَزَعٌ من سلسلةِ `ci`", () => {
    const pkg = (REAL.packageJson ?? "").replace(/check-routing-call-budget/g, "check-nothing");
    expect(audit({ packageJson: pkg })).toContain("guard.self-enforced");
  });

  it("«guard.budget-sane» — سقفٌ أو شكلٌ أو مدّةُ صلاحيّةٍ بلا معنىً", () => {
    expect(audit({ budget: 0 })).toContain("guard.budget-sane");
    expect(audit({ budget: 99, ceiling: 9 })).toContain("guard.budget-sane");
    expect(audit({ judgeRuleCount: 0 })).toContain("guard.budget-sane");
    expect(audit({ profile: { ...REAL.profile, heartbeatCount: 0 } })).toContain(
      "guard.budget-sane",
    );
    expect(audit({ thresholds: { ...REAL.thresholds, ttlSeconds: 0 } })).toContain(
      "guard.budget-sane",
    );
  });

  /**
   * الحاجزُ على الحاجزِ: قاعدةٌ تُضافُ بلا سالبةٍ مبذورةٍ ههنا تُسقِطُ هذا
   * التأكيدَ — فلا تُزادُ قاعدةٌ بلا برهانِ سقوطٍ.
   */
  it("كلُّ اسمِ قاعدةِ حاجزٍ مُعلَنٍ له سالبةٌ مبذورةٌ ههنا", () => {
    const seeded: readonly GuardRuleName[] = [
      "guard.measurement-present",
      "guard.judge-imported",
      "guard.wire-counted",
      "guard.container-wired",
      "guard.phases-measured",
      "guard.assertion-intact",
      "guard.thresholds-imported",
      "guard.cache-policy-guard",
      "guard.self-enforced",
      "guard.budget-sane",
    ];
    expect([...GUARD_RULE_NAMES].sort()).toEqual([...seeded].sort());
  });
});
