/**
 * الغرض: إثبات العطب الذي وقع فعلاً في الإنتاج يوم 2026-08-11، وإثبات زواله.
 *
 *   عميل واحد (rider b7b95840 في قاعدة الإنتاج) كان يملك طلبين نشطين معاً:
 *   مشوار أُنشئ 05:29 وطرد أُنشئ 05:37. ضغط /cancel مرّة، فقرأ النظام «آخر طلب»
 *   بـ limit 1 فألغى الطرد — الأحدث — وردّ عليه بـ «تم إلغاء طلبك» بلا تسمية.
 *   فخرج العميل ظانّاً أن مشواره انتهى، والمشوار باقٍ 'searching' خمس ساعات،
 *   ظاهراً في لوحة الإدارة تحت «طلبات تبحث عن سائق». وهو ما اشتكى منه المالك.
 *
 *   والعطب الثاني في المسار نفسه: الإلغاء كان تحديثاً منفرداً لصفّ orders. لا
 *   العروض المعلّقة تُلغى — فيبقى بوسع سائق أن يرى بطاقة عرض لطلب انتهى — ولا
 *   السائق المُسنَد يُخبَر وهو في طريقه، ولا يبقى للحدث أثر في audit_log.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: يُوسَّع حين يُسحب نصّ بطاقة القروب من القروب بعد الإلغاء.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "cancel-secret";
const RIDER_CHAT = 270_001;
const DRIVER_CHAT = 270_002;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1902 };

const config: AppConfig = {
  env: "test",
  port: 3995,
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
  translationProvider: "none" as const,
  translationApiKey: null,
  translationContactEmail: null,
};

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let riderSent: SentMessage[];
let driverSent: SentMessage[];
let cityId: string;

async function post(bot: string, update: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const callback = (chatId: number, data: string) => ({
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

async function riderRegisters(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/start"));
  await post("rider", text(RIDER_CHAT, "عبدالله"));
  await post("rider", contact(RIDER_CHAT, "+966500000270"));
  await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
}

/** مشوار كامل حتى يصير الطلب 'searching'. */
async function orderRide(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/ride"));
  await post("rider", callback(RIDER_CHAT, "svc:transport"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
}

/** طرد: نقطة واحدة ووصف — لا وجهة ثانية. */
async function orderDelivery(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/delivery"));
  await post("rider", callback(RIDER_CHAT, "svc:delivery"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
  await post("rider", text(RIDER_CHAT, "شاورما"));
}

async function orderRows(): Promise<{ id: string; service: string; status: string }[]> {
  return sql<{ id: string; service: string; status: string }[]>`
    select id, service, status from orders order by created_at asc`;
}

describeIf("إلغاء الطلب: أي طلب أُلغي، ومن عَلِم به", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = -1001,
             telegram_escalation_group_id = -1002,
             telegram_unsubscribed_drivers_group_id = -1003
       where id = ${cityId}
    `;
    riderSent = [];
    driverSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("طلب واحد: التأكيد يسمّي ما أُلغي، لا «تم إلغاء طلبك» المجرّدة", async () => {
    await riderRegisters();
    await orderRide();

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const rows = await orderRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("cancelled");

    // النصّ يذكر نوع الخدمة على الأقل: العميل يجب أن يعرف ما الذي انتهى
    const last = riderSent.at(-1)?.text ?? "";
    expect(last).toContain("نقل أشخاص");
  });

  it("العطب الأصلي: طلبان نشطان — /cancel لا يختار عن العميل", async () => {
    await riderRegisters();
    await orderRide();
    await orderDelivery();

    const before = await orderRows();
    expect(before).toHaveLength(2);
    expect(before.every((row) => row.status === "searching")).toBe(true);

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    // قبل الإصلاح: كان يُلغى الأحدث (الطرد) صامتاً ويُقال «تم إلغاء طلبك».
    // بعده: لا يُلغى شيء قبل أن يختار العميل.
    const afterPrompt = await orderRows();
    expect(afterPrompt.every((row) => row.status === "searching")).toBe(true);

    const prompt = riderSent.at(-1);
    expect(prompt?.text).toContain("أكثر من طلب");
    // زرّ لكل طلب — لا زرّ واحد يخفي الآخر
    const keyboard =
      (prompt?.markup as { inline_keyboard?: { callback_data?: string }[][] } | null)
        ?.inline_keyboard ?? [];
    expect(keyboard).toHaveLength(2);
    const targets = keyboard.flat().map((button) => button.callback_data);
    expect(targets).toContain(`cancel:${before[0]?.id}`);
    expect(targets).toContain(`cancel:${before[1]?.id}`);
  });

  it("الاختيار يُلغي الطلب المقصود وحده — والمشوار لا يُترك يبحث", async () => {
    await riderRegisters();
    await orderRide();
    await orderDelivery();

    const rows = await orderRows();
    const ride = rows.find((row) => row.service === "transport");
    const delivery = rows.find((row) => row.service === "delivery");
    if (ride === undefined || delivery === undefined) throw new Error("لم يُنشأ الطلبان");

    await post("rider", text(RIDER_CHAT, "/cancel"));
    await post("rider", callback(RIDER_CHAT, `cancel:${ride.id}`));

    const after = await orderRows();
    const rideAfter = after.find((row) => row.id === ride.id);
    const deliveryAfter = after.find((row) => row.id === delivery.id);

    // هذا هو جوهر شكوى المالك: المشوار هو ما أُلغي، لا الطرد
    expect(rideAfter?.status).toBe("cancelled");
    expect(deliveryAfter?.status).toBe("searching");
  });

  it("الإلغاء يترك أثراً في audit_log — لم يكن يترك شيئاً", async () => {
    await riderRegisters();
    await orderRide();
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const logged = await sql<{ action: string; payload: Record<string, unknown> }[]>`
      select action, payload from audit_log where action = 'order.cancelled'`;
    expect(logged).toHaveLength(1);
    expect(logged[0]?.payload.reason).toBe("rider_cancelled");
    expect(logged[0]?.payload.previous_status).toBe("searching");
  });

  it("السائق صاحب العرض المعلّق يُخبَر، ولا يبقى عرضه معلّقاً", async () => {
    // سائق مكتمل التسجيل ومتاح، ليصله عرض حقيقي
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "فهد العتيبي"));
    await post("driver", contact(DRIVER_CHAT, "+966500000271"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000000270"));
    await post("driver", photo(DRIVER_CHAT, "photo_270"));
    await sql`update drivers set verification_status = 'verified'`;
    await post("driver", location(DRIVER_CHAT, PICKUP));
    await post("driver", text(DRIVER_CHAT, "/available"));

    await riderRegisters();
    await orderRide();

    const pending = await sql<{ count: string }[]>`
      select count(*) from order_offers where status = 'pending'`;
    // إن لم يصل عرض فالاختبار لا يقيس ما يدّعي قياسه — نكشف ذلك بدل تمريره
    expect(Number(pending[0]?.count)).toBeGreaterThan(0);

    driverSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));

    const stillPending = await sql<{ count: string }[]>`
      select count(*) from order_offers where status = 'pending'`;
    expect(Number(stillPending[0]?.count)).toBe(0);

    // السائق عَلِم فعلاً — لا مجرّد صفّ تغيّر في القاعدة
    const told = driverSent.some((sent) => sent.text.includes("أُلغي"));
    expect(told).toBe(true);
  });
});
