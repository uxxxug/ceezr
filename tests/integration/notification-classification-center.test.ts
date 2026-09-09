/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لتصنيفِ الإشعاراتِ حرج/معلوماتيٍّ
 *   ولمركزِ الإشعاراتِ داخلَ التطبيقِ (البند `F6-05` / `TG-002` / `SS-07`).
 *
 *   المقصودُ إثباتُ ما **لا يُثبتُه mock إطلاقاً**، لأنَّ كلَّ ما يهمُّ ههنا يقعُ
 *   في مُطلِقاتٍ وقيودٍ داخلَ القاعدةِ:
 *
 *   ١) أنَّ صفَّ سياسةٍ مفقوداً **يُرسَلُ** لا يُكتَمُ — الميلُ نحوَ الإرسالِ.
 *   ٢) أنَّ قناةً `in_app` تُنتِجُ حالةً نهائيّةً `in_app_only` **ولا يلتقطُها
 *      مُطالِبُ التسليمِ**، فالكتمُ فعليٌّ لا وصفيٌّ.
 *   ٣) أنَّ نوعاً مُوجَّهاً إلى مجموعةٍ **يستحيلُ** تصنيفُه `in_app` — قيدٌ يرفعُ
 *      خطأً، لأنَّ كتمَه إعدامٌ صامتٌ لبلاغِ استغاثةٍ لا تهدئةٌ.
 *   ٤) أنَّ مستقبِلاً لا يُحلَّ **لا يُسقِطُ معاملةَ المُنتِجِ** ولا يكتمُ الإشعارَ:
 *      عطلُ دفترِ إشعاراتٍ لا يجوزُ أن يُرجِعَ عرضاً أو إلغاءَ رحلةٍ.
 *   ٥) أنَّ مركزَ الإشعاراتِ يُقيِّدُ **القناتَينِ** لا القناةَ الداخليّةَ وحدَها
 *      (شاهدٌ موجَبٌ يمنعُ اختباراً يمرُّ لأنَّ لا شيءَ يُكتَب).
 *   ٦) أنَّ القراءةَ لا تعبرُ حدَّ المستخدمِ، وأنَّ الوسمَ متماثلُ الأثرِ، وأنَّ
 *      «ليسَ لك» و«لا وجودَ له» جوابٌ واحدٌ فلا عرّافَ يُستنطَق.
 *
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: عندَ إعادةِ تصنيفِ نوعٍ إلى `in_app` فعلاً (قرارُ منتَجٍ بعدَ
 *   بناءِ شاشاتِ `F2`/`F3`) يُضافُ ههنا شاهدٌ لذلكَ النوعِ بعينِه.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createUserNotificationCenter } from "../../packages/infrastructure/notification/user-notification-center.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TELEGRAM = 961001;
const OTHER_TELEGRAM = 961002;

let sql: Sql;
let cityId: string;
let riderUserId: string;
let otherUserId: string;
let riderId: string;
let orderId: string;

/** بذرُ مدينةٍ معزولةٍ: لا يُعتمَدُ على مدينةٍ قائمةٍ فتتلوّثَ نتائجُ غيرِنا. */
async function seedCity(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into cities (code, name_ar, name_en, is_active)
    values (${`f605${Date.now().toString(36)}`}, 'مدينةُ تصنيفِ الإشعارات', 'F6-05 City', false)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر تجهيزُ المدينة");
  return id;
}

async function seedUser(telegramId: number, role: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${telegramId}::bigint, 'صاحبُ مركزِ الإشعارات',
            ${`+96650${telegramId}`}, ${role}::user_role, 'ar')
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر تجهيزُ المستخدم");
  return id;
}

async function setPolicy(kind: string, channel: string): Promise<void> {
  await sql`
    insert into notification_kind_policy (city_id, kind, channel, description_ar)
    values (${cityId}, ${kind}, ${channel}, 'شاهدُ اختبار')
    on conflict (city_id, kind) do update set channel = excluded.channel
  `;
}

async function clearPolicy(kind: string): Promise<void> {
  await sql`delete from notification_kind_policy where city_id = ${cityId} and kind = ${kind}`;
}

/** إيداعُ إشعارِ إلغاءٍ لسائقٍ — أقربُ نوعٍ إلى مستقبِلٍ شخصيٍّ يُحلُّ من الحِمْل. */
async function enqueueCancelled(driverUserId: string): Promise<string> {
  const driver = await sql<{ id: string }[]>`
    select id from drivers where user_id = ${driverUserId}::uuid limit 1
  `;
  const driverId = driver[0]?.id;
  if (driverId === undefined) throw new Error("لا سائقَ لهذا المستخدم");
  const rows = await sql<{ id: string }[]>`
    insert into notification_outbox (city_id, kind, payload, dedup_key, next_attempt_at)
    values (${cityId}, 'order_cancelled',
            ${sql.json({ order_id: orderId, driver_id: driverId, was_assigned: true })},
            ${`f6-05-${crypto.randomUUID()}`}, now())
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("تعذّر الإيداع");
  return id;
}

async function outboxRow(id: string): Promise<{ status: string; recipient: string | null }> {
  const rows = await sql<{ status: string; recipient: string | null }[]>`
    select status, recipient_user_id as recipient from notification_outbox where id = ${id}::uuid
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لا صفَّ صادرٍ بهذا المعرّف");
  return row;
}

async function centerRows(
  outboxId: string,
): Promise<{ id: string; channel: string; user_id: string }[]> {
  return await sql`
    select id, channel, user_id from user_notifications where outbox_id = ${outboxId}::uuid
  `;
}

describeIf("تصنيفُ الإشعاراتِ ومركزُها على قاعدةٍ حقيقيةٍ (F6-05)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "", max: 4 });
    cityId = await seedCity();

    riderUserId = await seedUser(RIDER_TELEGRAM, "driver");
    otherUserId = await seedUser(OTHER_TELEGRAM, "driver");

    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}::uuid) returning id
    `;
    riderId = rider[0]?.id ?? "";

    for (const userId of [riderUserId, otherUserId]) {
      await sql`
        insert into drivers (city_id, user_id, verification_status)
        values (${cityId}, ${userId}::uuid, 'verified'::verification_status)
      `;
    }

    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                          pickup_label, dropoff_label)
      values (${cityId}, ${riderId}::uuid, 'transport'::service_type, 'cancelled'::order_status,
              st_setsrid(st_makepoint(39.6, 24.5), 4326)::geography,
              st_setsrid(st_makepoint(39.7, 24.6), 4326)::geography,
              'مبدأٌ', 'مقصدٌ')
      returning id
    `;
    orderId = order[0]?.id ?? "";
    if (riderId === "" || orderId === "") throw new Error("تعذّر تجهيزُ الرحلة");
  });

  afterAll(async () => {
    // الحذفُ بالمدينةِ: يعتمدُ على `on delete cascade` فلا يُتركُ صفٌّ يتيمٌ
    // يُفسِدُ تشغيلاً تالياً على نفسِ القاعدة.
    await sql`delete from user_notifications where city_id = ${cityId}`;
    await sql`delete from notification_outbox where city_id = ${cityId}`;
    await sql`delete from notification_kind_policy where city_id = ${cityId}`;
    await sql`delete from orders where city_id = ${cityId}`;
    await sql`delete from drivers where city_id = ${cityId}`;
    await sql`delete from riders where city_id = ${cityId}`;
    await sql`delete from users where city_id = ${cityId}`;
    await sql`delete from cities where id = ${cityId}`;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`delete from user_notifications where city_id = ${cityId}`;
    await sql`delete from notification_outbox where city_id = ${cityId}`;
    await setPolicy("order_cancelled", "critical");
  });

  it("النوعُ الحرجُ يبقى `pending` ويُقيَّدُ في المركزِ بقناةِ `critical`", async () => {
    const id = await enqueueCancelled(otherUserId);
    const row = await outboxRow(id);

    // شاهدٌ موجَبٌ: لو كانَ المُطلِقُ يكتبُ للقناةِ الداخليّةِ وحدَها لمرَّ كلُّ
    // اختبارٍ سالبٍ في هذا الملفِّ وهوَ لا يكتبُ شيئاً.
    expect(row.status).toBe("pending");
    expect(row.recipient).toBe(otherUserId);

    const center = await centerRows(id);
    expect(center).toHaveLength(1);
    expect(center[0]?.channel).toBe("critical");
    expect(center[0]?.user_id).toBe(otherUserId);
  });

  it("القناةُ `in_app` تُنتِجُ `in_app_only` ولا يلتقطُها مُطالِبُ التسليمِ", async () => {
    await setPolicy("order_cancelled", "in_app");
    const id = await enqueueCancelled(otherUserId);

    expect((await outboxRow(id)).status).toBe("in_app_only");
    const center = await centerRows(id);
    expect(center).toHaveLength(1);
    expect(center[0]?.channel).toBe("in_app");

    // الكتمُ **فعليٌّ**: المُطالِبُ يمسحُ `status = 'pending'` وحدَه، فصفُّنا
    // خارجَ مداهُ. ولو كانَ الكتمُ في طبقةِ التطبيقِ لَأمكنَ لعاملٍ آخرَ أن
    // يُرسِلَه — وهذا ما يمنعُه اختيارُ حالةٍ نهائيّةٍ لا علامةٍ جانبيّةٍ.
    const claimed = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select claim_notification_delivery() as result
    `;
    const result = claimed[0]?.result;
    if (result?.ok === true) {
      const claimedId = (result as unknown as { delivery?: { id?: string } }).delivery?.id;
      expect(claimedId).not.toBe(id);
    } else {
      expect(result?.ok).toBe(false);
    }
  });

  it("غيابُ صفِّ السياسةِ يُرسِلُ ولا يكتمُ — الميلُ نحوَ الإرسالِ", async () => {
    await clearPolicy("order_cancelled");
    const id = await enqueueCancelled(otherUserId);

    // القرارُ الافتراضيُّ هوَ الإزعاجُ لا الصمتُ: الإزعاجُ الخاطئُ يُرى ويُقاسُ،
    // والصمتُ الخاطئُ ينتهي في حالةٍ «ناجحةٍ» فلا يُرى أبداً.
    expect((await outboxRow(id)).status).toBe("pending");
    expect((await centerRows(id))[0]?.channel).toBe("critical");
  });

  it("النوعُ المُوجَّهُ إلى مجموعةٍ يستحيلُ تصنيفُه `in_app`", async () => {
    // `safety_incident` بلاغُ استغاثةٍ يُوجَّهُ إلى مجموعةٍ ولا صندوقَ واردٍ
    // شخصيَّ له: كتمُه لا يُنتِجُ رسالةً ولا مدخلَ مركزٍ — إعدامٌ صامتٌ.
    let raised = false;
    try {
      await setPolicy("safety_incident", "in_app");
    } catch {
      raised = true;
    }
    expect(raised).toBe(true);

    // شاهدٌ موجَبٌ: `critical` للنوعِ نفسِه يُقبَلُ، فالرفضُ أعلاه للقناةِ لا
    // لخللٍ في البذرِ أو في القيدِ الأساسيِّ.
    await setPolicy("safety_incident", "critical");
    const kept = await sql<{ channel: string }[]>`
      select channel from notification_kind_policy
       where city_id = ${cityId} and kind = 'safety_incident'
    `;
    expect(kept[0]?.channel).toBe("critical");
  });

  it("مستقبِلٌ لا يُحلُّ لا يُسقِطُ الإيداعَ ولا يكتمُ الإشعارَ", async () => {
    await setPolicy("order_cancelled", "in_app");
    // حِمْلٌ بمعرّفِ سائقٍ لا وجودَ له: لا مستقبِلَ يُحلُّ.
    const rows = await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, payload, dedup_key, next_attempt_at)
      values (${cityId}, 'order_cancelled',
              ${sql.json({ order_id: orderId, driver_id: crypto.randomUUID() })},
              ${`f6-05-orphan-${crypto.randomUUID()}`}, now())
      returning id
    `;
    const id = rows[0]?.id ?? "";

    // الإيداعُ **نجحَ**: عطلُ دفترِ إشعاراتٍ لا يُرجِعُ معاملةَ عملٍ.
    expect(id).not.toBe("");
    const row = await outboxRow(id);
    // ولم يُكتَمْ رغمَ أنَّ السياسةَ `in_app`: بلا مستقبِلٍ لا مركزَ يُقرأُ منه،
    // فالكتمُ كانَ سيُصيِّرُ الإشعارَ لا شيءَ. فيُرسَلُ.
    expect(row.status).toBe("pending");
    expect(row.recipient).toBeNull();
    expect(await centerRows(id)).toHaveLength(0);
  });

  it("القراءةُ لا تعبرُ حدَّ المستخدمِ، والوسمُ متماثلُ الأثرِ", async () => {
    const mine = await enqueueCancelled(riderUserId);
    const theirs = await enqueueCancelled(otherUserId);
    const center = createUserNotificationCenter(sql);

    const feed = await center.readFeed({ telegramUserId: String(RIDER_TELEGRAM) });
    if (!feed.ok) throw new Error(`تعذّرت القراءة: ${feed.error.reason}`);
    expect(feed.value.items).toHaveLength(1);
    expect(feed.value.unreadCount).toBe(1);
    const entry = feed.value.items[0];
    expect(entry?.readAt).toBeNull();

    const theirRows = await centerRows(theirs);
    const theirNotificationId = theirRows[0]?.id ?? "";
    expect(theirNotificationId).not.toBe("");
    expect(feed.value.items.some((item) => item.id === theirNotificationId)).toBe(false);
    expect((await centerRows(mine))[0]?.user_id).toBe(riderUserId);

    // وسمُ إشعارِ غيرِك: `NOT_FOUND` نفسُه الذي يُعادُ عن معرّفٍ لا وجودَ له —
    // فلا يستطيعُ حاملُ جلسةٍ أن يُثبِتَ بالجوابِ وجودَ إشعارٍ لمستخدمٍ آخر.
    const foreign = await center.markRead(String(RIDER_TELEGRAM), theirNotificationId);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.reason).toBe("NOTIFICATION_NOT_FOUND");

    const absent = await center.markRead(String(RIDER_TELEGRAM), crypto.randomUUID());
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error.reason).toBe("NOTIFICATION_NOT_FOUND");

    const first = await center.markRead(String(RIDER_TELEGRAM), entry?.id ?? "");
    if (!first.ok) throw new Error(`تعذّر الوسم: ${first.error.reason}`);
    expect(first.value.alreadyRead).toBe(false);

    const again = await center.markRead(String(RIDER_TELEGRAM), entry?.id ?? "");
    if (!again.ok) throw new Error(`تعذّرت إعادةُ الوسم: ${again.error.reason}`);
    // الوقتُ لا يُزاحُ إلى الأمامِ بكلِّ نقرةٍ، وإلّا فسدَ أيُّ قياسٍ لزمنِ التفاعل.
    expect(again.value.alreadyRead).toBe(true);
    expect(again.value.readAt.getTime()).toBe(first.value.readAt.getTime());

    const after = await center.readFeed({ telegramUserId: String(RIDER_TELEGRAM) });
    if (!after.ok) throw new Error("تعذّرت القراءةُ بعدَ الوسم");
    expect(after.value.unreadCount).toBe(0);
    // الصفُّ يبقى مقروءاً لا يُحذَفُ: الحذفُ كانَ سيمحو سِجلَّ ما أُبلِغَ به.
    expect(after.value.items).toHaveLength(1);
  });

  it("الحدُّ يُقصَرُ في القاعدةِ نفسِها ولا يُصدَّقُ ما يطلبُه العميلُ", async () => {
    const raw = await sql<{ result: { ok: boolean; items: unknown[] } }[]>`
      select get_user_notifications(${RIDER_TELEGRAM}::bigint, 100000::integer, null) as result
    `;
    expect(raw[0]?.result.ok).toBe(true);
    // لا صفوفَ كثيرةٌ ههنا؛ المقصودُ أنَّ حدّاً هائلاً لا يُخفِقُ ولا يُمرَّرُ خاماً.
    expect(Array.isArray(raw[0]?.result.items)).toBe(true);

    const clamped = await sql<{ result: { items: unknown[] } }[]>`
      select get_user_notifications(${RIDER_TELEGRAM}::bigint, 0::integer, null) as result
    `;
    // حدٌّ صفريٌّ يُقصَرُ إلى واحدٍ لا يُعيدُ الكلَّ ولا يُخفِق.
    expect((clamped[0]?.result.items ?? []).length).toBeLessThanOrEqual(1);
  });

  it("مستخدمٌ لا صفَّ له يُقرأُ `RECIPIENT_NOT_FOUND` لا موجَزاً فارغاً كاذباً", async () => {
    const center = createUserNotificationCenter(sql);
    const missing = await center.readFeed({ telegramUserId: "999999999999" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.reason).toBe("RECIPIENT_NOT_FOUND");

    // التمييزُ يبقى في الطبقةِ التي تفهمُه: المسارُ هوَ مَن يُترجِمُه موجَزاً
    // فارغاً، فلا يفقدُ المحوّلُ القدرةَ على التفريقِ بينَ «لا حسابَ» و«لا إشعارَ».
    const nonNumeric = await center.readFeed({ telegramUserId: "not-a-number" });
    expect(nonNumeric.ok).toBe(false);
  });
});
