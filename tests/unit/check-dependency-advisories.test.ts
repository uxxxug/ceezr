/**
 * الغرض: برهانُ سقوطِ **حاجزِ** نشراتِ الثغراتِ قاعدةً قاعدةً (`ح-7`)، مُشغَّلاً
 *   على الحاجزِ عينِه بمدخلاتٍ محقونةٍ — لا على نسخةٍ منهُ تُعيدُ منطقَه.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-20 (`SEC-15`).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0150
 *
 * ولا شبكةَ ههنا: الحقائقُ مبذورةٌ، و`measureAudit` تُشغَّلُ في CI لا في حزمةِ
 * الوحدةِ — فاختبارٌ يطلبُ شبكةً يسقطُ بانقطاعِها فيُقرأُ عيباً في الكودِ.
 */

import { describe, expect, it } from "bun:test";

import {
  auditDependencyAdvisories,
  GUARD_RULE_NAMES,
  GUARD_SCRIPT_PATH,
  type GuardInputs,
  staticInputs,
} from "../../scripts/check-dependency-advisories.ts";

const NOW = new Date("2026-09-20T00:00:00.000Z");

const inputs = (overrides: Partial<GuardInputs> = {}): GuardInputs => ({
  ciChain: `bun run lint && bun run ${GUARD_SCRIPT_PATH} && bun run test`,
  dependabotText: "updates:\n  - package-ecosystem: npm\n    directory: /\n",
  facts: { measured: true, advisories: [], failure: null },
  now: NOW,
  ...overrides,
});

const rules = (violations: readonly { rule: string }[]) => violations.map((v) => v.rule);

describe("حاجزُ نشراتِ الثغراتِ — الطرفُ الموجَبُ على القرصِ الحقيقيِّ", () => {
  it("سلسلةُ ci الحقيقيّةُ تحملُ الحاجزَ، وdependabot الحقيقيُّ يُغطّي npm", () => {
    const disk = staticInputs();
    const violations = auditDependencyAdvisories({
      ...disk,
      facts: { measured: true, advisories: [], failure: null },
      now: NOW,
    });
    expect(violations).toEqual([]);
    expect(disk.ciChain).toContain(GUARD_SCRIPT_PATH);
    expect(disk.dependabotText).not.toBeNull();
  });
});

describe("حاجزُ نشراتِ الثغراتِ — سالبةٌ مبذورةٌ لكلِّ قاعدةٍ (ح-7)", () => {
  it("chain.guard-in-ci — نزعُ الحاجزِ من السلسلةِ يُسقِطُ البناءَ", () => {
    const violations = auditDependencyAdvisories(
      inputs({ ciChain: "bun run lint && bun run test" }),
    );
    expect(rules(violations)).toContain("chain.guard-in-ci");
  });

  it("chain.dependabot-present — حذفُ مُحدِّثِ النُسَخِ يُبقي الكشفَ بلا علاجٍ", () => {
    const violations = auditDependencyAdvisories(inputs({ dependabotText: null }));
    expect(rules(violations)).toContain("chain.dependabot-present");
  });

  it("chain.dependabot-covers-npm — تهيئةٌ بلا مُعجَمِ npm لا تُغطّي المقيسَ", () => {
    const violations = auditDependencyAdvisories(
      inputs({ dependabotText: "updates:\n  - package-ecosystem: docker\n" }),
    );
    expect(rules(violations)).toContain("chain.dependabot-covers-npm");
  });

  it("الحاجزُ يُمرِّرُ حُكمَ النشراتِ ولا يُخفيهِ: نشرةٌ عندَ الحدِّ تصلُ إلى المُخرَجِ", () => {
    const violations = auditDependencyAdvisories(
      inputs({
        facts: {
          measured: true,
          advisories: [
            {
              package: "hono",
              id: 1193730,
              title: "parseBody memory exhaustion",
              url: "https://github.com/advisories/GHSA-g6gw-c38x-mqfc",
              severity: "moderate",
              vulnerableVersions: "<4.13.5",
            },
          ],
          failure: null,
        },
      }),
    );
    expect(rules(violations)).toContain("audit.no-unacknowledged");
  });

  it("الحاجزُ يسقطُ مغلقاً متى تعذَّرَ القياسُ", () => {
    const violations = auditDependencyAdvisories(
      inputs({ facts: { measured: false, advisories: [], failure: "لا شبكةَ" } }),
    );
    expect(rules(violations)).toContain("audit.measured");
  });

  it("كلُّ قاعدةٍ في مُعجَمِ الحاجزِ لها سالبةٌ في هذهِ الحزمةِ", () => {
    expect([...GUARD_RULE_NAMES].sort()).toEqual(
      (
        [
          "chain.dependabot-covers-npm",
          "chain.dependabot-present",
          "chain.guard-in-ci",
        ] as (typeof GUARD_RULE_NAMES)[number][]
      ).sort(),
    );
  });
});
