/**
 * الغرض: التحقّق أنّ **كلَّ ردٍّ** من خادمِ البوابةِ يحمل `X-Request-Id` مولَّداً
 *   من الخادمِ وحدَه — البند `F1-08` · ADR 0043.
 * الحالة: اختبار فعلي. لا شبكة: Hono يعالج الطلبَ في العمليةِ نفسِها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حين يُربَط `traceparent` في `F8-01` يُضاف ههنا تحقّقٌ من
 *   استمرارِ سياقِ التتبّعِ عبرَ الطابور — وهو ما لا يُقاس اليوم.
 *
 * وما لا يُدَّعى ههنا: لا شبكةَ حقيقيةَ ولا وكيلَ عكسيَّ ولا حافةَ Fly.io. فالمُثبَتُ
 * أنّ التطبيقَ نفسَه يُصدِر الرأسَ، لا أنّ الرأسَ يبقى سالماً عبرَ كلِّ وسيطٍ
 * أمامَه في الإنتاج.
 */
import { describe, expect, it } from "bun:test";
import { REQUEST_ID_HEADER } from "../../apps/gateway/src/observability/request-id.ts";
import { createServer } from "../../apps/gateway/src/server.ts";

const STARTED_AT = new Date("2026-08-29T00:00:00.000Z");
const NOW = new Date("2026-08-29T00:01:00.000Z");
const SECRET = "test-webhook-secret-value";

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "x",
  DRIVER_BOT_TOKEN: "x",
  RIDER_BOT_TOKEN: "x",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

function buildApp(opts: { newRequestId?: () => string; explode?: boolean } = {}) {
  return createServer({
    health: { now: () => NOW, startedAt: STARTED_AT, env: FULL_ENV },
    webhook: {
      webhookSecret: SECRET,
      handler: {
        handle: async () => {
          if (opts.explode) throw new Error("انفجارٌ مقصودٌ لاختبارِ مسارِ الاستثناء");
          return true;
        },
      },
      ...(opts.explode ? { log: () => undefined } : {}),
    },
    ...(opts.newRequestId === undefined ? {} : { newRequestId: opts.newRequestId }),
  });
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function webhookRequest(): Request {
  return new Request("http://localhost/webhook/telegram/driver", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify({ update_id: 1 }),
  });
}

describe("F1-08 · معرّفُ الطلبِ في كلِّ ردّ", () => {
  it("ردٌّ ناجحٌ يحمل معرّفاً بصيغةِ UUID", async () => {
    const res = await buildApp().request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("ردُّ `404` يحمل معرّفاً — وهو أوّلُ ما يحتاجه المشغّلُ لا آخِرُه", async () => {
    const res = await buildApp().request("http://localhost/لا-وجود-له");
    expect(res.status).toBe(404);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("ردُّ الاستثناءِ غيرِ المتوقَّعِ (500) يحمل معرّفاً", async () => {
    const res = await buildApp({ explode: true }).request(webhookRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "INTERNAL_ERROR" });
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("ردٌّ برمزِ عميلٍ (`401` من ويبهوكٍ بسرٍّ خاطئ) يحمل معرّفاً", async () => {
    const res = await buildApp().request(
      new Request("http://localhost/webhook/telegram/driver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "not-the-secret",
        },
        body: JSON.stringify({ update_id: 2 }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("معرّفٌ لكلِّ طلبٍ لا معرّفٌ للعمليةِ: طلبان لا يتشاركان معرّفاً", async () => {
    const app = buildApp();
    const first = await app.request("http://localhost/health");
    const second = await app.request("http://localhost/health");
    const a = first.headers.get(REQUEST_ID_HEADER);
    const b = second.headers.get(REQUEST_ID_HEADER);
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it("**رأسُ العميلِ لا يُقرأ**: المعرّفُ المُعادُ ليس ما أرسله المُرسِل", async () => {
    // قيمةُ رأسٍ لا تكون إلّا ASCII — والمحقونُ مقبولُ الشكلِ قصداً: لو كان الوسيطُ
    // يقرأ الوارِدَ لمرَّ هذا كما هو، فرفضُه إنكارٌ للمصدرِ لا تدقيقٌ للشكل.
    const injected = "client-supplied-request-id-0001";
    const res = await buildApp().request(
      new Request("http://localhost/health", { headers: { [REQUEST_ID_HEADER]: injected } }),
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBe(injected);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("مولّدٌ يُخرِج شكلاً غيرَ مقبولٍ يُستبدَل ولا يُسقِط الطلبَ", async () => {
    const res = await buildApp({ newRequestId: () => "أ\nب" }).request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("مولّدٌ يرمي استثناءً يُستبدَل ولا يُسقِط الطلبَ", async () => {
    const res = await buildApp({
      newRequestId: () => {
        throw new Error("مولّدٌ معطوبٌ");
      },
    }).request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_SHAPE);
  });

  it("مولّدٌ مقبولُ الشكلِ (ULID مثلاً) يُستعمَل كما هو", async () => {
    const ulid = "01J8XQ2K4N7P9R3T5V7W9Y1Z3B";
    const res = await buildApp({ newRequestId: () => ulid }).request("http://localhost/health");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(ulid);
  });

  it("المعرّفُ في الرأسِ وحدَه — لا يُحقَن في جسمِ الردّ (عقدُ القسم 10 كما هو)", async () => {
    const res = await buildApp().request("http://localhost/health");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("requestId");
    expect(JSON.stringify(body)).not.toContain(res.headers.get(REQUEST_ID_HEADER) ?? "?");
  });
});
