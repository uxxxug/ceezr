/**
 * الغرض: اختبارات وحدة لطبقة تغييرات الاشتراك — `cancelSubscription`،
 *   `resumeSubscription`، `upgradePlan` — بمزدوجات لا بقاعدة.
 *
 *   اختبارات التكامل (tests/integration/subscription-cancel-upgrade.test.ts) تثبت
 *   السلوك على قاعدة حقيقية. هذا الملف يثبت شيئاً آخر لا تراه: ما تفعله طبقة
 *   التطبيق نفسها حين تعطيها القاعدةُ ردّاً غير متوقّع. وهي الحالات التي لا
 *   يمكن إنتاجها على قاعدة سليمة، وهي بعينها ما يحدث حين يُنشر خطأٌ في هجرة.
 *
 *   ما تقيسه:
 *     ١. ردٌّ ناجحٌ بلا `subscription_id` لا يُترجَم نجاحاً — يُرفض برمز صريح.
 *        (لو مرّ لأعاد البوت للسائق «تمّ الإلغاء» بلا سجلٍّ يُلغى فعلاً.)
 *     ٢. فشل المنفذ (انقطاع القاعدة) يظهر بتفصيله لا بـ«حدث خطأ».
 *     ٣. الترقية المجّانية (داخل التجربة) لا تُنشئ معاملة دفع أصلاً — يُتحقّق
 *        بعدّ نداءات مستودع الدفع، لا بقراءة الكود.
 *     ٤. الترقية المدفوعة تُنشئ المعاملة بالوحدة الصغرى (هللات): ١٥٠ ريالاً
 *        تُمرَّر 15000 لا 150. أوّل نسخة مرّرت 150 — أي ١٫٥ ريال — فكانت خسارة
 *        ٩٩٪ من قيمة كل ترقية، وهذا الاختبار يمنع رجوعها.
 *     ٥. وسم المعاملة يحمل `upgrade: true` والخطّة السابقة: منه تعرف
 *        `confirm_payment` أنها ترقيةٌ في مكانها لا اشتراكٌ يُمدّد الدورة.
 *     ٦. تناقض القاعدة (دفعٌ مطلوب ومبلغٌ غير موجب) يُرفض ولا يُنشئ معاملة صفرية.
 *     ٧. مفتاح إيدمبوتنسي مستعمل سلفاً يُعيد المعاملة القائمة ولا يُطالب المزوّد
 *        مرّة ثانية — يُتحقّق بعدّ نداءات المزوّد.
 *
 * الحالة: منفّذ فعلياً — اختبار وحدة، لا يحتاج قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه: CI (وظيفة verify، قبل خدمة القاعدة).
 */

import { describe, expect, it } from "bun:test";
import type {
  CreatePaymentInput,
  PaymentProvider,
  PaymentRepository,
} from "../../packages/application/financial/ports.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  type CancelSubscriptionDeps,
  cancelSubscription,
  resumeSubscription,
} from "../../packages/application/subscription/cancel-subscription.ts";
import type {
  CancellationOutcome,
  ResumeOutcome,
  SubscriptionChangeRpcPort,
  UpgradeApplied,
  UpgradeQuote,
} from "../../packages/application/subscription/ports.ts";
import {
  type UpgradePlanDeps,
  upgradePlan,
} from "../../packages/application/subscription/upgrade-plan.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
} from "../../packages/domain/financial/entity.ts";
import { money } from "../../packages/domain/financial/entity.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const driverId = "driver-1" as DriverId;
const cityId = "city-1" as CityId;

const PERIOD_END = new Date("2026-09-11T10:00:00Z");

function cancellation(overrides: Partial<CancellationOutcome> = {}): CancellationOutcome {
  return {
    ok: true,
    error: null,
    subscriptionId: "sub-1",
    alreadyCancelled: false,
    status: "active",
    serviceUntil: PERIOD_END,
    ...overrides,
  };
}

function resumeOutcome(overrides: Partial<ResumeOutcome> = {}): ResumeOutcome {
  return {
    ok: true,
    error: null,
    subscriptionId: "sub-1",
    alreadyActive: false,
    status: "active",
    ...overrides,
  };
}

function quote(overrides: Partial<UpgradeQuote> = {}): UpgradeQuote {
  return {
    ok: true,
    error: null,
    subscriptionId: "sub-1",
    cityId,
    currentPlan: "transport",
    newPlan: "both",
    amountDue: 150,
    paymentRequired: true,
    currency: "SAR",
    periodEnd: PERIOD_END,
    status: "active",
    ...overrides,
  };
}

function applied(overrides: Partial<UpgradeApplied> = {}): UpgradeApplied {
  return {
    ok: true,
    error: null,
    subscriptionId: "sub-1",
    alreadyOnPlan: false,
    plan: "both",
    periodEnd: PERIOD_END,
    ...overrides,
  };
}

/** مزدوج منفذ التغييرات — يحفظ ما استُدعي به ليُتحقّق منه لا ليُفترض. */
function fakeChanges(responses: {
  cancel?: CancellationOutcome | PortFailureError;
  resume?: ResumeOutcome | PortFailureError;
  quote?: UpgradeQuote | PortFailureError;
  apply?: UpgradeApplied | PortFailureError;
}): { port: SubscriptionChangeRpcPort; applyCalls: number; cancelReasons: (string | null)[] } {
  const state = { applyCalls: 0, cancelReasons: [] as (string | null)[] };
  return {
    port: {
      requestCancellation: async (_driver, reason) => {
        state.cancelReasons.push(reason);
        const r = responses.cancel ?? cancellation();
        return r instanceof PortFailureError ? err(r) : ok(r);
      },
      resume: async () => {
        const r = responses.resume ?? resumeOutcome();
        return r instanceof PortFailureError ? err(r) : ok(r);
      },
      quoteUpgrade: async () => {
        const r = responses.quote ?? quote();
        return r instanceof PortFailureError ? err(r) : ok(r);
      },
      applyUpgrade: async () => {
        state.applyCalls += 1;
        const r = responses.apply ?? applied();
        return r instanceof PortFailureError ? err(r) : ok(r);
      },
    },
    get applyCalls() {
      return state.applyCalls;
    },
    get cancelReasons() {
      return state.cancelReasons;
    },
  };
}

function makeTx(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: "tx-1" as PaymentTransactionId,
    payerId: driverId,
    payeeId: "platform",
    purpose: "driver_subscription",
    amount: money(15_000, "SAR"),
    provider: "test-provider",
    providerTransactionId: null,
    status: "pending",
    metadata: {},
    createdAt: new Date("2026-08-12T10:00:00Z"),
    updatedAt: new Date("2026-08-12T10:00:00Z"),
    ...overrides,
  };
}

/** مزدوج مستودع الدفع — يحفظ كل مدخلات الإنشاء ليُتحقّق من المبلغ والوسم. */
function fakePayments(existing: PaymentTransaction | null = null): {
  repo: PaymentRepository;
  createInputs: CreatePaymentInput[];
} {
  const createInputs: CreatePaymentInput[] = [];
  return {
    repo: {
      create: async (input) => {
        createInputs.push(input);
        return ok({ transaction: makeTx({ amount: input.amount }), alreadyExists: false });
      },
      findById: async () => ok(existing),
      findByIdempotencyKey: async () => ok(existing),
      confirmPayment: async () => err(new PortFailureError("payments", "NOT_USED_HERE")),
    },
    createInputs,
  };
}

function fakeProvider(): { provider: PaymentProvider; calls: number } {
  const state = { calls: 0 };
  return {
    provider: {
      name: "test-provider",
      chargeSubscription: async () => {
        state.calls += 1;
        return ok({
          providerTransactionId: "prov-1",
          checkoutUrl: "https://pay.test/1",
          status: "pending" as const,
        });
      },
    },
    get calls() {
      return state.calls;
    },
  };
}

describe("إلغاء الاشتراك — طبقة التطبيق بمزدوجات", () => {
  it("يُمرّر السبب كما هو ويعيد آخر لحظة خدمة", async () => {
    const changes = fakeChanges({});
    const deps: CancelSubscriptionDeps = { changes: changes.port };
    const result = await cancelSubscription({ driverId, reason: "غالي" }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.serviceUntil?.getTime()).toBe(PERIOD_END.getTime());
    expect(result.value.alreadyCancelled).toBe(false);
    expect(changes.cancelReasons).toEqual(["غالي"]);
  });

  it("نجاحٌ بلا معرّف اشتراك لا يُترجَم نجاحاً", async () => {
    const changes = fakeChanges({ cancel: cancellation({ subscriptionId: null }) });
    const result = await cancelSubscription({ driverId, reason: null }, { changes: changes.port });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("CANCELLED_WITHOUT_SUBSCRIPTION_ID");
  });

  it("رفض القاعدة يظهر برمزه لا برسالة عامّة", async () => {
    const changes = fakeChanges({
      cancel: cancellation({ ok: false, error: "NO_LIVE_SUBSCRIPTION" }),
    });
    const result = await cancelSubscription({ driverId, reason: null }, { changes: changes.port });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("انقطاع القاعدة يظهر بتفصيله", async () => {
    const changes = fakeChanges({
      cancel: new PortFailureError("subscription-changes", "CONNECTION_RESET"),
    });
    const result = await cancelSubscription({ driverId, reason: null }, { changes: changes.port });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("CONNECTION_RESET");
  });

  it("الاستئناف: نجاحٌ بلا معرّف يُرفض أيضاً", async () => {
    const changes = fakeChanges({ resume: resumeOutcome({ subscriptionId: null }) });
    const result = await resumeSubscription({ driverId }, { changes: changes.port });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("RESUMED_WITHOUT_SUBSCRIPTION_ID");
  });
});

describe("ترقية الخطّة — طبقة التطبيق بمزدوجات", () => {
  const base = { driverId, cityId, newPlan: "both" as const, idempotencyKey: "idem-1" };

  it("داخل التجربة: تُطبَّق مباشرةً ولا تُنشأ معاملة دفع", async () => {
    const changes = fakeChanges({ quote: quote({ paymentRequired: false, amountDue: 0 }) });
    const payments = fakePayments();
    const provider = fakeProvider();
    const deps: UpgradePlanDeps = {
      changes: changes.port,
      payments: payments.repo,
      provider: provider.provider,
    };

    const result = await upgradePlan(base, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("applied");
    expect(payments.createInputs).toHaveLength(0);
    expect(provider.calls).toBe(0);
    expect(changes.applyCalls).toBe(1);
  });

  it("المدفوعة: المبلغ يُمرَّر بالوحدة الصغرى — 150 ريالاً = 15000", async () => {
    const changes = fakeChanges({});
    const payments = fakePayments();
    const provider = fakeProvider();

    const result = await upgradePlan(base, {
      changes: changes.port,
      payments: payments.repo,
      provider: provider.provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("payment_required");
    const input = payments.createInputs[0];
    expect(input).toBeDefined();
    // 150 لا 15000 يعني مطالبة السائق بـ١٫٥ ريال مقابل ترقية ثمنها ١٥٠.
    expect(input?.amount.amount).toBe(15_000);
    expect(input?.amount.currency).toBe("SAR");
    // الطبقة لا تُطبّق الترقية بنفسها قبل الدفع: `confirm_payment` تفعل.
    expect(changes.applyCalls).toBe(0);
  });

  it("وسم المعاملة يحمل علم الترقية والخطّة السابقة", async () => {
    const payments = fakePayments();
    await upgradePlan(base, {
      changes: fakeChanges({}).port,
      payments: payments.repo,
      provider: fakeProvider().provider,
    });

    expect(payments.createInputs[0]?.metadata).toEqual({
      plan: "both",
      cityId,
      upgrade: true,
      previousPlan: "transport",
    });
  });

  it("دفعٌ مطلوب بمبلغ غير موجب: تناقضٌ يُرفض ولا يُنشئ معاملة صفرية", async () => {
    const payments = fakePayments();
    const result = await upgradePlan(base, {
      changes: fakeChanges({ quote: quote({ amountDue: 0, paymentRequired: true }) }).port,
      payments: payments.repo,
      provider: fakeProvider().provider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("QUOTE_AMOUNT_NOT_POSITIVE");
    expect(payments.createInputs).toHaveLength(0);
  });

  it("مفتاح مستعمل سلفاً: تُعاد المعاملة القائمة ولا يُطالَب المزوّد ثانيةً", async () => {
    const payments = fakePayments(makeTx({ status: "pending" }));
    const provider = fakeProvider();

    const result = await upgradePlan(base, {
      changes: fakeChanges({}).port,
      payments: payments.repo,
      provider: provider.provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("payment_required");
    expect(payments.createInputs).toHaveLength(0);
    expect(provider.calls).toBe(0);
  });

  it("رفض الاقتباس (ترقية جانبية) يمنع كل ما بعده", async () => {
    const payments = fakePayments();
    const provider = fakeProvider();
    const result = await upgradePlan(base, {
      changes: fakeChanges({ quote: quote({ ok: false, error: "PLAN_NOT_AN_UPGRADE" }) }).port,
      payments: payments.repo,
      provider: provider.provider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toBe("PLAN_NOT_AN_UPGRADE");
    expect(payments.createInputs).toHaveLength(0);
    expect(provider.calls).toBe(0);
  });
});
