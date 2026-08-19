/**
 * الغرض: استقبال ويبهوك الدفع بعد إثبات أصله وإعادة قراءة الدفعة من خادم المزوّد.
 * الحالة: منفّذ فعلياً؛ لا تؤخذ حالة أو مبلغ أو معرّف معاملتنا من حمولة خارجية.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts بعد تركيب PaymentProvider.
 * ملاحظات مستقبلية: التسجيل لا يتضمن السر ولا الجسم الخام؛ الجسم يحفظ في القاعدة
 * فقط ضمن RPC التدقيقي بعد قبول الحدث.
 */

import { type Context, Hono } from "hono";
import {
  type ConfirmPaymentDeps,
  confirmSubscriptionPayment,
} from "../../../../packages/application/financial/index.ts";
import type { PaymentProvider } from "../../../../packages/application/financial/ports.ts";
import type { PaymentTransactionId } from "../../../../packages/domain/financial/index.ts";
import { readBounded } from "./telegram-webhook.ts";

export const PAYMENT_WEBHOOK_MAX_BYTES = 256 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSACTION_METADATA_KEY = "waslah_transaction_id";

export interface PaymentWebhookDependencies {
  /** المزوّد المركّب؛ غيابه يعطّل المسار بدلاً من قبول ويبهوك قديم غير موثّق. */
  readonly provider?: PaymentProvider;
  readonly confirmDeps: ConfirmPaymentDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** توافق تركيبي مؤقت فقط؛ لا يُقرأ ولا يُستخدم للتحقق. */
  readonly webhookSecret?: string;
  /** توافق تركيبي مؤقت فقط؛ الاسم الفعلي provider.name. */
  readonly providerName?: string;
}

function rejected(c: Context, error: string, status: 400 | 401 | 409 | 422 | 503) {
  return c.json({ ok: false, error }, status);
}

export function createPaymentWebhookRoutes(deps: PaymentWebhookDependencies): Hono {
  const app = new Hono();

  app.post("/webhook/payment", async (c) => {
    if (deps.provider === undefined) {
      deps.log?.("ويبهوك الدفع معطّل لغياب مزوّد موثّق", {});
      return rejected(c, "PAYMENT_PROVIDER_NOT_CONFIGURED", 503);
    }
    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > PAYMENT_WEBHOOK_MAX_BYTES) {
      return rejected(c, "PAYLOAD_TOO_LARGE", 400);
    }
    const raw = await readBounded(c.req.raw.body, PAYMENT_WEBHOOK_MAX_BYTES);
    if (raw === null) return rejected(c, "PAYLOAD_TOO_LARGE", 400);

    // Moyasar يثبت السر داخل الجسم؛ لا HMAC أو ترويسة مخترعة هنا.
    const verified = await deps.provider.verifyWebhook(raw, c.req.raw.headers);
    if (!verified.ok) {
      deps.log?.("رفض ويبهوك دفع غير موثّق", { detail: verified.error.detail });
      return rejected(c, "INVALID_WEBHOOK", 401);
    }

    // لا نقرأ status أو amount أو metadata من الحدث. هذه اللقطة من API المزوّد.
    const snapshot = await deps.provider.fetchTransaction(verified.value.providerTransactionId);
    if (!snapshot.ok) {
      deps.log?.("تعذر إعادة قراءة دفعة مزوّد", { detail: snapshot.error.detail });
      return rejected(c, "PROVIDER_LOOKUP_FAILED", 503);
    }
    if (snapshot.value.id !== verified.value.providerTransactionId) {
      deps.log?.("معرّف الدفعة المعاد لا يطابق الحدث", {});
      return rejected(c, "PROVIDER_TRANSACTION_MISMATCH", 400);
    }

    const localId = snapshot.value.metadata[TRANSACTION_METADATA_KEY];
    if (localId === undefined || !UUID_PATTERN.test(localId)) {
      deps.log?.("دفعة مزوّد بلا إثبات ربط بمعاملة محلية", {});
      return rejected(c, "UNOWNED_PROVIDER_TRANSACTION", 422);
    }
    const local = await deps.confirmDeps.payments.findById(localId as PaymentTransactionId);
    if (!local.ok) {
      deps.log?.("تعذر قراءة المعاملة المحلية", { detail: local.error.detail });
      return rejected(c, "LOCAL_TRANSACTION_LOOKUP_FAILED", 503);
    }
    if (local.value === null) {
      deps.log?.("حدث دفع لمعاملة غير معروفة", {});
      return rejected(c, "UNKNOWN_TRANSACTION", 422);
    }
    if (local.value.provider !== deps.provider.name) {
      deps.log?.("مزوّد الحدث لا يملك المعاملة المحلية", {});
      return rejected(c, "PROVIDER_MISMATCH", 422);
    }
    if (
      local.value.amount.amount !== snapshot.value.amount ||
      local.value.amount.currency.toUpperCase() !== snapshot.value.currency.toUpperCase()
    ) {
      deps.log?.("مبلغ أو عملة دفعة المزوّد لا يطابقان المعاملة", {
        transactionId: local.value.id,
      });
      return rejected(c, "AMOUNT_OR_CURRENCY_MISMATCH", 422);
    }

    const confirmed = await confirmSubscriptionPayment(
      {
        transactionId: local.value.id,
        providerTransactionId: snapshot.value.id,
        newStatus: snapshot.value.status,
        providerAmount: snapshot.value.amount,
        providerCurrency: snapshot.value.currency,
        webhookEventId: verified.value.id,
        provider: deps.provider.name,
        rawPayload: raw,
      },
      deps.confirmDeps,
    );
    if (!confirmed.ok) {
      deps.log?.("رفض تأكيد دفع من RPC", { detail: confirmed.error.detail });
      return rejected(c, "CONFIRMATION_REJECTED", 409);
    }

    return c.json(
      {
        ok: true,
        transactionId: confirmed.value.transactionId,
        duplicate: confirmed.value.duplicate,
      },
      200,
    );
  });

  return app;
}
