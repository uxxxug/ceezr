/**
 * الغرض: قياسُ **الحالةِ الصريحةِ «غيرُ قابلٍ للتسليمِ»** في `notification_outbox`
 *   (`SEC-19` · الخطوةُ الثانية) على PostgreSQL حقيقيٍّ: القيدُ يقبلُ الحالةَ
 *   الجديدةَ، ويُلزِمُها بلحظةٍ وسببٍ، ويحصرُ الأسبابَ في قائمةٍ مغلقةٍ، ولا
 *   يخلِطُها بسياسةِ التطبيقِ (`in_app_only`) ولا بفشلِ المحاولاتِ (`dead`).
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22.
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-19` · `F6-05` (مركزُ الإشعاراتِ) · `ADR 0031` (المعرِّفُ وسيلةُ
 *   ربطٍ لا مفتاحٌ أساسيٌّ) · `ADR 0136` (الأثرُ يُقاسُ بالأثرِ)
 *
 * ## المسألةُ التي يقيسُها هذا الملفُّ
 *
 * `notification_outbox.status` لم يكن فيها «غيرُ قابلٍ للتسليمِ». فـ`dead` تعني
 * فشلاً بعدَ محاولاتٍ، و`in_app_only` قرارُ سياسةٍ. فالخلطُ بينَهما يُلوِّثُ
 * كلَّ مقياسٍ. هذه الخطوةُ تُضيفُ `undeliverable` كحالةٍ صريحةٍ مستقلّةٍ.
 *
 * ## وما لا يُقاسُ ههنا — مُسمّىً لا مسكوتاً عنه (`ح-5`)
 *
 * **لا يُقاسُ مسلكُ إرسالٍ واحدٌ**: الحرسُ في `claim_notification_delivery` طورٌ
 * تالٍ. والقيدُ هنا يُتيحُ الإعلانَ لا يُنفِّذُه. ولا يُقاسُ مستخدِمٌ بـ
 * `telegram_id = null` — متعذِّرٌ اليومَ إذ العمودُ `not null`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ حالةِ «غيرُ قابلٍ للتسليمِ» مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

/** بادئةٌ تُميِّزُ صفوفَ هذا الملفِّ فتُمحى وحدَها ولا يُمَسُّ سواها. */
const MARK = "sec19-undeliverable";

type ConstraintRow = {
  readonly conname: string;
  readonly consrc: string;
};

describeIf("حالةُ «غيرُ قابلٍ للتسليمِ» في notification_outbox (SEC-19-ب-٢)", () => {
  let sql: Sql;
  let cityId: string;
  let driverId: string;
  let orderId: string;
  let offerId: string;
  /** صفٌّ يُملأ بـ`undeliverable` لاختبارِ القيدِ. */
  let undeliverableId: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });

    const cities = await sql<{ id: string }[]>`select id from cities order by created_at limit 1`;
    const city = cities[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدةِ: القياسُ يحتاجُ مدينةً قائمةً.");
    cityId = city.id;

    // صفٌّ واحدٌ يُدرَجُ ثمَّ يُحدَّثُ في كلِّ اختبارٍ — لا إنشاءٌ متكرّرٌ. والصفُّ
    // يُبنى بكلِّ ما يلزمُ قيودَ الصندوقِ (kind, order_id, driver_id, offer_id).
    const user = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(8_000_000_000_000 + Date.now())}::bigint, ${MARK}, 'ar', 'rider')
      returning id
    `;
    const userId = user[0]?.id as string;

    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id, full_name, phone)
      values (${cityId}::uuid, ${userId}::uuid, ${MARK}, ${MARK})
      returning id
    `;
    const riderId = rider[0]?.id as string;

    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, created_at)
      values (${cityId}::uuid, ${riderId}::uuid, 'delivery', 'pending', now())
      returning id
    `;
    orderId = order[0]?.id as string;

    const driverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(9_000_000_000_000 + Date.now())}::bigint, ${`${MARK}-driver`}, 'ar', 'driver')
      returning id
    `;
    const driverUserId = driverUser[0]?.id as string;

    const driver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, full_name, phone, verification_status)
      values (${cityId}::uuid, ${driverUserId}::uuid, ${`${MARK}-driver`}, ${MARK}, 'approved')
      returning id
    `;
    driverId = driver[0]?.id as string;

    const offer = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, distance_km, expires_at, status)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, 5.0, now() + interval '5 minutes', 'pending')
      returning id
    `;
    offerId = offer[0]?.id as string;

    // الصفُّ يُدرَجُ بـ`pending` ثمَّ يُحدَّثُ في كلِّ اختبارٍ.
    const inserted = await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id, dedup_key, payload)
      values (${cityId}::uuid, 'offer', ${offerId}::uuid, ${orderId}::uuid, ${driverId}::uuid,
              ${`${MARK}:${Date.now()}`}, ${sql.json({ mark: MARK })})
      returning id
    `;
    undeliverableId = inserted[0]?.id as string;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`delete from notification_outbox where id = ${undeliverableId}::uuid`;
    await sql`delete from order_offers where id = ${offerId}::uuid`;
    await sql`delete from orders where id = ${orderId}::uuid`;
    await sql`delete from drivers where id = ${driverId}::uuid`;
    await sql`delete from riders where user_id in (select id from users where full_name like ${`${MARK}%`})`;
    await sql`delete from users where full_name like ${`${MARK}%`}`;
    await sql.end();
  });

  it("١) القيدُ المنشورُ يقبلُ `undeliverable` — الحالةُ في القائمةِ المغلقةِ", async () => {
    // القياسُ من `pg_constraint` لا من ملفِّ الهجرةِ: لو خالفَ المنشورُ الملفَّ
    // لكانَ الحاجزُ النصّيُّ يُخضِرُّ على قيدٍ آخر.
    const rows = await sql<ConstraintRow[]>`
      select conname, pg_get_constraintdef(oid) as consrc
        from pg_constraint
       where conrelid = 'notification_outbox'::regclass
         and conname = 'notification_outbox_status_check'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.consrc).toContain("'undeliverable'");
  });

  it("٢) `undeliverable` بلا `died_at` و`dead_reason` يُرفَضُ — القيدُ يُلزِمُ", async () => {
    await sql`
      update notification_outbox
         set status = 'pending', died_at = null, dead_reason = null, claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    // `sql` وسمٌ مؤجَّلٌ لا وعدٌ منطلقٌ (ADR 0122) — فـ`expect(sql\`…\`).rejects`
    // لا يُحسَمُ أبدًا. التقاطُ الخطأ بـ`try`/`catch` هو النمطُ الصادقُ.
    let threw = false;
    try {
      await sql`
        update notification_outbox
           set status = 'undeliverable'
         where id = ${undeliverableId}::uuid
      `;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("٣) `undeliverable` بـ`died_at` و`dead_reason` مقبولٌ — القيدُ يرضى", async () => {
    await sql`
      update notification_outbox
         set status = 'pending', claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    await sql`
      update notification_outbox
         set status = 'undeliverable',
             died_at = now(),
             dead_reason = 'TELEGRAM_ID_MISSING'
       where id = ${undeliverableId}::uuid
    `;
    const row = await sql<{ status: string; dead_reason: string }[]>`
      select status, dead_reason from notification_outbox where id = ${undeliverableId}::uuid
    `;
    expect(row[0]?.status).toBe("undeliverable");
    expect(row[0]?.dead_reason).toBe("TELEGRAM_ID_MISSING");
  });

  it("٤) `undeliverable` بسببٍ خارجِ القائمةِ يُرفَضُ — الأسبابُ مغلقةٌ", async () => {
    await sql`
      update notification_outbox
         set status = 'pending', died_at = null, dead_reason = null, claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    let threw = false;
    try {
      await sql`
        update notification_outbox
           set status = 'undeliverable',
               died_at = now(),
               dead_reason = 'UNKNOWN_REASON'
         where id = ${undeliverableId}::uuid
      `;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("٥) `TELEGRAM_DELIVERY_UNAVAILABLE` سببٌ مقبولٌ", async () => {
    await sql`
      update notification_outbox
         set status = 'pending', died_at = null, dead_reason = null, claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    await sql`
      update notification_outbox
         set status = 'undeliverable',
             died_at = now(),
             dead_reason = 'TELEGRAM_DELIVERY_UNAVAILABLE'
       where id = ${undeliverableId}::uuid
    `;
    const row = await sql<{ dead_reason: string }[]>`
      select dead_reason from notification_outbox where id = ${undeliverableId}::uuid
    `;
    expect(row[0]?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });

  it("٦) `TELEGRAM_DELIVERY_NOT_REQUIRED` سببٌ مقبولٌ", async () => {
    await sql`
      update notification_outbox
         set status = 'pending', died_at = null, dead_reason = null, claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    await sql`
      update notification_outbox
         set status = 'undeliverable',
             died_at = now(),
             dead_reason = 'TELEGRAM_DELIVERY_NOT_REQUIRED'
       where id = ${undeliverableId}::uuid
    `;
    const row = await sql<{ dead_reason: string }[]>`
      select dead_reason from notification_outbox where id = ${undeliverableId}::uuid
    `;
    expect(row[0]?.dead_reason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
  });

  it("٧) `dead` بحالةٍ قائمةٍ لا تزالُ تعملُ — لا انحدارَ في القيدِ الأوّلِ", async () => {
    // `notification_dead_pair` لم يُمَسَّ: `dead` ما زال يلزمُه `died_at` و`dead_reason`.
    await sql`
      update notification_outbox
         set status = 'pending', died_at = null, dead_reason = null, claim_token = null, claimed_at = null
       where id = ${undeliverableId}::uuid
    `;
    // `dead` بلا `died_at` و`dead_reason` يُرفَضُ — القيدُ الأوّلُ لم يُضعَفْ.
    // (ADR 0122: التقاطٌ بـtry/catch لا expect(sql).rejects)
    let threw = false;
    try {
      await sql`
        update notification_outbox
           set status = 'dead'
         where id = ${undeliverableId}::uuid
      `;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // `dead` بهما مقبولٌ — السلوكُ القائمُ بحرفِه.
    await sql`
      update notification_outbox
         set status = 'dead',
             died_at = now(),
             dead_reason = 'MAX_ATTEMPTS'
       where id = ${undeliverableId}::uuid
    `;
    const row = await sql<{ status: string }[]>`
      select status from notification_outbox where id = ${undeliverableId}::uuid
    `;
    expect(row[0]?.status).toBe("dead");
  });

  it("٨) `in_app_only` تبقى صالحةً بلا `dead_reason` — لا خلطُ سياسةٍ بتعذُّرٍ", async () => {
    // `in_app_only` قرارُ سياسةٍ لا تعذُّرٌ: لا يلزمُه `died_at` ولا `dead_reason`.
    // ولو التبسَ القيدانِ لكانَ هذا الاختبارُ يفشلُ — وهو حارسُ عدمِ الخلطِ.
    await sql`
      update notification_outbox
         set status = 'in_app_only', died_at = null, dead_reason = null,
             claim_token = null, claimed_at = null, next_attempt_at = now()
       where id = ${undeliverableId}::uuid
    `;
    const row = await sql<{ status: string }[]>`
      select status from notification_outbox where id = ${undeliverableId}::uuid
    `;
    expect(row[0]?.status).toBe("in_app_only");
  });

  it("٩) القيدُ الجديدُ `notification_undeliverable_pair` منشورٌ في القاعدةِ", async () => {
    const rows = await sql<ConstraintRow[]>`
      select conname, pg_get_constraintdef(oid) as consrc
        from pg_constraint
       where conrelid = 'notification_outbox'::regclass
         and conname = 'notification_undeliverable_pair'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.consrc).toContain("'undeliverable'");
    expect(rows[0]?.consrc).toContain("died_at");
    expect(rows[0]?.consrc).toContain("dead_reason");
  });

  it("١٠) القيدُ الجديدُ `notification_undeliverable_reason_check` منشورٌ في القاعدةِ", async () => {
    const rows = await sql<ConstraintRow[]>`
      select conname, pg_get_constraintdef(oid) as consrc
        from pg_constraint
       where conrelid = 'notification_outbox'::regclass
         and conname = 'notification_undeliverable_reason_check'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.consrc).toContain("'undeliverable'");
    expect(rows[0]?.consrc).toContain("TELEGRAM_ID_MISSING");
    expect(rows[0]?.consrc).toContain("TELEGRAM_DELIVERY_UNAVAILABLE");
    expect(rows[0]?.consrc).toContain("TELEGRAM_DELIVERY_NOT_REQUIRED");
  });
});
