/**
 * الغرض: `F4-08` — السباقُ الخامسُ: **انقطاعُ Redis في منتصفِ مسارِ الموقعِ**.
 *   نبضةٌ تمرُّ والمخزنُ الساخنُ حيٌّ، ثمَّ ينقطعُ فتتزاحمُ نبضتانِ عليهِ وهوَ
 *   مقطوعٌ، ثمَّ يعودُ فتمرُّ نبضةٌ رابعةٌ. والمقيسُ **أنَّ القناةَ لا تنكسرُ**:
 *   لا رقمَ يتكرَّرُ، ولا موضعَ يتراجعُ، ولا نبضةً تُبتلَعُ صامتةً.
 *
 *   ## ولماذا ههنا لا في `tests/integration/`؟
 *
 *   لأنَّ انقطاعاً يُحاكى بمزدوجٍ يُثبِتُ أنَّ المزدوجَ أطاعَنا حينَ أمرناهُ أن
 *   يُخفِقَ. والمقصودُ غيرُ ذلك: مخزنٌ ساخنٌ **حقيقيٌّ** بسكربتاتِ `Lua` حقيقيّةٍ،
 *   وقاعدةُ `PostgreSQL` حقيقيّةٌ، وجلسةُ تتبُّعٍ حقيقيّةٌ — ثمَّ يُقطَعُ الطريقُ
 *   إلى المخزنِ الساخنِ وحدَه. فما قبلَ الانقطاعِ وما بعدَه مقيسانِ على المحرِّكِ
 *   نفسِه، والانقطاعُ وحدَه محقونٌ.
 *
 *   ## وأينَ يُحقَنُ الانقطاعُ بالضبطِ — وهذا حدُّ الدعوى
 *
 *   عندَ **حدِّ العميلِ**: نداءٌ يمسُّ مفاتيحَ `waslah:driver-location` يرجعُ
 *   `{ok:false, kind:"network"}` — وهيَ عينُ الصورةِ التي يرجعُ بها العميلُ
 *   الحقيقيُّ حينَ تسقطُ الشبكةُ أو النقطةُ. **ولا يُدَّعى** أنَّ خادمَ Redis
 *   نفسَه أُسقِطَ (لا سلطانَ للاختبارِ على خدمةٍ مُدارةٍ)، ولا أنَّ هذا قياسُ
 *   إنتاجٍ (`ح-5`). المُدَّعى واحدٌ: **سلوكُ المسارِ حينَ يُخفِقُ المخزنُ الساخنُ
 *   وسطَ سباقٍ** — وهوَ ما نصَّ عليه `F4-01`/`F4-02`: الإخفاقُ يُسجَّلُ ولا
 *   يُبتلَعُ، والكتابةُ ترجعُ إلى القاعدةِ، والنبضةُ لا تضيعُ.
 *
 *   والعزلُ مقصودٌ في نطاقِه: يُقطَعُ **المخزنُ الساخنُ وحدَه** لا كلُّ ما يمسُّ
 *   Redis. ولو قُطِعَ الكلُّ لسقطَ مخزنُ الحوارِ ودلوُ الحدِّ معاً، فصارَ الأخضرُ
 *   أو الأحمرُ خبراً عن ثلاثةِ أعطابٍ مجتمعةٍ لا عن العطبِ المقصودِ.
 *
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّب `UPSTASH_REDIS_REST_URL`/`_TOKEN` و`TEST_DATABASE_URL`.
 * ينتمي إلى: tests/real-redis
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ «تكامل على Redis حقيقي» في CI.
 * ملاحظات مستقبلية: إن صارَ للمخزنِ الساخنِ قاطعُ دورةٍ (`circuit breaker`) فيُضافُ
 *   ههنا توكيدٌ على أنَّه فتحَ بعدَ الإخفاقاتِ، ولا يُخفَّفُ توكيدٌ قائمٌ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import type { LivePosition } from "../../packages/application/tracking/customer-live-relay.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { HOT_LOCATION_PREFIX } from "../../packages/shared/config/driver-location-hot-state.ts";
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
const WEBHOOK_SECRET = "outage-race-secret";
const DRIVER_CHAT = 141_501;
const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
const DEGREE_STEP = 0.0005;
const MS_PER_SECOND = 1000;

const config: AppConfig = testConfig({
  port: 3993,
  telegramWebhookSecret: WEBHOOK_SECRET,
  sessionStore: "redis",
});

let sql: Sql;
let handle: RealRedisHandle;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let events: TrackingEvent[];
let logs: { readonly event: string; readonly detail: unknown }[];
let hotStateDown: boolean;

interface SequenceRow {
  readonly id: string;
  readonly last_sequence: number;
  readonly last_fix_at: string | null;
}

/**
 * شرطُ التفعيلِ مكتوبٌ بأسماءِ المتغيّراتِ صريحةً لا بالمعينِ وحدَه — عن قصدٍ:
 * حاجزُ تصنيفِ التجاوزِ (`OPS-009`) يقرأ **هذا الملفَّ** فيتحقّق أنّ ما يزعمُه السجلُّ
 * شرطاً هو ما يقرؤه الملفُّ فعلاً. والأسماءُ تُقرَأ، والقيمُ لا تُطبَع ولا تُقارَن.
 */
const enabled =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured() &&
  DATABASE_URL !== undefined;
const describeIf = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn(
    "⚠️  سباقُ انقطاعِ المخزنِ الساخنِ مُتخطًّى: يحتاج UPSTASH_REDIS_REST_URL/_TOKEN وTEST_DATABASE_URL معاً.",
  );
}

const silentLiveChannel = {
  start: async (_chatId: string, _position: LivePosition, _live: number) => "msg",
  update: async () => true,
  stop: async () => true,
};

describeIf("سباقُ انقطاعِ المخزنِ الساخنِ على Redis حقيقيٍّ — F4-08", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    handle = createRealRedis();
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    const leftover = await handle.cleanup();
    expect(leftover).toBe(0);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = coalesce(telegram_support_group_id, -1001),
             telegram_escalation_group_id = coalesce(telegram_escalation_group_id, -1002),
             telegram_unsubscribed_drivers_group_id =
               coalesce(telegram_unsubscribed_drivers_group_id, -1003)
       where id = ${cityId}
    `;

    events = [];
    logs = [];
    hotStateDown = false;

    /**
     * الحاجزُ: يمرُّ كلُّ شيءٍ إلى الخادمِ الحقيقيِّ إلَّا ما يمسُّ مفاتيحَ المخزنِ
     * الساخنِ حالَ الانقطاعِ. والصورةُ المُرجَعةُ ليست اختراعاً — هيَ الصورةُ التي
     * يبنيها `createUpstashRedis` نفسُه حينَ يُخفِقُ `fetch`.
     */
    const gated: RedisClient = {
      command: async (args) => {
        const touchesHotState = args.some(
          (argument) => typeof argument === "string" && argument.startsWith(HOT_LOCATION_PREFIX),
        );
        if (hotStateDown && touchesHotState) {
          return { ok: false, error: { kind: "network", detail: "انقطاعٌ محقونٌ عندَ حدِّ العميلِ" } };
        }
        return handle.client.command(args);
      },
    };

    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    container = buildContainer(config, {
      redis: gated,
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: silentLiveChannel,
      log: (event, detail) => {
        logs.push({ event, detail });
      },
    });

    container.tracking.bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: (event) => {
          events.push(event);
        },
      },
    );
  });

  async function seedDriver(chat: number): Promise<string> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${`سائق ${chat}`}, ${`+9665${chat}`}, 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}::uuid, 'verified', 'sedan', ${`س ${chat}`})
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`select record_attendance(${driverId}::uuid, true, 'test_seed')`;
    return driverId;
  }

  async function postLocation(agoSeconds: number, step: number): Promise<void> {
    await container.handler.handle("driver", {
      message: {
        chat: { id: DRIVER_CHAT },
        from: { id: DRIVER_CHAT, language_code: "ar" },
        location: {
          latitude: JEDDAH.latitude + step * DEGREE_STEP,
          longitude: JEDDAH.longitude,
          horizontal_accuracy: 8,
        },
        date: Math.floor(Date.now() / MS_PER_SECOND) - agoSeconds,
      },
    });
  }

  const recordedMsOf = (event: TrackingEvent): number => Number(event.metadata?.recordedAtMs);

  it("ينقطعُ المخزنُ الساخنُ وسطَ سباقٍ: القناةُ تصمدُ، والتدهوّرُ يُسجَّلُ، والعودةُ لا تُنتِجُ رقماً مكرَّراً", async () => {
    const driverId = await seedDriver(DRIVER_CHAT);
    handle.trackForeignKey(`${HOT_LOCATION_PREFIX}:hot:${cityId}:${driverId}`);
    handle.trackForeignKey(`${HOT_LOCATION_PREFIX}:backlog:${cityId}`);
    handle.trackForeignKey(`${HOT_LOCATION_PREFIX}:pending:${cityId}`);

    // ١) والمخزنُ حيٌّ: نبضةٌ تمرُّ على السكربتِ الحقيقيِّ.
    await postLocation(60, 1);
    const beforeOutage = events.filter((event) => event.type === "location_updated").length;
    expect(beforeOutage).toBeGreaterThan(0);

    // ٢) الانقطاعُ، ونبضتانِ تتزاحمانِ عليهِ وهوَ مقطوعٌ.
    hotStateDown = true;
    await Promise.all([postLocation(40, 2), postLocation(30, 3)]);

    // التدهوّرُ يُسجَّلُ ولا يُبتلَعُ — وهذا نصُّ `F4-02`.
    const degraded = logs.filter(
      (entry) =>
        entry.event === "driver_location.hot_state_degraded" ||
        entry.event === "driver_location.hot_state_failed",
    );
    expect(degraded.length).toBeGreaterThan(0);

    // ٣) العودةُ: المخزنُ يرجعُ ونبضةٌ رابعةٌ تمرُّ عليهِ.
    hotStateDown = false;
    await postLocation(10, 4);

    const rows = await sql<SequenceRow[]>`
      select id, last_sequence, last_fix_at from tracking_sessions where driver_id = ${driverId}
    `;
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (row === undefined) throw new Error("لم تُفتح جلسة");

    const positions = events.filter((event) => event.type === "location_updated");

    // لا رقمَ مكرَّرٌ ولا راجعٌ عبرَ الانقطاعِ والعودةِ.
    const sequences = positions.map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    for (let index = 1; index < sequences.length; index += 1) {
      expect(sequences[index] ?? 0).toBeGreaterThan(sequences[index - 1] ?? 0);
    }

    // ولا موضعَ يتراجعُ: طوابعُ الجهازِ غيرُ متناقصةٍ في المنشورِ.
    const stamps = positions.map(recordedMsOf);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index] ?? 0).toBeGreaterThanOrEqual(stamps[index - 1] ?? 0);
    }

    // والانقطاعُ لم يبتلع النبضاتِ: ما بعدَ الانقطاعِ نُشِرَ أيضاً.
    expect(positions.length).toBeGreaterThan(beforeOutage);

    // ورقمُ الصفِّ هوَ آخرُ ما نُشِرَ — لا رقمَ وُلِدَ خارجَ كتابةٍ قبِلَت.
    expect(sequences.at(-1)).toBe(row.last_sequence);
    expect(new Set(positions.map((event) => event.sessionId))).toEqual(new Set([row.id]));

    // والنبضةُ الأخيرةُ (قبلَ عشرِ ثوانٍ) هيَ ما استقرَّ في الصفِّ.
    const savedAgoSeconds = Math.round(
      (Date.now() - new Date(row.last_fix_at ?? 0).getTime()) / MS_PER_SECOND,
    );
    expect(savedAgoSeconds).toBeLessThanOrEqual(15);
  });
});
