/**
 * الغرض: **إثباتُ** أولويّاتِ المرورِ (القسمُ ١٥ / `F6-07`) على PostgreSQL حقيقيّةٍ.
 *    وحدةُ الاختبارِ تُثبِتُ أنَّ الرتبةَ مكتوبةٌ في الكودِ؛ وههنا وحدَه يُثبَتُ ما
 *    لا يُثبِتُه محاكٍ: أنَّ **المُطالِبَ** (`claim_notification_delivery`) يُقدِّمُ
 *    صفّاً حرجاً **أحدَثَ** على صفٍّ متوسّطٍ **أقدمَ** — أي أنَّ الترتيبَ الرتبيَّ
 *    سارٍ في القاعدةِ لا في التعليقِ؛ وأنَّ الأقدميّةَ تبقى حاكمةً داخلَ الرتبةِ
 *    الواحدةِ فلا يُجاعُ صفٌّ بلا نهايةٍ داخلَ صنفِه؛ وأنَّ رتبةَ كلِّ نوعٍ في
 *    القاعدةِ تُطابِقُ رتبتَه في الكودِ **بالنداءِ لا بقراءةِ نصِّ الهجرةِ**.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 *    وبعدَ حكمِ CI `34393076336` أُضيفَ ههنا ما هوَ أهمُّ من الرتبةِ: أنَّ
 *    الرتبةَ **لا تقلِبُ** تتابعَ رسائلِ الطلبِ الواحدِ (شرطُ رأسِ الطلبِ)،
 *    وأنّها تُزاحِمُ **بينَ** الطلباتِ كما وُعِدَ.
 * ما لا يفعله: لا يقيسُ خطّةَ الاستعلامِ (استعمالَ فهرسِ الرتبةِ) — ذلكَ دَينٌ
 *   مُعلَنٌ في `docs/adr/0071-traffic-priority-classes.md` §٧، ولا يُدَّعى ههنا.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { NOTIFICATION_KINDS } from "../../packages/shared/config/notification-kinds.ts";
import { isDeferrableUnderBackpressure } from "../../packages/shared/config/queue-backpressure.ts";
import { priorityRankOfKind } from "../../packages/shared/config/traffic-priority.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
/** طلبانِ حقيقيّانِ: التتابعُ السببيُّ يُقاسُ على `order_id` فعليٍّ لا على فراغٍ. */
let orderA: string;
let orderB: string;
let riderId: string;
let riderUserId: string;
/**
 * صفوفُ غيرِنا المعلَّقةُ في القاعدةِ المشتركةِ. المُطالِبُ **عالميٌّ** (بلا وسائطَ)
 * فيلتقطُ أيَّ معلَّقٍ مستحقٍّ لأيِّ مدينةٍ؛ ولو تُرِكَت بقايا ملفٍّ سابقٍ مستحقّةً
 * لَقاسَ هذا الملفُّ ترتيبَ صفوفٍ لا يعرفُها ثمَّ نسبَ الفشلَ إلى الرتبةِ. فتُؤجَّلُ
 * ههنا بقيمةٍ محفوظةٍ، وتُعادُ قيمُها **حرفاً** في `afterAll` — تأجيلٌ لا حَذفٌ،
 * فلا يُمحى دليلُ اختبارٍ آخرَ.
 */
let parked: { id: string; next_attempt_at: string }[] = [];
/** القيمُ المبذورةُ كما وُجِدت — تُستعادُ في النهايةِ فلا تُسمِّمُ ما بعدَها. */
let seeded: Record<string, number> = {};

const TOUCHED_KEYS = [
  "outbox_queue_consumer_concurrency",
  "outbox_queue_depth_limit",
  "outbox_queue_oldest_age_limit_seconds",
] as const;

/** وسمٌ في `dedup_key` يُميِّزُ صفوفَ هذا الملفِّ وحدَها عندَ التنظيفِ. */
const TAG = "f6-07-claim";

async function setLimit(key: string, value: number): Promise<void> {
  await sql`
    update platform_settings
       set value = to_jsonb(${value}::numeric)
     where city_id = ${cityId}::uuid and key = ${key}
  `;
}

/** يُنشِئُ طلباً حقيقيّاً للراكبِ المبذورِ ويُعيدُ معرّفَه. */
async function seedOrder(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
            ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّرَ تجهيزُ الطلبِ");
  return id;
}

/**
 * يُدرِجُ صفّاً معلَّقاً بنوعٍ وعُمرٍ محدَّدَينِ ويُعيدُ معرّفَه.
 * `orderId` اختياريٌّ: الفارغُ لا يُقارَنُ بفارغٍ فيبقى الصفُّ خارجَ الحجبِ
 * السببيِّ، وبه تُقاسُ الرتبةُ وحدَها.
 */
async function seedRow(kind: string, ageSeconds: number, orderId?: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into notification_outbox
      (city_id, kind, status, payload, created_at, next_attempt_at, dedup_key, order_id)
    values (${cityId}::uuid, ${kind}, 'pending', '{}'::jsonb,
            now() - make_interval(secs => ${ageSeconds}::numeric),
            now() - make_interval(secs => ${ageSeconds}::numeric),
            ${`${TAG}:`} || gen_random_uuid()::text,
            ${orderId ?? null}::uuid)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّرَ بذرُ صفٍّ في الصادرِ");
  return id;
}

async function claimOne(): Promise<{ deliveryId: string | null; kind: string | null }> {
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    select claim_notification_delivery() as result
  `;
  const delivery = rows[0]?.result?.delivery as Record<string, unknown> | null | undefined;
  if (delivery === null || delivery === undefined) return { deliveryId: null, kind: null };
  return {
    deliveryId: String(delivery.delivery_id ?? ""),
    kind: String(delivery.kind ?? ""),
  };
}

describeIf("أولويّاتُ المرورِ في المُطالِبِ على PostgreSQL فعلية (F6-07)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");

    const rows = await sql<{ key: string; value: number }[]>`
      select key, (value #>> '{}')::numeric as value
        from platform_settings
       where city_id = ${cityId}::uuid and key like 'outbox_queue_%'
    `;
    seeded = Object.fromEntries(rows.map((row) => [row.key, Number(row.value)]));
    for (const key of TOUCHED_KEYS) {
      if (seeded[key] === undefined) throw new Error(`مفتاحٌ غيرُ مبذورٍ: ${key}`);
    }
    // حدودٌ واسعةٌ: موضوعُ القياسِ **الترتيبُ** لا الضغطُ العكسيُّ. ولو بقيَ سقفُ
    // التزامنِ ضيّقاً لَرَدَّ المُطالِبُ الالتقاطَ الثانيَ بسببِ الضغطِ فقاسَ
    // الاختبارُ حاجزاً آخرَ وادَّعى أنَّه قاسَ الرتبةَ.
    await setLimit("outbox_queue_consumer_concurrency", 50);
    await setLimit("outbox_queue_depth_limit", 10_000);
    await setLimit("outbox_queue_oldest_age_limit_seconds", 86_400);

    const riderUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}::uuid, 880607::bigint, 'راكبُ قياسِ الأولويّةِ', '+966500880607', 'rider')
      returning id
    `;
    riderUserId = riderUser[0]?.id ?? "";
    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      values (${cityId}::uuid, ${riderUserId}::uuid) returning id
    `;
    riderId = rider[0]?.id ?? "";
    if (riderId === "") throw new Error("تعذّرَ تجهيزُ الراكبِ");
    orderA = await seedOrder();
    orderB = await seedOrder();
  });

  beforeEach(async () => {
    // `returning` في `update` يُعيدُ **الجديدَ** لا القديمَ، فلو قُرِئَ منه
    // لَحُفِظَ التأجيلُ نفسُه ثمَّ «أُعيدَ» فبقيَ الصفُّ مؤجَّلاً ساعتَينِ عندَ غيرِنا.
    // فتُقرأُ القيمُ القديمةُ في `with` قبلَ التحديثِ، وبها تُستعادُ حرفاً.
    const rows = await sql<{ id: string; next_attempt_at: string }[]>`
      with target as (
        select id, next_attempt_at from notification_outbox
         where status = 'pending'
           and next_attempt_at <= now() + interval '1 hour'
           and (dedup_key is null or dedup_key not like ${`${TAG}:%`})
         for update
      ), moved as (
        update notification_outbox n
           set next_attempt_at = now() + interval '2 hours'
          from target t where n.id = t.id
        returning n.id
      )
      select t.id, t.next_attempt_at from target t
       where t.id in (select id from moved)
    `;
    parked = rows.map((row) => ({ id: row.id, next_attempt_at: row.next_attempt_at }));
  });

  afterEach(async () => {
    await sql`
      delete from notification_outbox
       where city_id = ${cityId}::uuid and dedup_key like ${`${TAG}:%`}
    `;
  });

  afterAll(async () => {
    for (const key of TOUCHED_KEYS) {
      const value = seeded[key];
      if (value !== undefined) await setLimit(key, value);
    }
    await sql`
      delete from notification_outbox
       where city_id = ${cityId}::uuid and dedup_key like ${`${TAG}:%`}
    `;
    for (const row of parked) {
      await sql`
        update notification_outbox set next_attempt_at = ${row.next_attempt_at}::timestamptz
         where id = ${row.id}::uuid
      `;
    }
    // الطلبانِ والراكبُ يُحذَفانِ **بعدَ** صفوفِ الصادرِ (`on delete restrict`).
    for (const orderId of [orderA, orderB]) {
      if (orderId !== undefined && orderId !== "") {
        await sql`delete from orders where id = ${orderId}::uuid`;
      }
    }
    if (riderId !== "") await sql`delete from riders where id = ${riderId}::uuid`;
    if (riderUserId !== "") await sql`delete from users where id = ${riderUserId}::uuid`;
    await sql.end({ timeout: 5 });
  });

  it("الحرجُ الأحدَثُ يُلتقَطُ قبلَ المتوسّطِ الأقدمِ — الرتبةُ قبلَ الأقدميّةِ", async () => {
    // المتوسّطُ أقدمُ بدقيقةٍ كاملةٍ: بترتيبِ `F6-06` (الأقدميّةُ وحدَها) كانَ
    // يُلتقَطُ أوّلاً بلا خلافٍ، فالمقياسُ ههنا مقياسٌ فارقٌ لا تأكيدُ سلوكٍ قائمٍ.
    const older = await seedRow("no_driver_found", 60);
    const newer = await seedRow("negotiation_turn_opened", 1);

    const first = await claimOne();
    expect(first.kind).toBe("negotiation_turn_opened");
    expect(first.deliveryId).toBe(newer);

    const second = await claimOne();
    expect(second.kind).toBe("no_driver_found");
    expect(second.deliveryId).toBe(older);
  });

  it("الحرجُ ثمَّ المرتفعُ ثمَّ المتوسّطُ — رتبُ نطاقِ المُطالِبِ الثلاثُ مُرتَّبةٌ فعلاً", async () => {
    // الأعمارُ مقلوبةٌ على الرتبِ عمداً: الأدنى رتبةً هوَ الأقدمُ، فلو أُهمِلَت
    // الرتبةُ لَخرجَ الترتيبُ معكوساً تماماً.
    //
    // تصحيحٌ مُضافٌ — F6-07 (بعدَ حكمِ CI `34393076336`): كانَ ههنا صفٌّ رابعٌ من
    // `broadcast_recipient` (الرتبةُ ٤) ودعوى «الرتبُ الأربعُ». وهوَ خطأٌ مُركَّبٌ:
    // (١) بذرُه يخرقُ `notification_broadcast_shape` فأخفقَ الاختبارُ إدراجاً لا
    // قياساً، و(٢) النوعُ **ليسَ في نطاقِ هذا المُطالِبِ** (له مطالِبُه) فرتبتُه
    // الرابعةُ لا تُقاسُ ههنا بحالٍ. فصارَت الدعوى ثلاثَ رتبٍ هيَ الموجودةُ في
    // النطاقِ فعلاً، ورتبةُ `broadcast_recipient` تُقاسُ بالنداءِ في حالةِ
    // التطابقِ أدناه لا بادّعاءِ التقاطٍ لا يقعُ.
    // تصحيحٌ مُضافٌ ثانٍ — (بعدَ حكمِ CI `34395013243`): كانَ صفُّ الرتبةِ الثانيةِ
    // `offer`، وبذرُه بلا ثلاثيِّ العرضِ يخرقُ `notification_offer_shape` (كما
    // خرقَ `broadcast_recipient` قيدَ شكلِه قبلَه). و`wider_circle_opened` رتبتُه
    // الثانيةُ نفسُها ولا شكلَ خاصَّ له، فالدعوى محفوظةٌ والبذرُ صحيحٌ.
    await seedRow("no_driver_found", 300);
    await seedRow("wider_circle_opened", 200);
    await seedRow("order_cancelled", 100);

    const order: (string | null)[] = [];
    for (let index = 0; index < 3; index += 1) {
      order.push((await claimOne()).kind);
    }
    expect(order).toEqual(["order_cancelled", "wider_circle_opened", "no_driver_found"]);
    expect((await claimOne()).kind).toBeNull();
  });

  it("الأقدميّةُ تبقى حاكمةً داخلَ الرتبةِ الواحدةِ — لا جوعَ داخلَ الصنفِ", async () => {
    const older = await seedRow("no_driver_found", 120);
    await seedRow("no_driver_found", 5);
    expect((await claimOne()).deliveryId).toBe(older);
  });

  // ---------------------------------------------------------------------------
  // تصحيحٌ مُضافٌ — F6-07 (بعدَ حكمِ CI `34393076336`)
  //
  // الرتبةُ وحدَها قلبَت تتابعَ رسائلِ الطلبِ الواحدِ فأسقطَت
  // `unsubscribed-negotiation.test.ts`: بلغَ الراكبَ «تمَّ الاتفاقُ» (رتبةُ ١) ثمَّ
  // بلغَه بعدَه «فُتِحَت دائرةٌ أوسعُ» (رتبةُ ٢) عن بحثٍ انتهى. والعلاجُ شرطُ رأسِ
  // الطلبِ في المُطالِبِ، وههنا يُقاسُ الوجهانِ: أنَّ التتابعَ حُفِظَ داخلَ الطلبِ،
  // وأنَّ الرتبةَ ما زالَت تُزاحِمُ بينَ الطلبَينِ.
  // ---------------------------------------------------------------------------

  it("داخلَ الطلبِ الواحدِ: الأقدمُ أوّلاً وإن كانَت رتبتُه أدنى — لا انقلابَ سببيّاً", async () => {
    const olderHigh = await seedRow("wider_circle_opened", 60, orderA);
    const newerCritical = await seedRow("negotiation_agreed", 1, orderA);

    const first = await claimOne();
    expect(first.deliveryId).toBe(olderHigh);
    expect(first.kind).toBe("wider_circle_opened");

    const second = await claimOne();
    expect(second.deliveryId).toBe(newerCritical);
  });

  it("بينَ طلبَينِ: الحرجُ الأحدَثُ يسبقُ المرتفعَ الأقدمَ — الحجبُ سببيٌّ لا مُعطِّلٌ للرتبةِ", async () => {
    const olderHighA = await seedRow("wider_circle_opened", 60, orderA);
    const newerCriticalB = await seedRow("negotiation_agreed", 1, orderB);

    const first = await claimOne();
    expect(first.deliveryId).toBe(newerCriticalB);

    const second = await claimOne();
    expect(second.deliveryId).toBe(olderHighA);
  });

  it("الإيداعُ يُكمِلُ عمودَ `order_id` لا الحمولةَ وحدَها — وإلّا فشرطُ الرأسِ لا يُطبَّقُ على شيءٍ", async () => {
    // تصحيحٌ مُضافٌ ثانٍ — (بعدَ حكمِ CI `34395013243`): شرطُ رأسِ الطلبِ كانَ
    // صحيحاً ولا يعملُ، لأنَّ `enqueue_notification` تركَت العمودَ فارغاً ووضعَت
    // معرّفَ الطلبِ في الحمولةِ وحدَها. فهذا قياسُ العلاجِ في موضعِه: بالإيداعِ
    // الحقيقيِّ لا ببذرٍ يدويٍّ.
    const enqueued = await sql<{ ok: boolean }[]>`
      select enqueue_rider_order_notification(
        ${cityId}::uuid, 'no_driver_found', ${orderA}::uuid
      ) as ok
    `;
    expect(enqueued[0]?.ok).toBe(true);
    const rows = await sql<{ order_id: string | null; payload_order: string | null }[]>`
      select order_id, payload->>'order_id' as payload_order
        from notification_outbox
       where kind = 'no_driver_found' and dedup_key = ${`no_driver_found:${orderA}`}
    `;
    expect(rows[0]?.order_id).toBe(orderA);
    // والحمولةُ كما كانَت حرفاً — لا حقلَ حُذِفَ فقارئوها في العامِلِ لا يُمَسّونَ.
    expect(rows[0]?.payload_order).toBe(orderA);
    await sql`
      delete from notification_outbox
       where kind = 'no_driver_found' and dedup_key = ${`no_driver_found:${orderA}`}
    `;
  });

  it("رتبةُ كلِّ نوعٍ في القاعدةِ تُطابِقُ رتبتَه في الكودِ — بالنداءِ لا بقراءةِ النصِّ", async () => {
    for (const kind of NOTIFICATION_KINDS) {
      const rows = await sql<{ rank: number; deferrable: boolean }[]>`
        select notification_kind_priority(${kind})::int as rank,
               notification_kind_is_deferrable(${kind}) as deferrable
      `;
      expect(rows[0]?.rank).toBe(priorityRankOfKind(kind));
      expect(rows[0]?.deferrable).toBe(isDeferrableUnderBackpressure(kind));
    }
  });

  it("نوعٌ مجهولٌ يُقرأُ حرجاً في القاعدةِ — السهوُ يُقدِّمُ ولا يُؤخِّرُ", async () => {
    const rows = await sql<{ rank: number; deferrable: boolean }[]>`
      select notification_kind_priority('kind_that_does_not_exist')::int as rank,
             notification_kind_is_deferrable('kind_that_does_not_exist') as deferrable
    `;
    expect(rows[0]?.rank).toBe(priorityRankOfKind("safety_incident"));
    expect(rows[0]?.deferrable).toBe(false);
  });

  it("فهرسُ الرتبةِ قائمٌ في القاعدةِ لا في ملفِّ الهجرةِ وحدَه", async () => {
    const rows = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where tablename = 'notification_outbox'
         and indexname = 'notification_outbox_priority_due_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("notification_kind_priority");
  });
});
