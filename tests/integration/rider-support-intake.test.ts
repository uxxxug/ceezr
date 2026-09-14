/**
 * الغرض: قياسُ `open_support_ticket` بمرجعِها المنطوقِ و`rider_support_tickets`
 *   على قاعدةٍ حقيقيّةٍ (`F2-12` · `SR-11`) — وأهمُّ ما يُقاسُ ههنا ما **لا
 *   يقدرُ حاجزٌ ساكنٌ ولا مخزنٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ المرجعَ **يُولَدُ من القاعدةِ لا من الشِفرةِ**: صفٌّ يُكتَبُ بلا
 *        ذكرِ العمودِ يخرجُ بمرجعٍ على نمطِ `WSL-` وستِّ خاناتٍ، **ومتفرّدٍ**.
 *     ــ أنَّ التهدئةَ تُردُّ بثانيةٍ تُقرأُ (`retry_after_seconds`) لا برفضٍ
 *        أخرسَ — فالشاشةُ تقولُ «بعدَ كم» أو تسكتُ عن وعدٍ لا تعرفُه.
 *     ــ أنَّ مِلكيّةَ الطلبِ **قيدُ استعلامٍ**: طلبُ غيرِكَ يُردُّ
 *        `ORDER_NOT_YOURS` ولو صحَّ معرّفُه.
 *     ــ أنَّ الترقيمَ **بمفتاحٍ لا بإزاحةٍ**: صفحاتٌ متتابعةٌ تُعطي كلَّ تذكرةٍ
 *        مرّةً واحدةً **ولو كُتِبَت تذكرةٌ جديدةٌ بينَ الصفحتَينِ** — وهذا الحكمُ
 *        يسقطُ مع `offset` ولا يسقطُ معَ المفتاحِ، ولا يظهرُ إلّا ههنا.
 *     ــ أنَّ زمنَ الاستجابةِ المتوقَّعَ **إعدادٌ لا رقمٌ في شِفرةٍ**، وأنَّ
 *        مدينةً بلا إعدادٍ تُعطي `null` **ولا تحجبُ تذاكرَ صاحبِها**.
 *     ــ أنَّ الحدَّ خارجَ المدى والمؤشِّرَ الناقصَ **يُرَدّانِ** لا يُقصَرانِ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` (دعمُ السائقِ) إذ يمرُّ بالدالّةِ نفسِها.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ منعُ `anon` ههنا**: مقيسٌ **لكلِّ دالّةٍ في المخطَّطِ** في
 *    `tests/integration/database-privilege-surface.test.ts` (الطبقةُ ٢) — ولا
 *    يُكرَّرُ سؤالٌ في موضعَينِ فيفترقَ جوابُه.
 * ــ **لا يُقاسُ مسارُ البوّابةِ HTTP**: خريطةُ الرموزِ إلى 401/403/409/422
 *    مقيسةٌ في `tests/unit/rider-support-usecase.test.ts` حكماً، والبوّابةُ
 *    تُمرِّرُها — ودَينٌ مُعلَنٌ أن يُقاسَ الطلبُ الشبكيُّ نفسُه.
 * ــ **لا يُقاسُ إرفاقُ صورةٍ**: لا رفعَ في هذا البندِ (دَينٌ مُعلَنٌ)، والعمودُ
 *    `attachment_file_id` يبقى لمسارِ السائقِ في البوتِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const RIDER_TELEGRAM_ID = 900_000_121;
const OTHER_TELEGRAM_ID = 900_000_122;
const PAGER_TELEGRAM_ID = 900_000_123;
const NON_RIDER_TELEGRAM_ID = 900_000_124;
const ABSENT_TELEGRAM_ID = 900_000_125;

let cityId = "";
let previousGroupId: string | null = null;
let riderUserId = "";
let riderId = "";
let otherUserId = "";
let otherRiderId = "";
let pagerUserId = "";
let pagerRiderId = "";
let nonRiderUserId = "";
let otherOrderId = "";

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

interface OpenPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly ticket_id?: string;
  readonly reference?: string;
  readonly retry_after_seconds?: number;
  readonly type?: string;
}

interface TicketRow {
  readonly id: string;
  readonly reference: string;
  readonly type: string;
  readonly status: string;
  readonly message: string;
  readonly resolution: string | null;
  readonly order_id: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

interface PagePayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly expected_response_minutes?: number | null;
  readonly has_more?: boolean;
  readonly next_cursor?: { created_at: string; id: string } | null;
  readonly tickets?: readonly TicketRow[];
}

async function openTicket(options: {
  readonly telegramId: number;
  readonly type?: string;
  readonly message?: string;
  readonly orderId?: string | null;
}): Promise<OpenPayload> {
  const [row] = await sql<{ result: OpenPayload }[]>`
    select open_support_ticket(
      ${options.telegramId}::bigint,
      ${options.type ?? "app_problem"}::support_ticket_type,
      ${options.message ?? "الخريطةُ لا تفتحُ عندي"}::text,
      null::text,
      ${options.orderId ?? null}::uuid
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function page(options: {
  readonly telegramId: number;
  readonly limit?: number | null;
  readonly beforeCreatedAt?: string | null;
  readonly beforeId?: string | null;
}): Promise<PagePayload> {
  const [row] = await sql<{ result: PagePayload }[]>`
    select rider_support_tickets(
      ${options.telegramId}::bigint,
      ${options.limit === undefined ? 20 : options.limit}::integer,
      ${options.beforeCreatedAt ?? null}::timestamptz,
      ${options.beforeId ?? null}::uuid
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * تذكرةٌ مزروعةٌ مباشرةً **بلا ذكرِ عمودِ المرجعِ**: القصدُ مزدوجٌ — أن تُقاسَ
 * قيمةُ العمودِ الافتراضيّةُ على مسارِ كتابةٍ لا يمرُّ بالدالّةِ، وأن يُبنى
 * تاريخٌ متباعدُ الأختامِ لا تصنعُه الدالّةُ لأنَّ التهدئةَ تمنعُ تذكرتَينِ في
 * خمسِ دقائقَ. **ولا تُخفَّفُ التهدئةُ لأجلِ اختبارٍ.**
 */
async function seedTicket(options: {
  readonly riderId: string;
  readonly minutesAgo: number;
  readonly type?: string;
  readonly status?: string;
}): Promise<{ readonly id: string; readonly reference: string }> {
  const [row] = await sql<{ id: string; reference: string }[]>`
    insert into support_tickets (city_id, type, rider_id, message, status, created_at)
    values (
      ${cityId}, ${options.type ?? "other"}::support_ticket_type, ${options.riderId},
      ${`تذكرةٌ مزروعةٌ قبلَ ${options.minutesAgo} دقيقةً`},
      ${options.status ?? "open"}::support_ticket_status,
      now() - make_interval(mins => ${options.minutesAgo})
    ) returning id, reference
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ التذكرةِ");
  return row;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  const [city] = await sql<{ id: string; support: string | null }[]>`
    select c.id, c.telegram_support_group_id::text as support
      from cities c
      join city_service_areas a on a.city_id = c.id and a.is_active
     where c.is_active order by c.code limit 1
  `;
  if (city === undefined) {
    throw new Error("تعذّر الزرعُ: لا مدينةَ مفعَّلةً لها منطقةُ خدمةٍ مفعَّلةٌ");
  }
  cityId = city.id;
  previousGroupId = city.support;
  // قروبُ الدعمِ شرطُ فتحِ التذكرةِ (`CITY_GROUP_MISSING`)، ويُعادُ كما كانَ
  // في `afterAll` — الاختبارُ لا يُغيِّرُ حالةَ مدينةٍ ويتركُها.
  await sql`
    update cities
       set telegram_support_group_id = coalesce(telegram_support_group_id, -1006012)
     where id = ${cityId}
  `;

  const seedRider = async (
    telegramId: number,
    name: string,
    phone: string,
  ): Promise<{ readonly userId: string; readonly riderId: string }> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'rider', ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error(`تعذّر زرعُ المستخدمِ ${name}`);
    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${user.id}) returning id
    `;
    if (rider === undefined) throw new Error(`تعذّر زرعُ الراكبِ ${name}`);
    return { userId: user.id, riderId: rider.id };
  };

  const main = await seedRider(RIDER_TELEGRAM_ID, "راكبُ الدعمِ", "+966500000121");
  riderUserId = main.userId;
  riderId = main.riderId;
  const other = await seedRider(OTHER_TELEGRAM_ID, "راكبٌ آخرُ للدعمِ", "+966500000122");
  otherUserId = other.userId;
  otherRiderId = other.riderId;
  const pager = await seedRider(PAGER_TELEGRAM_ID, "راكبُ الترقيمِ", "+966500000123");
  pagerUserId = pager.userId;
  pagerRiderId = pager.riderId;

  // **مستخدمٌ بلا صفِّ راكبٍ**: به يُقاسُ `NOT_A_RIDER` — وهوَ غيرُ
  // `USER_NOT_FOUND`، والخلطُ بينَهما يقولُ لصاحبِ حسابٍ قائمٍ «لا حسابَ لكَ».
  const [nonRider] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${NON_RIDER_TELEGRAM_ID}, 'rider', 'مستخدمٌ بلا صفِّ راكبٍ', '+966500000124')
    returning id
  `;
  if (nonRider === undefined) throw new Error("تعذّر زرعُ المستخدمِ بلا راكبٍ");
  nonRiderUserId = nonRider.id;

  const [order] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, idempotency_key
    ) values (
      ${cityId}, ${otherRiderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      ${`support-intake:${crypto.randomUUID()}`}
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ طلبِ الراكبِ الآخرِ");
  otherOrderId = order.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  const riderIds = [riderId, otherRiderId, pagerRiderId].filter((id) => id !== "");
  const userIds = [riderUserId, otherUserId, pagerUserId, nonRiderUserId].filter((id) => id !== "");
  if (riderIds.length > 0) {
    await sql`delete from support_tickets where rider_id = any(${riderIds}::uuid[])`;
    await sql`delete from orders where rider_id = any(${riderIds}::uuid[])`;
    await sql`delete from riders where id = any(${riderIds}::uuid[])`;
  }
  if (userIds.length > 0) {
    await sql`delete from audit_log where actor_user_id = any(${userIds}::uuid[])`;
    await sql`delete from users where id = any(${userIds}::uuid[])`;
  }
  if (cityId !== "" && previousGroupId === null) {
    await sql`update cities set telegram_support_group_id = null where id = ${cityId}`;
  }
  await sql.end();
});

describeIf("مرجعُ التذكرةِ — نصٌّ منطوقٌ تولِّدُه القاعدةُ", () => {
  it("فتحُ تذكرةٍ يُعيدُ مرجعاً على نمطِ `WSL-` وستِّ خاناتٍ", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM_ID });
    expect(opened.ok).toBe(true);
    expect(opened.reference).toMatch(/^WSL-[0-9]{6,}$/);
    expect(opened.ticket_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // **والمرجعُ ليسَ المعرّفَ**: لو كانا واحداً لَعُرِضَ UUID على شاشةٍ.
    expect(opened.reference).not.toBe(opened.ticket_id);
  });

  it("صفٌّ يُكتَبُ **بلا ذكرِ العمودِ** يخرجُ بمرجعٍ — الافتراضيُّ في القاعدةِ لا في الشِفرةِ", async () => {
    const seeded = await seedTicket({ riderId: pagerRiderId, minutesAgo: 90 });
    expect(seeded.reference).toMatch(/^WSL-[0-9]{6,}$/);
  });

  it("المراجعُ **متفرّدةٌ** — فهرسٌ فريدٌ قائمٌ ومُصدَّقٌ", async () => {
    const [row] = await sql<{ indisvalid: boolean; indisunique: boolean }[]>`
      select i.indisvalid, i.indisunique
        from pg_class c join pg_index i on i.indexrelid = c.oid
       where c.relname = 'support_tickets_reference_key'
    `;
    expect(row?.indisunique).toBe(true);
    expect(row?.indisvalid).toBe(true);

    const [duplicate] = await sql<{ n: string }[]>`
      select count(*)::text as n from (
        select reference from support_tickets group by reference having count(*) > 1
      ) d
    `;
    expect(duplicate?.n).toBe("0");
  });

  it("قيدُ حضورِ المرجعِ **مُصدَّقٌ** لا معلَّقٌ", async () => {
    const [row] = await sql<{ convalidated: boolean }[]>`
      select convalidated from pg_constraint where conname = 'support_tickets_reference_present'
    `;
    expect(row?.convalidated).toBe(true);
  });
});

describeIf("فتحُ التذكرةِ — أحكامُ القاعدةِ", () => {
  it("التهدئةُ تُردُّ **بثانيةٍ تُقرأُ** لا برفضٍ أخرسَ", async () => {
    const first = await openTicket({ telegramId: OTHER_TELEGRAM_ID, type: "other" });
    expect(first.ok).toBe(true);
    const second = await openTicket({ telegramId: OTHER_TELEGRAM_ID, type: "other" });
    expect(second.ok).toBe(false);
    expect(second.error).toBe("COOLDOWN_ACTIVE");
    expect(second.retry_after_seconds).toBeGreaterThan(0);
    // والتذكرةُ الثانيةُ **لم تُكتَبْ**: رفضٌ لا يكتبُ صفّاً.
    const [count] = await sql<{ n: string }[]>`
      select count(*)::text as n from support_tickets where rider_id = ${otherRiderId}
    `;
    expect(count?.n).toBe("1");
  });

  it("طلبُ غيرِكَ يُردُّ `ORDER_NOT_YOURS` ولو صحَّ معرّفُه", async () => {
    const result = await openTicket({
      telegramId: PAGER_TELEGRAM_ID,
      type: "lost_item",
      orderId: otherOrderId,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ORDER_NOT_YOURS");
  });

  it("رسالةٌ من فراغاتٍ تُردُّ قبلَ كلِّ شيءٍ", async () => {
    const result = await openTicket({ telegramId: RIDER_TELEGRAM_ID, message: "   " });
    expect(result.error).toBe("MESSAGE_EMPTY");
  });

  it("`subscription` ليسَ لراكبٍ — تُردُّ `NOT_A_DRIVER`", async () => {
    const result = await openTicket({ telegramId: RIDER_TELEGRAM_ID, type: "subscription" });
    expect(result.error).toBe("NOT_A_DRIVER");
  });

  it("مستخدمٌ لا صفَّ له في القاعدةِ ⇒ `USER_NOT_FOUND` لا جلسةٌ فاسدةٌ", async () => {
    const result = await openTicket({ telegramId: ABSENT_TELEGRAM_ID });
    expect(result.error).toBe("USER_NOT_FOUND");
  });

  it("الأصنافُ الأربعةُ الجديدةُ **مقبولةٌ في النوعِ**", async () => {
    const [row] = await sql<{ labels: string[] }[]>`
      select array_agg(e.enumlabel::text order by e.enumlabel) as labels
        from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'support_ticket_type'
    `;
    for (const label of ["lost_item", "driver_conduct", "app_problem", "other"]) {
      expect(row?.labels).toContain(label);
    }
  });
});

describeIf("قراءةُ تذاكري — مِلكيّةٌ وترقيمُ مفتاحٍ", () => {
  it("مستخدمٌ بلا صفِّ راكبٍ ⇒ `NOT_A_RIDER`، وغائبٌ ⇒ `USER_NOT_FOUND`", async () => {
    expect((await page({ telegramId: NON_RIDER_TELEGRAM_ID })).error).toBe("NOT_A_RIDER");
    expect((await page({ telegramId: ABSENT_TELEGRAM_ID })).error).toBe("USER_NOT_FOUND");
  });

  it("الحدُّ خارجَ المدى **يُردُّ** لا يُقصَرُ، والمؤشِّرُ الناقصُ يُردُّ", async () => {
    expect((await page({ telegramId: RIDER_TELEGRAM_ID, limit: 0 })).error).toBe(
      "LIMIT_OUT_OF_RANGE",
    );
    expect((await page({ telegramId: RIDER_TELEGRAM_ID, limit: 51 })).error).toBe(
      "LIMIT_OUT_OF_RANGE",
    );
    expect((await page({ telegramId: RIDER_TELEGRAM_ID, limit: null })).error).toBe(
      "LIMIT_OUT_OF_RANGE",
    );
    const half = await page({
      telegramId: RIDER_TELEGRAM_ID,
      beforeCreatedAt: new Date().toISOString(),
      beforeId: null,
    });
    expect(half.error).toBe("CURSOR_INCOMPLETE");
  });

  it("سجلُّ راكبٍ **لا يحملُ تذكرةَ راكبٍ آخرَ**", async () => {
    const mine = await page({ telegramId: RIDER_TELEGRAM_ID, limit: 50 });
    expect(mine.ok).toBe(true);
    const references = (mine.tickets ?? []).map((ticket) => ticket.reference);
    const others = await sql<{ reference: string }[]>`
      select reference from support_tickets where rider_id = ${otherRiderId}
    `;
    for (const row of others) expect(references).not.toContain(row.reference);
  });

  it("صفحتانِ بمفتاحٍ تُعطيانِ كلَّ تذكرةٍ **مرّةً واحدةً ولو كُتِبَ صفٌّ بينَهما**", async () => {
    // ستُّ تذاكرَ بأختامٍ متباعدةٍ، ثمَّ صفحتانِ بحدٍّ ثلاثةٍ.
    for (const minutes of [600, 540, 480, 420, 360, 300]) {
      await seedTicket({ riderId: pagerRiderId, minutesAgo: minutes });
    }
    const first = await page({ telegramId: PAGER_TELEGRAM_ID, limit: 3 });
    expect(first.ok).toBe(true);
    expect(first.tickets?.length).toBe(3);
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).not.toBe(null);

    // **صفٌّ جديدٌ بينَ الصفحتَينِ**: مع الإزاحةِ يُكرِّرُ صفّاً أو يُسقِطُه،
    // ومع المفتاحِ لا يفعلُ — وهذا الحكمُ لا يظهرُ إلّا على قاعدةٍ حقيقيّةٍ.
    await seedTicket({ riderId: pagerRiderId, minutesAgo: 1 });

    const second = await page({
      telegramId: PAGER_TELEGRAM_ID,
      limit: 3,
      beforeCreatedAt: first.next_cursor?.created_at ?? null,
      beforeId: first.next_cursor?.id ?? null,
    });
    expect(second.ok).toBe(true);
    const firstIds = (first.tickets ?? []).map((ticket) => ticket.id);
    const secondIds = (second.tickets ?? []).map((ticket) => ticket.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    // والترتيبُ تنازليٌّ حتماً في الصفحتَينِ.
    const stamps = [...(first.tickets ?? []), ...(second.tickets ?? [])].map((ticket) =>
      new Date(ticket.created_at).getTime(),
    );
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
  });

  it("زمنُ الاستجابةِ المتوقَّعُ **إعدادٌ** يُقرأُ، وغيابُه `null` **لا يحجبُ التذاكرَ**", async () => {
    const withSetting = await page({ telegramId: PAGER_TELEGRAM_ID, limit: 5 });
    expect(withSetting.ok).toBe(true);
    expect(withSetting.expected_response_minutes).toBe(120);

    const present = await page({ telegramId: PAGER_TELEGRAM_ID, limit: 5 });
    expect(present.ok).toBe(true);
    expect(present.expected_response_minutes).toBe(120);

    // **الغيابُ يُصنَعُ داخلَ معاملةٍ تُرجَعُ**: حذفُ صفِّ إعدادٍ ثمَّ استعادتُه
    // بيدٍ يتركُ قاعدةَ الاختبارِ أسوأَ ممّا وجدَها إن سقطَ الاختبارُ في
    // المنتصفِ — وقد وقعَ ذلكَ فعلاً مرّةً في بناءِ هذا الملفِّ. و`'null'::jsonb`
    // لا تُغني: قيدُ `platform_settings_value_type_coherent` يمنعُها لنوعِ
    // `number`. فالتراجعُ **هوَ** أداةُ العزلِ، ولا يُخفَّفُ قيدٌ لأجلِ قياسٍ.
    const ROLLBACK = "ROLLBACK_AFTER_MEASUREMENT";
    let measured: PagePayload | null = null;
    try {
      await sql.begin(async (tx) => {
        await tx`
          delete from platform_settings
           where city_id = ${cityId} and key = 'support_expected_response_minutes'
        `;
        const [row] = await tx<{ result: PagePayload }[]>`
          select rider_support_tickets(${PAGER_TELEGRAM_ID}::bigint, 5::integer, null, null) as result
        `;
        measured = row?.result ?? null;
        throw new Error(ROLLBACK);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
    }

    expect(measured).not.toBe(null);
    const withoutSetting = measured as unknown as PagePayload;
    expect(withoutSetting.ok).toBe(true);
    // **لا تُحجَبُ تذاكرُ صاحبِها لأجلِ سطرٍ إعلاميٍّ غائبٍ.**
    expect(withoutSetting.expected_response_minutes).toBe(null);
    expect((withoutSetting.tickets ?? []).length).toBeGreaterThan(0);

    // والصفُّ باقٍ كما كانَ بعدَ التراجعِ.
    const [restored] = await sql<{ value: string }[]>`
      select value::text as value from platform_settings
       where city_id = ${cityId} and key = 'support_expected_response_minutes'
    `;
    expect(restored?.value).toBe("120");
  });

  it("الإعدادُ **مُعلَنٌ مؤقّتاً** — لا رقمَ تجاريّاً يُزعَمُ نهائيّاً", async () => {
    const [row] = await sql<{ is_provisional: boolean }[]>`
      select is_provisional from platform_settings
       where city_id = ${cityId} and key = 'support_expected_response_minutes'
    `;
    expect(row?.is_provisional).toBe(true);
  });
});
