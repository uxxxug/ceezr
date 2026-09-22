/**
 * الغرض: قياسُ **الدالّةِ والمحوّلِ** لإعلانِ التعذُّرِ من طبقةِ التطبيقِ
 *   (`SEC-19` · الساقُ «ب-٤» · الخطوةُ الخامسة) على PostgreSQL حقيقيٍّ.
 *
 *   الخطوةُ الرابعةُ أضافت حرسًا في TypeScript قبلَ `String(contact.telegram_id)`
 *   ودالّةً `mark_notification_undeliverable(uuid, uuid, text)` تُعالِجُ إعلانَ
 *   التعذُّرِ. والقياسُ الوحدويُّ يتأكَّدُ من أنَّ `telegram_id = null` لا يُرسِلُ
 *   `"null"`. وهذه الخطوةُ تقيسُ **الوصلَ بينَ الكودِ والقاعدةِ**: الدالّةُ تعملُ،
 *   والمحوّلُ يناديها، و`deliverNotification` يُعلِنُ `undeliverable` لا `dead`،
 *   والشوطُ لا ينكسرُ.
 *
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22.
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-19` · `F6-05` (مركزُ الإشعاراتِ) · `ADR 0136` (الأثرُ يُقاسُ بالأثرِ)
 *
 * ## وما لا يُقاسُ ههنا — مُسمّىً لا مسكوتاً عنه (`ح-5`)
 *
 * **لا يُقاسُ `telegram_id = null` في القاعدةِ**: عمودُ `users.telegram_id`
 * مُلزَمٌ بـ`not null` في المخطّطِ المنشورِ، فلا يمكنُ إنشاءُ صفٍّ كهذا
 * دونَ تخريبِ القيدِ. حرسُ `String(null)` يُقاسُ وحدويًّا في
 * `tests/unit/sec-19-ts-guard-string-null.test.ts`. وهنا يُقاسُ الوصلُ: الدالّةُ
 * والمحوّلُ وتدفُّقُ `deliverNotification`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  NotificationDeliveryDeps,
  NotificationHandler,
} from "../../packages/application/notification/deliver-notification.ts";
import {
  deliverNotification,
  deliverNotificationBatch,
} from "../../packages/application/notification/deliver-notification.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { ok } from "../../packages/shared/result/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ دالّةِ ومحوّلِ التعذُّرِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

/** بادئةٌ تُميِّزُ صفوفَ هذا الملفِّ فتُمحى وحدَها ولا يُمَسُّ سواها. */
const MARK = "sec19-step5";

type FunctionResult = {
  readonly ok: boolean;
  readonly delivery_id: string | null;
  readonly status: string | null;
  readonly dead_reason: string | null;
};

type OutboxRow = {
  readonly id: string;
  readonly status: string;
  readonly dead_reason: string | null;
  readonly died_at: string | null;
  readonly claim_token: string | null;
  readonly claimed_at: string | null;
  readonly attempts: number;
};

describeIf("دالّةُ ومحوّلُ التعذُّرِ من طبقةِ التطبيقِ (SEC-19-ب-٤ · Step 5)", () => {
  let sql: Sql;
  let cityId: string;
  let driverId: string;
  let orderId: string;
  let offerId: string;
  let outboxId: string;
  let claimToken: string;
  let secondOfferId: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });

    const cities = await sql<{ id: string }[]>`select id from cities order by created_at limit 1`;
    const city = cities[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدةِ: القياسُ يحتاجُ مدينةً قائمةً.");
    cityId = city.id;

    const user = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(8_500_000_000_000 + Date.now())}::bigint, ${MARK}, 'ar', 'rider')
      returning id
    `;
    const userId = user[0]?.id as string;

    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      values (${cityId}::uuid, ${userId}::uuid)
      returning id
    `;
    const riderId = rider[0]?.id as string;

    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${cityId}::uuid, ${riderId}::uuid, 'delivery', 'searching',
              st_setsrid(st_makepoint(0, 0), 4326))
      returning id
    `;
    orderId = order[0]?.id as string;

    const driverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(9_500_000_000_000 + Date.now())}::bigint, ${`${MARK}-driver`}, 'ar', 'driver')
      returning id
    `;
    const driverUserId = driverUser[0]?.id as string;

    const driver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}::uuid, ${driverUserId}::uuid, 'verified')
      returning id
    `;
    driverId = driver[0]?.id as string;

    const offer = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, distance_km, expires_at, status)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, 5.0, now() + interval '5 minutes', 'pending')
      returning id
    `;
    offerId = offer[0]?.id as string;

    // صفٌّ واحدٌ يُستخدَمُ في الاختباراتِ ١-٣: يُوضَعُ في `sending` برمزِ حجزٍ يدويًّا.
    const inserted = await sql<{ id: string; claim_token: string }[]>`
      insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id, dedup_key, payload,
                                       status, claim_token, claimed_at, attempts)
      values (${cityId}::uuid, 'offer', ${offerId}::uuid, ${orderId}::uuid, ${driverId}::uuid,
              ${`${MARK}:${Date.now()}`}, ${sql.json({ mark: MARK })},
              'sending', gen_random_uuid(), now(), 1)
      returning id, claim_token
    `;
    outboxId = inserted[0]?.id as string;
    claimToken = String(inserted[0]?.claim_token);
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`delete from notification_outbox where id = ${outboxId}::uuid`;
    await sql`delete from notification_outbox where dedup_key like ${`${MARK}:%`}`;
    await sql`delete from order_offers where id = ${offerId}::uuid`;
    await sql`delete from orders where id = ${orderId}::uuid`;
    await sql`delete from drivers where id = ${driverId}::uuid`;
    await sql`delete from riders where user_id in (select id from users where full_name like ${`${MARK}%`})`;
    await sql`delete from users where full_name like ${`${MARK}%`}`;
    await sql.end();
  });

  /** يُعيدُ الصفَّ من القاعدةِ بحالتِه الحاليّةِ. */
  async function readRow(id: string): Promise<OutboxRow | undefined> {
    const rows = await sql<OutboxRow[]>`
      select id, status, dead_reason, died_at, claim_token, claimed_at, attempts
        from notification_outbox where id = ${id}::uuid
    `;
    return rows[0];
  }

  it("١) mark_notification_undeliverable: رمزُ حجزٍ مطابِقٌ ⇒ ok=true والحالةُ undeliverable", async () => {
    // أعد ضبطَ الصفِّ إلى `sending` برمزِ حجزٍ يدويًّا.
    const newToken = "11111111-1111-1111-1111-111111111111";
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = ${newToken}::uuid, claimed_at = now(),
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;

    const rows = await sql<{ result: FunctionResult }[]>`
      select mark_notification_undeliverable(${outboxId}::uuid, ${newToken}::uuid, 'TELEGRAM_DELIVERY_UNAVAILABLE'::text) result
    `;
    expect(rows[0]?.result).toMatchObject({
      ok: true,
      delivery_id: outboxId,
      status: "undeliverable",
      dead_reason: "TELEGRAM_DELIVERY_UNAVAILABLE",
    });

    const row = await readRow(outboxId);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
    expect(row?.died_at).not.toBeNull();
    expect(row?.claim_token).toBeNull();
    expect(row?.claimed_at).toBeNull();
  });

  it("٢) mark_notification_undeliverable: رمزُ حجزٍ خاطئٌ ⇒ ok=false والصفُّ لا يتغيَّر", async () => {
    const realToken = "22222222-2222-2222-2222-222222222222";
    const wrongToken = "33333333-3333-3333-3333-333333333333";
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = ${realToken}::uuid, claimed_at = now(),
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;

    const rows = await sql<{ result: FunctionResult }[]>`
      select mark_notification_undeliverable(${outboxId}::uuid, ${wrongToken}::uuid, 'TELEGRAM_DELIVERY_UNAVAILABLE'::text) result
    `;
    expect(rows[0]?.result).toMatchObject({ ok: false });

    const row = await readRow(outboxId);
    expect(row?.status).toBe("sending");
    expect(row?.claim_token).toBe(realToken);
  });

  it("٣) mark_notification_undeliverable: صفٌّ ليسَ في `sending` ⇒ ok=false (pending, delivered, dead)", async () => {
    // صفٌّ `delivered` — لا يُعلَنُ تعذُّرٌ على ما سُلِّمَ.
    // (يلزمه `delivered_at` و`delivered_message_id` بسبب `notification_delivered_pair`.)
    await sql`
      update notification_outbox
         set status = 'delivered', claim_token = ${claimToken}::uuid, claimed_at = now(),
             delivered_at = now(), delivered_message_id = 'msg-test',
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;

    const deliveredRows = await sql<{ result: FunctionResult }[]>`
      select mark_notification_undeliverable(${outboxId}::uuid, ${claimToken}::uuid, 'TELEGRAM_DELIVERY_UNAVAILABLE'::text) result
    `;
    expect(deliveredRows[0]?.result).toMatchObject({ ok: false });
    const deliveredRow = await readRow(outboxId);
    expect(deliveredRow?.status).toBe("delivered");

    // صفٌّ `pending` — لم يُحجَز بعدُ.
    await sql`
      update notification_outbox
         set status = 'pending', claim_token = null, claimed_at = null,
             delivered_at = null, delivered_message_id = null,
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;
    const pendingRows = await sql<{ result: FunctionResult }[]>`
      select mark_notification_undeliverable(${outboxId}::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'TELEGRAM_DELIVERY_UNAVAILABLE'::text) result
    `;
    expect(pendingRows[0]?.result).toMatchObject({ ok: false });
    const pendingRow = await readRow(outboxId);
    expect(pendingRow?.status).toBe("pending");

    // صفٌّ `dead` — مات، فلا يُعلَنُ تعذُّرٌ عليه.
    await sql`
      update notification_outbox
         set status = 'dead', claim_token = null, claimed_at = null,
             delivered_at = null, delivered_message_id = null,
             died_at = now(), dead_reason = 'TELEGRAM_ID_MISSING'
       where id = ${outboxId}::uuid
    `;
    const deadRows = await sql<{ result: FunctionResult }[]>`
      select mark_notification_undeliverable(${outboxId}::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'TELEGRAM_DELIVERY_UNAVAILABLE'::text) result
    `;
    expect(deadRows[0]?.result).toMatchObject({ ok: false });
    const deadRow = await readRow(outboxId);
    expect(deadRow?.status).toBe("dead");
  });

  it("٤) NotificationOutboxAdapter.undeliverable: ينادي الدالّةَ ويُعيدُ النتيجةَ", async () => {
    // أعد ضبطَ الصفِّ إلى `sending` برمزِ حجزٍ.
    const adapterToken = "44444444-4444-4444-4444-444444444444";
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = ${adapterToken}::uuid, claimed_at = now(),
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;

    const port = createNotificationOutboxPort(sql);
    const result = await port.undeliverable({
      deliveryId: outboxId,
      claimToken: adapterToken,
      reason: "TELEGRAM_DELIVERY_UNAVAILABLE",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(true);

    const row = await readRow(outboxId);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });

  it("٥) deliverNotification: معالجٌ يُرجِعُ undeliverable ⇒ الصفُّ undeliverable لا dead", async () => {
    // أعد ضبطَ الصفِّ إلى `pending` ثمَّ التقِطْه عبر `claim_notification_delivery`.
    await sql`
      update notification_outbox
         set status = 'pending', claim_token = null, claimed_at = null,
             died_at = null, dead_reason = null, attempts = 0, next_attempt_at = now()
       where id = ${outboxId}::uuid
    `;

    const port = createNotificationOutboxPort(sql);

    // معالجٌ وهميٌّ يُرجِعُ `undeliverable: true` — يحاكي ما يفعله `createOfferNotificationHandler`
    // حينَ يرمي الحرسُ `TELEGRAM_DELIVERY_UNAVAILABLE`.
    const handler: NotificationHandler = async () =>
      ok({
        abandon: false,
        messageId: null,
        failure: null,
        undeliverable: true,
        undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
      });

    const deps: NotificationDeliveryDeps = {
      outbox: port,
      handlers: { offer: handler },
    };

    const result = await deliverNotification(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.found).toBe(true);
    expect(result.value.undeliverable).toBe(true);
    expect(result.value.delivered).toBe(false);
    expect(result.value.abandoned).toBe(false);
    expect(result.value.died).toBe(false);

    const row = await readRow(outboxId);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });

  it("٦) سببٌ خارجُ القائمةِ المغلقةِ يُرفَضُ (notification_undeliverable_reason_check)", async () => {
    // أعد ضبطَ الصفِّ إلى `sending` برمزِ حجزٍ.
    const invalidToken = "77777777-7777-7777-7777-777777777777";
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = ${invalidToken}::uuid, claimed_at = now(),
             died_at = null, dead_reason = null
       where id = ${outboxId}::uuid
    `;

    // سببٌ غيرُ مسموحٍ به — القيدُ يرفضُه.
    try {
      await sql`
        select mark_notification_undeliverable(${outboxId}::uuid, ${invalidToken}::uuid, 'INVALID_REASON'::text) result
      `;
      throw new Error("كانَ ينبغي أن يُرفَضَ السببُ غيرُ المسموحِ به");
    } catch (e: unknown) {
      const msg = String((e as Error).message);
      expect(msg).toContain("notification_undeliverable_reason_check");
    }

    // الصفُّ لم يتغيَّر — ظلَّ في `sending`.
    const row = await readRow(outboxId);
    expect(row?.status).toBe("sending");
  });

  it("٧) deliverNotificationBatch: شوطٌ لا ينكسرُ بعدَ صفٍّ undeliverable", async () => {
    // صفَّانِ: الأوّلُ يُرجِعُ undeliverable والثاني ناجحٌ.

    // أعد ضبطَ الصفِّ الأوّلِ إلى `pending`.
    await sql`
      update notification_outbox
         set status = 'pending', claim_token = null, claimed_at = null,
             died_at = null, dead_reason = null, attempts = 0, next_attempt_at = now()
       where id = ${outboxId}::uuid
    `;

    // أنشِئ عرضاً ثانياً للصفِّ الثاني — `offer_id` فريدٌ في `notification_outbox`.
    const secondOffer = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, distance_km, expires_at, status)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, 3.0, now() + interval '5 minutes', 'pending')
      returning id
    `;
    secondOfferId = secondOffer[0]?.id as string;

    // أنشِئ صفَّاً ثانياً.
    const second = await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id, dedup_key, payload,
                                       status, next_attempt_at)
      values (${cityId}::uuid, 'offer', ${secondOfferId}::uuid, ${orderId}::uuid, ${driverId}::uuid,
              ${`${MARK}:second:${Date.now()}`}, ${sql.json({ mark: `${MARK}-2` })},
              'pending', now())
      returning id
    `;
    const secondId = second[0]?.id as string;

    try {
      const port = createNotificationOutboxPort(sql);

      // معالجٌ يُرجِعُ `undeliverable` للصفِّ الأوّلِ و`delivered` للثاني.
      // لكنَّ `deliverNotification` يلتقطُ صفَّاً واحداً في كلِّ دورةٍ، فالترتيبُ
      // يعتمدُ على القاعدةِ. لكِنَّ كلا الصفَّينِ من نوعٍ واحدٍ ونفسِ المدينةِ،
      // فيُلتقَطُ الأقدمُ أوّلاً (الأوّلُ).
      const handler: NotificationHandler = async (delivery) => {
        if (delivery.deliveryId === secondId) {
          return ok({
            abandon: false,
            messageId: "msg-batch-2",
            failure: null,
            undeliverable: false,
          });
        }
        return ok({
          abandon: false,
          messageId: null,
          failure: null,
          undeliverable: true,
          undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
        });
      };

      const deps: NotificationDeliveryDeps = {
        outbox: port,
        handlers: { offer: handler },
      };

      const result = await deliverNotificationBatch(deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // الشوطُ لا ينكسرُ: التقَطَ صفَّينِ على الأقلِّ.
      expect(result.value.claimed).toBeGreaterThanOrEqual(2);
      // الأوّلُ عُذِرَ تسليمُه.
      expect(result.value.undeliverable).toBeGreaterThanOrEqual(1);
      // الثاني سُلِّمَ.
      expect(result.value.delivered).toBeGreaterThanOrEqual(1);

      // الصفُّ الأوّلُ undeliverable لا dead.
      const firstRow = await readRow(outboxId);
      expect(firstRow?.status).toBe("undeliverable");

      // الصفُّ الثاني delivered.
      const secondRow = await readRow(secondId);
      expect(secondRow?.status).toBe("delivered");
    } finally {
      await sql`delete from notification_outbox where id = ${secondId}::uuid`;
      await sql`delete from order_offers where id = ${secondOfferId}::uuid`;
    }
  });
});
