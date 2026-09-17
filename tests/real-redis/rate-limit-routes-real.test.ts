/**
 * الغرض: إثباتُ أنَّ حدَّ المسارِ المكشوفِ **نافذةٌ واحدةٌ بينَ نسختَينِ** على Redis
 *   حقيقيٍّ — نسختانِ من الموجِّهِ نفسِه، كلٌّ بحاصرِها، تتقاسمانِ العدَّ فيأتي
 *   `429` من الثانيةِ بسببِ طلبٍ خدمتْه الأولى؛ وضبطٌ موجبٌ معكوسٌ: النسختانِ
 *   على حاصرِ ذاكرةٍ تُعطيانِ ضِعفَ الحدِّ (`SEC-07`).
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّبُ `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`.
 * ينتمي إلى: tests/real-redis
 * يُستخدَمُ من: وظيفةُ «تكامل على Redis حقيقي» في CI.
 * يحرسُه: `scripts/lib/skip-registry.ts` (`OPS-009`).
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ ملفٌّ جديدٌ ولا يكفي ما في `redis-sessions-real.test.ts`
 *
 * ذاكَ يُثبِتُ أنَّ **الحاصرَ** يعدُّ في الخادمِ — وهو صحيحٌ وباقٍ ولا يُمَسُّ. وما
 * لم يكن مُثبَتاً هوَ **التركيبُ**: أنَّ المسارَ المكشوفَ مُوصَّلٌ بذاكَ الحاصرِ حتى
 * يصيرَ حدُّه مشتركاً. ولو أُبقيَ الحاصرُ الموزَّعُ في المستودعِ ووُصِّلَ المسارُ
 * بحاصرِ ذاكرةٍ لَبقيَ الدليلُ القديمُ أخضرَ والحدُّ الفعليُّ ضِعفَ المُعلَنِ بعددِ
 * النسخِ. فالمقيسُ ههنا **الردُّ عبرَ نسختَينِ** لا سلوكُ الحاصرِ.
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يقيسُ ذرّيّةَ السكربتِ ولا انتهاءَ النافذةِ بالزمنِ**: مُثبَتانِ في
 *   `tests/real-redis/redis-sessions-real.test.ts`، ولا يُكرَّرُ مصدرُ حقٍّ.
 * - **لا يُشغِّلُ عمليَّتَي نظامٍ**: النسختانِ موجِّهانِ مبنيّانِ بنداءَينِ مستقلَّينِ
 *   بلا حالةٍ مشتركةٍ في الذاكرةِ. والفرقُ المقصودُ — «العدُّ في الخادمِ لا في
 *   العمليّةِ» — يظهرُ كاملاً بضبطِ الذاكرةِ المعكوسِ في هذا الملفِّ نفسِه: لو كانَ
 *   الاشتراكُ وهماً لَأعطى Redis ضِعفَ الحدِّ كما تُعطيه الذاكرةُ.
 * - **لا يُهيِّئُ تبعيّاتِ المسارِ**: `503` تعني «مرَّ الحاصرُ»، و`429` تعني «رُدَّ» —
 *   وهذا هوَ الفرقُ المقيسُ وحدَه.
 */

import { describe, expect, it } from "bun:test";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
} from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createSessionTelegramRoutes } from "../../apps/gateway/src/routes/session-telegram.ts";
import {
  assertRealRedisWhenRequired,
  createRealRedis,
  type RealRedisHandle,
  realRedisConfigured,
} from "../support/real-redis.ts";

assertRealRedisWhenRequired();

/**
 * شرطُ التفعيلِ مكتوبٌ بأسماءِ المتغيّراتِ صريحةً لا بالمعينِ وحدَه — عن قصدٍ: حاجزُ
 * تصنيفِ التجاوزِ (`OPS-009`) يقرأُ **هذا الملفَّ** فيُطابِقُ ما يزعمُه السجلُّ شرطاً.
 */
const ENABLED =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured();

const LIMIT = 2;
const ADDRESS = "198.51.100.24";

let handle: RealRedisHandle | null = null;

function redis(): RealRedisHandle {
  handle ??= createRealRedis();
  return handle;
}

function call(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  return app.fetch(
    new Request("http://gate.test/v1/session/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ADDRESS },
      body: JSON.stringify({ probe: true }),
    }),
  );
}

const suite = ENABLED ? describe : describe.skip;

suite("حدُّ المسارِ المكشوفِ نافذةٌ واحدةٌ بينَ نسختَينِ على Redis حقيقيٍّ (SEC-07)", () => {
  it("نسختانِ منفصلتانِ على Redis تتقاسمانِ الحدَّ — لا ضِعفَ بعددِ النسخِ", async () => {
    const scope = redis();
    const options = { limit: LIMIT, windowSeconds: 60, prefix: `${scope.prefix}:shared` };
    // نسختانِ لا تعرفُ إحداهما الأخرى في العمليّةِ: قائمتانِ مقامَ حاويتَينِ.
    const alpha = createSessionTelegramRoutes({
      limits: { perAddress: createRedisRateLimiter(scope.client, options) },
    });
    const beta = createSessionTelegramRoutes({
      limits: { perAddress: createRedisRateLimiter(scope.client, options) },
    });

    expect((await call(alpha)).status).not.toBe(429);
    expect((await call(beta)).status).not.toBe(429);

    // الطلبُ الثالثُ يقصدُ نسخةً لم تخدمْ إلّا طلباً واحداً — فرَدُّه دليلُ الاشتراكِ.
    const third = await call(beta);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);

    // التنظيفُ ههنا لا في `afterAll`: خُطّافٌ داخلَ وصفٍ مُتخطًّى يُحسَبُ تخطّياً
    // بلا اسمٍ في تقريرِ التشغيلِ، وسِجلُّ التصنيفِ (`OPS-009`) يعدُّ المتخطّى بالاسمِ.
    scope.trackForeignKey(`${options.prefix}:session-telegram:${ADDRESS}`);
    expect(await scope.cleanup()).toBe(0);
  });

  it("والضبطُ المعكوسُ: نسختانِ على حاصرِ ذاكرةٍ تُعطيانِ ضِعفَ الحدِّ", async () => {
    const window = { limit: LIMIT, windowSeconds: 60 };
    const alpha = createSessionTelegramRoutes({
      limits: { perAddress: createMemoryRateLimiter(window) },
    });
    const beta = createSessionTelegramRoutes({
      limits: { perAddress: createMemoryRateLimiter(window) },
    });

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      expect((await call(alpha)).status).not.toBe(429);
      expect((await call(beta)).status).not.toBe(429);
    }
    // أربعةُ طلباتٍ مرَّت وحدُّ كلٍّ اثنانِ: هذا هوَ الضررُ الذي يمنعُه Redis.
    expect((await call(alpha)).status).toBe(429);
    expect((await call(beta)).status).toBe(429);
  });
});
