/**
 * الغرض: إثباتُ مخزنِ الجلساتِ على **Redis حقيقيٍّ** لا على مزدوجٍ في الذاكرةِ —
 *   ذهاباً وعودةً، ومهلةً تنتهي بالزمنِ الفعليِّ لا بساعةٍ نكتبها، وفضاءَي بوتٍ
 *   لا يتصادمان على قاعدةٍ واحدةٍ، وحواراً كاملاً من الويبهوك إلى PostgreSQL
 *   وحالتُه في Redis الحقيقيِّ، وحدُّ المعدَّلِ الموزَّعُ يعدُّ في الخادمِ لا في العمليّةِ
 *   — وهما مستهلِكا Redis الوحيدانِ في المستودعِ.
 * الحالة: اختبارٌ حقيقيٌّ — `OPS-006` (ADR 0049). يتطلّب
 *   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` و`TEST_DATABASE_URL`.
 * ينتمي إلى: tests/real-redis
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ «تكامل على Redis حقيقي» في CI، وحاجزُ
 *   `scripts/check-real-redis-proof.ts` الذي يقرأ دليلَه.
 * ملاحظات مستقبلية: انقطاعُ Redis لا يُحاكى ههنا — الحقنُ في مزدوجٍ لا في خادمٍ
 *   حقيقيٍّ، ويبقى مُثبَتاً في `tests/integration/redis-sessions.test.ts`.
 *
 * ولماذا ملفٌّ جديدٌ لا تعديلُ القديمِ؟ لأنّ القديمَ يحقن انقطاعاً ويُحرّك ساعةً —
 * وكلاهما لا يُفعَل بخادمٍ حقيقيٍّ إلّا بكذبٍ. فبقيَ القديمُ على مزدوجِه يُثبِت
 * سلوكَ الفشلِ، وجاء هذا يُثبِت أنّ المحوّلَ والمخزنَ يعملان على المحرّكِ نفسِه.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createRedisSessionStore,
  REDIS_SESSION_PREFIX,
} from "../../apps/gateway/src/bots/shared/redis-session.ts";
import { stripRevision } from "../../apps/gateway/src/bots/shared/session-revision.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createRedisRateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { DialogState } from "../../packages/application/bots/types.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";
import { createRedisLiveBroadcastStore } from "../../packages/infrastructure/tracking/redis-live-broadcast-store.ts";
import { createRedisStreamTrackingEventBus } from "../../packages/infrastructure/tracking/redis-stream-event-bus.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";
import { testConfig } from "../support/config.ts";
import {
  assertRealRedisWhenRequired,
  createRealRedis,
  type RealRedisHandle,
  realRedisConfigured,
} from "../support/real-redis.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

// يسقط التشغيلُ فوراً إن كانت الوظيفةُ تزعم Redis حقيقياً ولا نقطةَ لها.
assertRealRedisWhenRequired();

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const PROOF_PATH = process.env.REAL_REDIS_PROOF_PATH ?? "/tmp/real-redis-proof.json";
const WEBHOOK_SECRET = "real-redis-secret";
/**
 * شرطُ التفعيلِ مكتوبٌ ههنا بأسماءِ المتغيّراتِ صريحةً لا بالمعينِ وحدَه — عن قصدٍ:
 * حاجزُ تصنيفِ التجاوزِ (`OPS-009`) يقرأ **هذا الملفَّ** فيتحقّق أنّ ما يزعمه السجلُّ
 * شرطاً هو ما يقرؤه الملفُّ فعلاً. والأسماءُ تُقرَأ، والقيمُ لا تُطبَع ولا تُقارَن.
 */
const ENABLED =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured() &&
  DATABASE_URL !== undefined;

/**
 * معرّفُ محادثةٍ يتغيّر بكلِّ تشغيلٍ: مفتاحُ الجلسةِ الذي يكتبه كودُ الإنتاجِ ببادئتِه
 * هو `waslah:session:driver:<id>`، فلو ثُبِّت العددُ لتصادمَ تشغيلانِ متوازيانِ على
 * قاعدةٍ واحدةٍ فأخفقَ أحدُهما لسببِ بيئةٍ لا لسببِ منطقٍ.
 */
const DRIVER_CHAT = 700_000 + Math.floor(Math.random() * 200_000);

const checks = new Set<string>();
const mark = (id: string): void => {
  checks.add(id);
};

let redis: RealRedisHandle;
let sql: Sql;
let cityId: string;
let keysLeftBehind = 0;

const state = (step: DialogState["step"]): DialogState => ({
  step,
  language: "ar",
  draftName: "سائقُ الدليل",
  draftPhone: null,
  draftCityId: null,
  draftService: null,
  draftPickup: null,
  draftDropoff: null,
  draftSupportType: null,
  draftVehicleType: null,
  draftPlateNumber: null,
  draftNationalId: null,
  draftVehiclePhotoFileId: null,
  draftPreferredAreaLabel: null,
});

const describeIf = ENABLED ? describe : describe.skip;

describeIf("مخزنُ الجلساتِ على Redis حقيقيٍّ", () => {
  beforeAll(async () => {
    redis = createRealRedis();
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    // التنظيفُ قبلَ كتابةِ الدليلِ: عددُ ما بقي جزءٌ من الدليلِ لا ملحوظةٌ بعدَه.
    keysLeftBehind = await redis.cleanup();
    await sql.end({ timeout: 5 });
    await Bun.write(
      PROOF_PATH,
      `${JSON.stringify(
        {
          producedAt: new Date().toISOString(),
          runId: redis.runId,
          usedRealClient: true,
          commandsIssued: redis.commandsIssued(),
          checks: [...checks],
          keyPrefix: redis.prefix,
          keysLeftBehind,
        },
        null,
        2,
      )}\n`,
    );
    expect(keysLeftBehind).toBe(0);
  });

  it("أمرٌ يخرج إلى الخادمِ ويعود: SET ثم GET ثم DEL", async () => {
    const key = `${redis.prefix}:roundtrip`;
    const written = await redis.client.command(["SET", key, "قيمةُ دليلٍ", "EX", 60]);
    expect(written.ok).toBe(true);

    const read = await redis.client.command(["GET", key]);
    expect(read.ok && read.value).toBe("قيمةُ دليلٍ");

    const removed = await redis.client.command(["DEL", key]);
    expect(removed.ok && Number(removed.value)).toBe(1);

    const after = await redis.client.command(["GET", key]);
    expect(after.ok && after.value).toBe(null);
    mark("roundtrip-set-get-del");
  });

  it("المخزنُ نفسُه يحفظ ويقرأ عبرَ الشبكةِ بلا فقدِ حقلٍ", async () => {
    const store = createRedisSessionStore(redis.client, "driver", { prefix: redis.prefix });
    const saved = await store.save("11", state("awaiting_name"));
    expect(saved.ok).toBe(true);

    const loaded = await store.load("11");
    // المراجعةُ رمزٌ عابرٌ لا جزءٌ من الحالة، فتُنزَع قبل المقارنة.
    expect(loaded.ok && stripRevision(loaded.value)).toEqual(state("awaiting_name"));

    const cleared = await store.clear("11");
    expect(cleared.ok).toBe(true);
    const afterClear = await store.load("11");
    expect(afterClear.ok && afterClear.value).toBe(null);
    mark("session-store-save-load");
  });

  it("المهلةُ مضبوطةٌ في الخادمِ نفسِه لا في ذاكرةِ العملية", async () => {
    const store = createRedisSessionStore(redis.client, "driver", { prefix: redis.prefix });
    await store.save("12", state("awaiting_phone"));

    const ttl = await redis.client.command(["TTL", `${redis.prefix}:driver:12`]);
    expect(ttl.ok).toBe(true);
    const seconds = Number(ttl.ok ? ttl.value : -1);
    // مهلةُ الجلسةِ نصفُ ساعةٍ: أكبرُ من الصفرِ ولا تتجاوزُها — والقيمةُ من الخادمِ.
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(1800);
    await store.clear("12");
    mark("session-ttl-is-real");
  });

  it("انتهاءُ المهلةِ يُلاحَظ بزمنٍ فعليٍّ لا بساعةٍ مُحقونةٍ", async () => {
    const store = createRedisSessionStore(redis.client, "driver", {
      prefix: redis.prefix,
      ttlSeconds: 1,
    });
    await store.save("13", state("awaiting_name"));
    const before = await store.load("13");
    expect(before.ok && before.value).not.toBe(null);

    await new Promise((resolve) => setTimeout(resolve, 1600));

    const after = await store.load("13");
    expect(after.ok && after.value).toBe(null);
    mark("session-expiry-observed");
  });

  it("فضاءا البوتَين لا يتصادمان لنفسِ معرّفِ تلغرام على قاعدةٍ واحدةٍ", async () => {
    const driver = createRedisSessionStore(redis.client, "driver", { prefix: redis.prefix });
    const rider = createRedisSessionStore(redis.client, "rider", { prefix: redis.prefix });

    await driver.save("14", state("awaiting_name"));
    const riderView = await rider.load("14");
    expect(riderView.ok && riderView.value).toBe(null);

    await rider.save("14", state("awaiting_pickup"));
    const driverView = await driver.load("14");
    expect(driverView.ok && stripRevision(driverView.value)).toEqual(state("awaiting_name"));

    await driver.clear("14");
    await rider.clear("14");
    mark("namespace-isolation");
  });

  it("قيمةٌ مشوَّهةٌ في الخادمِ تُمحى وتُقرَأ «لا جلسة» لا «جلسةٌ فاسدة»", async () => {
    const key = `${redis.prefix}:driver:15`;
    await redis.client.command(["SET", key, "ليس JSON", "EX", 60]);

    const store = createRedisSessionStore(redis.client, "driver", { prefix: redis.prefix });
    const loaded = await store.load("15");
    expect(loaded.ok && loaded.value).toBe(null);

    const exists = await redis.client.command(["EXISTS", key]);
    expect(exists.ok && Number(exists.value)).toBe(0);
    mark("malformed-value-erased");
  });

  it("لا يُنشئ التشغيلُ مفتاحاً خارجَ بادئتِه — والمفاتيحُ تُرى في الخادمِ بـSCAN", async () => {
    const store = createRedisSessionStore(redis.client, "driver", { prefix: redis.prefix });
    await store.save("16", state("awaiting_name"));

    const scanned = await redis.client.command([
      "SCAN",
      "0",
      "MATCH",
      `${redis.prefix}*`,
      "COUNT",
      200,
    ]);
    expect(scanned.ok).toBe(true);
    const payload = scanned.ok ? scanned.value : null;
    const keys = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1].map(String) : [];
    expect(keys).toContain(`${redis.prefix}:driver:16`);
    for (const key of keys) expect(key.startsWith(redis.prefix)).toBe(true);

    await store.clear("16");
    mark("keys-scoped-to-prefix");
  });

  /**
   * ومستهلِكُ Redis الثاني في المستودعِ حدُّ المعدَّلِ الموزَّعُ: فلو تُرِك على
   * مزدوجٍ وحدَه لبقي أقوى ما فيه غيرَ مجرَّبٍ — ومعنى «موزَّع» أنّ العدَّ يجري في
   * الخادمِ لا في العمليّةِ، فنسختانِ ترى العدَّ نفسَه.
   */
  it("حدُّ المعدَّلِ يعدُّ في الخادمِ فيراه مُستهلِكانِ منفصلانِ عدًّا واحداً", async () => {
    const options = { limit: 3, windowSeconds: 60, prefix: `${redis.prefix}:rate` };
    // محدِّدانِ منفصلانِ بلا حالةٍ مشتركةٍ في العمليّةِ: قائمانِ مقامَ نسختَينِ.
    const first = createRedisRateLimiter(redis.client, options);
    const second = createRedisRateLimiter(redis.client, options);
    const key = `probe:${DRIVER_CHAT}`;

    expect((await first.hit(key)).allowed).toBe(true);
    expect((await second.hit(key)).allowed).toBe(true);
    expect((await first.hit(key)).allowed).toBe(true);
    const fourth = await second.hit(key);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);

    await redis.client.command(["DEL", `${redis.prefix}:rate:${key}`]);
    mark("rate-limit-counts-on-server");
  });

  it("نافذةُ الحدِّ تنتهي بمهلةِ الخادمِ فيُسمَح من جديدٍ", async () => {
    const limiter = createRedisRateLimiter(redis.client, {
      limit: 1,
      windowSeconds: 1,
      prefix: `${redis.prefix}:rate`,
    });
    const key = `window:${DRIVER_CHAT}`;

    expect((await limiter.hit(key)).allowed).toBe(true);
    expect((await limiter.hit(key)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1600));

    // لو كان EXPIRE يُرسَل مع كلِّ طلبٍ لتجدَّدت النافذةُ فلم تنتهِ أبداً.
    expect((await limiter.hit(key)).allowed).toBe(true);
    await redis.client.command(["DEL", `${redis.prefix}:rate:${key}`]);
    mark("rate-limit-window-expires");
  }, 15_000);

  /**
   * وقلبُ عيبِ BUG-006 ههنا: لا يكفي أن يعدَّ الخادمُ، بل أن يعدَّ **ذرّيًّا** — فلو
   * كان `INCR` ثمَّ `EXPIRE` أمرَينِ منفصلَينِ لكانَ بينَهما نافذةٌ تُفقدُ فيها المهلةُ.
   * والسكربتُ الواحدُ يجعلُ العدَّ وضبطَ المهلةِ خطوةً واحدةً: لا مفتاحَ بلا مهلةٍ، ولا
   * تجاوزَ للحدِّ تحتَ التزامنِ، ولا يُضافُ عضوٌ مرفوضٌ.
   */
  it("حدٌّ ذرّيٌّ: تزامنٌ على نفسِ المفتاحِ يُتيحُ الحدَّ بالضبطِ ويُبقي للمفتاحِ مهلةً", async () => {
    const options = { limit: 5, windowSeconds: 60, prefix: `${redis.prefix}:rate` };
    const limiter = createRedisRateLimiter(redis.client, options);
    const key = `conc:${DRIVER_CHAT}`;

    // عشرون طلباً متزامناً على نفسِ المفتاحِ: الخادمُ يُسلسِلُ EVAL فيُتيحُ خمسةً بالضبطِ.
    const decisions = await Promise.all(Array.from({ length: 20 }, () => limiter.hit(key)));
    const allowed = decisions.filter((d) => d.allowed);
    const denied = decisions.filter((d) => !d.allowed);
    expect(allowed).toHaveLength(5);
    expect(denied).toHaveLength(15);
    expect(denied.every((d) => d.remaining === 0)).toBe(true);

    // المهلةُ مضبوطةٌ في الخادمِ لا مفقودةٌ — وهذا ما كانَ يُفقدُ بينَ INCR وEXPIRE.
    const ttl = await redis.client.command(["PTTL", `${redis.prefix}:rate:${key}`]);
    expect(ttl.ok).toBe(true);
    expect(Number(ttl.ok ? ttl.value : -1)).toBeGreaterThan(0);

    // لا تُضافُ العناصرُ المرفوضةُ: العدُّ في الخادمِ لا يتجاوزُ الحدَّ.
    const card = await redis.client.command(["ZCARD", `${redis.prefix}:rate:${key}`]);
    expect(card.ok).toBe(true);
    expect(Number(card.ok ? card.value : -1)).toBe(5);

    await redis.client.command(["DEL", `${redis.prefix}:rate:${key}`]);
    mark("rate-limit-atomic-under-concurrency");
  }, 15_000);

  it("حوارُ تسجيلٍ كاملٌ يمضي عبرَ Redis الحقيقيِّ وينتهي بصفِّ سائقٍ في القاعدة", async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = -1001,
             telegram_escalation_group_id = -1002,
             telegram_unsubscribed_drivers_group_id = -1003
       where code = 'JED'
    `;

    const config: AppConfig = testConfig({
      sessionStore: "redis",
      telegramWebhookSecret: WEBHOOK_SECRET,
      port: 3998,
    });
    const driverSent: SentMessage[] = [];
    const container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing([]),
      redis: redis.client,
    });
    const app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });

    // الحاويةُ تكتب ببادئةِ الإنتاجِ لا ببادئةِ الاختبارِ، فيُسجَّل المفتاحُ ليُمحى.
    const productionKey = `${REDIS_SESSION_PREFIX}:driver:${DRIVER_CHAT}`;
    redis.trackForeignKey(productionKey);

    const post = async (update: unknown): Promise<Response> =>
      app.fetch(
        new Request("http://localhost/webhook/telegram/driver", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
          },
          body: JSON.stringify(update),
        }),
      );
    const text = (value: string) => ({
      message: {
        chat: { id: DRIVER_CHAT },
        from: { id: DRIVER_CHAT, language_code: "ar" },
        text: value,
      },
    });

    try {
      await post(text("/start"));

      // الحالةُ في الخادمِ الحقيقيِّ لا في ذاكرةِ العمليةِ — يُقرأ المفتاحُ بأمرٍ مستقلٍّ.
      const raw = await redis.client.command(["GET", productionKey]);
      expect(raw.ok).toBe(true);
      // الحالةُ مغلفةٌ: { revision, state } — الخطوةُ داخلَ state.
      const envelope = JSON.parse(String(raw.ok ? raw.value : "{}")) as {
        revision?: number;
        state?: { step?: string };
      };
      expect(envelope.state?.step).toBe("awaiting_name");

      await post(text("عبدالله الحربي"));
      await post({
        message: {
          chat: { id: DRIVER_CHAT },
          from: { id: DRIVER_CHAT, language_code: "ar" },
          contact: { user_id: DRIVER_CHAT, phone_number: "+966500000222" },
        },
      });
      const callback = (data: string) => ({
        callback_query: {
          data,
          from: { id: DRIVER_CHAT },
          message: { chat: { id: DRIVER_CHAT } },
        },
      });
      await post(callback(`city:${cityId}`));
      await post(callback("service:transport"));
      await post(callback("vehicle:sedan"));
      await post(text("أ ب ج 4321"));
      // رقمُ هويّةٍ من عشرِ خاناتٍ: معرّفُ المحادثةِ ستُّ خاناتٍ فتُكمِلُه بادئةٌ ثابتةٌ.
      await post(text(`1000${DRIVER_CHAT}`));
      await post({
        message: {
          chat: { id: DRIVER_CHAT },
          from: { id: DRIVER_CHAT, language_code: "ar" },
          photo: [{ file_id: "vphoto_real_thumb" }, { file_id: "vphoto_real" }],
        },
      });

      const rows = await sql<{ full_name: string; phone: string }[]>`
        select full_name, phone from users where telegram_id = ${DRIVER_CHAT}
      `;
      expect(rows[0]).toEqual({ full_name: "عبدالله الحربي", phone: "+966500000222" });
      expect(driverSent.length).toBeGreaterThan(0);
      mark("full-dialog-through-real-redis");
    } finally {
      await container.close();
    }
  }, 30_000);

  // `SCL-004` — مجرى أحداثٍ مشترك عبر Redis Streams: نشرٌ من نسخةٍ وتسليمٌ في
  // أخرى عبرَ `XADD`/`XREAD` على عميلِ Upstash REST نفسِه (لا مقبسٌ دائم). يُثبتُ
  // أنّ الناقلَ الموزَّعَ يعملُ على Redis حقيقيٍّ لا على المزدوجِ في الذاكرةِ.
  it("SCL-004: حدثٌ نُشرَ في نسخةٍ يصلُ إلى مشتركٍ في نسخةٍ أخرى عبرَ Streams", async () => {
    const streamKey = `${redis.prefix}:scl-004:stream`;
    redis.trackForeignKey(streamKey);

    const localA = createTrackingEventBus();
    const localB = createTrackingEventBus();
    const busA = createRedisStreamTrackingEventBus({
      local: localA,
      redis: redis.client,
      streamKey,
      instanceId: "ci-A",
      pollMs: 50,
      startCursor: "$",
    });
    const busB = createRedisStreamTrackingEventBus({
      local: localB,
      redis: redis.client,
      streamKey,
      instanceId: "ci-B",
      pollMs: 50,
      startCursor: "0-0",
    });

    const received: TrackingEvent[] = [];
    localB.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          received.push(event);
        },
      },
    );
    busB.start();

    try {
      const event: TrackingEvent = {
        type: "location_updated",
        driverId: "driver-scl-004",
        tripId: "trip-scl-004",
        sessionId: "sess-scl-004",
        sequence: 1,
        position: { lat: 21.5471, lng: 39.1751 },
        cityId: cityId,
        timestamp: new Date(),
      };
      await busA.publish(event);

      // أعطِ الماسحَ دوراتٍ كافيةً لالتقاطِ الحدثِ من المجرى.
      for (let i = 0; i < 20 && received.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]?.tripId).toBe("trip-scl-004");
      expect(received[0]?.sequence).toBe(1);
      mark("scl-004-stream-cross-instance-delivery");
    } finally {
      busB.stop();
    }
  }, 15_000);

  // `SCL-005` — مخزنُ بثٍّ مشتركٌ عبرَ Redis: ادّعاءٌ ذرّيٌّ لبدءِ البثّ (`SET NX`)
  // ينجحُ مرّةً واحدةً فقط، حتى لو تسابقَ عليهِ عميلانِ؛ وتحريرٌ آمنٌ بالرمز؛
  // وذهابٌ وعودةٌ للحالة. يُثبِتُ أنّ المخزنَ يعملُ على Redis حقيقيٍّ لا على المزدوجِ.
  it("SCL-005: ادّعاءُ بدءِ البثّ ذرّيٌّ عبرَ Redis — نجاحٌ مرّةً واحدةً ولو تسابقَ عميلان", async () => {
    const store = createRedisLiveBroadcastStore(redis.client);
    const trip = `trip-scl-005-${redis.runId}`;
    const stateKey = `live:broadcast:state:${trip}`;
    const claimKey = `live:broadcast:claim:${trip}`;
    redis.trackForeignKey(stateKey);
    redis.trackForeignKey(claimKey);

    // ذهابٌ وعودةٌ: save ثم get.
    await store.save(
      trip,
      {
        chatId: "555",
        messageId: "msg-real-1",
        sentAtMs: 1_000,
        lat: 21.5,
        lng: 39.1,
        sessionId: "sess-scl-005",
        lastAppliedSeq: 1,
      },
      60_000,
    );
    const roundtrip = await store.get(trip);
    expect(roundtrip?.messageId).toBe("msg-real-1");
    expect(roundtrip?.lastAppliedSeq).toBe(1);

    // التحريرُ الآمنُ: رمزٌ مغايرٌ لا يحرّر.
    await store.claimStart(trip, "tok-real-a", 10_000);
    await store.releaseClaim(trip, "tok-real-wrong");
    const secondClaim = await store.claimStart(trip, "tok-real-b", 10_000);
    expect(secondClaim).toBe(false); // لا يزال مشغولاً
    await store.releaseClaim(trip, "tok-real-a"); // الرمزُ الصحيح
    const thirdClaim = await store.claimStart(trip, "tok-real-c", 10_000);
    expect(thirdClaim).toBe(true); // صار متاحاً
    await store.releaseClaim(trip, "tok-real-c");

    // الادّعاءُ الذرّيُّ تحتَ التسابقِ: عميلانِ يحاولانِ معاً — واحدٌ فقط يفوز.
    const raceTrip = `trip-scl-005-race-${redis.runId}`;
    const raceClaim = `live:broadcast:claim:${raceTrip}`;
    redis.trackForeignKey(raceClaim);
    const raceStoreA = createRedisLiveBroadcastStore(redis.client);
    const raceStoreB = createRedisLiveBroadcastStore(redis.client);
    const [a, b] = await Promise.all([
      raceStoreA.claimStart(raceTrip, "race-a", 10_000),
      raceStoreB.claimStart(raceTrip, "race-b", 10_000),
    ]);
    expect(a && !b ? true : !a && b ? true : false).toBe(true); // واحدٌ فقط
    await raceStoreA.releaseClaim(raceTrip, "race-a");
    await raceStoreB.releaseClaim(raceTrip, "race-b");

    // الحذفُ يُزيل الحالة.
    await store.delete(trip);
    expect(await store.get(trip)).toBeNull();
    mark("scl-005-broadcast-shared-store");
  }, 15_000);
});
