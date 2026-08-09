/**
 * الغرض: إثبات أن الحاوية حين تُضبط على SESSION_STORE=redis تمضي بحوار حقيقي كاملاً
 *   من الويبهوك إلى القاعدة، وأن حالة الحوار تعيش في Redis لا في ذاكرة العملية —
 *   أي أن التبديل لا يغيّر سلوكاً واحداً في أي حوار.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL. Redis مزدوج في الذاكرة
 *   لأن المطلوب إثباته هو أن الحالة خرجت من العملية إلى المخزن، لا أن Upstash يعمل.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على مخزن الجلسات
 * ملاحظات مستقبلية: عند وصول رابط Upstash حقيقي يُشغَّل نفس الملف بعميل حقيقي
 *   بتبديل المزدوج وحده، بلا تغيير أي توقّع فيه.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { REDIS_SESSION_PREFIX } from "../../apps/gateway/src/bots/shared/redis-session.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 310_001;

const config: AppConfig = {
  env: "test",
  port: 3999,
  supabaseUrl: "https://local.test.supabase.co",
  databaseUrl: DATABASE_URL ?? "postgres://invalid",
  supabaseServiceKey: "local-test",
  redisUrl: "http://localhost",
  redisToken: "local-test",
  sessionStore: "redis",
  driverBotToken: "driver-token",
  riderBotToken: "rider-token",
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: "990001",
  translationProvider: "none" as const,
  translationApiKey: null,
  translationContactEmail: null,
};

/** Redis مزدوج يحترم EX بمنطق مهلة حقيقي، لأن انتهاء المهلة جزء من السلوك المختبَر. */
function fakeRedis(nowMs: () => number): RedisClient & {
  readonly keys: () => string[];
  readonly rawOf: (key: string) => string | undefined;
} {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  const live = (key: string): string | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAtMs <= nowMs()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  };
  return {
    keys: () => [...entries.keys()].filter((key) => live(key) !== undefined),
    rawOf: live,
    command: async (args) => {
      const name = String(args[0]).toUpperCase();
      const key = String(args[1] ?? "");
      if (name === "GET") return { ok: true, value: live(key) ?? null };
      if (name === "SET") {
        const seconds = Number(args[4] ?? 0);
        entries.set(key, { value: String(args[2]), expiresAtMs: nowMs() + seconds * 1000 });
        return { ok: true, value: "OK" };
      }
      if (name === "DEL") return { ok: true, value: entries.delete(key) ? 1 : 0 };
      return { ok: false, error: { kind: "redis", detail: name } };
    },
  };
}

let cityId: string;
let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let redis: ReturnType<typeof fakeRedis>;
let driverSent: SentMessage[];
let clockMs: number;

async function post(update: unknown): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/webhook/telegram/driver", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

const text = (value: string) => ({
  message: {
    chat: { id: DRIVER_CHAT },
    from: { id: DRIVER_CHAT, language_code: "ar" },
    text: value,
  },
});
const callback = (data: string) => ({
  callback_query: {
    data,
    from: { id: DRIVER_CHAT },
    message: { chat: { id: DRIVER_CHAT } },
  },
});
const contact = (phone: string) => ({
  message: {
    chat: { id: DRIVER_CHAT },
    from: { id: DRIVER_CHAT, language_code: "ar" },
    contact: { user_id: DRIVER_CHAT, phone_number: phone },
  },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("جلسات الحوار على Redis بحاوية حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterAll(async () => {
    await container.close();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
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
    clockMs = Date.now();
    redis = fakeRedis(() => clockMs);
    driverSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing([]),
      redis,
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("خطوة الحوار تُكتب في Redis لا في ذاكرة العملية", async () => {
    await post(text("/start"));

    const keys = redis.keys();
    expect(keys).toEqual([`${REDIS_SESSION_PREFIX}:driver:${DRIVER_CHAT}`]);
    const raw = redis.rawOf(keys[0] ?? "");
    expect(JSON.parse(raw ?? "{}").step).toBe("awaiting_name");
  });

  it("حوار تسجيل كامل يمضي عبر Redis وينتهي بصفّ سائق حقيقي في القاعدة", async () => {
    await post(text("/start"));
    await post(text("عبدالله الحربي"));
    await post(contact("+966500000111"));

    await post(callback(`city:${cityId}`));
    await post(callback("service:transport"));

    const rows = await sql<{ full_name: string; phone: string }[]>`
      select full_name, phone from users where telegram_id = ${DRIVER_CHAT}
    `;
    expect(rows[0]).toEqual({ full_name: "عبدالله الحربي", phone: "+966500000111" });
  });

  it("انتهاء مهلة المفتاح في Redis يُعيد الحوار إلى بدايته لا إلى خطوة معلَّقة", async () => {
    await post(text("/start"));
    await post(text("عبدالله الحربي"));
    expect(redis.keys()).toHaveLength(1);

    // نصف ساعة وثانية: المهلة نفسها التي كتبها المخزن مع الأمر SET
    clockMs += 1801 * 1000;
    expect(redis.keys()).toHaveLength(0);

    driverSent.length = 0;
    await post(text("رقم جوالي 0500000111"));

    // بلا جلسة يبدأ الحوار من أوله، ولا يُفسَّر النصّ على أنه إجابة خطوة الهاتف
    const usersAfter = await sql<{ count: string }[]>`
      select count(*)::text as count from users where telegram_id = ${DRIVER_CHAT}
    `;
    expect(usersAfter[0]?.count).toBe("0");
    expect(driverSent.length).toBeGreaterThan(0);
  });
});
