/**
 * الغرض: محوّلات الدفع على القاعدة الحقيقية — تنفيذ PaymentRepository وWebhookEventStore
 *   عبر دوال RPC ذرّية (create_payment، confirm_payment، record_webhook_event).
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (ويبهوك الدفع)، apps/workers
 * ملاحظات مستقبلية: لا مزوّد دفع فعلي مدمج — المنفذ (PaymentProvider) وحده معلَّق.
 */

import type {
  CreatePaymentResult,
  PaymentRepository,
  WebhookEventStore,
} from "../../application/financial/ports.ts";
import type {
  PaymentTransaction,
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../domain/financial/index.ts";
import type { DriverId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

interface PaymentRow {
  readonly id: string;
  readonly city_id: string;
  readonly payer_driver_id: string;
  readonly payee_id: string;
  readonly purpose: string;
  readonly amount_minor: number;
  readonly currency: string;
  readonly provider: string;
  readonly provider_transaction_id: string | null;
  readonly status: string;
  readonly metadata: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toTransaction(row: PaymentRow): PaymentTransaction {
  return {
    id: row.id as PaymentTransactionId,
    payerId: row.payer_driver_id as DriverId,
    payeeId: row.payee_id as "driver" | "platform",
    purpose: row.purpose as "driver_subscription",
    amount: { amount: row.amount_minor, currency: row.currency },
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id,
    status: row.status as PaymentTransactionStatus,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPaymentRepository(
  sql: Sql,
  /** city_id للسائق — يُقرأ من drivers عند الإنشاء. */
  cityIdForDriver: (driverId: DriverId) => Promise<string | null>,
): PaymentRepository {
  return {
    create: (input) =>
      guard("rpc.create_payment", async () => {
        const cityId = await cityIdForDriver(input.driverId);
        if (cityId === null) {
          throw new Error("DRIVER_NOT_FOUND");
        }
        const rows = await sql`select create_payment(
            ${cityId}::uuid,
            ${input.driverId}::uuid,
            ${input.purpose},
            ${input.amount.amount},
            ${input.amount.currency},
            ${input.provider},
            ${input.providerTransactionId},
            ${input.status},
            ${input.idempotencyKey},
            ${JSON.stringify(input.metadata ?? {})}::jsonb
          ) as result`;
        const envelope = readEnvelope((rows[0] as { result?: unknown } | undefined)?.result);
        if (envelope === null) throw new Error("ردّ create_payment غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");

        const txRows = await sql`select
            id, city_id, payer_driver_id, payee_id, purpose, amount_minor, currency,
            provider, provider_transaction_id, status, metadata, created_at, updated_at
          from payment_transactions where id = ${String(envelope.transaction_id)}::uuid`;
        return {
          transaction: toTransaction(txRows[0] as unknown as PaymentRow),
          alreadyExists: Boolean(envelope.already_exists),
        } satisfies CreatePaymentResult;
      }),

    findById: (id) =>
      guard("payments.findById", async () => {
        const rows = await sql`select
            id, city_id, payer_driver_id, payee_id, purpose, amount_minor, currency,
            provider, provider_transaction_id, status, metadata, created_at, updated_at
          from payment_transactions where id = ${id}`;
        const row = rows[0] as unknown as PaymentRow | undefined;
        return row === undefined ? null : toTransaction(row);
      }),

    findByIdempotencyKey: (key) =>
      guard("payments.findByIdempotencyKey", async () => {
        const rows = await sql`select
            id, city_id, payer_driver_id, payee_id, purpose, amount_minor, currency,
            provider, provider_transaction_id, status, metadata, created_at, updated_at
          from payment_transactions where idempotency_key = ${key}`;
        const row = rows[0] as unknown as PaymentRow | undefined;
        return row === undefined ? null : toTransaction(row);
      }),

    confirmPayment: (input) =>
      guard("rpc.confirm_payment", async () => {
        const rows = await sql`select confirm_payment(
            ${input.transactionId}::uuid,
            ${input.providerTransactionId},
            ${input.newStatus}
          ) as result`;
        const envelope = readEnvelope((rows[0] as { result?: unknown } | undefined)?.result);
        if (envelope === null) throw new Error("ردّ confirm_payment غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");

        const txRows = await sql`select
            id, city_id, payer_driver_id, payee_id, purpose, amount_minor, currency,
            provider, provider_transaction_id, status, metadata, created_at, updated_at
          from payment_transactions where id = ${input.transactionId}`;
        const row = txRows[0] as unknown as PaymentRow | undefined;
        if (row === undefined) throw new Error("TRANSACTION_NOT_FOUND");
        return toTransaction(row);
      }),
  };
}

export function createWebhookEventStore(sql: Sql): WebhookEventStore {
  return {
    record: (eventId, provider, payload, transactionId) =>
      guard("rpc.record_webhook_event", async () => {
        const rows =
          await sql`select record_webhook_event(${eventId}, ${provider}, ${payload}, ${transactionId}) as result`;
        const envelope = readEnvelope((rows[0] as { result?: unknown } | undefined)?.result);
        if (envelope === null) throw new Error("ردّ record_webhook_event غير مفهوم");
        if (!envelope.ok) throw new Error(envelope.error ?? "UNKNOWN");
        return Boolean(envelope.is_new);
      }),
  };
}
