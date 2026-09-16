/**
 * الغرض: تشغيل ثلاثين رحلة حقيقية متتابعة بلا أي تدخّل يدوي بينها، على قاعدة
 *   PostgreSQL فعلية ومن الويبهوك إلى الصفوف. المطلوب إثباتُه ليس أن رحلة
 *   واحدة تنجح — ذاك مُثبَت في tests/integration/mutual-ratings — بل أن النظام
 *   يصمد على التكرار: لا حالة عالقة من رحلة تسمّم التي بعدها، ولا عدّاد ينحرف،
 *   ولا سائق يبقى مشغولاً بعد الإنهاء، ولا تدهور في **العمل** مع الطول.
 *
 *   وتدهورُ الطولِ يُقاسُ **بعملِ المحرِّكِ لا بزمنِ الساعةِ** (`DEC-18` ·
 *   `ADR 0130`): صفوفٌ ممسوحةٌ وكُتَلٌ ملموسةٌ من `pg_stat_database`، لا
 *   `performance.now()`. والسببُ مقيسٌ لا مُفترَضٌ: توكيدُ نسبةِ الزمنِ قرأَ ٣٫٢
 *   على مُنفِّذٍ مُشترَكٍ في التشغيلِ `35124024068` ثمَّ مرَّ بالبصمةِ نفسِها —
 *   فكانَ يقيسُ جارَ المُنفِّذِ لا شِفرتَنا. والتفصيلُ في `tests/support/engine-work.ts`.
 *
 *   هذا ما يفرّق «يعمل» عن «يصلح للإطلاق»: العيوب التراكمية لا تظهر في المحاولة
 *   الأولى بل في العشرين.
 *
 * الحالة: اختبار e2e فعلي — يتطلب TEST_DATABASE_URL، ويُتخطّى بلا فشل بدونه.
 * ينتمي إلى: tests/e2e
 * الاستعمال: TEST_DATABASE_URL=... bun test tests/e2e
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { testConfig } from "../support/config.ts";
import {
  describeWorkGrowth,
  type EngineWork,
  settleEngineWork,
  WORK_BLOCK_RIDES,
  WORK_GROWTH_CEILING,
  workBetween,
  workGrowth,
} from "../support/engine-work.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "e2e-secret";

/** ثلاثون: الحدّ الأعلى لما طلبه التوجيه، فالأدنى منه لا يزيد ثقة. */
const RIDES = 30;

/** نطاق منفصل عن كل اختبار آخر (880xxx للهوية، 340xxx للدعم، 100/200xxx للرحلة). */
const DRIVER_CHAT = 450_001;
const RIDER_BASE = 460_000;

// جدة الحقيقية: الالتقاط والسائق على بعد أقلّ من كيلومتر، والوجهة داخل النطاق
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5612, longitude: 39.1889 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3998,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
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
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const privateCallback = (chatId: number, data: string) => ({
  callback_query: {
    data,
    from: { id: chatId },
    message: { chat: { id: chatId, type: "private" } },
  },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات e2e مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

describeIf("صمود: ثلاثون رحلة متتابعة بلا تدخّل", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;

    // تنظيف مرّة واحدة فقط في البداية: المقصود من الاختبار أن تتراكم الحالة
    // عبر الرحلات الثلاثين، فمسحها بين كل رحلة يُبطل الغرض منه أصلاً.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
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

    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  afterAll(async () => {
    await container.close();
    await sql.end({ timeout: 5 });
  });

  it("ثلاثون رحلة كاملة تتوالى على سائق واحد بلا حالة عالقة ولا انحراف عدّاد", async () => {
    // سائق واحد لكل الرحلات عمداً: تدوير السائقين يُخفي بالضبط ما نبحث عنه —
    // بقايا الرحلة السابقة في صفّ السائق (توافر، حالة، عدّاد تقييم).
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "فهد الصامد"));
    await post("driver", contact(DRIVER_CHAT, "+966500450001"));
    await post("driver", privateCallback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", privateCallback(DRIVER_CHAT, "service:transport"));
    await post("driver", privateCallback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001010"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001010"));

    const driverRows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id
       where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = driverRows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await post("driver", text(DRIVER_CHAT, "/available"));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));

    /** نجوم دوّارة: متوسّط متوقَّع 4 بالضبط، فالانحراف يُكشف حسابياً لا تقريباً. */
    const starCycle = [3, 4, 5, 4] as const;
    /** حدودُ الكُتَلِ الثلاثِ: بعدَ الرحلةِ العاشرةِ والعشرينَ والثلاثينَ. */
    const boundaries = new Map<number, EngineWork>();
    let expectedStarSum = 0;

    for (let ride = 0; ride < RIDES; ride += 1) {
      const riderChat = RIDER_BASE + ride + 1;

      // عميل جديد لكل رحلة: هذا واقع التشغيل، وهو أيضاً ما يمنع مسار الطلب
      // من الاعتماد على جلسة راكب دافئة من الرحلة السابقة.
      await post("rider", text(riderChat, "/start"));
      await post("rider", text(riderChat, `راكب رقم ${ride + 1}`));
      await post("rider", contact(riderChat, `+96650046${String(ride + 1).padStart(4, "0")}`));
      await post("rider", privateCallback(riderChat, `city:${cityId}`));

      await post("rider", text(riderChat, "/ride"));
      await post("rider", location(riderChat, PICKUP));
      await post("rider", location(riderChat, DROPOFF));

      const orderRows = await sql<{ id: string; status: string }[]>`
        select id, status from orders order by created_at desc limit 1
      `;
      const orderId = orderRows[0]?.id;
      expect(orderId).toBeDefined();
      if (orderId === undefined) throw new Error(`لم يُنشأ الطلب في الرحلة ${ride + 1}`);

      await post("driver", privateCallback(DRIVER_CHAT, `offer:accept:${orderId}`));
      await post("driver", privateCallback(DRIVER_CHAT, `ride:start:${orderId}`));
      await post("driver", privateCallback(DRIVER_CHAT, `ride:complete:${orderId}`));

      const stars = starCycle[ride % starCycle.length] ?? 4;
      expectedStarSum += stars;
      await post("rider", privateCallback(riderChat, `rate:${stars}:${orderId}`));
      await post("driver", privateCallback(DRIVER_CHAT, `rate:5:${orderId}`));

      // حدُّ كتلةٍ: تُقرأُ العدّاداتُ بعدَ سكونٍ مقيسٍ، ثلاثَ مرّاتٍ لا ثلاثينَ.
      if ((ride + 1) % WORK_BLOCK_RIDES === 0) {
        boundaries.set(ride + 1, await settleEngineWork(sql));
      }

      // تحقّق داخل الحلقة: الفشل يجب أن يُنسب إلى رحلته لا أن يظهر مجمّعاً في
      // النهاية، وإلا ضاع أثر أوّل رحلة انكسرت.
      const [order] = await sql<{ status: string; completed_at: Date | null }[]>`
        select status, completed_at from orders where id = ${orderId}
      `;
      expect(`رحلة ${ride + 1}: ${order?.status}`).toBe(`رحلة ${ride + 1}: completed`);
      expect(order?.completed_at).not.toBeNull();

      // السائق عاد متاحاً تلقائياً — وهذا الشرط بالذات هو ما يجعل الرحلة
      // التالية ممكنة أصلاً، فانكساره يوقف السلسلة لا رحلةً واحدة.
      const [availability] = await sql<{ is_available: boolean }[]>`
        select is_available from driver_availability where driver_id = ${driverId}
      `;
      expect(`رحلة ${ride + 1}: ${availability?.is_available}`).toBe(`رحلة ${ride + 1}: true`);
    }

    // لا طلب عالق في أي حالة وسيطة بعد انتهاء السلسلة كلّها
    const byStatus = await sql<{ status: string; count: string }[]>`
      select status, count(*)::text as count from orders group by status order by status
    `;
    expect(byStatus.map((r) => ({ ...r }))).toEqual([
      { status: "completed", count: String(RIDES) },
    ]);

    // العدّاد لم ينحرف: تقييم واحد لكل اتجاه لكل رحلة، لا أكثر ولا أقلّ
    const [ratingCount] = await sql<{ count: string }[]>`
      select count(*)::text as count from ratings
    `;
    expect(ratingCount?.count).toBe(String(RIDES * 2));

    // المتوسّط محسوب لا مُقرَّب: مجموع النجوم على العدد
    const [driverRow] = await sql<{ rating_average: string; rating_count: number }[]>`
      select rating_average, rating_count from drivers where id = ${driverId}
    `;
    expect(driverRow?.rating_count).toBe(RIDES);
    expect(Number(driverRow?.rating_average)).toBeCloseTo(expectedStarSum / RIDES, 2);

    // لا عرض معلَّق: كل عرض حُسم، فلا صفّ pending يتراكم بلا نهاية. والمقارنة
    // بالتوزيع كاملاً لا بعدّ pending وحده، كي يُكشف أي حال لم نتوقّعها.
    const offersByStatus = await sql<{ status: string; count: string }[]>`
      select status, count(*)::text as count from order_offers group by status order by status
    `;
    expect(offersByStatus.map((r) => ({ ...r }))).toEqual([
      { status: "accepted", count: String(RIDES) },
    ]);

    // لا تدهورَ معَ الطولِ — **مقيساً بعملِ المحرِّكِ**: عملُ آخرِ عشرِ رحلاتٍ لا
    // يتجاوزُ ثلاثةَ أضعافِ عملِ العشرِ التي قبلَها. والمقصودُ كشفُ نموٍّ خطّيٍّ أو
    // أسوأَ (فهرسٌ مفقودٌ · تسريبُ حالةٍ · استعلامٌ يمسحُ جدولاً ينمو)، والعتبةُ
    // **هيَ عينُها قبلَ `DEC-18`**: بُدِّلَت وحدةُ القياسِ لا سقفُه.
    //
    // والكتلةُ الأولى (١..١٠) **مُستبعَدةٌ إحماءً مُعلَناً**: فيها أوّلُ لمسةٍ لكلِّ
    // فهرسٍ وكلِّ خطّةٍ مُخبَّأةٍ، فعملُها أعلى بطبعِه — وجعلُها أساساً يُوسِّعُ
    // المقامَ فيُخضِّرُ نموّاً حقيقيّاً. فالمقارنةُ بينَ كتلتَينِ **دافئتَينِ**.
    const atTen = boundaries.get(10);
    const atTwenty = boundaries.get(20);
    const atThirty = boundaries.get(30);
    if (atTen === undefined || atTwenty === undefined || atThirty === undefined) {
      throw new Error("لم تُقرأْ حدودُ الكُتَلِ الثلاثُ — القياسُ ناقصٌ فلا حكمَ له");
    }
    const warmBaseline = workBetween(atTen, atTwenty);
    const finalBlock = workBetween(atTwenty, atThirty);
    const growth = workGrowth(warmBaseline, finalBlock);
    const reading = describeWorkGrowth(warmBaseline, finalBlock, growth);
    // القراءةُ تُطبَعُ دائماً لا عندَ الفشلِ فقط: حاجزٌ لا يُقرأُ رقمُه حاجزٌ يُصدَّقُ
    // بلا دليلٍ، وسجلُّ CI هوَ الدليلُ الذي يُراجَعُ بعدَ شهرٍ.
    console.log(`صمود/عمل: ${reading}`);
    expect(growth.rowsRatio).toBeLessThan(WORK_GROWTH_CEILING);
    expect(growth.blocksRatio).toBeLessThan(WORK_GROWTH_CEILING);
  }, 180_000);
});
