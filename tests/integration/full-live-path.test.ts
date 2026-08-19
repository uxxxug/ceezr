/**
 * الغرض: اختبار تكامل شامل يتتبّع المسار الحيّ الكامل للمنصّة — البند 9.
 *   يربط كل المكوّنات: دفع اشتراك ← ويبهوك تأكيد ← اشتراك فعّال ← نسخ احتياطي ناجح.
 *   هذا الاختبار لا يتطلب قاعدة بيانات فعلية: يستخدم مزدوجات (mocks) لكل منفذ،
 *   لكنه يتحقّق أنّ التوصيل بين المكوّنات (wiring) سليم، وأنّ البيانات تتدفّق
 *   بصورة صحيحة من نقطة البداية إلى النهاية.
 * الحالة: منفّذ فعلياً — البند 9.
 * ينتمي إلى: tests/integration
 */

import { describe, expect, it } from "bun:test";
import {
  type BackupConfig,
  type BackupDeps,
  type Dumper,
  runDatabaseBackup,
} from "../../apps/workers/src/jobs/backup-database.ts";
import {
  type ConfirmPaymentDeps,
  confirmSubscriptionPayment,
} from "../../packages/application/financial/confirm-payment.ts";
import type {
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
} from "../../packages/domain/financial/entity.ts";
import { isPaymentSuccessful, money } from "../../packages/domain/financial/entity.ts";
import type { SubscriptionPlan } from "../../packages/domain/subscription/entity.ts";
import { isSubscriptionLive } from "../../packages/domain/subscription/entity.ts";
import type { BackupStoragePort } from "../../packages/infrastructure/backup/backup-port.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const driverId = "driver-e2e-1" as DriverId;
const cityId = "city-e2e-jed" as CityId;

function e2ePaymentRepo(): PaymentRepository & { txns: PaymentTransaction[] } {
  const txns: PaymentTransaction[] = [];
  const webhookEvents = new Set<string>();
  return {
    txns,
    create: async (input) => {
      const existing = txns.find((t) => t.id === input.idempotencyKey);
      if (existing !== undefined) return ok({ transaction: existing, alreadyExists: true });
      const tx: PaymentTransaction = {
        id: input.idempotencyKey as PaymentTransactionId,
        payerId: input.driverId,
        payeeId: "platform",
        purpose: input.purpose,
        amount: input.amount,
        provider: input.provider,
        providerTransactionId: input.providerTransactionId,
        status: input.status,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      txns.push(tx);
      return ok({ transaction: tx, alreadyExists: false });
    },
    findById: async (id) => ok(txns.find((t) => t.id === id) ?? null),
    findByIdempotencyKey: async (key) => ok(txns.find((t) => t.id === key) ?? null),
    recordCheckoutUrl: async (input) => ok({ checkoutUrl: input.checkoutUrl }),
    recordProviderReference: async (input) =>
      ok({ providerTransactionId: input.providerTransactionId, stored: true }),
    findStalePending: async () => ok([]),
    confirmPayment: async (input) => {
      const idx = txns.findIndex((t) => t.id === input.transactionId);
      const current = txns[idx];
      if (idx === -1 || current === undefined)
        return err(new PortFailureError("payments", "NOT_FOUND"));
      const updated: PaymentTransaction = {
        ...current,
        status: input.newStatus,
        providerTransactionId: input.providerTransactionId,
        updatedAt: new Date(),
      };
      txns[idx] = updated;
      return ok(updated);
    },
    confirmWebhookPayment: async (input) => {
      const current = txns.find((item) => item.id === input.transactionId);
      if (current === undefined) return err(new PortFailureError("payments", "NOT_FOUND"));
      if (webhookEvents.has(input.webhookEventId)) {
        return ok({ transaction: current, duplicate: true });
      }
      webhookEvents.add(input.webhookEventId);
      const updated: PaymentTransaction = {
        ...current,
        status: input.newStatus,
        providerTransactionId: input.providerTransactionId,
        updatedAt: new Date(),
      };
      const index = txns.findIndex((item) => item.id === input.transactionId);
      txns[index] = updated;
      return ok({ transaction: updated, duplicate: false });
    },
  };
}

function e2eProvider(): PaymentProvider {
  return {
    name: "e2e-mock-provider",
    chargeSubscription: async () =>
      ok({
        providerTransactionId: "prov-e2e-1",
        checkoutUrl: null,
        status: "active" as const,
      }),
    verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
    fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
  };
}

function e2eEventStore(): WebhookEventStore & {
  seen: Set<string>;
  recordedTransactionIds: string[];
} {
  const seen = new Set<string>();
  const recordedTransactionIds: string[] = [];
  return {
    seen,
    recordedTransactionIds,
    // معرّف المعاملة محفوظ لا مُهمَل: منه تُقرأ مدينة الحدث في القاعدة.
    record: async (eventId, _provider, _payload, transactionId) => {
      recordedTransactionIds.push(transactionId);
      if (seen.has(eventId)) return ok(false);
      seen.add(eventId);
      return ok(true);
    },
  };
}

function e2ePriceReader(amount = 25000) {
  return async () => ok({ amount, currency: "SAR" });
}

function e2eBackupStorage(): BackupStoragePort & { uploads: { name: string; bytes: number }[] } {
  const uploads: { name: string; bytes: number }[] = [];
  return {
    uploads,
    upload: async (name, content) => {
      const result = { remoteFileId: name, bytes: content.byteLength, uploadedAt: new Date() };
      uploads.push({ name, bytes: content.byteLength });
      return ok(result);
    },
    list: async () =>
      ok(uploads.map((u) => ({ remoteFileId: u.name, name: u.name, uploadedAt: new Date() }))),
    delete: async () => ok(undefined),
  };
}

function makeBackupDeps(sql: Sql, storage: BackupStoragePort): BackupDeps {
  return {
    sql,
    storage,
    clock: { now: () => new Date("2026-08-11T15:00:00Z") },
  };
}

describe("e2e: المسار الحيّ الكامل", () => {
  it("يتتبّع: دفع اشتراك ← ويبهوك تأكيد ← اشتراك فعّال ← نسخ احتياطي ناجح", async () => {
    const plan: SubscriptionPlan = "transport";
    const idempotencyKey = "e2e-sub-1";

    // 1) بدء دفع الاشتراك
    const repo = e2ePaymentRepo();
    const provider = e2eProvider();
    const deps: SubscribePlanDeps = {
      payments: repo,
      provider,
      priceReader: e2ePriceReader(25000),
    };

    const subResult = await subscribePlan({ driverId, cityId, plan, idempotencyKey }, deps);
    expect(subResult.ok).toBe(true);
    if (!subResult.ok) return;
    expect(subResult.value.status).toBe("active");
    expect(repo.txns.length).toBe(1);
    expect(repo.txns[0]?.amount.amount).toBe(25000);
    expect(repo.txns[0]?.amount.currency).toBe("SAR");

    // 2) ويبهوك تأكيد
    const eventStore = e2eEventStore();
    const confirmDeps: ConfirmPaymentDeps = { payments: repo, events: eventStore };
    const confirmResult = await confirmSubscriptionPayment(
      {
        transactionId: idempotencyKey as PaymentTransactionId,
        providerTransactionId: "prov-e2e-1",
        newStatus: "active",
        providerAmount: 25000,
        providerCurrency: "SAR",
        webhookEventId: "wh-e2e-1",
        provider: "e2e-mock-provider",
        rawPayload: '{"eventId":"wh-e2e-1"}',
      },
      confirmDeps,
    );
    expect(confirmResult.ok).toBe(true);
    if (!confirmResult.ok) return;
    expect(confirmResult.value.duplicate).toBe(false);
    expect(confirmResult.value.status).toBe("active");

    // 3) التحقّق من الدفع الناجح والاشتراك الفعّال
    expect(isPaymentSuccessful(confirmResult.value.status)).toBe(true);
    expect(
      isSubscriptionLive(
        {
          driverId,
          cityId,
          plan: "transport",
          status: "active",
          trialEndsAt: null,
          currentPeriodEnd: new Date("2026-09-10T15:00:00Z"),
          cancelAtPeriodEnd: false,
        },
        new Date("2026-08-11T15:00:00Z"),
      ),
    ).toBe(true);

    // 4) ويبهوك مكرر: Idempotency يمنع التفعيل مرّتين
    const dupResult = await confirmSubscriptionPayment(
      {
        transactionId: idempotencyKey as PaymentTransactionId,
        providerTransactionId: "prov-e2e-1",
        newStatus: "active",
        providerAmount: 25000,
        providerCurrency: "SAR",
        webhookEventId: "wh-e2e-1",
        provider: "e2e-mock-provider",
        rawPayload: '{"eventId":"wh-e2e-1"}',
      },
      confirmDeps,
    );
    expect(dupResult.ok).toBe(true);
    if (!dupResult.ok) return;
    expect(dupResult.value.duplicate).toBe(true);

    // 5) النسخ الاحتياطي اليومي يعمل بعد الدفع بنجاح
    const storage = e2eBackupStorage();
    const fakeDumper: Dumper = {
      dump: async () => ok(new Uint8Array(Buffer.from("FAKE_PG_DUMP_OUTPUT"))),
    };
    const config: BackupConfig = {
      databaseUrl: "postgres://fake",
      retentionCount: 7,
    };
    const sqlMock = (async () => []) as unknown as Sql;
    const backupDeps = makeBackupDeps(sqlMock, storage);
    const backupResult = await runDatabaseBackup(config, backupDeps, fakeDumper);
    expect(backupResult.ok).toBe(true);
    if (!backupResult.ok) return;
    expect(backupResult.value.status).toBe("uploaded");
    expect(backupResult.value.bytes).toBeGreaterThan(0);
    expect(storage.uploads.length).toBe(1);
    expect(storage.uploads[0]?.bytes).toBeGreaterThan(0);
  });

  it("يتتبّع: دفع فاشل لا يُفعّل الاشتراك لكن النسخ الاحتياطي يعمل", async () => {
    const repo = e2ePaymentRepo();
    const failingProvider: PaymentProvider = {
      name: "e2e-fail-provider",
      chargeSubscription: async () => err(new PortFailureError("provider", "charge declined")),
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    const deps: SubscribePlanDeps = {
      payments: repo,
      provider: failingProvider,
      priceReader: e2ePriceReader(25000),
    };

    const result = await subscribePlan(
      { driverId, cityId, plan: "both", idempotencyKey: "e2e-fail-1" },
      deps,
    );
    expect(result.ok).toBe(false);

    // النسخ الاحتياطي لا يعتمد على الدفع
    const storage = e2eBackupStorage();
    const fakeDumper: Dumper = {
      dump: async () => ok(new Uint8Array(Buffer.from("BACKUP_EVEN_IF_PAYMENT_FAILED"))),
    };
    const config: BackupConfig = {
      databaseUrl: "postgres://fake",
      retentionCount: 7,
    };
    const sqlMock = (async () => []) as unknown as Sql;
    const backupDeps = makeBackupDeps(sqlMock, storage);
    const backupResult = await runDatabaseBackup(config, backupDeps, fakeDumper);
    expect(backupResult.ok).toBe(true);
  });

  it("كائن النقود: لا float، وحدات صغرى فقط، يُستخدم في كل المسار", () => {
    const m = money(25000, "SAR");
    expect(m.amount).toBe(25000);
    expect(m.currency).toBe("SAR");
    expect(() => money(250.5, "SAR")).toThrow();
  });
});
