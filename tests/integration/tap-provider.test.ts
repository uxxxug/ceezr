/**
 * الغرض: اختبار محوّل Tap عبر خادم HTTP محلي فعلي لا عبر mock لـfetch.
 * الحالة: منفّذ فعلياً؛ يغطي إنشاء الدفعة، التحقّق بـHMAC، إعادة القراءة،
 *   تحويل الوحدات الصغرى، 4xx بلا إعادة، 5xx مع إعادة، المهلة، والردّ المشوّه.
 * ينتمي إلى: tests/integration
 * يستخدمه: صيانة عقد Tap عند ترقية المحوّل.
 *
 * كلّ المفاتيح هنا نصوص وهمية صراحةً ولا تصلح عند Tap. ولا يُستدعى خادم Tap
 * الحقيقي في الاختبار: العقد يُثبت على خادمٍ محلّيّ نُشغّله، والتوقيع يُثبت
 * بمتجهٍ محسوبٍ بنفس الخطوات المنشورة في توثيق Tap لا بنسخةٍ من كودنا.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { createPaymentProvider } from "../../packages/infrastructure/financial/payment-provider-factory.ts";
import {
  chargeHashString,
  createTapProvider,
  decimalToMinorUnits,
  minorUnitsToDecimalString,
} from "../../packages/infrastructure/financial/tap-provider.ts";

const secretKey = "sk_test_not_a_real_key";
const transactionId = "11111111-1111-4111-8111-111111111111" as never;
const driverId = "22222222-2222-4222-8222-222222222222" as never;
const chargeId = "chg_TEST0000000000000000001";
const created = "1660000000000";

interface RunningServer {
  readonly server: ReturnType<typeof Bun.serve>;
  readonly provider: ReturnType<typeof createTapProvider>;
  readonly seen: { authorization: string | null; body: string | null; path: string | null };
}
const running: RunningServer[] = [];

function start(handler: (request: Request) => Response | Promise<Response>): RunningServer {
  const seen: RunningServer["seen"] = { authorization: null, body: null, path: null };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      seen.authorization = request.headers.get("authorization");
      seen.path = new URL(request.url).pathname;
      seen.body = request.method === "POST" ? await request.clone().text() : null;
      return handler(request);
    },
  });
  const provider = createTapProvider({
    secretKey,
    redirectUrl: "https://example.invalid/paid",
    postUrl: "https://example.invalid/webhook/payment",
    baseUrl: `http://127.0.0.1:${server.port}/v2`,
    timeoutMs: 40,
    maxAttempts: 3,
  });
  const item = { server, provider, seen };
  running.push(item);
  return item;
}

afterEach(() => {
  while (running.length > 0) running.pop()?.server.stop(true);
});

function chargeBody(overrides: Record<string, unknown> = {}) {
  return {
    id: chargeId,
    status: "CAPTURED",
    amount: 250,
    currency: "SAR",
    metadata: { waslah_transaction_id: transactionId, idempotency_key: "fixture-key" },
    reference: { gateway: "gw-1", payment: "pay-1", transaction: transactionId },
    transaction: { created, url: "https://pay.invalid/hosted" },
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signed(body: Record<string, unknown>): Headers {
  const amount = minorUnitsToDecimalString(
    decimalToMinorUnits(body.amount, String(body.currency)) ?? 0,
    String(body.currency),
  );
  const reference = body.reference as { gateway?: string; payment?: string } | undefined;
  const transaction = body.transaction as { created?: string } | undefined;
  const hash = createHmac("sha256", secretKey)
    .update(
      chargeHashString({
        id: String(body.id),
        amount: String(amount),
        currency: String(body.currency),
        gatewayReference: reference?.gateway ?? "",
        paymentReference: reference?.payment ?? "",
        status: String(body.status),
        created: transaction?.created ?? "",
      }),
    )
    .digest("hex");
  return new Headers({ hashstring: hash });
}

function charge(provider: ReturnType<typeof createTapProvider>) {
  return provider.chargeSubscription({
    transactionId,
    driverId,
    amount: { amount: 25000, currency: "SAR" },
    purpose: "driver_subscription",
    idempotencyKey: "fixture-key",
  });
}

describe("محوّل Tap على خادم HTTP محلّي حقيقي", () => {
  it("يُختار tap صراحةً ويُرفض نقص مفاتيحه بدل أن يُنتج مزوّداً يفشل عند أول دفعة", () => {
    const chosen = createPaymentProvider("tap", {
      tap: { secretKey, redirectUrl: "https://example.invalid/paid" },
    });
    expect(chosen.ok).toBe(true);
    expect(chosen.ok === true ? chosen.value.name : "").toBe("tap");

    const missing = createPaymentProvider("tap", {});
    expect(missing.ok).toBe(false);
    expect(missing.ok === false ? missing.error.detail : "").toBe("TAP_SECRETS_REQUIRED");

    const incomplete = createPaymentProvider("tap", {
      tap: { secretKey: "  ", redirectUrl: "https://example.invalid/paid" },
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.ok === false ? incomplete.error.detail : "").toBe(
      "TAP_CONFIGURATION_INCOMPLETE",
    );
  });

  it("الوحدات الصغرى تُحوَّل ذهاباً وعوداً بأسّ العملة لا بالتقريب", () => {
    expect(minorUnitsToDecimalString(25000, "SAR")).toBe("250.00");
    expect(minorUnitsToDecimalString(5, "SAR")).toBe("0.05");
    expect(minorUnitsToDecimalString(3000, "KWD")).toBe("3.000");
    // عملة غير معروفة تُرفض ولا تُحسب بأسّ مفترض.
    expect(minorUnitsToDecimalString(25000, "XYZ")).toBeNull();
    expect(decimalToMinorUnits(250, "SAR")).toBe(25000);
    expect(decimalToMinorUnits("250.00", "SAR")).toBe(25000);
    expect(decimalToMinorUnits("3.000", "KWD")).toBe(3000);
    // كسرٌ أدقّ من أسّ العملة لا يُقرَّب صامتاً: يُرفض.
    expect(decimalToMinorUnits("250.005", "SAR")).toBeNull();
    expect(decimalToMinorUnits("250.0000", "SAR")).toBe(25000);
    expect(decimalToMinorUnits("abc", "SAR")).toBeNull();
  });

  it("ينشئ دفعة مستضافة بـBearer ويُرسل معرّف معاملتنا في metadata وreference", async () => {
    const { provider, seen } = start(() => json(chargeBody({ status: "INITIATED", amount: 250 })));
    const result = await charge(provider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checkoutUrl).toBe("https://pay.invalid/hosted");
    expect(result.value.providerTransactionId).toBe(chargeId);
    expect(result.value.status).toBe("pending");
    expect(seen.authorization).toBe(`Bearer ${secretKey}`);
    expect(seen.path).toBe("/v2/charges");
    const sent = JSON.parse(String(seen.body)) as Record<string, unknown>;
    // المبلغ يُرسل عشرياً بعملته لا بوحداتٍ صغرى: 250.00 لا 25000.
    expect(sent.amount).toBe(250);
    expect(sent.currency).toBe("SAR");
    expect((sent.metadata as Record<string, string>).waslah_transaction_id).toBe(transactionId);
    expect((sent.reference as Record<string, string>).transaction).toBe(transactionId);
    expect((sent.source as Record<string, string>).id).toBe("src_all");
    expect((sent.redirect as Record<string, string>).url).toBe("https://example.invalid/paid");
    expect(sent.save_card).toBe(false);
  });

  it("حالة إنشاء غير متوقّعة لا تُعتبر بدايةً صحيحة", async () => {
    const { provider } = start(() => json(chargeBody({ status: "CAPTURED" })));
    const result = await charge(provider);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error.detail : "").toBe("TAP_UNEXPECTED_CHARGE_STATUS");
  });

  it("يقبل ويبهوكاً موقّعاً صحيحاً ويستخرج معرّف الدفعة وهويّة حدثٍ ثابتة", async () => {
    const { provider } = start(() => json(chargeBody()));
    const body = chargeBody();
    const raw = JSON.stringify(body);
    const first = await provider.verifyWebhook(raw, signed(body));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.providerTransactionId).toBe(chargeId);
    // نفس الويبهوك ⇒ نفس المعرّف: الإدمبوتنسيّة تعتمد عليه.
    const again = await provider.verifyWebhook(raw, signed(body));
    expect(again.ok === true ? again.value.id : "").toBe(first.value.id);
    // انتقال حالةٍ حقيقيّ ⇒ معرّف مختلف فيُعالَج مرّةً واحدة لا يُبتلع.
    const other = chargeBody({ status: "FAILED" });
    const transition = await provider.verifyWebhook(JSON.stringify(other), signed(other));
    expect(transition.ok === true ? transition.value.id : "").not.toBe(first.value.id);
  });

  it("يرفض ويبهوكاً بلا ترويسة توقيع أو بتوقيع خاطئ أو بحمولةٍ مُعدَّلة", async () => {
    const { provider } = start(() => json(chargeBody()));
    const body = chargeBody();

    const noHeader = await provider.verifyWebhook(JSON.stringify(body), new Headers());
    expect(noHeader.ok === false ? noHeader.error.detail : "").toBe(
      "TAP_WEBHOOK_HASHSTRING_MISSING",
    );

    const wrong = await provider.verifyWebhook(
      JSON.stringify(body),
      new Headers({ hashstring: "0".repeat(64) }),
    );
    expect(wrong.ok === false ? wrong.error.detail : "").toBe("TAP_WEBHOOK_SIGNATURE_MISMATCH");

    // توقيعٌ صحيحٌ لمبلغٍ ثم تعديل المبلغ في الجسم: التوقيع لم يعد يطابق.
    const tampered = { ...body, amount: 900 };
    const stale = await provider.verifyWebhook(JSON.stringify(tampered), signed(body));
    expect(stale.ok === false ? stale.error.detail : "").toBe("TAP_WEBHOOK_SIGNATURE_MISMATCH");

    const brokenJson = await provider.verifyWebhook("{", signed(body));
    expect(brokenJson.ok === false ? brokenJson.error.detail : "").toBe("TAP_WEBHOOK_INVALID_JSON");
  });

  it("يعيد قراءة الدفعة من خادم Tap ويحوّل المبلغ إلى وحداتٍ صغرى", async () => {
    const { provider, seen } = start(() => json(chargeBody()));
    const snapshot = await provider.fetchTransaction(chargeId);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.value.amount).toBe(25000);
    expect(snapshot.value.currency).toBe("SAR");
    expect(snapshot.value.status).toBe("active");
    expect(snapshot.value.metadata.waslah_transaction_id).toBe(transactionId);
    expect(seen.path).toBe(`/v2/charges/${chargeId}`);
  });

  it("معرّف مختلف في الردّ لا يُقبل، ودفعةٌ بلا ربطٍ بمعاملتنا تُرفض", async () => {
    const mismatch = start(() => json(chargeBody({ id: "chg_OTHER" })));
    const first = await mismatch.provider.fetchTransaction(chargeId);
    expect(first.ok === false ? first.error.detail : "").toBe("TAP_CHARGE_ID_MISMATCH");

    const unowned = start(() => json(chargeBody({ metadata: {} })));
    const second = await unowned.provider.fetchTransaction(chargeId);
    expect(second.ok === false ? second.error.detail : "").toBe("TAP_MALFORMED_CHARGE_RESPONSE");

    const unknownStatus = start(() => json(chargeBody({ status: "SOMETHING_NEW" })));
    const third = await unknownStatus.provider.fetchTransaction(chargeId);
    expect(third.ok === false ? third.error.detail : "").toBe("TAP_MALFORMED_CHARGE_RESPONSE");
  });

  it("لا يعيد محاولة 4xx، ويعيد 5xx ثم ينجح، ولا يعلّق على طلبٍ بطيء", async () => {
    let unauthorizedCalls = 0;
    const unauthorized = start(() => {
      unauthorizedCalls += 1;
      return json({ errors: [{ code: "2107" }] }, 401);
    });
    const denied = await charge(unauthorized.provider);
    expect(denied.ok).toBe(false);
    expect(denied.ok === false ? denied.error.detail : "").toBe("TAP_HTTP_401");
    expect(unauthorizedCalls).toBe(1);

    let flakyCalls = 0;
    const flaky = start(() => {
      flakyCalls += 1;
      return flakyCalls < 3
        ? json({ message: "upstream" }, 503)
        : json(chargeBody({ status: "INITIATED" }));
    });
    const recovered = await charge(flaky.provider);
    expect(recovered.ok).toBe(true);
    expect(flakyCalls).toBe(3);

    const slow = start(async () => {
      await Bun.sleep(400);
      return json(chargeBody({ status: "INITIATED" }));
    });
    const timedOut = await charge(slow.provider);
    expect(timedOut.ok).toBe(false);
    expect(timedOut.ok === false ? timedOut.error.detail : "").toBe("TAP_NETWORK_OR_TIMEOUT");
  });

  it("نصّ التوقيع مطابقٌ حرفياً لصيغة Tap المنشورة", () => {
    // متجه محسوب يدوياً من خطوات توثيق Tap: x_id…x_amount…x_created — بلا اعتماد
    // على أي دالة من كودنا في بناء النصّ المتوقَّع.
    const text =
      "x_idchg_1x_amount2.00x_currencySARx_gateway_referencegw_1x_payment_referencepay_1x_statusCAPTUREDx_created1660000000000";
    expect(
      chargeHashString({
        id: "chg_1",
        amount: "2.00",
        currency: "SAR",
        gatewayReference: "gw_1",
        paymentReference: "pay_1",
        status: "CAPTURED",
        created: "1660000000000",
      }),
    ).toBe(text);
  });
});
