/**
 * الغرض: إثبات أن الطلب الباحث يُعاد عرضُه فعلاً — على قاعدةٍ حقيقيةٍ لا بمزيَّف.
 *
 *   وقبل المرحلة ١٤ كانت `broadcastOffers` تُنادى مرّةً واحدةً في عمر الطلب: عند
 *   إنشائه. فالطلبُ الذي انتهت مهلةُ عرضه الوحيد يصير `searching` بـ`broadcast_round`
 *   = 1 و`max_broadcast_rounds` = 3 وصفرَ عروضٍ قائمة — ولا دورةَ ثانية أبداً. وهو
 *   لا يُصعَّد كذلك، لأنّ `findStaleSearching` تشترط «بلا أيّ عرض» وهذا الطلب له
 *   عرضٌ منتهٍ. فلا يُبَثّ ولا يُصعَّد ولا يُلغى: يتيمٌ تماماً، والراكب قيل له «تم
 *   إشعار سائقٍ بطلبك، سيصلك ردٌّ قريباً» ثم لا شيء إلى الأبد.
 *
 *   والاختبارات هنا تُثبت السلوكَ الجديد لا تحتمله: تُقاس `broadcast_round` قبلَ
 *   إعادة العرض وبعدَها، ويُشترط ظهورُ عرضٍ `pending` جديدٍ في دورةٍ رقمها ٢.
 *
 * الحالة: اختبار تكامل فعلي — يحتاج TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديل على packages/application/dispatch/*
 * ملاحظات مستقبلية: يوم يصير للطلب مُصدرُ أحداث تبقى هذه التوكيدات صالحة — فهي
 *   تختبر النتيجة في القاعدة لا الطريق إليها.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { expireOffers } from "../../apps/workers/src/jobs/expire-offers.ts";
import { runRedispatchSearching } from "../../apps/workers/src/jobs/redispatch-searching.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createExpireOffersRpc,
  createOfferRepository,
  createOfferWriter,
  createPendingOfferRepository,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { type CityId, systemClock } from "../../packages/shared/kernel/index.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

/**
 * الحرس نفسه المستخدم في بقية اختبارات التكامل: بلا قاعدةٍ حقيقيةٍ يُتخطّى الوصف
 * بهدوءٍ بدل أن يسقط بـECONNREFUSED. وCI يفرض عدم التخطّي لأنّه يوفّر القاعدة،
 * فالحرس لا يخفي فشلاً — إنّما يفصل «لا قاعدة» عن «القاعدة ترفض».
 */
const describeIf = DATABASE_URL === "" ? describe.skip : describe;
if (DATABASE_URL === "") {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}
const WEBHOOK_SECRET = "redispatch-secret";
const D1 = 122_501;
const R1 = 222_501;
const ADMIN = 992_501;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3996,
  databaseUrl: DATABASE_URL,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN),
});

let sql: Sql;
let cityId: CityId;
let container: ReturnType<typeof buildContainer>;
let app: ReturnType<typeof createServer>;
const driverSent: SentMessage[] = [];
const riderSent: SentMessage[] = [];

let nextUpdateId = 100_000;
function withUpdateId(update: unknown): unknown {
  if (
    update !== null &&
    typeof update === "object" &&
    !Array.isArray(update) &&
    !Object.hasOwn(update, "update_id")
  ) {
    return { update_id: nextUpdateId++, ...(update as Record<string, unknown>) };
  }
  return update;
}

const post = (bot: string, update: unknown) =>
  app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(withUpdateId(update)),
    }),
  );
const msg = (chat: number, body: Record<string, unknown>) => ({
  message: { chat: { id: chat }, from: { id: chat, language_code: "ar" }, ...body },
});
const text = (c: number, v: string) => msg(c, { text: v });
const photo = (c: number, f: string) => msg(c, { photo: [{ file_id: `${f}_t` }, { file_id: f }] });
const loc = (c: number, at: { latitude: number; longitude: number }) => msg(c, { location: at });
const contact = (c: number, p: string) => msg(c, { contact: { user_id: c, phone_number: p } });
const cb = (c: number, d: string) => ({
  callback_query: { data: d, from: { id: c }, message: { chat: { id: c } } },
});

interface OrderShape {
  readonly status: string;
  readonly round: number;
  readonly pending: number;
  readonly expired: number;
  readonly maxRound: number;
}

async function orderShape(): Promise<OrderShape> {
  const rows = await sql<
    {
      status: string;
      round: number;
      pending: string;
      expired: string;
      max_round: string | null;
    }[]
  >`
    select o.status::text as status,
           o.broadcast_round as round,
           (select count(*)::text from order_offers f
             where f.order_id = o.id and f.status = 'pending') as pending,
           (select count(*)::text from order_offers f
             where f.order_id = o.id and f.status = 'expired') as expired,
           (select max(f.round)::text from order_offers f where f.order_id = o.id) as max_round
      from orders o
     limit 1`;
  const row = rows[0];
  if (row === undefined) throw new Error("لا طلب في القاعدة — تهيئة الاختبار لم تُنشئه");
  return {
    status: row.status,
    round: Number(row.round),
    pending: Number(row.pending),
    expired: Number(row.expired),
    maxRound: row.max_round === null ? 0 : Number(row.max_round),
  };
}

/** نفسُ تبعيّات البثّ التي يبنيها العامل في الإنتاج — لا نسخةٌ مبسّطة للاختبار. */
function redispatchDeps() {
  return {
    finder: createSearchingOrderFinder(sql),
    broadcast: {
      orders: createOrderRepository(sql),
      offers: createOfferRepository(sql),
      candidates: createDriverCandidateRepository(sql),
      settings: createSettingsRepository(sql),
      offerWriter: createOfferWriter(sql),
      clock: systemClock,
    },
    limit: 50,
  };
}

beforeAll(async () => {
  // الخطّافات علوية فتعمل حتّى مع describe.skip — فيُحرَس مدخلُها صراحةً.
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = (cities[0]?.id ?? "") as CityId;

  await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                           order_offers, orders, subscriptions, driver_capabilities,
                           driver_availability, drivers, riders, users restart identity cascade`;
  await sql`
    update cities set is_active = true, telegram_support_group_id = -1001,
           telegram_escalation_group_id = -1002, telegram_unsubscribed_drivers_group_id = -1003
     where id = ${cityId}`;

  container = buildContainer(config, {
    driverSender: capturing(driverSent),
    riderSender: capturing(riderSent),
  });
  app = createServer({
    health: { now: () => new Date(), startedAt: new Date(), env: process.env },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
  });

  const adminRows = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, role)
    values (${cityId}, ${ADMIN}, 'مدير الاختبار', 'admin') returning id`;
  const actor = adminRows[0]?.id ?? "";

  await post("driver", text(D1, "/start"));
  await post("driver", text(D1, "سعيد الزهراني"));
  await post("driver", contact(D1, "0501120501"));
  await post("driver", cb(D1, `city:${cityId}`));
  await post("driver", cb(D1, "service:transport"));
  await post("driver", cb(D1, "vehicle:sedan"));
  await post("driver", text(D1, "أ ب د 1502"));
  await post("driver", text(D1, "1000001502"));
  await post("driver", photo(D1, "vphoto_1502"));
  const dRows = await sql<{ id: string }[]>`
    select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${D1}`;
  await sql`select admin_set_driver_verification(${actor}::uuid, ${dRows[0]?.id ?? ""}::uuid, 'verified'::text)`;
  await post("driver", text(D1, "/available"));
  await post("driver", loc(D1, DRIVER_AT));

  await post("rider", text(R1, "/start"));
  await post("rider", text(R1, "ماجد القحطاني"));
  await post("rider", cb(R1, `city:${cityId}`));
  await post("rider", cb(R1, "svc:transport"));
  await post("rider", loc(R1, PICKUP));
  await post("rider", loc(R1, DROPOFF));
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  await container.close();
  await sql.end({ timeout: 5 });
});

describeIf("إعادة عرض الطلبات الباحثة — المرحلة ١٤", () => {
  it("خطّ الأساس: الطلب أُنشئ ووصل عرضٌ واحدٌ في الدورة الأولى", async () => {
    const shape = await orderShape();
    expect(shape.status).toBe("searching");
    expect(shape.round).toBe(1);
    expect(shape.pending).toBe(1);
  });

  it("شوطٌ والعرضُ ما زال حيّاً لا يفتح دورةً ولا يحرق واحدة", async () => {
    const before = await orderShape();
    const report = await runRedispatchSearching(cityId, redispatchDeps());
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // الطلبُ يُقرأ (لأنّ القارئَ لا يُفتي) ثم يردّه المجالُ لانعدام المؤهّلين:
    // السائقُ الوحيدُ مستبعَدٌ بعرضه الحيّ. فالنتيجةُ صفرُ كتابةٍ لا كتابةٌ خاطئة.
    expect(report.value.examined).toBe(1);
    expect(report.value.rebroadcast).toHaveLength(0);
    expect(report.value.stillNoDriver).toHaveLength(1);
    expect(report.value.failed).toBe(0);

    const after = await orderShape();
    expect(after.round).toBe(before.round);
    expect(after.pending).toBe(1);
  });

  it("انتهت مهلةُ العرض: تُفتح الدورةُ الثانية فعلاً ويصل عرضٌ جديدٌ لنفس السائق", async () => {
    // المهلةُ تُحسَب في المجال من `created_at + offer_timeout_seconds` لا من عمود
    // `expires_at`، فتقديمُ العمود لا أثرَ له — وهذا بنفسه عطبٌ مقيسٌ ومُوثَّق (R-51).
    await sql`update order_offers set created_at = now() - interval '600 seconds'
               where status = 'pending'`;
    const expired = await expireOffers(cityId, {
      offers: createPendingOfferRepository(sql),
      settings: createSettingsRepository(sql),
      rpc: createExpireOffersRpc(sql),
      clock: systemClock,
    });
    expect(expired.ok).toBe(true);

    const orphaned = await orderShape();
    // هذه هي الحالةُ التي كانت تدوم إلى الأبد: باحثٌ، دورةٌ واحدة، لا عرضَ قائماً.
    expect(orphaned.status).toBe("searching");
    expect(orphaned.round).toBe(1);
    expect(orphaned.pending).toBe(0);
    expect(orphaned.expired).toBe(1);

    const report = await runRedispatchSearching(cityId, redispatchDeps());
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.rebroadcast).toHaveLength(1);
    expect(report.value.stillNoDriver).toHaveLength(0);
    expect(report.value.exhausted).toHaveLength(0);
    expect(report.value.failed).toBe(0);

    const revived = await orderShape();
    expect(revived.status).toBe("searching");
    expect(revived.round).toBe(2);
    expect(revived.pending).toBe(1);
    // العرضُ الجديد في الدورة الثانية لا تكرارٌ للأولى: القيدُ الفريد
    // `(order_id, driver_id, round)` يمنع التكرار، فارتفاعُ `round` هو الدليل.
    expect(revived.maxRound).toBe(2);
  });

  it("استنفادُ الدورات يُصنَّف استنفاداً لا إخفاقاً، ولا تُكتب دورةٌ رابعة", async () => {
    const settings = await sql<{ value: string }[]>`
      select value from platform_settings
       where city_id = ${cityId} and key = 'max_broadcast_rounds'`;
    const maxRounds = Number(settings[0]?.value ?? "3");
    expect(maxRounds).toBeGreaterThan(0);

    // نستهلك ما بقي من الدورات بإنهاء العرض الحيّ ثم إعادة العرض، مرّةً بعد مرّة.
    for (let round = 2; round < maxRounds; round += 1) {
      await sql`update order_offers set created_at = now() - interval '600 seconds'
                 where status = 'pending'`;
      await expireOffers(cityId, {
        offers: createPendingOfferRepository(sql),
        settings: createSettingsRepository(sql),
        rpc: createExpireOffersRpc(sql),
        clock: systemClock,
      });
      const step = await runRedispatchSearching(cityId, redispatchDeps());
      expect(step.ok).toBe(true);
      if (step.ok) expect(step.value.rebroadcast).toHaveLength(1);
    }

    const atMax = await orderShape();
    expect(atMax.round).toBe(maxRounds);

    // الدورةُ الأخيرة استُهلكت: العرضُ الحيُّ يُنهى ثم يُطلب شوطٌ آخر — فيجب أن
    // يُصنَّف «استنفد» لا «لا مؤهّل» ولا «إخفاق»، ولا تُكتب دورةٌ تجاوز الحدّ.
    await sql`update order_offers set created_at = now() - interval '600 seconds'
               where status = 'pending'`;
    await expireOffers(cityId, {
      offers: createPendingOfferRepository(sql),
      settings: createSettingsRepository(sql),
      rpc: createExpireOffersRpc(sql),
      clock: systemClock,
    });
    const report = await runRedispatchSearching(cityId, redispatchDeps());
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.exhausted).toHaveLength(1);
    expect(report.value.rebroadcast).toHaveLength(0);
    expect(report.value.failed).toBe(0);

    const frozen = await orderShape();
    expect(frozen.round).toBe(maxRounds);
    expect(frozen.pending).toBe(0);
  });

  /**
   * الشرطان يُختبَران كلٌّ على انفراد عن قصد. أُثبت بفحص التحوير أنّ اختبارهما معاً
   * — طلبٌ `matched` **و** له سائقٌ مُسنَد — يُخفي عطبَ أيٍّ منهما: يكفي الشرطُ
   * الباقي ليُبقي التوكيد صحيحاً، فيَنجو المحوَّرُ الذي يُلغي أحدَهما. فعزلُ الشرط
   * ليس تنويعاً تجميليّاً بل هو الفرقُ بين اختبارٍ يحرس وآخرَ يُطمئن كذباً.
   */
  it("طلبٌ باحثٌ ولكنّه مُسنَدٌ لسائقٍ لا يُقرأ — شرطُ السائق وحده", async () => {
    const rows = await sql<{ id: string }[]>`select id from orders limit 1`;
    const orderId = rows[0]?.id ?? "";
    const drivers = await sql<{ id: string }[]>`select id from drivers limit 1`;
    // الحالةُ تبقى `searching` فلا يحجبه شرطُ الحالة: السائقُ المُسنَد وحده هو
    // ما يجب أن يحجبه. وهذه الحالةُ واقعيّة: الانتقال `matched → searching` مسموحٌ
    // في القاعدة، فطلبٌ عاد للبحث بسائقٍ لم يُمحَ حقلُه يجب ألّا يُبَثّ لأنّ سائقاً
    // مُسنَداً معناه أنّ الرحلةَ قد تكون جارية.
    await sql`update orders set assigned_driver_id = ${drivers[0]?.id ?? ""}
               where id = ${orderId}`;

    const report = await runRedispatchSearching(cityId, redispatchDeps());
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.examined).toBe(0);

    await sql`update orders set assigned_driver_id = null where id = ${orderId}`;
    const restored = await runRedispatchSearching(cityId, redispatchDeps());
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.examined).toBe(1);
  });

  it("طلبٌ غيرُ باحثٍ بلا سائقٍ مُسنَدٍ لا يُقرأ — شرطُ الحالة وحده", async () => {
    const rows = await sql<{ id: string }[]>`select id from orders limit 1`;
    const orderId = rows[0]?.id ?? "";
    // `cancelled` بلا سائقٍ مُسنَد: شرطُ السائق لا يحجبه، فالحالةُ وحدها هي الحارس.
    await sql`update orders set status = 'cancelled' where id = ${orderId}`;

    const report = await runRedispatchSearching(cityId, redispatchDeps());
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.examined).toBe(0);

    await sql`update orders set status = 'searching' where id = ${orderId}`;
  });
});
