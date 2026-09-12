/**
 * الغرض: محوّل Tap Payments الحقيقي — إنشاء دفعة مستضافة، إثبات أصل الويبهوك
 *   بـHMAC، وإعادة قراءة الدفعة من خادم Tap قبل أي أثر مالي.
 * الحالة: منفّذ فعلياً؛ لا يقرأ process.env ولا يسجّل مفتاحاً ولا حمولةً كاملة.
 * ينتمي إلى: infrastructure/financial
 * يستخدمه: apps/gateway عبر createPaymentProvider فقط.
 *
 * لماذا وُجد؟ لأنّ مزوّد الإنتاج المُقرَّر هو Tap، وكان المستودع يحمل محوّل
 * Moyasar وحده. المنفذ (PaymentProvider) لم يتغيّر: المحوّلان يتبادلان الموضع
 * بضبط `PAYMENT_PROVIDER` وحده، فلا يعلم مسار الويبهوك ولا بوت السائق بأيّهما.
 *
 * ثلاثة فروق جوهرية عن Moyasar، وكلٌّ منها مصدر عيبٍ إن أُغفل:
 *
 *   (١) المبلغ عند Tap عشريّ بعملته (2.00 ريال) لا وحداتٍ صغرى (200 هلّة).
 *       النطاق كلّه يحسب بالوحدات الصغرى (ممنوع float)، فالتحويل يقع في هذا
 *       الملفّ وحده، بأسٍّ عشريٍّ لكلّ عملة (ISO 4217)، ذهاباً وعودةً.
 *   (٢) لا يُرسل Tap معرّف حدثٍ مستقلاً. الإدمبوتنسيّة تحتاج هويّةً ثابتة
 *       للحدث نفسه: تُشتقّ من (معرّف الدفعة + الحالة + زمن الإنشاء). إعادةُ
 *       إرسال نفس الويبهوك تُنتج نفس المعرّف فتُبتلع، وانتقالُ حالةٍ حقيقيّ
 *       يُنتج معرّفاً مختلفاً فيُعالَج.
 *   (٣) التحقّق HMAC-SHA256 على نصٍّ مُرتَّبٍ محدَّدٍ من Tap، بالمفتاح السرّي
 *       نفسه. لا سرّ ويبهوك منفصل: اختراعُ متغيّرٍ ثانٍ يُوهم المشغّل بضبطٍ لا
 *       وجود له.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  ProviderEvent,
  ProviderTransactionSnapshot,
} from "../../application/financial/ports.ts";
import { PortFailureError } from "../../application/ports/index.ts";
import type { PaymentTransactionStatus } from "../../domain/financial/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

const TAP_API_URL = "https://api.tap.company/v2";
const PAYMENT_METADATA_TRANSACTION_ID = "waslah_transaction_id";
/** صفحةٌ مستضافة عند Tap تعرض كلّ وسائل الدفع المفعَّلة للتاجر (مدى وبطاقات وApple Pay). */
const HOSTED_ALL_METHODS_SOURCE = "src_all";

/**
 * أسّ العشرة لكلّ عملة كما في ISO 4217 — بروتوكول عملة لا سياسة تسعير.
 * الافتراض ليس الحلّ: عملةٌ غير مذكورة تُرفض بدل أن تُحسب بأسٍّ خاطئ فيُطلب
 * من السائق عشرةُ أضعاف المبلغ أو عُشره.
 */
const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  SAR: 2,
  AED: 2,
  QAR: 2,
  EGP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
};

export interface TapProviderOptions {
  /** مفتاح Tap السرّي (sk_…): يُرسل Bearer، وهو نفسه مفتاح HMAC للويبهوك. */
  readonly secretKey: string;
  /** الصفحة التي يُعاد إليها الدافع بعد إتمام الدفع (عامّة لا سرّ فيها). */
  readonly redirectUrl: string;
  /** عنوان الويبهوك الذي يُرسل Tap إليه الحدث؛ غيابه يعني الاعتماد على ضبط لوحة Tap. */
  readonly postUrl?: string;
  /** للاختبارات المحلية فقط؛ الإنتاج يستخدم عنوان Tap الرسمي. */
  readonly baseUrl?: string;
  /** حدّ زمني تقني للطلب؛ يضبطه التركيب ولا يرتبط بسعر أو سياسة تجارية. */
  readonly timeoutMs?: number;
  /** عدد المحاولات الكلّي لخطأ شبكة أو 5xx؛ يضبطه التركيب. */
  readonly maxAttempts?: number;
}

interface TapCharge {
  readonly id: unknown;
  readonly status: unknown;
  readonly amount: unknown;
  readonly currency: unknown;
  readonly metadata?: unknown;
  readonly reference?: unknown;
  readonly transaction?: unknown;
}

function error(detail: string): Result<never, PortFailureError> {
  return err(new PortFailureError("tap", detail));
}

function constantTimeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // طولٌ مختلف يكشف نفسه في أي حال؛ المقارنة تبقى على مخزنٍ واحد كي لا
    // يتحوّل الفرق إلى قناةٍ زمنيّة على المحتوى.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** يحوّل الوحدات الصغرى إلى نصّ عشريّ بأسّ العملة: 25000 هلّة ⇒ "250.00". */
export function minorUnitsToDecimalString(minor: number, currency: string): string | null {
  const exponent = CURRENCY_EXPONENT[currency.toUpperCase()];
  if (exponent === undefined || !Number.isInteger(minor) || minor <= 0) return null;
  const factor = 10 ** exponent;
  const whole = Math.trunc(minor / factor);
  const fraction = minor % factor;
  return exponent === 0 ? `${whole}` : `${whole}.${String(fraction).padStart(exponent, "0")}`;
}

/**
 * يحوّل مبلغ Tap العشريّ إلى وحداتٍ صغرى صحيحة. لا يُقبل ما لا يُمثَّل بدقّة:
 * كسرٌ أدقّ من أسّ العملة يعني حمولةً غير مفهومة، وتقريبُه صامتاً يُنتج فرقاً
 * مالياً بين ما دفعه السائق وما سجّلناه.
 */
export function decimalToMinorUnits(value: unknown, currency: string): number | null {
  const exponent = CURRENCY_EXPONENT[currency.toUpperCase()];
  if (exponent === undefined) return null;
  const text = typeof value === "number" ? value.toFixed(exponent) : value;
  if (typeof text !== "string" || !/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > exponent) {
    // كسرٌ أطول من أسّ العملة: يُقبل فقط إن كانت الزيادة أصفاراً.
    if (!/^0+$/.test(fraction.slice(exponent))) return null;
  }
  const padded = fraction.slice(0, exponent).padEnd(exponent, "0");
  const minor = Number(`${whole}${padded}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * تعيين حالات Tap على حالات معاملتنا. المجهول يُرفض (null) ولا يُعامل كفشل:
 * حالةٌ جديدةٌ من المزوّد يجب أن تُعلن نفسها في السجلّ لا أن تُغلق معاملةً.
 */
function mapStatus(status: unknown): PaymentTransactionStatus | null {
  if (typeof status !== "string") return null;
  switch (status.toUpperCase()) {
    case "CAPTURED":
      return "active";
    case "INITIATED":
    case "IN_PROGRESS":
    case "INPROGRESS":
      return "pending";
    case "AUTHORIZED":
      return "past_due";
    case "FAILED":
    case "DECLINED":
    case "TIMEDOUT":
    case "RESTRICTED":
    case "ABANDONED":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
    case "VOID":
    case "REFUNDED":
      // لا تملك دورة الاشتراك حالة استرداد قابلة للتأكيد؛ ويبهوك استرداد لا
      // يجوز أن يُعيد تفعيل اشتراك، فيُعامل كإلغاء محلّي نهائيّ.
      return "canceled";
    case "EXPIRED":
      return "expired";
    default:
      return null;
  }
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

function nestedString(container: unknown, key: string): string {
  if (typeof container !== "object" || container === null) return "";
  const value = (container as Record<string, unknown>)[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/**
 * النصّ الذي يوقّعه Tap حرفياً — ترتيبه وأسماؤه من توثيق Tap لا من اجتهادنا:
 * x_id…x_amount…x_currency…x_gateway_reference…x_payment_reference…x_status…x_created
 * والمبلغ فيه بصيغته العشريّة القياسيّة للعملة، لا بوحداتٍ صغرى.
 */
export function chargeHashString(input: {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly gatewayReference: string;
  readonly paymentReference: string;
  readonly status: string;
  readonly created: string;
}): string {
  return `x_id${input.id}x_amount${input.amount}x_currency${input.currency}x_gateway_reference${input.gatewayReference}x_payment_reference${input.paymentReference}x_status${input.status}x_created${input.created}`;
}

import { createGuardedFetch } from "../../shared/wasla/egress-gate.ts";
export function createTapProvider(options: TapProviderOptions): PaymentProvider {
  const baseUrl = (options.baseUrl ?? TAP_API_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 3;
  /** البوّابةُ: نداءٌ إلى غيرِ `api.tap.company` يُرفَضُ (`W-6` / `ADR 0086`). */
  const doFetch = createGuardedFetch("tap-payments");

  async function request(
    path: string,
    init: RequestInit,
  ): Promise<Result<Response, PortFailureError>> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${options.secretKey}`,
            ...init.headers,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        if (attempt < maxAttempts) continue;
        return error("TAP_NETWORK_OR_TIMEOUT");
      }
      if (response.status >= 500 && attempt < maxAttempts) continue;
      // 4xx لا يُعاد: عمليةٌ مرفوضةٌ لا تصير مقبولةً بالتكرار، وإعادتُها تُخفي
      // خطأ اعتمادٍ أو حمولةٍ عن المشغّل.
      if (!response.ok) return error(`TAP_HTTP_${response.status}`);
      return ok(response);
    }
    return error("TAP_RETRY_EXHAUSTED");
  }

  function readCharge(charge: TapCharge): Result<ProviderTransactionSnapshot, PortFailureError> {
    const status = mapStatus(charge.status);
    const metadata = textRecord(charge.metadata ?? {});
    if (
      typeof charge.id !== "string" ||
      charge.id.length === 0 ||
      status === null ||
      typeof charge.currency !== "string" ||
      charge.currency.length !== 3 ||
      metadata === null ||
      typeof metadata[PAYMENT_METADATA_TRANSACTION_ID] !== "string"
    ) {
      return error("TAP_MALFORMED_CHARGE_RESPONSE");
    }
    const minor = decimalToMinorUnits(charge.amount, charge.currency);
    if (minor === null) return error("TAP_UNREPRESENTABLE_AMOUNT");
    return ok({
      id: charge.id,
      status,
      amount: minor,
      currency: charge.currency.toUpperCase(),
      metadata,
      // Tap لا يُصدر فاتورةً لهذا المسار؛ الإفصاح بـnull أصدق من معرّفٍ مختلق.
      invoiceId: null,
    } satisfies ProviderTransactionSnapshot);
  }

  return {
    name: "tap",

    async chargeSubscription(input) {
      const decimalAmount = minorUnitsToDecimalString(input.amount.amount, input.amount.currency);
      if (decimalAmount === null) return error("TAP_UNSUPPORTED_CURRENCY_OR_AMOUNT");
      const response = await request("/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(decimalAmount),
          currency: input.amount.currency.toUpperCase(),
          customer_initiated: true,
          threeDSecure: true,
          save_card: false,
          description: "اشتراك السائق",
          // معرّف معاملتنا يُرسل في الموضعين: metadata هو ما يقرؤه مسار
          // الويبهوك لإثبات الملكيّة، وreference.transaction ما يظهر للتاجر
          // في لوحة Tap فتصير المطابقة اليدويّة ممكنةً عند نزاع.
          metadata: {
            [PAYMENT_METADATA_TRANSACTION_ID]: input.transactionId,
            idempotency_key: input.idempotencyKey,
          },
          reference: { transaction: input.transactionId },
          source: { id: HOSTED_ALL_METHODS_SOURCE },
          redirect: { url: options.redirectUrl },
          ...(options.postUrl === undefined ? {} : { post: { url: options.postUrl } }),
        }),
      });
      if (!response.ok) return response;
      let charge: TapCharge;
      try {
        charge = (await response.value.json()) as TapCharge;
      } catch {
        return error("TAP_MALFORMED_CHARGE_RESPONSE");
      }
      const checkoutUrl = nestedString(charge.transaction, "url");
      if (typeof charge.id !== "string" || charge.id.length === 0 || checkoutUrl === "") {
        return error("TAP_MALFORMED_CHARGE_RESPONSE");
      }
      const status = mapStatus(charge.status);
      if (status !== "pending") return error("TAP_UNEXPECTED_CHARGE_STATUS");
      // معرّف Tap للدفعة هو نفسه ما يُعاد قراءته لاحقاً (chg_…)، فيُخزَّن فوراً:
      // بذلك تبقى الدفعة قابلةً للتسوية حتى لو لم يصل ويبهوك قطّ.
      return ok({ providerTransactionId: charge.id, checkoutUrl, status: "pending" });
    },

    async verifyWebhook(rawBody, headers) {
      let body: TapCharge;
      try {
        body = JSON.parse(rawBody) as TapCharge;
      } catch {
        return error("TAP_WEBHOOK_INVALID_JSON");
      }
      const posted = headers.get("hashstring") ?? "";
      if (posted === "") return error("TAP_WEBHOOK_HASHSTRING_MISSING");
      if (
        typeof body.id !== "string" ||
        body.id.length === 0 ||
        typeof body.status !== "string" ||
        typeof body.currency !== "string"
      ) {
        return error("TAP_WEBHOOK_MALFORMED");
      }
      const created = nestedString(body.transaction, "created");
      if (created === "") return error("TAP_WEBHOOK_MALFORMED");
      const minor = decimalToMinorUnits(body.amount, body.currency);
      if (minor === null) return error("TAP_WEBHOOK_MALFORMED");
      const amountText = minorUnitsToDecimalString(minor, body.currency);
      if (amountText === null) return error("TAP_WEBHOOK_MALFORMED");
      const expected = createHmac("sha256", options.secretKey)
        .update(
          chargeHashString({
            id: body.id,
            amount: amountText,
            currency: body.currency,
            gatewayReference: nestedString(body.reference, "gateway"),
            paymentReference: nestedString(body.reference, "payment"),
            status: body.status,
            created,
          }),
        )
        .digest("hex");
      if (!constantTimeEquals(posted, expected)) return error("TAP_WEBHOOK_SIGNATURE_MISMATCH");
      return ok({
        // هويّة الحدث مشتقّة لا مُرسَلة: نفس الويبهوك يُنتج نفس المعرّف فيُبتلع،
        // وانتقالُ حالةٍ حقيقيّ يُنتج معرّفاً آخر فيُعالَج مرّةً واحدة.
        id: `tap:${body.id}:${body.status}:${created}`,
        type: `charge.${body.status.toLowerCase()}`,
        providerTransactionId: body.id,
      } satisfies ProviderEvent);
    },

    async fetchTransaction(providerTransactionId) {
      const response = await request(`/charges/${encodeURIComponent(providerTransactionId)}`, {
        method: "GET",
      });
      if (!response.ok) return response;
      let charge: TapCharge;
      try {
        charge = (await response.value.json()) as TapCharge;
      } catch {
        return error("TAP_MALFORMED_CHARGE_RESPONSE");
      }
      if (charge.id !== providerTransactionId) return error("TAP_CHARGE_ID_MISMATCH");
      return readCharge(charge);
    },
  };
}

export { PAYMENT_METADATA_TRANSACTION_ID };
