/**
 * الغرض: `F11-03` — **فقدانُ Redis كلِّه وسطَ دورةٍ تجاريّةٍ لا يُفسِدُ حالةً تجاريّةً**.
 *
 *   بوّابةٌ من `buildContainer` بـ`sessionStore: "redis"` على خادمِ Redis حقيقيٍّ
 *   وقاعدةِ PostgreSQL حقيقيّةٍ. ثمَّ يُقطَعُ **كلُّ أمرٍ** إلى Redis — الجلساتُ،
 *   وناقلُ `Streams`، ومخزنُ البثِّ الحيِّ، والحالةُ الساخنةُ، ودلوُ الصادرِ،
 *   وحصّةُ التوجيهِ — في أطوارٍ من دورةِ الرحلةِ:
 *
 *     ١) قطعٌ **قبلَ الإنشاءِ**: الراكبُ يُرسلُ نقطتَي الرحلةِ وRedis مقطوعٌ.
 *     ٢) عودةٌ، فينشئُ الراكبُ رحلتَه ويصلُ العرضُ السائقَين.
 *     ٣) قطعٌ **بعدَ الإنشاءِ**: السائقانِ يتسابقانِ على القبولِ معاً، ويُعادُ تسليمُ
 *        نقرةِ كلٍّ منهما، ثمَّ يبدأُ الفائزُ ويُقفِلُ ويُعادُ تسليمُ الإقفالِ.
 *     ٤) عودةٌ، وتسليمٌ متقادمٌ لكلِّ نقرةٍ سبقَت.
 *
 *   ثمَّ يُحكَمُ على لقطةِ القاعدةِ بـ`judgeCommercialState` (`scripts/lib/
 *   commercial-state-invariants.ts`): طلبٌ واحدٌ · حالةٌ مطلوبةٌ · قبولٌ واحدٌ
 *   والمقبولُ هو المُسنَدُ · لا معلَّقَ بعدَ البحثِ · سائقٌ برحلةٍ نشطةٍ واحدةٍ ·
 *   لا حركةَ ماليّةَ لم تُطلَبْ · والانقطاعُ محقونٌ فعلاً.
 *
 *   ## وأينَ يُحقَنُ الفقدانُ — وهذا حدُّ الدعوى
 *
 *   عندَ **حدِّ العميلِ** كما في `F4-08`: كلُّ نداءٍ يرجعُ `{ok:false, kind:"network"}`
 *   — عينُ الصورةِ التي يبنيها `createUpstashRedis` حينَ يسقطُ `fetch`. ولا يُدَّعى
 *   أنَّ خادماً مُداراً أُسقِطَ، ولا أنَّ هذا قياسُ إنتاجٍ أو حِملٍ (`ح-5`).
 *
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّب `UPSTASH_REDIS_REST_URL`/`_TOKEN` و`TEST_DATABASE_URL`.
 * ينتمي إلى: tests/real-redis
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ «تكامل على Redis حقيقي» في CI (`ADR 0193`).
 * ملاحظات مستقبلية: إن صارَ للرحلةِ أثرٌ ماليٌّ فالحَكَمُ يُشدَّدُ ولا يُخفَّفُ هذا.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import type { RedisClient } from "../../apps/gateway/src/redis/upstash.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import arMessages from "../../packages/shared/i18n/ar.json" with { type: "json" };
import {
  type CommercialSnapshot,
  judgeCommercialState,
  type MoneyCounts,
  type OfferRow,
  type OrderRow,
} from "../../scripts/lib/commercial-state-invariants.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
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
const WEBHOOK_SECRET = "redis-loss-commercial-secret";
const D1 = 131_301;
const D2 = 131_302;
const R1 = 231_301;
const ADMIN = 991_301;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

/**
 * الأثرُ الظاهرُ يُعرَفُ بصدرِ قالبِه قبلَ أوّلِ متغيّرٍ — من ملفِّ الترجمةِ نفسِه لا
 * بنصٍّ منسوخٍ، فتغييرُ الصياغةِ لا يُعمي العدَّ.
 */
const templateHead = (key: keyof typeof arMessages): string => {
  const head = String(arMessages[key]).split("{")[0] ?? "";
  if (head.trim() === "") throw new Error(`قالبُ ${key} بلا صدرٍ ثابتٍ — لا يُعَدُّ به`);
  return head;
};
const NOTICE_HEADS = {
  acceptance: templateHead("tracking.rider_matched"),
  completion: templateHead("rating.completed_rider"),
} as const;

/** الجداولُ الماليّةُ كلُّها: الدورةُ لا تطلبُ حركةً في أيٍّ منها. */
const MONEY_TABLES = [
  "ledger_entries",
  "payment_transactions",
  "subscriptions",
  "subscription_wallets",
  "subscription_wallet_entries",
  "subscription_invoices",
  "subscription_refunds",
] as const;

/**
 * شرطُ التفعيلِ مكتوبٌ بأسماءِ المتغيّراتِ صريحةً — حاجزُ تصنيفِ التجاوزِ (`OPS-009`)
 * يقرأ **هذا الملفَّ** فيتحقّق أنّ ما يزعمُه السجلُّ شرطاً هو ما يقرؤه الملفُّ فعلاً.
 */
const enabled =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured() &&
  DATABASE_URL !== undefined;
const describeIf = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn(
    "⚠️  فقدانُ Redis وسطَ الدورةِ التجاريّةِ مُتخطًّى: يحتاج UPSTASH_REDIS_REST_URL/_TOKEN وTEST_DATABASE_URL معاً.",
  );
}

const config: AppConfig = testConfig({
  port: 3994,
  databaseUrl: DATABASE_URL ?? "",
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN),
  sessionStore: "redis",
});

let sql: Sql;
let handle: RealRedisHandle;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let container: ReturnType<typeof buildContainer>;
let app: ReturnType<typeof createServer>;
const driverSent: SentMessage[] = [];
const riderSent: SentMessage[] = [];
const logs: { readonly event: string; readonly detail: unknown }[] = [];
let redisDown = false;
let cutCommands = 0;
let passedCommands = 0;

/**
 * الحاجزُ: كلُّ أمرٍ يمرُّ إلى الخادمِ الحقيقيِّ إلّا حالَ الفقدانِ — فحينَها **لا
 * أمرَ** يمرُّ، بلا استثناءِ بادئةٍ. وكلُّ مفتاحٍ ببادئةِ الإنتاجِ يُسجَّلُ ليُمحى.
 */
function gate(inner: RedisClient, track: (key: string) => void): RedisClient {
  return {
    command: async (args) => {
      for (const argument of args) {
        if (typeof argument === "string" && argument.startsWith("waslah:")) track(argument);
      }
      if (redisDown) {
        cutCommands += 1;
        return { ok: false, error: { kind: "network", detail: "فقدانٌ محقونٌ عندَ حدِّ العميلِ" } };
      }
      passedCommands += 1;
      return inner.command(args);
    },
  };
}

let updateIdCounter = 900_000;
const nextUpdateId = (): number => {
  updateIdCounter += 1;
  return updateIdCounter;
};

const post = async (bot: string, update: unknown): Promise<number> => {
  const response = await app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
  await response.text();
  return response.status;
};

const msg = (chat: number, body: Record<string, unknown>) => ({
  update_id: nextUpdateId(),
  message: { chat: { id: chat }, from: { id: chat, language_code: "ar" }, ...body },
});
const text = (c: number, v: string) => msg(c, { text: v });
const photo = (c: number, f: string) => msg(c, { photo: [{ file_id: `${f}_t` }, { file_id: f }] });
const loc = (c: number, at: { latitude: number; longitude: number }) => msg(c, { location: at });
const contact = (c: number, p: string) => msg(c, { contact: { user_id: c, phone_number: p } });
const cb = (c: number, d: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data: d, from: { id: c }, message: { chat: { id: c } } },
});

async function registerDriver(chat: number, suffix: string, actor: string): Promise<string> {
  await post("driver", text(chat, "/start"));
  await post("driver", text(chat, `سائق ${suffix}`));
  await post("driver", contact(chat, `0501${suffix}01`));
  await post("driver", cb(chat, `city:${cityId}`));
  await post("driver", cb(chat, "service:transport"));
  await post("driver", cb(chat, "vehicle:sedan"));
  await post("driver", text(chat, `أ ب د ${suffix}`));
  await post("driver", text(chat, `100000${suffix}`));
  await post("driver", photo(chat, `vphoto_${suffix}`));
  const rows = await sql<{ id: string }[]>`
    select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chat}`;
  const driverId = rows[0]?.id;
  if (driverId === undefined) throw new Error(`لم يُسجَّلْ السائقُ ${chat} — الحوارُ لم يكتملْ`);
  await sql`select admin_set_driver_verification(${actor}::uuid, ${driverId}::uuid, 'verified'::text)`;
  await post("driver", text(chat, "/available"));
  await post("driver", loc(chat, DRIVER_AT));
  return driverId;
}

async function moneyCounts(): Promise<MoneyCounts> {
  const counts: Record<string, number> = {};
  for (const table of MONEY_TABLES) {
    const rows = await sql<{ n: string }[]>`select count(*)::text as n from ${sql(table)}`;
    counts[table] = Number(rows[0]?.n ?? Number.NaN);
  }
  return counts;
}

async function readOrders(): Promise<OrderRow[]> {
  const rows = await sql<
    {
      id: string;
      rider_id: string;
      status: OrderRow["status"];
      assigned_driver_id: string | null;
    }[]
  >`select id, rider_id, status::text as status, assigned_driver_id from orders order by created_at`;
  return rows.map((row) => ({
    id: row.id,
    riderId: row.rider_id,
    status: row.status,
    assignedDriverId: row.assigned_driver_id,
  }));
}

async function readOffers(): Promise<OfferRow[]> {
  const rows = await sql<{ order_id: string; driver_id: string; status: OfferRow["status"] }[]>`
    select order_id, driver_id, status::text as status from order_offers`;
  return rows.map((row) => ({
    orderId: row.order_id,
    driverId: row.driver_id,
    status: row.status,
  }));
}

let riderId = "";
let driverIds: Record<number, string> = {};
let moneyBefore: MoneyCounts = {};

describeIf("فقدانُ Redis وسطَ الدورةِ التجاريّةِ على Redis حقيقيٍّ — F11-03", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    handle = createRealRedis();

    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });

    container = buildContainer(config, {
      redis: gate(handle.client, handle.trackForeignKey),
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      log: (event, detail) => {
        logs.push({ event, detail });
      },
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });

    const admins = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, role)
      values (${cityId}, ${ADMIN}, 'مدير الاختبار', 'admin') returning id`;
    const actor = admins[0]?.id ?? "";
    driverIds = {
      [D1]: await registerDriver(D1, "3301", actor),
      [D2]: await registerDriver(D2, "3302", actor),
    };

    await post("rider", text(R1, "/start"));
    await post("rider", text(R1, "ماجد القحطاني"));
    await post("rider", cb(R1, `city:${cityId}`));
    await post("rider", cb(R1, "svc:transport"));
    const riders = await sql<{ id: string }[]>`
      select r.id from riders r join users u on u.id = r.user_id where u.telegram_id = ${R1}`;
    riderId = riders[0]?.id ?? "";
    if (riderId === "") throw new Error("لم يُسجَّلْ الراكبُ — الحوارُ لم يكتملْ");
    moneyBefore = await moneyCounts();
  });

  afterAll(async () => {
    redisDown = false;
    await container?.close();
    const leftover = await handle.cleanup();
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
    expect(leftover).toBe(0);
  });

  it("دورةٌ كاملةٌ وRedis مقطوعٌ في طورَيها: القاعدةُ لا تحملُ فساداً تجاريّاً", async () => {
    const statuses: number[] = [];

    // ١) قطعٌ قبلَ الإنشاءِ.
    redisDown = true;
    const riderRepliesBefore = riderSent.length;
    statuses.push(await post("rider", loc(R1, PICKUP)));
    statuses.push(await post("rider", loc(R1, DROPOFF)));
    const ordersDuringCut = await readOrders();
    const cutBeforeCreate = cutCommands;
    const repliesDuringCut = riderSent.slice(riderRepliesBefore).map((m) => m.text.split("\n")[0]);
    redisDown = false;
    console.log(
      `── F11-03 · قطعٌ قبلَ الإنشاءِ: ${cutBeforeCreate} أمراً مقطوعاً · ${ordersDuringCut.length} طلبٍ · ردودُ الراكبِ ${JSON.stringify(repliesDuringCut)}`,
    );

    // ٢) عودةٌ وإنشاءٌ.
    await post("rider", cb(R1, "svc:transport"));
    statuses.push(await post("rider", loc(R1, PICKUP)));
    statuses.push(await post("rider", loc(R1, DROPOFF)));
    const created = await readOrders();
    const offersAtCreate = await readOffers();
    console.log(
      `── F11-03 · بعدَ العودةِ: ${created.length} طلبٍ · ${offersAtCreate.length} عرضٍ (${offersAtCreate.map((o) => o.status).join(",")})`,
    );
    const orderId = created[created.length - 1]?.id ?? "";

    // ٣) قطعٌ بعدَ الإنشاءِ: سباقُ قبولٍ وإعادةُ تسليمٍ وبدءٌ وإقفالٌ.
    redisDown = true;
    const accept1 = cb(D1, `offer:accept:${orderId}`);
    const accept2 = cb(D2, `offer:accept:${orderId}`);
    statuses.push(...(await Promise.all([post("driver", accept1), post("driver", accept2)])));
    statuses.push(await post("driver", accept1));
    statuses.push(await post("driver", accept2));
    const afterClaim = await readOrders();
    const winner = afterClaim.find((order) => order.id === orderId)?.assignedDriverId ?? null;
    const winnerChat = winner === driverIds[D1] ? D1 : D2;
    const start = cb(winnerChat, `ride:start:${orderId}`);
    const complete = cb(winnerChat, `ride:complete:${orderId}`);
    statuses.push(await post("driver", start));
    statuses.push(await post("driver", complete));
    statuses.push(await post("driver", complete));
    const cutDuringLifecycle = cutCommands - cutBeforeCreate;
    redisDown = false;

    // ٤) عودةٌ وتسليمٌ متقادمٌ.
    statuses.push(await post("driver", accept1));
    statuses.push(await post("driver", accept2));
    statuses.push(await post("driver", start));
    statuses.push(await post("driver", complete));

    const snapshot: CommercialSnapshot = {
      orders: await readOrders(),
      offers: await readOffers(),
      moneyBefore,
      moneyAfter: await moneyCounts(),
      notices: Object.fromEntries(
        Object.entries(NOTICE_HEADS).map(([kind, head]) => [
          kind,
          riderSent.filter((m) => m.chatId === String(R1) && m.text.startsWith(head)).length,
        ]),
      ),
    };
    const verdict = judgeCommercialState(snapshot, {
      riderId,
      expectedOrders: 1,
      expectedStatus: "completed",
      cutCommands,
      expectedNotices: { acceptance: 1, completion: 1 },
    });
    console.log(
      `── F11-03 · مقطوعٌ ${cutCommands} (قبلَ الإنشاءِ ${cutBeforeCreate} · من القبولِ إلى الإقفالِ ${cutDuringLifecycle}) · مارٌّ ${passedCommands} · الفائزُ ${winner === null ? "لا أحد" : winnerChat === D1 ? "D1" : "D2"} · ${JSON.stringify(snapshot.orders.map((o) => o.status))} · ${JSON.stringify(snapshot.offers.map((o) => o.status))}`,
    );
    console.log(`── F11-03 · الحكمُ: ${JSON.stringify(verdict)}`);
    console.log(`── F11-03 · حالاتُ الويبهوك: ${JSON.stringify(statuses)}`);
    console.log(
      `── F11-03 · سجلٌّ: ${JSON.stringify([...new Set(logs.map((l) => l.event))].filter((e) => /redis|degrad|fail|session/i.test(e)))}`,
    );
    // كلُّ طورٍ قُطِعَ فعلاً: طورٌ بلا أمرٍ مقطوعٍ لا يشهدُ على فقدانٍ فيه.
    expect(cutBeforeCreate).toBeGreaterThan(0);
    // زيادةٌ `D-36` (`ADR 0194`): نقطتا الراكبِ والجلسةُ متعذِّرةٌ تُجابانِ بعطلٍ صادقٍ لا بـ«لم أفهم».
    expect(repliesDuringCut).toEqual([
      arMessages["common.error_try_again"],
      arMessages["common.error_try_again"],
    ]);
    expect(cutDuringLifecycle).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(verdict.violations).toEqual([]);
  });
});
