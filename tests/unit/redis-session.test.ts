/**
 * الغرض: إثبات أن مخزن الجلسات على Redis ينفّذ نفس منفذ SessionStore سلوكاً لا
 *   توقيعاً فقط، وأن انقطاع Redis وفساد البيانات لهما مسلكان معلومان لا مفاجأة.
 * الحالة: اختبار فعلي — الشبكة مستبدَلة بمزدوج fetch، بلا خادم Redis.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصول رابط Upstash حقيقي يُضاف اختبار دخان واحد يكتب مفتاحاً
 *   ويقرأه على قاعدة اختبار، ولا يُستبدل هذا الملف به.
 */
import { describe, expect, it } from "bun:test";
import {
  createRedisSessionStore,
  parseDialogState,
  REDIS_SESSION_PREFIX,
} from "../../apps/gateway/src/bots/shared/redis-session.ts";
import { SESSION_TTL_SECONDS } from "../../apps/gateway/src/bots/shared/session.ts";
import { createUpstashRedis, type RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import { type DialogState, INITIAL_STATE } from "../../packages/application/bots/types.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";

const FULL_STATE: DialogState = {
  ...INITIAL_STATE,
  step: "awaiting_parcel",
  language: "ur",
  draftName: "علي",
  draftPhone: "+966500000000",
  draftCityId: "11111111-1111-1111-1111-111111111111" as CityId,
  draftService: "delivery",
  draftPickup: { latitude: 21.4858, longitude: 39.1925 },
  draftDropoff: { latitude: 21.5, longitude: 39.2 },
  draftSupportType: "ride_dispute",
};

/** مزدوج Redis: خريطة في الذاكرة تسجّل كل أمر وصلها كما وصل. */
function fakeRedis(): RedisClient & {
  readonly store: Map<string, string>;
  readonly calls: (string | number)[][];
} {
  const store = new Map<string, string>();
  const calls: (string | number)[][] = [];
  return {
    store,
    calls,
    command: async (args) => {
      calls.push([...args]);
      const [name, key] = [String(args[0]).toUpperCase(), String(args[1] ?? "")];
      if (name === "GET") return { ok: true, value: store.get(key) ?? null };
      if (name === "SET") {
        store.set(key, String(args[2]));
        return { ok: true, value: "OK" };
      }
      if (name === "DEL") {
        const existed = store.delete(key);
        return { ok: true, value: existed ? 1 : 0 };
      }
      return { ok: false, error: { kind: "redis", detail: `أمر غير مدعوم: ${name}` } };
    },
  };
}

function brokenRedis(kind: "timeout" | "network" = "network"): RedisClient {
  return { command: async () => ({ ok: false, error: { kind, detail: "مقطوع" } }) };
}

describe("مخزن الجلسات على Redis", () => {
  it("يحفظ ثم يقرأ الحالة كاملة بكل حقولها بلا فقد", async () => {
    const redis = fakeRedis();
    const store = createRedisSessionStore(redis, "driver");

    expect((await store.save("770", FULL_STATE)).ok).toBe(true);
    const loaded = await store.load("770");

    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value).toEqual(FULL_STATE);
  });

  it("جلسة غير موجودة تعني null لا خطأ", async () => {
    const store = createRedisSessionStore(fakeRedis(), "rider");
    const loaded = await store.load("لا-أحد");
    expect(loaded).toEqual({ ok: true, value: null });
  });

  it("المسح يُزيل الجلسة فعلاً من Redis", async () => {
    const redis = fakeRedis();
    const store = createRedisSessionStore(redis, "driver");
    await store.save("770", INITIAL_STATE);
    expect(redis.store.size).toBe(1);

    expect((await store.clear("770")).ok).toBe(true);
    expect(redis.store.size).toBe(0);
    expect(await store.load("770")).toEqual({ ok: true, value: null });
  });

  it("بوتان مختلفان لنفس معرّف تلغرام لا تختلط جلستاهما", async () => {
    const redis = fakeRedis();
    const driver = createRedisSessionStore(redis, "driver");
    const rider = createRedisSessionStore(redis, "rider");

    await driver.save("770", { ...INITIAL_STATE, step: "awaiting_phone" });
    await rider.save("770", { ...INITIAL_STATE, step: "awaiting_pickup" });

    const asDriver = await driver.load("770");
    const asRider = await rider.load("770");
    expect(asDriver.ok && asDriver.value?.step).toBe("awaiting_phone");
    expect(asRider.ok && asRider.value?.step).toBe("awaiting_pickup");
    expect([...redis.store.keys()].sort()).toEqual([
      `${REDIS_SESSION_PREFIX}:driver:770`,
      `${REDIS_SESSION_PREFIX}:rider:770`,
    ]);
  });

  it("الحفظ يضع مهلة انتهاء صريحة فلا تبقى جلسة للأبد", async () => {
    const redis = fakeRedis();
    await createRedisSessionStore(redis, "driver").save("770", INITIAL_STATE);

    const setCall = redis.calls.find((call) => call[0] === "SET");
    expect(setCall?.slice(3)).toEqual(["EX", SESSION_TTL_SECONDS]);
  });

  it("مهلة مخصّصة تُحترم كما مُرّرت", async () => {
    const redis = fakeRedis();
    await createRedisSessionStore(redis, "rider", { ttlSeconds: 60 }).save("1", INITIAL_STATE);
    expect(redis.calls[0]?.slice(3)).toEqual(["EX", 60]);
  });

  it("انقطاع Redis يُعيد عطل منفذ لا جلسة فارغة صامتة", async () => {
    const failures: string[] = [];
    const store = createRedisSessionStore(brokenRedis("timeout"), "driver", {
      onFailure: (failure) => failures.push(`${failure.operation}:${failure.kind}`),
    });

    const loaded = await store.load("770");
    const saved = await store.save("770", INITIAL_STATE);
    const cleared = await store.clear("770");

    expect(loaded.ok).toBe(false);
    expect(saved.ok).toBe(false);
    expect(cleared.ok).toBe(false);
    expect(!loaded.ok && loaded.error.port).toBe("redis-session:driver");
    expect(failures).toEqual(["load:timeout", "save:timeout", "clear:timeout"]);
  });

  it("حالة فاسدة في Redis تُمحى وتُعامَل «لا جلسة» بدل تكرار الفشل كل رسالة", async () => {
    const redis = fakeRedis();
    redis.store.set(`${REDIS_SESSION_PREFIX}:driver:770`, '{"step":"خطوة-لا-وجود-لها"}');
    const failures: string[] = [];
    const store = createRedisSessionStore(redis, "driver", {
      onFailure: (failure) => failures.push(failure.detail),
    });

    const loaded = await store.load("770");

    expect(loaded).toEqual({ ok: true, value: null });
    expect(redis.store.size).toBe(0);
    expect(failures).toEqual(["حالة حوار غير صالحة، مُحيت"]);
  });

  it("نصّ ليس JSON أصلاً يُعامَل معاملة الفاسد لا يُسقط الطلب", async () => {
    const redis = fakeRedis();
    redis.store.set(`${REDIS_SESSION_PREFIX}:rider:9`, "ليس JSON إطلاقاً");
    const loaded = await createRedisSessionStore(redis, "rider").load("9");
    expect(loaded).toEqual({ ok: true, value: null });
  });
});

describe("التحقّق من حالة الحوار القادمة من Redis", () => {
  it("يقبل الحالة الابتدائية بعد دورة تسلسل كاملة", () => {
    expect(parseDialogState(JSON.stringify(INITIAL_STATE))).toEqual(INITIAL_STATE);
  });

  it("يرفض خطوة غير معروفة — نسخة أقدم كتبت خطوة حُذفت", () => {
    const state = { ...INITIAL_STATE, step: "awaiting_iban" };
    expect(parseDialogState(JSON.stringify(state))).toBeNull();
  });

  it("يرفض حقلاً ناقصاً ولو كان الباقي سليماً", () => {
    const { draftPhone: _removed, ...partial } = INITIAL_STATE;
    expect(parseDialogState(JSON.stringify(partial))).toBeNull();
  });

  it("يرفض نوع خدمة لا وجود له في enum القاعدة", () => {
    const state = { ...INITIAL_STATE, draftService: "towing" };
    expect(parseDialogState(JSON.stringify(state))).toBeNull();
  });

  it("يرفض إحداثيات ناقصة أو غير رقمية", () => {
    const missingLongitude = { ...INITIAL_STATE, draftPickup: { latitude: 21.4 } };
    const textual = { ...INITIAL_STATE, draftPickup: { latitude: "21.4", longitude: "39.1" } };
    const infinite = { ...INITIAL_STATE, draftPickup: { latitude: 21.4, longitude: Infinity } };
    expect(parseDialogState(JSON.stringify(missingLongitude))).toBeNull();
    expect(parseDialogState(JSON.stringify(textual))).toBeNull();
    // Infinity يصير null في JSON.stringify، فالتحقّق يمسكه بوصفه حقلاً غير كائن
    expect(parseDialogState(JSON.stringify(infinite))).toBeNull();
  });

  it("يرفض نصّاً صالح JSON لكنه ليس كائناً", () => {
    expect(parseDialogState("42")).toBeNull();
    expect(parseDialogState("null")).toBeNull();
    expect(parseDialogState('"جلسة"')).toBeNull();
  });
});

describe("عميل Upstash عبر REST", () => {
  function clientWith(
    handler: (request: Request) => Promise<Response> | Response,
    timeoutMs?: number,
  ): RedisClient {
    return createUpstashRedis({
      url: "https://redis.example.com/",
      token: "upstash-token",
      fetchImpl: ((input: string, init: RequestInit) =>
        Promise.resolve(handler(new Request(input, init)))) as unknown as typeof fetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  it("يرسل الأمر مصفوفةً في الجسم مع رمز الاعتماد", async () => {
    let seen: { url: string; auth: string | null; body: unknown } | undefined;
    const client = clientWith(async (request) => {
      seen = {
        url: request.url,
        auth: request.headers.get("authorization"),
        body: await request.json(),
      };
      return Response.json({ result: "OK" });
    });

    const result = await client.command(["SET", "k", "v", "EX", 60]);

    expect(result).toEqual({ ok: true, value: "OK" });
    // الشرطة الأخيرة في الرابط تُحذف فلا يصير المسار مزدوجاً
    expect(seen?.url).toBe("https://redis.example.com/");
    expect(seen?.auth).toBe("Bearer upstash-token");
    expect(seen?.body).toEqual(["SET", "k", "v", "EX", "60"]);
  });

  it("قيمة غير موجودة تُعاد null كما هي لا خطأ", async () => {
    const client = clientWith(() => Response.json({ result: null }));
    expect(await client.command(["GET", "k"])).toEqual({ ok: true, value: null });
  });

  it("خطأ Redis نفسه يُميَّز عن انقطاع الشبكة", async () => {
    const client = clientWith(() => Response.json({ error: "ERR unknown command" }));
    const result = await client.command(["NOPE"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("redis");
  });

  it("جواب HTTP فاشل يُبلَّغ بحالته", async () => {
    const client = clientWith(() => new Response("no", { status: 401 }));
    const result = await client.command(["GET", "k"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toEqual({ kind: "http", detail: "HTTP 401" });
  });

  it("جسم بلا حقل result يُعدّ مشوّهاً لا ناجحاً بقيمة undefined", async () => {
    const client = clientWith(() => Response.json({ something: 1 }));
    const result = await client.command(["GET", "k"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("malformed");
  });

  it("انقطاع الشبكة يُصنَّف network", async () => {
    const client = clientWith(() => {
      throw new Error("ECONNREFUSED");
    });
    const result = await client.command(["GET", "k"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("network");
  });

  it("التأخّر فوق المهلة يُقطع ويُصنَّف timeout لا انتظاراً بلا نهاية", async () => {
    const client = createUpstashRedis({
      url: "https://redis.example.com",
      token: "upstash-token",
      timeoutMs: 20,
      fetchImpl: ((_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });

    const result = await client.command(["GET", "k"]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("timeout");
  });
});
