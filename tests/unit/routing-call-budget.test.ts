/**
 * الغرض: برهانُ سقوطِ حَكَمِ ميزانِ نداءاتِ التوجيهِ (`ECO-002`): لكلِّ قاعدةٍ
 *   من قواعدِه **سالبةٌ مبذورةٌ** تُسقِطُها وحدَها (`ح-7`)، وسقفُه **مُشتَقٌّ**
 *   من شكلِ النافذةِ فلا يُرفَعُ بلا أن يسقطَ الحَكَمُ.
 * الحالة: منفّذ فعلياً — `ECO-002`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (وظيفةُ `verify`)
 *
 * ## ما لا يُقاسُ ههنا
 *
 * لا نداءَ ولا شبكةَ ولا قاعدةَ: القياسُ الحقيقيُّ في
 * `tests/integration/routing-call-budget.test.ts`. والمقيسُ ههنا **أنَّ الحَكَمَ
 * يحكمُ**: أخضرُ الحَكَمِ على حقائقَ فاسدةٍ عطبٌ أخطرُ من نداءٍ زائدٍ.
 */

import { describe, expect, it } from "bun:test";
import { DEFAULT_ROUTE_CACHE_THRESHOLDS } from "../../packages/application/tracking/route-cache.ts";
import {
  JUDGE_RULE_NAMES,
  type JudgeInputs,
  type JudgeRuleName,
  judgeRoutingCalls,
  maxAllowedBudget,
  RIDE_ROUTING_PROFILE,
  type RoutingCallFacts,
  routingCallBudget,
  summarizeRoutingCalls,
} from "../../scripts/lib/routing-call-budget.ts";

/** الحقائقُ الخضراءُ: هيَ عينُها ما قاسَه اختبارُ التكاملِ على السِلكِ. */
const GREEN: RoutingCallFacts = {
  measured: true,
  heartbeatCount: RIDE_ROUTING_PROFILE.heartbeatCount,
  activeReadCount: RIDE_ROUTING_PROFILE.activeReadCount,
  repeatedReadCount: RIDE_ROUTING_PROFILE.repeatedReadCount,
  callsDuringHeartbeats: 0,
  callsDuringRepeatedReads: 0,
  totalCalls: RIDE_ROUTING_PROFILE.activeReadCount + RIDE_ROUTING_PROFILE.quoteCallCount,
  windowMs: RIDE_ROUTING_PROFILE.windowMs,
  thresholds: {
    minChangeMeters: DEFAULT_ROUTE_CACHE_THRESHOLDS.minChangeMeters,
    ttlSeconds: DEFAULT_ROUTE_CACHE_THRESHOLDS.ttlSeconds,
  },
};

function inputs(overrides: {
  readonly facts?: Partial<RoutingCallFacts>;
  readonly budget?: number;
  readonly profile?: typeof RIDE_ROUTING_PROFILE;
}): JudgeInputs {
  const profile = overrides.profile ?? RIDE_ROUTING_PROFILE;
  return {
    facts: { ...GREEN, ...(overrides.facts ?? {}) },
    profile,
    budget: overrides.budget ?? routingCallBudget(profile),
    declaredThresholds: DEFAULT_ROUTE_CACHE_THRESHOLDS,
  };
}

function rulesOf(judged: readonly { readonly rule: string }[]): readonly string[] {
  return [...new Set(judged.map((violation) => violation.rule))].sort();
}

describe("ECO-002 — سقفُ النداءاتِ مُشتَقٌّ لا مكتوبٌ", () => {
  it("السقفُ = قراءاتُ الراكبِ + نداءُ الاقتباسِ، ويتحرَّكُ بتحرُّكِ الشكلِ", () => {
    expect(routingCallBudget(RIDE_ROUTING_PROFILE)).toBe(
      RIDE_ROUTING_PROFILE.activeReadCount + RIDE_ROUTING_PROFILE.quoteCallCount,
    );
    // شكلٌ بقراءاتٍ أكثرَ يرفعُ السقفَ؛ وترددُ النبضةِ **لا** يرفعُه ألبتّةَ.
    expect(routingCallBudget({ ...RIDE_ROUTING_PROFILE, activeReadCount: 20 })).toBe(21);
    expect(routingCallBudget({ ...RIDE_ROUTING_PROFILE, heartbeatCount: 6_000 })).toBe(
      routingCallBudget(RIDE_ROUTING_PROFILE),
    );
    expect(maxAllowedBudget(RIDE_ROUTING_PROFILE)).toBe(routingCallBudget(RIDE_ROUTING_PROFILE));
  });

  it("النافذةُ عشرُ دقائقَ — محورُ القياسِ نفسُه الذي يقيسُ بياناتِ الجلسةِ", () => {
    expect(RIDE_ROUTING_PROFILE.windowMs).toBe(10 * 60 * 1_000);
  });

  it("الحقائقُ الخضراءُ لا مخالفةَ فيها، والملخَّصُ يُعلِنُ أنَّ العددَ ليسَ تكلفةً", () => {
    expect(judgeRoutingCalls(inputs({}))).toEqual([]);
    const summary = summarizeRoutingCalls(GREEN, routingCallBudget());
    expect(summary).toContain("REQ-09");
  });
});

describe("ECO-002 — لكلِّ قاعدةٍ سالبةٌ مبذورةٌ", () => {
  it("«facts.measured» — قياسٌ لم يجرِ لا يُقرأُ صفرَ نداءاتٍ", () => {
    const judged = judgeRoutingCalls(
      inputs({
        facts: {
          measured: false,
          heartbeatCount: 0,
          activeReadCount: 0,
          repeatedReadCount: 0,
          totalCalls: 0,
        },
        budget: routingCallBudget(),
      }),
    );
    expect(rulesOf(judged)).toContain("facts.measured");
  });

  it("«facts.measured» — قياسٌ بلا مرحلةِ نبضاتٍ يسقطُ ولو قالَ إنَّه قاسَ", () => {
    const judged = judgeRoutingCalls(inputs({ facts: { heartbeatCount: 0 } }));
    expect(rulesOf(judged)).toEqual(["facts.measured"]);
  });

  it("«counts.sane» — عددٌ سالبٌ أو كسريٌّ يُبطِلُ الحُكمَ", () => {
    expect(rulesOf(judgeRoutingCalls(inputs({ facts: { activeReadCount: -1 } })))).toContain(
      "counts.sane",
    );
    expect(rulesOf(judgeRoutingCalls(inputs({ facts: { totalCalls: 8.5 } })))).toContain(
      "counts.sane",
    );
  });

  it("«calls.consistent» — جزءٌ أكبرُ من كُلِّه عدّادٌ معطوبٌ لا نجاحٌ", () => {
    const judged = judgeRoutingCalls(
      inputs({ facts: { callsDuringHeartbeats: 0, callsDuringRepeatedReads: 40, totalCalls: 9 } }),
    );
    expect(rulesOf(judged)).toContain("calls.consistent");
  });

  it("«heartbeat.no-route» — نداءٌ واحدٌ في مرحلةِ النبضاتِ يُسقِطُ الحُكمَ", () => {
    const judged = judgeRoutingCalls(
      inputs({ facts: { callsDuringHeartbeats: 1, totalCalls: 10 } }),
    );
    expect(rulesOf(judged)).toContain("heartbeat.no-route");
  });

  it("«heartbeat.no-route» — نداءٌ لكلِّ نبضةٍ يسقطُ ولو رُفِعَ السقفُ لاستيعابِه", () => {
    const judged = judgeRoutingCalls(
      inputs({
        facts: { callsDuringHeartbeats: 60, totalCalls: 69 },
        budget: 69,
      }),
    );
    // يسقطُ مرّتَينِ: القاعدةُ نفسُها، ورفعُ السقفِ الذي أُريدَ به التليينُ.
    expect(rulesOf(judged)).toEqual(["budget.derived", "heartbeat.no-route"]);
  });

  it("«cache.suppresses-repeats» — قراءةٌ مكرَّرةٌ بلا حركةٍ تُنادي = تخزينٌ لا يعملُ", () => {
    const judged = judgeRoutingCalls(
      inputs({ facts: { callsDuringRepeatedReads: 4, totalCalls: 9 } }),
    );
    expect(rulesOf(judged)).toEqual(["cache.suppresses-repeats"]);
  });

  it("«ride.within-budget» — نداءٌ فوقَ السقفِ يسقطُ", () => {
    const judged = judgeRoutingCalls(inputs({ facts: { totalCalls: 10 } }));
    expect(rulesOf(judged)).toEqual(["ride.within-budget"]);
  });

  it("«budget.derived» — سقفٌ مكتوبٌ بيدٍ يُخالِفُ المُشتَقَّ يسقطُ", () => {
    expect(rulesOf(judgeRoutingCalls(inputs({ budget: 12 })))).toEqual(["budget.derived"]);
    // والأدنى يسقطُ أيضاً: السقفُ عقدٌ لا مزاجٌ — وشدُّه بيدٍ يُخفي الشكلَ.
    expect(rulesOf(judgeRoutingCalls(inputs({ budget: 3 })))).toEqual([
      "budget.derived",
      "ride.within-budget",
    ]);
  });

  it("«thresholds.single-source» — عتبةٌ منسوخةٌ في القياسِ تُسقِطُ الحُكمَ", () => {
    const judged = judgeRoutingCalls(
      inputs({
        facts: {
          thresholds: {
            minChangeMeters: DEFAULT_ROUTE_CACHE_THRESHOLDS.minChangeMeters + 450,
            ttlSeconds: DEFAULT_ROUTE_CACHE_THRESHOLDS.ttlSeconds,
          },
        },
      }),
    );
    expect(rulesOf(judged)).toEqual(["thresholds.single-source"]);
  });

  it("«window.declared» — نافذةٌ أقصرُ تُخفي نمواً فتسقطُ", () => {
    const judged = judgeRoutingCalls(inputs({ facts: { windowMs: 30_000 } }));
    expect(rulesOf(judged)).toEqual(["window.declared"]);
  });

  /**
   * الحاجزُ على الحاجزِ: قاعدةٌ تُضافُ إلى `JUDGE_RULE_NAMES` بلا سالبةٍ مبذورةٍ
   * في هذا الملفِّ تُسقِطُ هذا التأكيدَ — فلا تُزادُ قاعدةٌ بلا برهانِ سقوطٍ.
   */
  it("كلُّ اسمِ قاعدةٍ مُعلَنٍ له سالبةٌ مبذورةٌ ههنا", () => {
    const seeded: readonly JudgeRuleName[] = [
      "facts.measured",
      "counts.sane",
      "calls.consistent",
      "heartbeat.no-route",
      "cache.suppresses-repeats",
      "ride.within-budget",
      "budget.derived",
      "thresholds.single-source",
      "window.declared",
    ];
    expect([...JUDGE_RULE_NAMES].sort()).toEqual([...seeded].sort());
  });
});
