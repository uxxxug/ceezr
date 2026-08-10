/**
 * الغرض: اختبار خادم البوابة الحقيقي عبر طلبات HTTP فعلية على التطبيق نفسه.
 * الحالة: اختبار فعلي. لا شبكة ولا مفتاح: Hono يعالج الطلب في العملية نفسها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند تركيب grammY يُضاف اختبار يتحقّق أن التحديث وصل إلى المعالج الصحيح.
 */
import { describe, expect, it } from "bun:test";
import {
  type BotKind,
  MAX_WEBHOOK_BODY_BYTES,
  secretsMatch,
  TELEGRAM_SECRET_HEADER,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";
import { createServer } from "../../apps/gateway/src/server.ts";

const SECRET = "test-webhook-secret-value";
const STARTED_AT = new Date("2026-08-06T12:00:00.000Z");
const NOW = new Date("2026-08-06T12:01:30.000Z");

/** بيئة كاملة صالحة — لا مفتاح حقيقي، فقط قيم غير فارغة لاختبار الجهوزية. */
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

function buildApp(opts: {
  env?: Record<string, string | undefined>;
  handled?: boolean;
  readinessChecks?: readonly {
    name: string;
    check: () => Promise<boolean>;
    critical?: boolean;
  }[];
  received?: { bot: BotKind; update: unknown }[];
}) {
  const received = opts.received ?? [];
  return createServer({
    health: {
      now: () => NOW,
      startedAt: STARTED_AT,
      env: opts.env ?? FULL_ENV,
      ...(opts.readinessChecks === undefined ? {} : { readinessChecks: opts.readinessChecks }),
    },
    webhook: {
      webhookSecret: SECRET,
      handler: {
        handle: async (bot, update) => {
          received.push({ bot, update });
          return opts.handled ?? true;
        },
      },
    },
  });
}

function webhookRequest(
  body: unknown,
  opts: { secret?: string; bot?: string; rawBody?: string } = {},
): Request {
  return new Request(`http://localhost/webhook/telegram/${opts.bot ?? "driver"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.secret === undefined ? {} : { [TELEGRAM_SECRET_HEADER]: opts.secret }),
    },
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

describe("secretsMatch", () => {
  it("يطابق السرّ الصحيح", () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
  });
  it("يرفض سرّاً مختلفاً بنفس الطول", () => {
    expect(secretsMatch("a".repeat(SECRET.length), SECRET)).toBe(false);
  });
  it("يرفض سرّاً أقصر أو أطول", () => {
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false);
  });
  it("يرفض السرّ الفارغ", () => {
    expect(secretsMatch("", SECRET)).toBe(false);
  });
});

describe("GET /health", () => {
  it("يجيب 200 مع مدة التشغيل المحسوبة", async () => {
    const res = await buildApp({}).request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", uptimeSeconds: 90 });
  });
});

describe("GET /ready", () => {
  it("جاهز عندما تكتمل المتغيرات", async () => {
    const res = await buildApp({}).request("http://localhost/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ready",
      missingEnv: [],
      failedChecks: [],
      degradedChecks: [],
    });
  });

  it("غير جاهز 503 ويسمّي المتغيرات الناقصة", async () => {
    const partial = { ...FULL_ENV };
    delete partial.SUPABASE_SERVICE_ROLE_KEY;
    delete partial.UPSTASH_REDIS_REST_TOKEN;

    const res = await buildApp({ env: partial }).request("http://localhost/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; missingEnv: string[] };
    expect(body.status).toBe("not_ready");
    expect(body.missingEnv.sort()).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
      "UPSTASH_REDIS_REST_TOKEN",
    ]);
  });

  it("غير جاهز إن فشل فحص تبعية", async () => {
    const res = await buildApp({
      readinessChecks: [{ name: "database", check: async () => false }],
    }).request("http://localhost/ready");
    expect(res.status).toBe(503);
    expect((await res.json()) as { failedChecks: string[] }).toMatchObject({
      failedChecks: ["database"],
    });
  });

  it("الفحص الذي يرمي استثناءً يُعتبر فاشلاً لا ناجحاً", async () => {
    const res = await buildApp({
      readinessChecks: [
        {
          name: "redis",
          check: async () => {
            throw new Error("connection refused");
          },
        },
      ],
    }).request("http://localhost/ready");
    expect(res.status).toBe(503);
  });

  /**
   * الفصل بين «لا تعمل» و«تعمل ناقصةً». راجع التعليق على ReadinessProbe:
   * Render يقطع الحركة بعد 15 ثانية من فشل الفحص ويُعيد التشغيل بعد 60.
   */
  describe("تصنيف التبعيات: حرجة مقابل مُضعِفة", () => {
    it("تبعية غير حرجة فاشلة تُبقي 200 مع degraded وتسمّيها", async () => {
      const res = await buildApp({
        readinessChecks: [
          { name: "database", check: async () => true },
          { name: "redis", critical: false, check: async () => false },
        ],
      }).request("http://localhost/ready");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "degraded",
        missingEnv: [],
        failedChecks: [],
        degradedChecks: ["redis"],
      });
    });

    it("تبعية غير حرجة ترمي استثناءً تُضعِف ولا تُسقِط", async () => {
      const res = await buildApp({
        readinessChecks: [
          {
            name: "redis",
            critical: false,
            check: async () => {
              throw new Error("connection refused");
            },
          },
        ],
      }).request("http://localhost/ready");

      expect(res.status).toBe(200);
      expect((await res.json()) as { degradedChecks: string[] }).toMatchObject({
        status: "degraded",
        degradedChecks: ["redis"],
      });
    });

    it("القاعدة حرجة: سقوطها يُسقِط الجهوزية حتى لو كان Redis سليماً", async () => {
      const res = await buildApp({
        readinessChecks: [
          { name: "database", check: async () => false },
          { name: "redis", critical: false, check: async () => true },
        ],
      }).request("http://localhost/ready");

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        status: "not_ready",
        missingEnv: [],
        failedChecks: ["database"],
        degradedChecks: [],
      });
    });

    it("سقوط الاثنين معاً: 503 وكلّ واحد في خانته", async () => {
      const res = await buildApp({
        readinessChecks: [
          { name: "database", check: async () => false },
          { name: "redis", critical: false, check: async () => false },
        ],
      }).request("http://localhost/ready");

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        status: "not_ready",
        missingEnv: [],
        failedChecks: ["database"],
        degradedChecks: ["redis"],
      });
    });

    it("الافتراضي حرج: فحص بلا critical يُسقِط الجهوزية", async () => {
      const res = await buildApp({
        readinessChecks: [{ name: "تبعية جديدة", check: async () => false }],
      }).request("http://localhost/ready");

      expect(res.status).toBe(503);
      expect((await res.json()) as { failedChecks: string[] }).toMatchObject({
        failedChecks: ["تبعية جديدة"],
        degradedChecks: [],
      });
    });
  });
});

describe("POST /webhook/telegram/:bot", () => {
  it("يقبل تحديثاً بسرّ صحيح ويوصله إلى المعالج", async () => {
    const received: { bot: BotKind; update: unknown }[] = [];
    const res = await buildApp({ received }).request(
      webhookRequest({ update_id: 1, message: { text: "/start" } }, { secret: SECRET }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]?.bot).toBe("driver");
  });

  it("يميّز بوت العميل عن بوت السائق", async () => {
    const received: { bot: BotKind; update: unknown }[] = [];
    await buildApp({ received }).request(
      webhookRequest({ update_id: 2 }, { secret: SECRET, bot: "rider" }),
    );
    expect(received[0]?.bot).toBe("rider");
  });

  it("يرفض 401 بلا ترويسة السرّ ولا يستدعي المعالج", async () => {
    const received: { bot: BotKind; update: unknown }[] = [];
    const res = await buildApp({ received }).request(webhookRequest({ update_id: 3 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "INVALID_SECRET" });
    expect(received).toHaveLength(0);
  });

  it("يرفض 401 بسرّ خاطئ", async () => {
    const res = await buildApp({}).request(
      webhookRequest({ update_id: 4 }, { secret: "wrong-secret" }),
    );
    expect(res.status).toBe(401);
  });

  it("يرفض 404 لبوت مجهول", async () => {
    const res = await buildApp({}).request(
      webhookRequest({ update_id: 5 }, { secret: SECRET, bot: "admin" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "UNKNOWN_BOT" });
  });

  it("يرفض 400 لجسم ليس JSON صالحاً", async () => {
    const res = await buildApp({}).request(
      webhookRequest(null, { secret: SECRET, rawBody: "{ليس json" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "INVALID_JSON" });
  });

  describe("حدّ حجم الجسم", () => {
    /** جسم JSON صالح بحجم مطلوب تقريباً، بالحشو في حقل نصّي. */
    const bodyOfBytes = (bytes: number) =>
      JSON.stringify({ update_id: 9, message: { text: "ح".repeat(Math.ceil(bytes / 2)) } });

    it("يقبل تحديثاً كبيراً لكنه دون الحدّ", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      const res = await buildApp({ received }).request(
        webhookRequest(null, {
          secret: SECRET,
          rawBody: bodyOfBytes(MAX_WEBHOOK_BODY_BYTES - 4096),
        }),
      );
      expect(res.status).toBe(200);
      expect(received).toHaveLength(1);
    });

    it("يرفض 413 ما تجاوز الحدّ ولا يستدعي المعالج", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      const res = await buildApp({ received }).request(
        webhookRequest(null, {
          secret: SECRET,
          rawBody: bodyOfBytes(MAX_WEBHOOK_BODY_BYTES * 2),
        }),
      );
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ ok: false, error: "PAYLOAD_TOO_LARGE" });
      // الرفض قبل التحليل والمعالجة: لا يُحمَّل النظام بجسم رفضه
      expect(received).toHaveLength(0);
    });

    it("لا يُقبل جسم مجهول الطول يتجاوز الحدّ: القياس على البايت لا على الترويسة", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      // بلا content-length: تدفّق مقطَّع، وهو المسار الذي كان يفلت لو اكتُفي بالترويسة
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = new TextEncoder().encode("ء".repeat(32 * 1024));
          for (let i = 0; i < 20; i += 1) controller.enqueue(chunk);
          controller.close();
        },
      });
      const res = await buildApp({ received }).request(
        new Request("http://localhost/webhook/telegram/driver", {
          method: "POST",
          headers: { "content-type": "application/json", [TELEGRAM_SECRET_HEADER]: SECRET },
          body: stream,
          // مطلوب في fetch لإرسال تدفّق بلا طول معروف
          duplex: "half",
        } as RequestInit),
      );
      expect(res.status).toBe(413);
      expect(received).toHaveLength(0);
    });

    it("الحدّ يتّسع لأكبر رسالة تلغرام واقعية فلا يردّ شرعياً", () => {
      // نصّ تلغرام محدود بـ 4096 محرفاً؛ بالعربية محرفان لكلٍّ في UTF-8
      const largestRealistic = 4096 * 2;
      expect(MAX_WEBHOOK_BODY_BYTES).toBeGreaterThan(largestRealistic * 4);
    });
  });

  describe("إزالة تكرار update_id", () => {
    it("التحديث المكرَّر لا يبلغ المعالج ويُجاب 200 مع duplicate", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      const app = buildApp({ received });
      const update = { update_id: 4242, message: { text: "/start" } };

      const first = await app.request(webhookRequest(update, { secret: SECRET }));
      expect(first.status).toBe(200);
      expect(received).toHaveLength(1);

      const second = await app.request(webhookRequest(update, { secret: SECRET }));
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ ok: true, duplicate: true });
      // الأثر الفعلي: المعالج لم يُستدعَ ثانية
      expect(received).toHaveLength(1);
    });

    it("تحديث بلا update_id يُعالَج دائماً: لا يُرفض شرعي بحجّة التكرار", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      const app = buildApp({ received });
      const update = { message: { text: "/start" } };

      await app.request(webhookRequest(update, { secret: SECRET }));
      await app.request(webhookRequest(update, { secret: SECRET }));
      expect(received).toHaveLength(2);
    });

    it("لا يُلغي تحديثُ بوتٍ تحديثَ الآخر بالرقم نفسه", async () => {
      const received: { bot: BotKind; update: unknown }[] = [];
      const app = buildApp({ received });
      const update = { update_id: 909, message: { text: "/start" } };

      await app.request(webhookRequest(update, { secret: SECRET, bot: "driver" }));
      await app.request(webhookRequest(update, { secret: SECRET, bot: "rider" }));
      expect(received).toHaveLength(2);
    });
  });

  it("يرفض 400 لتحديث ليس كائناً", async () => {
    const res = await buildApp({}).request(webhookRequest([1, 2, 3], { secret: SECRET }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "INVALID_UPDATE" });
  });

  it("يجيب 200 مع NOT_HANDLED إن تعذّرت المعالجة، فلا يُعيد تلغرام الإرسال بلا نهاية", async () => {
    const res = await buildApp({ handled: false }).request(
      webhookRequest({ update_id: 6 }, { secret: SECRET }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "NOT_HANDLED" });
  });

  it("لا يقبل GET على مسار الـ webhook", async () => {
    const res = await buildApp({}).request("http://localhost/webhook/telegram/driver");
    expect(res.status).toBe(404);
  });
});

describe("مسار مجهول", () => {
  it("يجيب 404 بصيغة موحّدة", async () => {
    const res = await buildApp({}).request("http://localhost/whatever");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
