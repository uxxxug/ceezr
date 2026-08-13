/**
 * الغرض: إثبات ما كان يحدث فعلاً في الإنتاج وما صار يحدث بعده: راكب يطلب ولا
 *   سائق في المدينة، فيبقى طلبه 'searching' بلا عرض واحد. قبل مهمّة الكنس كان
 *   يبقى كذلك إلى الأبد بلا كلمة تصله؛ وبعدها يُصعَّد إلى قروب الإسناد ويُخبَر
 *   صاحبه مرّة واحدة لا في كل شوط.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: يُوسَّع حين تُضاف إعادة البثّ قبل التصعيد.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { runSweepUnmatchedOrders } from "../../apps/workers/src/jobs/sweep-unmatched-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNegotiationWiring } from "../../packages/infrastructure/dispatch/negotiation-wiring.ts";
import {
  createUnmatchedOrderFinder,
  createUnmatchedRiderNotifier,
} from "../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import { asOutboundSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { NO_TRACKING_OVERRIDES } from "../../packages/shared/config/index.ts";
import { DEFAULT_LANGUAGE, t, translate } from "../../packages/shared/i18n/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "unmatched-secret";
const RIDER_CHAT = 250_001;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1902 };

const config: AppConfig = {
  env: "test",
  port: 3997,
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
  runWorkerInGateway: false,
  // المرحلة ١٠: حقول الخريطة. `none` هو الافتراضي في الضبط الحقيقي، فالاختبارات
  // تعبّر عن نفس الحال: لا خريطة، ولا مفتاح، ولا نمط.
  mapProvider: "none",
  mapStyleUrl: null,
  mapTilesPublicKey: null,
  maplibreSri: null,
  // المرحلة ١٥ — لا مزوّد توجيه في الاختبارات الافتراضية: زمن الوصول يُمتنع صريحاً.
  routingProvider: "none",
  osrmBaseUrl: null,
  tracking: NO_TRACKING_OVERRIDES,
};

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let riderSent: SentMessage[];
let groupSent: SentMessage[];
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
const callback = (chatId: number, data: string) => ({
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

/** كنسٌ بعتبة صفرية: الطلب المُنشأ للتوّ يُعدّ عالقاً بلا انتظار حقيقي في الاختبار. */
async function sweep(staleAfterSeconds = 0) {
  const negotiation = createNegotiationWiring(sql, {
    driverOut: asOutboundSender(capturing(groupSent)),
    riderOut: asOutboundSender(capturing(riderSent)),
    // بطاقة قروب الإسناد تُنشَر ببوت السائق: هو وحده العضو في القروبات،
    // ويجب أن يعود معرّف الرسالة ليُربط بالطلب.
    identifyingDriver: {
      sendReturningId: async (chatId: string, body: string) => {
        groupSent.push({ chatId, text: body, markup: null });
        return "1";
      },
    },
  });

  return runSweepUnmatchedOrders(cityId as CityId, {
    finder: createUnmatchedOrderFinder(sql),
    escalate: negotiation.escalate,
    notifier: createUnmatchedRiderNotifier(asOutboundSender(capturing(riderSent)), (order) => {
      const say = t(order.riderLanguage ?? DEFAULT_LANGUAGE);
      return order.service === "delivery"
        ? say("rider.no_driver_found_delivery")
        : say("rider.no_driver_found");
    }),
    staleAfterSeconds,
  });
}

/** راكب يصل إلى طلب رحلة قائم بلا أي سائق في المدينة. */
async function riderOrdersRide(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/start"));
  await post("rider", text(RIDER_CHAT, "عبدالله"));
  await post("rider", contact(RIDER_CHAT, "+966500000250"));
  await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
  await post("rider", text(RIDER_CHAT, "/ride"));
  await post("rider", callback(RIDER_CHAT, "svc:transport"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
}

describeIf("الطلب الذي لا يجد سائقاً: تصعيد وإشعار", () => {
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
    groupSent = [];
    container = buildContainer(config, {
      driverSender: capturing(groupSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("يُعيد إنتاج العطب: طلب بلا سائق يبقى يبحث بلا أي عرض", async () => {
    await riderOrdersRide();

    const orders = await sql<{ status: string; broadcast_round: number }[]>`
      select status, broadcast_round from orders`;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("searching");

    // هذا بالضبط ما رأيناه في الإنتاج: صفر عروض. لا شيء تُنهي مهلته expire-offers،
    // ولا دورة تُدوّرها rotate-negotiations — فالطلب كان يسقط بين المهمّتين.
    const offers = await sql<{ count: string }[]>`select count(*) from order_offers`;
    expect(Number(offers[0]?.count)).toBe(0);
  });

  it("الكنس يُصعّد الطلب إلى قروب الإسناد ويُخبر الراكب بالحقيقة", async () => {
    await riderOrdersRide();
    riderSent.length = 0;
    groupSent.length = 0;

    const report = await sweep();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(1);
    expect(report.value.escalated).toHaveLength(1);
    expect(report.value.notified).toHaveLength(1);

    // الأثر مُثبَّت في القاعدة لا في الذاكرة فقط
    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(1);

    // الراكب أُخبِر فعلاً، وبنصٍّ يقول له إنه لا سائق — لا صمت
    const told = riderSent.filter((m) => m.text === translate("ar", "rider.no_driver_found"));
    expect(told).toHaveLength(1);
    expect(String(told[0]?.chatId)).toBe(String(RIDER_CHAT));

    // وبطاقة وصلت قروب الإسناد
    const toGroup = groupSent.filter((m) => String(m.chatId) === "-1002");
    expect(toGroup.length).toBeGreaterThan(0);
  });

  it("الطلب لا يُصعَّد مرّتين ولا يُزعَج صاحبه في كل شوط", async () => {
    await riderOrdersRide();
    await sweep();
    riderSent.length = 0;
    groupSent.length = 0;

    // الشوط الثاني بعد دقيقة في الواقع — وهنا فوراً
    const second = await sweep();
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.examined).toBe(1);
    expect(second.value.escalated).toHaveLength(0);
    expect(second.value.alreadyEscalated).toBe(1);
    expect(second.value.notified).toHaveLength(0);

    // لا رسالة ثانية للراكب: عدم التكرار مضمون في القاعدة لا في ذاكرة العملية
    expect(
      riderSent.filter((m) => m.text === translate("ar", "rider.no_driver_found")),
    ).toHaveLength(0);

    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(1);
  });

  it("الطلب الذي لم يبلغ العتبة بعد لا يُصعَّد", async () => {
    await riderOrdersRide();
    riderSent.length = 0;

    // عتبة ساعة كاملة: الطلب أُنشئ للتوّ فلا يجوز أن يُصعَّد
    const report = await sweep(3600);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(0);
    expect(report.value.escalated).toHaveLength(0);
    expect(riderSent).toHaveLength(0);
  });
});
