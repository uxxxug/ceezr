/**
 * الغرض: إثبات أن حدّ المعدّل يمنع من يجب منعه ولا يمنع تلغرام نفسها، وأن انقطاع
 *   Redis يُبقي الباب مفتوحاً لا مغلقاً.
 * الحالة: اختبار فعلي — العدّ حتمي بساعة مُمرَّرة، وRedis مزدوج بلا شبكة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند الانتقال إلى نافذة منزلقة تبقى هذه التوقّعات كما هي إلا
 *   توقّع «حدّ النافذتين المتجاورتين» أدناه، فهو خاصّ بالنافذة الثابتة.
 */
import { describe, expect, it } from "bun:test";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  RATE_LIMIT_PREFIX,
} from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import type { RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import {
  clientAddress,
  createTelegramWebhookRoutes,
  updateActorId,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";

// قيم الترويسات ASCII لا عربية: الترويسة ذات قيمة غير ASCII يرفضها Request أصلاً،
// وهو قيد حقيقي في المنصّة اكتُشف بهذا الاختبار لا بمراجعة.
const SECRET = "webhook-secret";
const WRONG_SECRET = "wrong-secret";
const TOO_MANY = 429;
const UNAUTHORIZED = 401;

function handlerDouble(seen: unknown[] = []) {
  return {
    seen,
    handle: async (_bot: "driver" | "rider", update: unknown): Promise<boolean> => {
      seen.push(update);
      return true;
    },
  };
}

describe("عدّاد النافذة الثابتة في الذاكرة", () => {
  it("يسمح حتى الحدّ ويمنع ما بعده", async () => {
    const limiter = createMemoryRateLimiter({ limit: 3, windowSeconds: 60 }, () => 0);

    const decisions = [];
    for (let i = 0; i < 5; i += 1) decisions.push(await limiter.hit("ك"));

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0, 0]);
  });

  it("مفاتيح مختلفة عدّادات مستقلّة", async () => {
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 60 }, () => 0);
    expect((await limiter.hit("أ")).allowed).toBe(true);
    expect((await limiter.hit("ب")).allowed).toBe(true);
    expect((await limiter.hit("أ")).allowed).toBe(false);
  });

  it("النافذة تُفتح من جديد بعد انتهائها", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 10 }, () => now);

    expect((await limiter.hit("ك")).allowed).toBe(true);
    expect((await limiter.hit("ك")).allowed).toBe(false);
    now += 10_000;
    expect((await limiter.hit("ك")).allowed).toBe(true);
  });

  it("resetSeconds يتقلّص مع تقدّم النافذة فلا يُطلب انتظار أطول من الحقيقي", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 60 }, () => now);
    await limiter.hit("ك");
    now += 40_000;
    expect((await limiter.hit("ك")).resetSeconds).toBe(20);
  });

  it("العدّادات المنتهية تُنظَّف فلا تتكدّس بمفاتيح مهاجم يبدّل عنوانه", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ limit: 5, windowSeconds: 10 }, () => now);
    for (let i = 0; i < 50; i += 1) await limiter.hit(`عنوان-${i}`);
    expect(limiter.size()).toBe(50);

    now += 11_000;
    await limiter.hit("عنوان-جديد");
    expect(limiter.size()).toBe(1);
  });
});

describe("عدّاد النافذة الثابتة على Redis", () => {
  function fakeRedis(): RedisClient & { readonly calls: string[][] } {
    const counters = new Map<string, number>();
    const calls: string[][] = [];
    return {
      calls,
      command: async (args) => {
        calls.push(args.map(String));
        const name = String(args[0]).toUpperCase();
        const key = String(args[1]);
        if (name === "INCR") {
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return { ok: true, value: next };
        }
        if (name === "EXPIRE") return { ok: true, value: 1 };
        return { ok: false, error: { kind: "redis", detail: name } };
      },
    };
  }

  it("يعدّ عبر Redis ويمنع بعد الحدّ", async () => {
    const redis = fakeRedis();
    const limiter = createRedisRateLimiter(redis, { limit: 2, windowSeconds: 30 });

    expect((await limiter.hit("ك")).allowed).toBe(true);
    expect((await limiter.hit("ك")).allowed).toBe(true);
    expect((await limiter.hit("ك")).allowed).toBe(false);
  });

  it("المهلة تُضبَط عند أول طلب وحده، وإلا لم تنتهِ النافذة أبداً", async () => {
    const redis = fakeRedis();
    const limiter = createRedisRateLimiter(redis, { limit: 5, windowSeconds: 30 });

    await limiter.hit("ك");
    await limiter.hit("ك");
    await limiter.hit("ك");

    const expires = redis.calls.filter((call) => call[0] === "EXPIRE");
    expect(expires).toEqual([["EXPIRE", `${RATE_LIMIT_PREFIX}:ك`, "30"]]);
  });

  it("عجز Redis يسمح ولا يمنع: الحدّ حماية لا مصادقة", async () => {
    const failures: string[] = [];
    const broken: RedisClient = {
      command: async () => ({ ok: false, error: { kind: "timeout", detail: "مقطوع" } }),
    };
    const limiter = createRedisRateLimiter(broken, {
      limit: 1,
      windowSeconds: 60,
      onFailure: (detail) => failures.push(detail),
    });

    for (let i = 0; i < 5; i += 1) {
      expect((await limiter.hit("ك")).allowed).toBe(true);
    }
    expect(failures).toHaveLength(5);
  });

  it("جواب INCR غير رقمي يُعدّ عجزاً فيُسمح، لا يُقرأ NaN بوصفه عدداً", async () => {
    const weird: RedisClient = { command: async () => ({ ok: true, value: "لا رقم" }) };
    const failures: string[] = [];
    const limiter = createRedisRateLimiter(weird, {
      limit: 1,
      windowSeconds: 60,
      onFailure: (detail) => failures.push(detail),
    });

    expect((await limiter.hit("ك")).allowed).toBe(true);
    expect(failures).toEqual(["جواب INCR ليس رقماً"]);
  });
});

describe("قراءة عنوان المُرسِل ومعرّف صاحب التحديث", () => {
  it("أول عنوان في x-forwarded-for هو العميل لا آخره", () => {
    expect(clientAddress("203.0.113.9, 10.0.0.1, 10.0.0.2")).toBe("203.0.113.9");
  });

  it("ترويسة غائبة أو فارغة تُعطي unknown لا نصّاً فارغاً يخلط المفاتيح", () => {
    expect(clientAddress(undefined)).toBe("unknown");
    expect(clientAddress("   ")).toBe("unknown");
    expect(clientAddress(",,")).toBe("unknown");
  });

  it("يقرأ المعرّف من الرسالة ومن الزرّ على السواء", () => {
    expect(updateActorId({ message: { from: { id: 770 } } })).toBe("770");
    expect(updateActorId({ callback_query: { from: { id: 880 } } })).toBe("880");
  });

  it("تحديث بلا صاحب معلوم لا يُحسب على أحد", () => {
    expect(updateActorId({ channel_post: { chat: { id: 1 } } })).toBeNull();
    expect(updateActorId({ message: { from: {} } })).toBeNull();
    expect(updateActorId({})).toBeNull();
  });
});

describe("حدّ المعدّل على مسار الويبهوك", () => {
  function post(
    app: ReturnType<typeof createTelegramWebhookRoutes>,
    options: {
      readonly secret?: string;
      readonly address?: string;
      readonly body?: unknown;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.secret !== undefined) {
      headers["x-telegram-bot-api-secret-token"] = options.secret;
    }
    if (options.address !== undefined) headers["x-forwarded-for"] = options.address;
    return Promise.resolve(
      app.fetch(
        new Request("http://localhost/webhook/telegram/driver", {
          method: "POST",
          headers,
          body: JSON.stringify(options.body ?? { message: { from: { id: 770 }, text: "/start" } }),
        }),
      ),
    );
  }

  it("من يجرّب أسراراً خاطئة يُقفل عليه بـ429 وRetry-After", async () => {
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes: createMemoryRateLimiter({ limit: 2, windowSeconds: 60 }, () => 0) },
    });

    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      UNAUTHORIZED,
    );
    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      UNAUTHORIZED,
    );
    const third = await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" });

    expect(third.status).toBe(TOO_MANY);
    expect(third.headers.get("retry-after")).toBe("60");
    expect(await third.json()).toEqual({ ok: false, error: "RATE_LIMITED" });
  });

  it("عنوان مقفول عليه لا يُقفل على غيره", async () => {
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler: handlerDouble(),
      rateLimits: { probes: createMemoryRateLimiter({ limit: 1, windowSeconds: 60 }, () => 0) },
    });

    await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" });
    expect((await post(app, { secret: WRONG_SECRET, address: "203.0.113.9" })).status).toBe(
      TOO_MANY,
    );
    expect((await post(app, { secret: WRONG_SECRET, address: "198.51.100.4" })).status).toBe(
      UNAUTHORIZED,
    );
  });

  it("حدّ المحاولات لا يُحتسب على تلغرام: سرّ صحيح مهما تكرّر لا يُقفل", async () => {
    const handler = handlerDouble();
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler,
      rateLimits: { probes: createMemoryRateLimiter({ limit: 1, windowSeconds: 60 }, () => 0) },
    });

    for (let i = 0; i < 10; i += 1) {
      const response = await post(app, { secret: SECRET, address: "149.154.167.220" });
      expect(response.status).toBe(200);
    }
    expect(handler.seen).toHaveLength(10);
  });

  it("مستخدم واحد يتجاوز حدّه فيُمنع، ولا يتأثّر غيره", async () => {
    const handler = handlerDouble();
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler,
      rateLimits: { users: createMemoryRateLimiter({ limit: 2, windowSeconds: 10 }, () => 0) },
    });

    const asUser = (id: number) =>
      post(app, { secret: SECRET, body: { message: { from: { id } } } });
    expect((await asUser(770)).status).toBe(200);
    expect((await asUser(770)).status).toBe(200);
    expect((await asUser(770)).status).toBe(TOO_MANY);
    expect((await asUser(880)).status).toBe(200);

    // التحديث الممنوع لم يُعالَج: ثلاثة نجحت لا أربعة
    expect(handler.seen).toHaveLength(3);
  });

  it("تحديث بلا صاحب معلوم يمرّ بلا احتساب على أحد", async () => {
    const handler = handlerDouble();
    const app = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      handler,
      rateLimits: { users: createMemoryRateLimiter({ limit: 1, windowSeconds: 10 }, () => 0) },
    });

    for (let i = 0; i < 3; i += 1) {
      const response = await post(app, { secret: SECRET, body: { channel_post: { text: "x" } } });
      expect(response.status).toBe(200);
    }
    expect(handler.seen).toHaveLength(3);
  });

  it("بلا حدود مضبوطة يعمل المسار كما كان تماماً", async () => {
    const handler = handlerDouble();
    const app = createTelegramWebhookRoutes({ webhookSecret: SECRET, handler });

    for (let i = 0; i < 20; i += 1) {
      expect((await post(app, { secret: SECRET })).status).toBe(200);
    }
    expect((await post(app, { secret: WRONG_SECRET })).status).toBe(UNAUTHORIZED);
  });
});
