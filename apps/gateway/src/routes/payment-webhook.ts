/**
 * الغرض: استقبال ويبهوك تأكيد الدفع من مزوّد الدفع — البند 8.3 و8.5.
 *   يتحقّق من التوقيع بزمن ثابت (بنفس صرامة ويبهوك تلغرام)، ثم يطبّق Idempotency،
 *   ثم يؤكّد المعاملة ذرّياً (تفعيل الاشتراك + دفتر الأستاذ).
 * الحالة: منفّذ فعلياً — البند 8.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts
 * ملاحظات مستقبلية: لا تُخزَّن بيانات بطاقة ولا CVV نهائياً (البند 8.9). لا سرّ في
 *   السجلّات. كل الأسرار في متغيّرات بيئة Render فقط.
 */

import { Hono } from "hono";
import {
  type ConfirmPaymentDeps,
  confirmSubscriptionPayment,
} from "../../../../packages/application/financial/index.ts";
import type {
  PaymentTransactionId,
  PaymentTransactionStatus,
} from "../../../../packages/domain/financial/index.ts";

/**
 * مقارنة زمن ثابت للسرّ — مُعاد استخدامها من نمط ويبهوك تلغرام لا اختراع جديد.
 * لا تكشف طول المحتوى ولا موضع الاختلاف من زمن الاستجابة.
 */
export function paymentSecretsMatch(provided: string, expected: string): boolean {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let diff = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (providedBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }
  return diff === 0;
}

export const PAYMENT_WEBHOOK_MAX_BYTES = 256 * 1024;

export interface PaymentWebhookDependencies {
  /** السرّ المشترك مع مزوّد الدفع — يُقارن بزمن ثابت. */
  readonly webhookSecret: string;
  /** اسم المزوّد للسجلّ. */
  readonly providerName: string;
  readonly confirmDeps: ConfirmPaymentDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * شكل حدث الويبهوك المتوقَّع. المزوّد الفعلي يحدد التفاصيل، لكن العقد ثابت:
 * معرّف الحدث (للإيدمبوتنسي)، معرّف المعاملة عندنا، معرّف العملية عند المزوّد، الحالة.
 */
interface PaymentWebhookEvent {
  readonly eventId: string;
  readonly transactionId: string;
  readonly providerTransactionId: string;
  readonly status: PaymentTransactionStatus;
}

export function createPaymentWebhookRoutes(deps: PaymentWebhookDependencies): Hono {
  const app = new Hono();

  app.post("/webhook/payment", async (c) => {
    const signature = c.req.header("x-payment-signature") ?? "";

    // التحقّق من التوقيع أولاً — بزمن ثابت، قبل أيّ معالجة.
    if (!paymentSecretsMatch(signature, deps.webhookSecret)) {
      deps.log?.("رفض ويبهوك دفع بتوقيع غير مطابق", {});
      return c.json({ ok: false, error: "INVALID_SIGNATURE" }, 401);
    }

    const raw = await c.req.text();
    if (raw.length > PAYMENT_WEBHOOK_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    let event: PaymentWebhookEvent;
    try {
      event = JSON.parse(raw) as PaymentWebhookEvent;
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    if (!event.eventId || !event.transactionId || !event.providerTransactionId || !event.status) {
      return c.json({ ok: false, error: "INVALID_EVENT" }, 400);
    }

    const result = await confirmSubscriptionPayment(
      {
        transactionId: event.transactionId as PaymentTransactionId,
        providerTransactionId: event.providerTransactionId,
        newStatus: event.status,
        webhookEventId: event.eventId,
        provider: deps.providerName,
        rawPayload: raw,
      },
      deps.confirmDeps,
    );

    if (!result.ok) {
      deps.log?.("فشل تأكيد دفع", { detail: result.error.detail });
      return c.json({ ok: false, error: "CONFIRMATION_FAILED" }, 200);
    }

    // 200 حتى للحدث المكرَّر: المزوّد لا يُعاد إرساله بلا داعٍ.
    return c.json(
      { ok: true, transactionId: result.value.transactionId, duplicate: result.value.duplicate },
      200,
    );
  });

  return app;
}
