/**
 * الغرض: إثبات تفعيل Pilot مغلق لمدينة واحدة على PostgreSQL ومرور ويبهوك تيليجرام الحقيقي.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وتشغيل الـPilot الأول.
 * ملاحظات مستقبلية: المرسِل الملتقط يراقب الرسائل الخارجة فقط؛ المدن والحوار والويبهوك
 *   وقاعدة البيانات كلها مكوّنات الإنتاج الفعلية.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createMemoryRateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createCityDirectory } from "../../packages/infrastructure/geo/city-directory.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pilot-integration-secret";
const DRIVER_CHAT = 930_001;
const RIDER_CHAT = 930_002;

const config: AppConfig = {
  env: "test",
  port: 3994,
  supabaseUrl: "https://local.test.supabase.co",
  databaseUrl: DATABASE_URL ?? "postgres://invalid",
  supabaseServiceKey: "local-test",
  redisUrl: "http://localhost",
  redisToken: "local-test",
  sessionStore: "memory",
  driverBotToken: "driver-token",
  riderBotToken: "rider-token",
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: "990001",
  translationProvider: "none",
  translationApiKey: null,
  translationContactEmail: null,
};

let sql: Sql;
let pilotCityId: string;
let container: ReturnType<typeof buildContainer>;
let containerStarted = false;
let app: ReturnType<typeof createServer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];

function update(chatId: number, body: Record<string, unknown>): unknown {
  return { message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body } };
}

async function post(bot: "driver" | "rider", body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(body),
    }),
  );
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("تفعيل مدينة الـPilot على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'TIF'`;
    const city = cities[0]?.id;
    if (city === undefined) throw new Error("مدينة الطائف المزروعة لا توجد في قاعدة الاختبار");
    pilotCityId = city;
  });

  afterAll(async () => {
    if (containerStarted) await container.close();
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where id = ${pilotCityId}
    `;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    if (containerStarted) await container.close();
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = null,
             telegram_escalation_group_id = null,
             telegram_unsubscribed_drivers_group_id = null
       where id = ${pilotCityId}
    `;
    await sql`
      delete from users
       where telegram_id in (${DRIVER_CHAT}::bigint, ${RIDER_CHAT}::bigint)
    `;
    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    containerStarted = true;
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("قيد القاعدة يرفض التفعيل الناقص ثم يقبل السجل المكتمل بالمعرّفات السالبة", async () => {
    let constraintError: unknown = null;
    try {
      await sql`update cities set is_active = true where id = ${pilotCityId}`;
    } catch (error) {
      constraintError = error;
    }
    expect(String(constraintError)).toContain("cities_active_requires_groups");

    await sql`
      update cities
         set telegram_support_group_id = -1009000001001,
             telegram_escalation_group_id = -1009000001002,
             telegram_unsubscribed_drivers_group_id = -1009000001003,
             is_active = true
       where id = ${pilotCityId}
    `;
    const rows = await sql<
      { is_active: boolean; support: string; escalation: string; unsubscribed: string }[]
    >`
      select is_active, telegram_support_group_id::text as support,
             telegram_escalation_group_id::text as escalation,
             telegram_unsubscribed_drivers_group_id::text as unsubscribed
        from cities where id = ${pilotCityId}
    `;
    expect(rows[0]).toEqual({
      is_active: true,
      support: "-1009000001001",
      escalation: "-1009000001002",
      unsubscribed: "-1009000001003",
    });
  });

  it("لا تعود المدينة غير المفعّلة لأي مستخدم حتى لو كانت قروباتها مكتملة", async () => {
    await sql`
      update cities
         set telegram_support_group_id = -1009000001101,
             telegram_escalation_group_id = -1009000001102,
             telegram_unsubscribed_drivers_group_id = -1009000001103,
             is_active = false
       where id = ${pilotCityId}
    `;
    const active = await createCityDirectory(sql).listActive();
    expect(active.ok && active.value?.some((city) => city.code === "TIF")).toBe(false);

    expect((await post("driver", update(DRIVER_CHAT, { text: "/start" }))).status).toBe(200);
    expect((await post("driver", update(DRIVER_CHAT, { text: "سائق غير مفعّل" }))).status).toBe(200);
    expect(
      (
        await post(
          "driver",
          update(DRIVER_CHAT, {
            contact: { user_id: DRIVER_CHAT, phone_number: "0501234567" },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await post("rider", update(RIDER_CHAT, { text: "/start" }))).status).toBe(200);
    expect((await post("rider", update(RIDER_CHAT, { text: "راكب غير مفعّل" }))).status).toBe(200);
    expect(driverSent.map((message) => message.text).join("\n")).not.toContain("الطائف");
    expect(riderSent.map((message) => message.text).join("\n")).not.toContain("الطائف");
  });

  it("الويبهوك الحقيقي يحفظ الحوار، ويؤجّل الرسالة المحدودة ثم يقبل إعادة الإرسال", async () => {
    await sql`
      update cities
         set telegram_support_group_id = -1009000001201,
             telegram_escalation_group_id = -1009000001202,
             telegram_unsubscribed_drivers_group_id = -1009000001203,
             is_active = true
       where id = ${pilotCityId}
    `;
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter({ limit: 1, windowSeconds: 10 }, () => now);
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: {
        webhookSecret: WEBHOOK_SECRET,
        handler: container.handler,
        rateLimits: { users: limiter },
      },
    });

    const started = await post("driver", update(DRIVER_CHAT, { text: "/start" }));
    expect(started.status).toBe(200);
    const deferred = await post("driver", update(DRIVER_CHAT, { text: "سائق Pilot" }));
    expect(deferred.status).toBe(429);
    expect(deferred.headers.get("retry-after")).not.toBeNull();

    now += 11_000;
    const retried = await post("driver", update(DRIVER_CHAT, { text: "سائق Pilot" }));
    expect(retried.status).toBe(200);
    expect(driverSent.map((message) => message.text)).toContain(
      translate("ar", "driver.ask_phone"),
    );

    const users = await sql<{ count: number }[]>`
      select count(*)::int as count from users where telegram_id = ${DRIVER_CHAT}::bigint
    `;
    expect(users[0]?.count).toBe(0);
  });
});
