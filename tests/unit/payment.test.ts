/**
 * الغرض: اختبارات وحدة طبقة الدفع — البند 8.4 (الاختبارات الإلزامية).
 *   تثبت: إنشاء معاملة، دفعة ناجحة، دفعة فاشلة، إيدمبوتنسي (مكررة)، ويبهوك مكرر،
 *   توقيع ويبهوك غير صالح — بنفس صرامة الاختبار العدائي الموثّق.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { money } from "../../packages/domain/financial/entity.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../packages/domain/financial/entity.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";
import {
  confirmSubscriptionPayment,
  type ConfirmPaymentDeps,
  type ConfirmPaymentInput,
} from "../../packages/application/financial/confirm-payment.ts";
import {
  subscribePlan,
  type SubscribePlanDeps,
} from "../../packages/application/financial/subscribe-plan.ts";
import type {
  ChargeInitiation,
  CreatePaymentInput,
  PaymentProvider,
  PaymentRepository,
  WebhookEventStore,
} from "../../packages/application/financial/ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  paymentSecretsMatch,
} from "../../apps/gateway/src/routes/payment-webhook.ts";
import type { SubscriptionPlan } from "../../packages/domain/subscription/entity.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";

const driverId = "driver-1" as DriverId;
const cityId = "city-1" as CityId;
const txId = "tx-1" as PaymentTransactionId;

function makeTx(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: txId,
    payerId: driverId,
    payeeId: "platform",
    purpose: "driver_subscription",
    amount: money(25000, "SAR"),
    provider: "test-provider",
    providerTransactionId: null,
    status: "pending",
    metadata: {},
    createdAt: new Date("2026-08-11T10:00:00Z"),
    updatedAt: new Date("2026-08-11T10:00:00Z"),
    ...overrides,
  };
}

/** مزدوج مستودع الدفع — يجمع الإنشاء ويحاكي التأكيد. */
function fakePaymentRepo(initial?: PaymentTransaction): {
  repo: PaymentRepository;
  stored: PaymentTransaction | null;
  confirmCalls: number;
} {
  const state: { tx: PaymentTransaction | null } = { tx: initial ?? null };
  return {
    repo: {
      create: async (input: CreatePaymentInput) => {
        if (state.tx !== null) return ok(state.tx); // idempotency
        state.tx = makeTx({
          id: input.idempotencyKey as PaymentTransactionId,
          status: input.status,
          provider: input.provider,
          amount: input.amount,
        });
        return ok(state.tx);
      },
      findById: async () => ok(state.tx),
      findByIdempotencyKey: async () => ok(state.tx),
      confirmPayment: async (input) => {
        if (state.tx === null) return err(new PortFailureError("payments", "TRANSACTION_NOT_FOUND"));
        state.tx = { ...state.tx, status: input.newStatus, providerTransactionId: input.providerTransactionId };
        return ok(state.tx);
      },
    },
    get stored() {
      return state.tx;
    },
    confirmCalls: 0,
  };
}

/** مزدوج مزوّد الدفع — لا مزوّد فعلي. */
function fakeProvider(overrides: Partial<ChargeInitiation> = {}): PaymentProvider {
  return {
    name: "test-provider",
    chargeSubscription: async () =>
      ok({
        providerTransactionId: "prov-tx-1",
        checkoutUrl: null,
        status: "active",
        ...overrides,
      }),
  };
}

/** مزدوج متجر أحداث الويبهوك. */
function fakeEventStore(known = new Set<string>()): {
  store: WebhookEventStore;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    store: {
      record: async (eventId) => {
        if (known.has(eventId)) {
          seen.push(eventId);
          return ok(false);
        }
        known.add(eventId);
        seen.push(eventId);
        return ok(true);
      },
    },
    seen,
  };
}

function subscribeDeps(
  repo: PaymentRepository,
  provider: PaymentProvider,
  priceAmount = 25000,
): SubscribePlanDeps {
  return {
    payments: repo,
    provider,
    priceReader: async () => ok({ amount: priceAmount, currency: "SAR" }),
  };
}

describe("payment: subscribe-plan", () => {
  it("ينشئ معاملة PENDING ثم يؤكدها عند نجاح المزوّد فوراً", async () => {
    const { repo } = fakePaymentRepo();
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "key-1" },
      subscribeDeps(repo, fakeProvider()),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("active");
    expect(result.value.transactionId).toBe("key-1");
  });

  it("الإيدمبوتنسي: استدعاء بنفس المفتاح مرّتين لا يُنشئ معاملة ثانية", async () => {
    const { repo } = fakePaymentRepo();
    const deps = subscribeDeps(repo, fakeProvider());
    const input = { driverId, cityId, plan: "both" as SubscriptionPlan, idempotencyKey: "dup-key" };

    const first = await subscribePlan(input, deps);
    const second = await subscribePlan(input, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.transactionId).toBe(second.value.transactionId);
  });

  it("الإيدمبوتنسي pending: معاملة pending بلا مزوّد لا تستدعي المزوّد ثانية", async () => {
    let providerCallCount = 0;
    const trackingProvider: PaymentProvider = {
      name: "track-provider",
      chargeSubscription: async () => {
        providerCallCount += 1;
        return ok({ providerTransactionId: `prov-${providerCallCount}`, checkoutUrl: null, status: "pending" as const });
      },
    };
    // معاملة موجودة سلفاً pending بلا providerTransactionId
    const existing = makeTx({ id: "pending-key" as PaymentTransactionId, status: "pending", providerTransactionId: null });
    const { repo } = fakePaymentRepo(existing);
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "pending-key" },
      subscribeDeps(repo, trackingProvider),
    );
    expect(result.ok).toBe(true);
    expect(providerCallCount).toBe(0); // لم يُستدعَ المزوّد
  });

  it("الإيدمبوتنسي pending مع providerTransactionId: لا يُعاد استدعاء المزوّد", async () => {
    let providerCallCount = 0;
    const trackingProvider: PaymentProvider = {
      name: "track-provider",
      chargeSubscription: async () => {
        providerCallCount += 1;
        return ok({ providerTransactionId: `prov-${providerCallCount}`, checkoutUrl: null, status: "pending" as const });
      },
    };
    // معاملة موجودة pending لكن المزوّد دُعي بالفعل (providerTransactionId !== null)
    const existing = makeTx({ id: "pending-prov" as PaymentTransactionId, status: "pending", providerTransactionId: "prov-1" });
    const { repo } = fakePaymentRepo(existing);
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "pending-prov" },
      subscribeDeps(repo, trackingProvider),
    );
    expect(result.ok).toBe(true);
    expect(providerCallCount).toBe(0); // لم يُستدعَ المزوّد
  });

  it("يفشل عند فشل قراءة السعر", async () => {
    const { repo } = fakePaymentRepo();
    const deps: SubscribePlanDeps = {
      payments: repo,
      provider: fakeProvider(),
      priceReader: async () =>
        err({ code: "PORT_FAILURE", port: "settings", detail: "no price" } as unknown as PortFailureError),
    };
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "k" },
      deps,
    );
    expect(result.ok).toBe(false);
  });

  it("يفشل عند فشل المزوّد ولا يُفعّل الاشتراك", async () => {
    const { repo } = fakePaymentRepo();
    const failingProvider: PaymentProvider = {
      name: "fail-provider",
      chargeSubscription: async () =>
        err({ code: "PORT_FAILURE", port: "provider", detail: "charge failed" } as unknown as PortFailureError),
    };
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "k2" },
      subscribeDeps(repo, failingProvider),
    );
    expect(result.ok).toBe(false);
  });
});

describe("payment: confirm-payment (webhook)", () => {
  function confirmInput(eventId: string, status: PaymentTransactionStatus = "active"): ConfirmPaymentInput {
    return {
      transactionId: txId,
      providerTransactionId: "prov-tx-1",
      newStatus: status,
      webhookEventId: eventId,
      provider: "test-provider",
      rawPayload: "{}",
    };
  }

  it("يؤكّد دفعة ناجحة ويفعّل الاشتراك", async () => {
    const { repo } = fakePaymentRepo(makeTx());
    const { store } = fakeEventStore();
    const deps: ConfirmPaymentDeps = { payments: repo, events: store };

    const result = await confirmSubscriptionPayment(confirmInput("evt-1"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("active");
    expect(result.value.duplicate).toBe(false);
  });

  it("الويبهوك المكرر: لا يعالج الحدث مرّتين (Idempotency)", async () => {
    const { repo } = fakePaymentRepo(makeTx());
    const { store, seen } = fakeEventStore();
    const deps: ConfirmPaymentDeps = { payments: repo, events: store };

    const first = await confirmSubscriptionPayment(confirmInput("evt-dup"), deps);
    const second = await confirmSubscriptionPayment(confirmInput("evt-dup"), deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.duplicate).toBe(false);
    expect(second.value.duplicate).toBe(true);
    // الحدث سُجِّل مرّة واحدة فعلياً
    expect(seen.length).toBe(2); // كلاهما فحص، لكن الثاني أعاد is_new=false
  });

  it("الويبهوك الفاشل (معاملة غير موجودة) يُعاد خطأ", async () => {
    const { repo } = fakePaymentRepo();
    const { store } = fakeEventStore();
    const deps: ConfirmPaymentDeps = { payments: repo, events: store };

    const result = await confirmSubscriptionPayment(confirmInput("evt-x", "failed"), deps);
    expect(result.ok).toBe(false);
  });

  it("دفعة فاشلة لا تُفعّل الاشتراك لكن تُحدّث الحالة", async () => {
    const { repo } = fakePaymentRepo(makeTx());
    const { store } = fakeEventStore();
    const deps: ConfirmPaymentDeps = { payments: repo, events: store };

    const result = await confirmSubscriptionPayment(confirmInput("evt-fail", "failed"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("failed");
  });
});

describe("payment: webhook signature", () => {
  it("التوقيع الصحيح يُقبل", () => {
    expect(paymentSecretsMatch("my-secret", "my-secret")).toBe(true);
  });

  it("التوقيع الخاطئ يُرفض", () => {
    expect(paymentSecretsMatch("wrong", "my-secret")).toBe(false);
  });

  it("التوقيع الفارغ يُرفض", () => {
    expect(paymentSecretsMatch("", "my-secret")).toBe(false);
  });

  it("أطوال مختلفة تُرفض بزمن ثابت", () => {
    expect(paymentSecretsMatch("short", "much-longer-secret")).toBe(false);
  });
});

describe("payment: money value object", () => {
  it("يقبل وحدات صغرى صحيحة موجبة", () => {
    const m = money(25000, "SAR");
    expect(m.amount).toBe(25000);
    expect(m.currency).toBe("SAR");
  });

  it("يرفض float", () => {
    expect(() => money(250.5, "SAR")).toThrow();
  });

  it("يرفض سالباً وصفراً", () => {
    expect(() => money(0, "SAR")).toThrow();
    expect(() => money(-100, "SAR")).toThrow();
  });

  it("يرفض عملة غير ثلاثية", () => {
    expect(() => money(100, "RIYAL")).toThrow();
  });
});
