/**
 * الغرض: سالباتٌ مبذورةٌ (`ح-7`) لحَكَمِ عطلِ مزوّدِ الدفعِ
 *   (`scripts/lib/payment-outage.ts`): كلُّ قاعدةٍ تُكسَرُ عمداً فيُرى أنَّها
 *   تُمسِكُ الكسرَ — فخضرةُ اختبارِ التكاملِ لا تكونُ حَكَماً أعمى.
 * الحالة: اختبار وحدة.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0200-payment-provider-outage-is-pending-recoverable.md
 */

import { describe, expect, it } from "bun:test";
import {
  type ChargeOutageFacts,
  type ChargeRecoveryFacts,
  judgeChargeOutage,
  judgeChargeRecovery,
  judgeReconcileOutage,
  judgeSettlement,
  judgeWebhookOutage,
  OUTAGE_MODES,
  type ReconcileOutageFacts,
  type SettlementFacts,
  type WebhookOutageFacts,
} from "../../scripts/lib/payment-outage.ts";

function honestCharge(overrides: Partial<ChargeOutageFacts> = {}): ChargeOutageFacts {
  return {
    mode: "server_error",
    rejected: true,
    rowStatus: "pending",
    providerReference: null,
    ledgerEntries: 0,
    subscriptionActive: false,
    wireCalls: 1,
    ...overrides,
  };
}

function honestRecovery(overrides: Partial<ChargeRecoveryFacts> = {}): ChargeRecoveryFacts {
  return {
    checkoutUrl: "https://tap.local/pay/chg_1",
    secondChargeStarted: true,
    rowsForKey: 1,
    rowStatus: "pending",
    providerReference: "chg_1",
    ledgerEntries: 0,
    subscriptionActive: false,
    ...overrides,
  };
}

function honestReconcile(overrides: Partial<ReconcileOutageFacts> = {}): ReconcileOutageFacts {
  return {
    mode: "server_error",
    examined: 2,
    failed: 2,
    settled: 0,
    rowStatus: "pending",
    ledgerEntries: 0,
    subscriptionActive: false,
    wireCalls: 2,
    ...overrides,
  };
}

function honestSettlement(overrides: Partial<SettlementFacts> = {}): SettlementFacts {
  return {
    rowSettledFirstRound: 1,
    secondRoundSettled: 0,
    rowStillStaleAfterSettlement: false,
    rowStatus: "active",
    ledgerEntries: 1,
    subscriptionActiveCount: 1,
    ...overrides,
  };
}

function honestWebhook(overrides: Partial<WebhookOutageFacts> = {}): WebhookOutageFacts {
  return {
    mode: "malformed",
    httpStatus: 503,
    rowStatus: "pending",
    ledgerEntries: 0,
    subscriptionActive: false,
    webhookEventsStored: 0,
    ...overrides,
  };
}

function chargeRules(facts: ChargeOutageFacts): string[] {
  return judgeChargeOutage(facts).map((violation) => violation.rule);
}

function recoveryRules(facts: ChargeRecoveryFacts): string[] {
  return judgeChargeRecovery(facts).map((violation) => violation.rule);
}

function reconcileRules(facts: ReconcileOutageFacts): string[] {
  return judgeReconcileOutage(facts).map((violation) => violation.rule);
}

describe("judgeChargeOutage — الموجبُ والسالباتُ", () => {
  it("شحنةٌ فاشلةٌ صادقةٌ في كلِّ طورٍ لا تُخالِفُ شيئاً", () => {
    for (const mode of OUTAGE_MODES) {
      expect(chargeRules(honestCharge({ mode, wireCalls: mode === "stopped" ? 0 : 1 }))).toEqual(
        [],
      );
    }
  });

  it("charge.outage-honest: العطلُ ردَّ بنجاحٍ لا رابطَ فيهِ", () => {
    expect(chargeRules(honestCharge({ rejected: false }))).toContain("charge.outage-honest");
  });

  it("charge.row-pending: العطلُ أغلقَ الصفَّ أو فعَّلَه", () => {
    expect(chargeRules(honestCharge({ rowStatus: "failed" }))).toContain("charge.row-pending");
    expect(chargeRules(honestCharge({ rowStatus: "active" }))).toContain("charge.row-pending");
  });

  it("charge.no-provider-reference: مرجعٌ مُختلَقٌ لشحنةٍ لم تبدأْ", () => {
    expect(chargeRules(honestCharge({ providerReference: "chg_ghost" }))).toContain(
      "charge.no-provider-reference",
    );
  });

  it("charge.no-ledger: قيدٌ ماليٌّ بلا دفعٍ", () => {
    expect(chargeRules(honestCharge({ ledgerEntries: 1 }))).toContain("charge.no-ledger");
  });

  it("charge.no-activation: اشتراكٌ فعّالٌ بشحنةٍ فاشلةٍ", () => {
    expect(chargeRules(honestCharge({ subscriptionActive: true }))).toContain(
      "charge.no-activation",
    );
  });

  it("charge.outage-injected: طورٌ يصلُ السِلكَ بلا طلباتٍ لم يُحقَنْ", () => {
    expect(chargeRules(honestCharge({ mode: "server_error", wireCalls: 0 }))).toContain(
      "charge.outage-injected",
    );
    // و«stopped» مستثنىً: رفضُ الاتصالِ لا يبلغُ المعالِجَ أصلاً.
    expect(chargeRules(honestCharge({ mode: "stopped", wireCalls: 0 }))).not.toContain(
      "charge.outage-injected",
    );
  });
});

describe("judgeChargeRecovery — الموجبُ والسالباتُ", () => {
  it("استعادةٌ كاملةٌ لا تُخالِفُ شيئاً", () => {
    expect(recoveryRules(honestRecovery())).toEqual([]);
  });

  it("recovery.checkout-url: المحاولةُ الثانيةُ ردَّت برابطٍ null — سجنُ `D-38`", () => {
    expect(recoveryRules(honestRecovery({ checkoutUrl: null }))).toContain("recovery.checkout-url");
    expect(recoveryRules(honestRecovery({ checkoutUrl: "" }))).toContain("recovery.checkout-url");
  });

  it("recovery.charge-restarted: «استعادةٌ» بلا شحنةٍ جديدةٍ — نجاحٌ كاذبٌ", () => {
    expect(recoveryRules(honestRecovery({ secondChargeStarted: false }))).toContain(
      "recovery.charge-restarted",
    );
  });

  it("recovery.single-row: إعادةُ المحاولةِ أنشأَت صفًّا ثانياً", () => {
    expect(recoveryRules(honestRecovery({ rowsForKey: 2 }))).toContain("recovery.single-row");
  });

  it("recovery.row-pending: الصفُّ بعدَ الاستئنافِ ليسَ معلَّقاً", () => {
    expect(recoveryRules(honestRecovery({ rowStatus: "failed" }))).toContain(
      "recovery.row-pending",
    );
  });

  it("recovery.reference-recorded: شحنةٌ بلا مرجعٍ محفوظٍ — دفعةٌ لا تُراجَع", () => {
    expect(recoveryRules(honestRecovery({ providerReference: null }))).toContain(
      "recovery.reference-recorded",
    );
  });

  it("recovery.no-ledger وrecovery.no-activation: أثرٌ ماليٌّ قبلَ الدفعِ", () => {
    expect(recoveryRules(honestRecovery({ ledgerEntries: 1 }))).toContain("recovery.no-ledger");
    expect(recoveryRules(honestRecovery({ subscriptionActive: true }))).toContain(
      "recovery.no-activation",
    );
  });
});

describe("judgeReconcileOutage — الموجبُ والسالباتُ", () => {
  it("مراجعةٌ صادقةٌ أثناءَ العطلِ لا تُخالِفُ شيئاً", () => {
    expect(reconcileRules(honestReconcile())).toEqual([]);
  });

  it("reconcile.examined: القياسُ أعمى — لم يُرشَّحْ صفٌّ", () => {
    expect(reconcileRules(honestReconcile({ examined: 0, failed: 0 }))).toContain(
      "reconcile.examined",
    );
  });

  it("reconcile.no-settlement: حسمٌ أثناءَ العطلِ — مالٌ من عدمٍ", () => {
    expect(reconcileRules(honestReconcile({ settled: 1 }))).toContain("reconcile.no-settlement");
  });

  it("reconcile.failure-honest: العطلُ يُكتَمُ في عدّادٍ", () => {
    expect(reconcileRules(honestReconcile({ failed: 1, examined: 2 }))).toContain(
      "reconcile.failure-honest",
    );
  });

  it("reconcile.row-stays-pending وreconcile.no-ledger وreconcile.no-activation", () => {
    expect(reconcileRules(honestReconcile({ rowStatus: "failed" }))).toContain(
      "reconcile.row-stays-pending",
    );
    expect(reconcileRules(honestReconcile({ ledgerEntries: 1 }))).toContain("reconcile.no-ledger");
    expect(reconcileRules(honestReconcile({ subscriptionActive: true }))).toContain(
      "reconcile.no-activation",
    );
  });

  it("reconcile.outage-injected: صفرُ قراءاتٍ في طورٍ يبلغُ السِلكَ", () => {
    expect(reconcileRules(honestReconcile({ wireCalls: 0 }))).toContain(
      "reconcile.outage-injected",
    );
    expect(reconcileRules(honestReconcile({ mode: "stopped", wireCalls: 0 }))).not.toContain(
      "reconcile.outage-injected",
    );
  });
});

describe("judgeSettlement — الموجبُ والسالباتُ", () => {
  it("تسويةٌ واحدةٌ كاملةٌ لا تُخالِفُ شيئاً", () => {
    expect(judgeSettlement(honestSettlement())).toEqual([]);
  });

  it("settlement.settled-once: الجولةُ الأولىُ لم تحسِمْ", () => {
    expect(
      judgeSettlement(
        honestSettlement({ rowSettledFirstRound: 0, rowStatus: "pending", ledgerEntries: 0 }),
      ).map((v) => v.rule),
    ).toContain("settlement.settled-once");
  });

  it("settlement.second-idempotent: الجولةُ الثانيةُ حسمَتْ من جديدٍ", () => {
    expect(
      judgeSettlement(honestSettlement({ secondRoundSettled: 1 })).map((v) => v.rule),
    ).toContain("settlement.second-idempotent");
  });

  it("settlement.row-closed: الصفُّ المحسومُ ما زال يُرشَّحُ للمراجعةِ", () => {
    expect(
      judgeSettlement(honestSettlement({ rowStillStaleAfterSettlement: true })).map((v) => v.rule),
    ).toContain("settlement.row-closed");
  });

  it("settlement.row-active: الحالةُ النهائيّةُ ليستْ active", () => {
    expect(
      judgeSettlement(honestSettlement({ rowStatus: "pending" })).map((v) => v.rule),
    ).toContain("settlement.row-active");
  });

  it("settlement.ledger-once: قيدانِ أو لا قيدَ", () => {
    expect(judgeSettlement(honestSettlement({ ledgerEntries: 2 })).map((v) => v.rule)).toContain(
      "settlement.ledger-once",
    );
    expect(judgeSettlement(honestSettlement({ ledgerEntries: 0 })).map((v) => v.rule)).toContain(
      "settlement.ledger-once",
    );
  });

  it("settlement.subscription-once: اشتراكانِ فعّالانِ لدفعٍ واحدٍ", () => {
    expect(
      judgeSettlement(honestSettlement({ subscriptionActiveCount: 2 })).map((v) => v.rule),
    ).toContain("settlement.subscription-once");
  });
});

describe("judgeWebhookOutage — الموجبُ والسالباتُ", () => {
  it("ويبهوكٌ صادقٌ لا يُخالِفُ شيئاً", () => {
    expect(judgeWebhookOutage(honestWebhook())).toEqual([]);
  });

  it("webhook.503: ردَّ بغيرِ 503 فلا يعيدُ المزوّدُ الإرسالَ", () => {
    expect(judgeWebhookOutage(honestWebhook({ httpStatus: 200 })).map((v) => v.rule)).toContain(
      "webhook.503",
    );
    expect(judgeWebhookOutage(honestWebhook({ httpStatus: 409 })).map((v) => v.rule)).toContain(
      "webhook.503",
    );
  });

  it("webhook.row-stays-pending: الويبهوكُ الفاشلُ أغلقَ الصفَّ", () => {
    expect(judgeWebhookOutage(honestWebhook({ rowStatus: "failed" })).map((v) => v.rule)).toContain(
      "webhook.row-stays-pending",
    );
  });

  it("webhook.no-ledger وwebhook.no-activation: أثرٌ ماليٌّ من ويبهوكٍ فاشلٍ", () => {
    expect(judgeWebhookOutage(honestWebhook({ ledgerEntries: 1 })).map((v) => v.rule)).toContain(
      "webhook.no-ledger",
    );
    expect(
      judgeWebhookOutage(honestWebhook({ subscriptionActive: true })).map((v) => v.rule),
    ).toContain("webhook.no-activation");
  });

  it("webhook.no-event-stored: حدثٌ خُزِّنَ مقبولاً قبلَ حسمِهِ", () => {
    expect(
      judgeWebhookOutage(honestWebhook({ webhookEventsStored: 1 })).map((v) => v.rule),
    ).toContain("webhook.no-event-stored");
  });
});
