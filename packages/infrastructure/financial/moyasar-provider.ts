/**
 * الغرض: محوّل Moyasar الحقيقي: فاتورة مستضافة، تحقق ويبهوك، وإعادة قراءة دفعة.
 * الحالة: منفّذ فعلياً؛ لا يقرأ process.env ولا يسجل مفاتيحاً أو حمولة كاملة.
 * ينتمي إلى: infrastructure/financial
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway عبر createPaymentProvider فقط.
 * ملاحظات مستقبلية: لا يُعاد إرسال 4xx؛ إعادة المحاولة للشبكة و5xx فقط كي لا
 *   تتكرر عملية أعمال مرفوضة أو تتخفى مشكلة اعتماد.
 */

import type {
  PaymentProvider,
  ProviderEvent,
  ProviderTransactionSnapshot,
} from "../../application/financial/ports.ts";
import { PortFailureError } from "../../application/ports/index.ts";
import type { PaymentTransactionStatus } from "../../domain/financial/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

const MOYASAR_API_URL = "https://api.moyasar.com/v1";
const PAYMENT_METADATA_TRANSACTION_ID = "waslah_transaction_id";

export interface MoyasarProviderOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly callbackUrl: string;
  readonly successUrl?: string;
  readonly backUrl?: string;
  /** للاختبارات المحلية فقط؛ الإنتاج يستخدم عنوان Moyasar الرسمي. */
  readonly baseUrl?: string;
  /** حد زمني تقني للطلب؛ يضبطه التركيب ولا يرتبط بسعر أو سياسة تجارية. */
  readonly timeoutMs?: number;
  /** عدد المحاولات الكلي لخطأ شبكة أو 5xx؛ يضبطه التركيب. */
  readonly maxAttempts?: number;
}

interface MoyasarInvoice {
  readonly id: unknown;
  readonly status: unknown;
  readonly url: unknown;
}
interface MoyasarPayment {
  readonly id: unknown;
  readonly status: unknown;
  readonly amount: unknown;
  readonly currency: unknown;
  readonly metadata?: unknown;
  readonly invoice_id?: unknown;
}
interface MoyasarWebhook {
  readonly id: unknown;
  readonly type: unknown;
  readonly secret_token: unknown;
  readonly data: unknown;
}

function constantTimeEquals(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function textRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    output[key] = entry;
  }
  return output;
}

function mapStatus(status: unknown): PaymentTransactionStatus | null {
  switch (status) {
    case "paid":
    case "captured":
      return "active";
    case "initiated":
      return "pending";
    case "authorized":
    case "verified":
      return "past_due";
    case "failed":
      return "failed";
    case "refunded":
      // لا تملك دورة الاشتراك حالة refund قابلة للتأكيد؛ لا يجوز أن يعيد
      // ويبهوك استرداد تفعيل اشتراك، فتعامل كإلغاء محلي نهائي.
      return "canceled";
    case "voided":
      return "canceled";
    default:
      return null;
  }
}

function error(detail: string): Result<never, PortFailureError> {
  return err(new PortFailureError("moyasar", detail));
}

function basicAuthorization(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

export function createMoyasarProvider(options: MoyasarProviderOptions): PaymentProvider {
  const baseUrl = (options.baseUrl ?? MOYASAR_API_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 3;

  async function request(
    path: string,
    init: RequestInit,
  ): Promise<Result<Response, PortFailureError>> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: basicAuthorization(options.secretKey),
            ...init.headers,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (attempt < maxAttempts) continue;
        return error("MOYASAR_NETWORK_OR_TIMEOUT");
      }
      if (response.status >= 500 && attempt < maxAttempts) continue;
      if (!response.ok) return error(`MOYASAR_HTTP_${response.status}`);
      return ok(response);
    }
    return error("MOYASAR_RETRY_EXHAUSTED");
  }

  return {
    name: "moyasar",
    async chargeSubscription(input) {
      const response = await request("/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: input.amount.amount,
          currency: input.amount.currency,
          description: "اشتراك السائق",
          callback_url: options.callbackUrl,
          ...(options.successUrl === undefined ? {} : { success_url: options.successUrl }),
          ...(options.backUrl === undefined ? {} : { back_url: options.backUrl }),
          metadata: {
            [PAYMENT_METADATA_TRANSACTION_ID]: input.transactionId,
            idempotency_key: input.idempotencyKey,
          },
        }),
      });
      if (!response.ok) return response;
      let invoice: MoyasarInvoice;
      try {
        invoice = (await response.value.json()) as MoyasarInvoice;
      } catch {
        return error("MOYASAR_MALFORMED_INVOICE_RESPONSE");
      }
      if (
        typeof invoice.id !== "string" ||
        typeof invoice.url !== "string" ||
        typeof invoice.status !== "string"
      ) {
        return error("MOYASAR_MALFORMED_INVOICE_RESPONSE");
      }
      if (invoice.status !== "initiated") return error("MOYASAR_UNEXPECTED_INVOICE_STATUS");
      // id هو invoice وليس payment؛ لا نخزنه في provider_transaction_id كي لا
      // يمنع معرّف payment الحقيقي القادم من GET /payments/:id.
      return ok({ providerTransactionId: null, checkoutUrl: invoice.url, status: "pending" });
    },

    async verifyWebhook(rawBody, _headers) {
      let event: MoyasarWebhook;
      try {
        event = JSON.parse(rawBody) as MoyasarWebhook;
      } catch {
        return error("MOYASAR_WEBHOOK_INVALID_JSON");
      }
      if (
        typeof event.id !== "string" ||
        typeof event.type !== "string" ||
        typeof event.secret_token !== "string" ||
        typeof event.data !== "object" ||
        event.data === null
      ) {
        return error("MOYASAR_WEBHOOK_MALFORMED");
      }
      if (!constantTimeEquals(event.secret_token, options.webhookSecret)) {
        return error("MOYASAR_WEBHOOK_SECRET_MISMATCH");
      }
      const paymentId = (event.data as { id?: unknown }).id;
      if (typeof paymentId !== "string" || paymentId.length === 0) {
        return error("MOYASAR_WEBHOOK_PAYMENT_ID_MISSING");
      }
      return ok({
        id: event.id,
        type: event.type,
        providerTransactionId: paymentId,
      } satisfies ProviderEvent);
    },

    async fetchTransaction(providerTransactionId) {
      const response = await request(`/payments/${encodeURIComponent(providerTransactionId)}`, {
        method: "GET",
      });
      if (!response.ok) return response;
      let payment: MoyasarPayment;
      try {
        payment = (await response.value.json()) as MoyasarPayment;
      } catch {
        return error("MOYASAR_MALFORMED_PAYMENT_RESPONSE");
      }
      const status = mapStatus(payment.status);
      const metadata = textRecord(payment.metadata ?? {});
      if (
        typeof payment.id !== "string" ||
        payment.id !== providerTransactionId ||
        status === null ||
        !Number.isInteger(payment.amount) ||
        typeof payment.amount !== "number" ||
        payment.amount <= 0 ||
        typeof payment.currency !== "string" ||
        payment.currency.length !== 3 ||
        metadata === null ||
        typeof metadata[PAYMENT_METADATA_TRANSACTION_ID] !== "string"
      ) {
        return error("MOYASAR_MALFORMED_PAYMENT_RESPONSE");
      }
      return ok({
        id: payment.id,
        status,
        amount: payment.amount,
        currency: payment.currency.toUpperCase(),
        metadata,
        invoiceId: typeof payment.invoice_id === "string" ? payment.invoice_id : null,
      } satisfies ProviderTransactionSnapshot);
    },
  };
}

export { PAYMENT_METADATA_TRANSACTION_ID };
