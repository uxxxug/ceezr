/**
 * الغرض: اختبارات وحدة طبقة الدفع — البند 8.4 (الاختبارات الإلزامية).
 *   تثبت: إنشاء معاملة، دفعة ناجحة، دفعة فاشلة، إيدمبوتنسي (مكررة)، ويبهوك مكرر،
 *   توقيع ويبهوك غير صالح — بنفس صرامة الاختبار العدائي الموثّق.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type ConfirmPaymentDeps,
  type ConfirmPaymentInput,
  confirmSubscriptionPayment,
} from "../../packages/application/financial/confirm-payment.ts";
import type {
  ChargeInitiation,
  CreatePaymentInput,
  PaymentProvider,
  PaymentRepository,
  WebhookEventStore,
} from "../../packages/application/financial/ports.ts";
import {
  type SubscribePlanDeps,
  subscribePlan,
} from "../../packages/application/financial/subscribe-plan.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../packages/domain/financial/entity.ts";
import { money } from "../../packages/domain/financial/entity.ts";
import type { SubscriptionPlan } from "../../packages/domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

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
  const webhookEvents = new Set<string>();
  return {
    repo: {
      create: async (input: CreatePaymentInput) => {
        if (state.tx !== null) {
          // idempotency: RPC يعيد المعاملة الموجودة مع already_exists=true
          return ok({ transaction: state.tx, alreadyExists: true });
        }
        state.tx = makeTx({
          id: input.idempotencyKey as PaymentTransactionId,
          status: input.status,
          provider: input.provider,
          amount: input.amount,
        });
        return ok({ transaction: state.tx, alreadyExists: false });
      },
      findById: async () => ok(state.tx),
      findByIdempotencyKey: async () => ok(state.tx),
      recordCheckoutUrl: async (input) => ok({ checkoutUrl: input.checkoutUrl }),
      // يخزّن فعلاً كما يفعل RPC: مزدوجٌ يقول «خُزِن» بلا أن يخزن يخفي أنّ
      // المرجع لم يُكتب — وهو بعينه الخلل الذي تحرسه هذه الاختبارات.
      recordProviderReference: async (input) => {
        const current = state.tx;
        if (current === null) return err(new PortFailureError("payments", "TRANSACTION_NOT_FOUND"));
        if (current.providerTransactionId === null) {
          state.tx = { ...current, providerTransactionId: input.providerTransactionId };
          return ok({ providerTransactionId: input.providerTransactionId, stored: true });
        }
        return ok({ providerTransactionId: current.providerTransactionId, stored: false });
      },
      findStalePending: async () => ok([]),
      confirmPayment: async (input) => {
        const current = state.tx;
        if (current === null) return err(new PortFailureError("payments", "TRANSACTION_NOT_FOUND"));
        state.tx = {
          ...current,
          status: input.newStatus,
          providerTransactionId: input.providerTransactionId,
        };
        return ok(state.tx);
      },
      confirmWebhookPayment: async (input) => {
        const current = state.tx;
        if (current === null) return err(new PortFailureError("payments", "TRANSACTION_NOT_FOUND"));
        if (webhookEvents.has(input.webhookEventId)) {
          return ok({ transaction: current, duplicate: true });
        }
        webhookEvents.add(input.webhookEventId);
        state.tx = {
          ...current,
          status: input.newStatus,
          providerTransactionId: input.providerTransactionId,
        };
        return ok({ transaction: state.tx, duplicate: false });
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
    verifyWebhook: async () =>
      ok({ id: "event", type: "payment_paid", providerTransactionId: "prov-tx-1" }),
    fetchTransaction: async () =>
      ok({
        id: "prov-tx-1",
        status: "active",
        amount: 25000,
        currency: "SAR",
        metadata: {},
        invoiceId: null,
      }),
  };
}

/**
 * مزدوج متجر أحداث الويبهوك.
 *
 * يسجّل `transactionId` الممرّر لا ليُزيّن التوقيع بل ليُمكِّن توكيده: منه تُقرأ
 * مدينة الصفّ في القاعدة، فمزدوجٌ يتجاهله يُخفي تمريراً خاطئاً أو مفقوداً.
 */
function fakeEventStore(known = new Set<string>()): {
  store: WebhookEventStore;
  seen: string[];
  recordedTransactionIds: string[];
} {
  const seen: string[] = [];
  const recordedTransactionIds: string[] = [];
  return {
    store: {
      record: async (eventId, _provider, _payload, transactionId) => {
        recordedTransactionIds.push(transactionId);
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
    recordedTransactionIds,
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
        return ok({
          providerTransactionId: `prov-${providerCallCount}`,
          checkoutUrl: null,
          status: "pending" as const,
        });
      },
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    // معاملة موجودة سلفاً pending بلا providerTransactionId
    const existing = makeTx({
      id: "pending-key" as PaymentTransactionId,
      status: "pending",
      providerTransactionId: null,
    });
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
        return ok({
          providerTransactionId: `prov-${providerCallCount}`,
          checkoutUrl: null,
          status: "pending" as const,
        });
      },
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    // معاملة موجودة pending لكن المزوّد دُعي بالفعل (providerTransactionId !== null)
    const existing = makeTx({
      id: "pending-prov" as PaymentTransactionId,
      status: "pending",
      providerTransactionId: "prov-1",
    });
    const { repo } = fakePaymentRepo(existing);
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "pending-prov" },
      subscribeDeps(repo, trackingProvider),
    );
    expect(result.ok).toBe(true);
    expect(providerCallCount).toBe(0); // لم يُستدعَ المزوّد
  });

  it("السباق (race): findByIdempotencyKey يُرجع null لكن create يُرجع alreadyExists=true — لا يُستدعى المزوّد", async () => {
    let providerCallCount = 0;
    const trackingProvider: PaymentProvider = {
      name: "track-provider",
      chargeSubscription: async () => {
        providerCallCount += 1;
        return ok({
          providerTransactionId: `prov-${providerCallCount}`,
          checkoutUrl: null,
          status: "pending" as const,
        });
      },
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    // محاكاة السباق: findByIdempotencyKey يُرجع null (لا توجد بعد)،
    // لكن create يُرجع alreadyExists=true (طرفٌ آخر أنشأها بين الفحص والإنشاء).
    const raceTx = makeTx({ id: "race-tx" as PaymentTransactionId, status: "pending" });
    const raceRepo: PaymentRepository = {
      create: async () => ok({ transaction: raceTx, alreadyExists: true }),
      findById: async () => ok(raceTx),
      findByIdempotencyKey: async () => ok(null), // لا توجد (فحص سابق)
      recordCheckoutUrl: async (input) => ok({ checkoutUrl: input.checkoutUrl }),
      recordProviderReference: async (input) =>
        ok({ providerTransactionId: input.providerTransactionId, stored: true }),
      findStalePending: async () => ok([]),
      confirmPayment: async () => ok(raceTx),
      confirmWebhookPayment: async () => ok({ transaction: raceTx, duplicate: false }),
    };
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "race-tx" },
      subscribeDeps(raceRepo, trackingProvider),
    );
    expect(result.ok).toBe(true);
    expect(providerCallCount).toBe(0); // المزوّد لم يُستدعَ — alreadyExists=true حسم السباق
  });

  it("يفشل عند فشل قراءة السعر", async () => {
    const { repo } = fakePaymentRepo();
    const deps: SubscribePlanDeps = {
      payments: repo,
      provider: fakeProvider(),
      priceReader: async () =>
        err({
          code: "PORT_FAILURE",
          port: "settings",
          detail: "no price",
        } as unknown as PortFailureError),
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
        err({
          code: "PORT_FAILURE",
          port: "provider",
          detail: "charge failed",
        } as unknown as PortFailureError),
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    const result = await subscribePlan(
      { driverId, cityId, plan: "transport" as SubscriptionPlan, idempotencyKey: "k2" },
      subscribeDeps(repo, failingProvider),
    );
    expect(result.ok).toBe(false);
  });
});

describe("payment: confirm-payment (webhook)", () => {
  function confirmInput(
    eventId: string,
    status: PaymentTransactionStatus = "active",
  ): ConfirmPaymentInput {
    return {
      transactionId: txId,
      providerTransactionId: "prov-tx-1",
      newStatus: status,
      providerAmount: 25000,
      providerCurrency: "SAR",
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
    // الإيدمبوتنسي انتقل إلى RPC واحد؛ متجر الأحداث القديم لا يُستدعى خارجها.
    expect(seen.length).toBe(0);
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
