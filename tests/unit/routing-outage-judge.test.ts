/**
 * الغرض: سالباتٌ مبذورةٌ (`ح-7`) لحَكَمِ عطلِ مزوّدِ الخرائطِ
 *   (`scripts/lib/routing-outage.ts`): كلُّ قاعدةٍ تُكسَرُ عمداً فيُرى أنَّها
 *   تُمسِكُ الكسرَ — فخضرةُ اختبارِ التكاملِ لا تكونُ حَكَماً أعمى.
 * الحالة: اختبار وحدة.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0192-routing-outage-is-injected-on-the-wire.md
 */

import { describe, expect, it } from "bun:test";
import {
  judgeOutageRead,
  judgeRecovery,
  OUTAGE_LATENCY_MARGIN_MS,
  OUTAGE_MODES,
  type OutageReadFacts,
  type RideSnapshot,
} from "../../scripts/lib/routing-outage.ts";

const RIDE: RideSnapshot = {
  orderId: "order-1",
  status: "in_progress",
  phase: "TO_DESTINATION",
  driverPresent: true,
  positionShown: true,
};

function honest(overrides: Partial<OutageReadFacts> = {}): OutageReadFacts {
  return {
    mode: "server_error",
    httpStatus: 200,
    before: RIDE,
    during: RIDE,
    storedStatus: "in_progress",
    etaKind: "UNAVAILABLE",
    etaReason: "PROVIDER_DOWN",
    elapsedMs: 150,
    providerBudgetMs: 3_000,
    wireCalls: 2,
    ...overrides,
  };
}

function rules(facts: OutageReadFacts): string[] {
  return judgeOutageRead(facts).map((violation) => violation.rule);
}

describe("judgeOutageRead — الموجبُ", () => {
  it("قراءةٌ صادقةٌ في كلِّ طورٍ لا تُخالِفُ شيئاً", () => {
    for (const mode of OUTAGE_MODES) {
      const wireCalls = mode === "quota_exhausted" || mode === "stopped" ? 0 : 1;
      expect(rules(honest({ mode, wireCalls }))).toEqual([]);
    }
  });

  it("القراءةُ عندَ السقفِ تماماً مقبولةٌ", () => {
    expect(rules(honest({ elapsedMs: 3_000 + OUTAGE_LATENCY_MARGIN_MS }))).toEqual([]);
  });
});

describe("judgeOutageRead — سالباتٌ مبذورةٌ", () => {
  it("outage.http-ok: عطلُ المزوّدِ أسقطَ القراءةَ", () => {
    expect(rules(honest({ httpStatus: 503 }))).toContain("outage.http-ok");
  });

  it("outage.ride-intact: الرحلةُ غابَت من الردِّ", () => {
    expect(rules(honest({ during: null }))).toContain("outage.ride-intact");
  });

  it("outage.ride-intact: الرحلةُ تبدَّلَت (سائقٌ اختفى · موقعٌ أُخفيَ · طورٌ تغيَّرَ)", () => {
    expect(rules(honest({ during: { ...RIDE, driverPresent: false } }))).toContain(
      "outage.ride-intact",
    );
    expect(rules(honest({ during: { ...RIDE, positionShown: false } }))).toContain(
      "outage.ride-intact",
    );
    expect(rules(honest({ during: { ...RIDE, phase: "TO_PICKUP" } }))).toContain(
      "outage.ride-intact",
    );
  });

  it("outage.ride-intact: القراءةُ كتبَت حالةً في القاعدةِ", () => {
    expect(rules(honest({ storedStatus: "cancelled" }))).toContain("outage.ride-intact");
  });

  it("outage.eta-hidden: رقمٌ يُعرَضُ والمزوّدُ معطَّلٌ", () => {
    expect(rules(honest({ etaKind: "ROUTED", etaReason: null }))).toContain("outage.eta-hidden");
  });

  it("outage.eta-hidden: المدّةُ غائبةٌ بلا حكمٍ", () => {
    expect(rules(honest({ etaKind: null, etaReason: null }))).toContain("outage.eta-hidden");
  });

  it("outage.eta-reason: السببُ غيرُ الواقعِ", () => {
    for (const reason of ["NOT_CONFIGURED", "NO_ROUTE", null]) {
      expect(rules(honest({ etaReason: reason }))).toContain("outage.eta-reason");
    }
  });

  it("outage.bounded: تعليقُ المزوّدِ علَّقَ القراءةَ", () => {
    expect(
      rules(honest({ mode: "hanging", elapsedMs: 3_000 + OUTAGE_LATENCY_MARGIN_MS + 1 })),
    ).toContain("outage.bounded");
  });

  it("outage.injected: طورٌ يبلغُ السِلكَ بصفرِ طلباتٍ غيرُ مقيسٍ", () => {
    for (const mode of ["hanging", "server_error", "malformed"] as const) {
      expect(rules(honest({ mode, wireCalls: 0 }))).toContain("outage.injected");
    }
    // رفضُ الاتصالِ لا يبلغُ المعالِجَ: صفرٌ فيه هوَ الحقنُ عينُه.
    expect(rules(honest({ mode: "stopped", wireCalls: 0 }))).not.toContain("outage.injected");
  });

  it("outage.quota-no-wire: الحصّةُ مستنفَدةٌ وطلبٌ وصلَ المزوّدَ", () => {
    expect(rules(honest({ mode: "quota_exhausted", wireCalls: 1 }))).toContain(
      "outage.quota-no-wire",
    );
  });
});

describe("judgeRecovery", () => {
  it("الموجبُ: المدّةُ عادَت من السِلكِ", () => {
    expect(judgeRecovery({ httpStatus: 200, etaKind: "ROUTED", wireCalls: 1 })).toEqual([]);
  });

  it("recovery.eta-returns: الفشلُ بقيَ بعدَ عودةِ المزوّدِ", () => {
    const found = judgeRecovery({ httpStatus: 200, etaKind: "UNAVAILABLE", wireCalls: 1 });
    expect(found.map((v) => v.rule)).toEqual(["recovery.eta-returns"]);
  });

  it("recovery.from-wire: المدّةُ عادَت بلا طلبٍ — من مخزنٍ لا من المزوّدِ", () => {
    const found = judgeRecovery({ httpStatus: 200, etaKind: "ROUTED", wireCalls: 0 });
    expect(found.map((v) => v.rule)).toEqual(["recovery.from-wire"]);
  });
});
