/**
 * الغرض: قياسُ مَهمّةِ السائقِ النشطةِ على قاعدةٍ حقيقيّةٍ (`F3-03` · `SD-05`) —
 *   وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ عليه حاجزٌ ساكنٌ**:
 *     ــ أنَّ **الطَورَ ختمُ إنسانٍ**: `next_action` يتقدَّمُ بختمٍ يُكتَبُ لا
 *        بمسافةٍ تُحسَبُ، وهوَ **مُشتقٌّ في الخادمِ** فلا تُخترِعُه شاشةٌ.
 *     ــ أنَّ **لِـ`arrived_at` كاتباً واحداً**: ختمانِ متزامنانِ يُنجِحانِ واحداً
 *        فقط، والثانيُ يُرَدُّ بـ`ALREADY_ARRIVED` **ولحظةُ الوصولِ لا تُزحزَحُ**.
 *     ــ أنَّ **الغلافَ لا يُفلِتُ ذرّيّةَ الكاتبِ القائمِ ولا يخترعُ شرطاً**:
 *        بدءٌ بلا ختمِ وصولٍ **يمرُّ** (ولا يُخترَعُ لهُ منعٌ في الغلافِ)، وبدءٌ
 *        مرّتَينِ يُرَدُّ برمزٍ مُصنَّفٍ، والإنهاءُ **يُعيدُ السائقَ متاحاً** —
 *        وذاكَ أثرُ `complete_ride` وحدَها، فوقوعُه برهانُ التفويضِ.
 *     ــ أنَّ **المِلكيّةَ قيدُ استعلامٍ**: مَهمّةُ غيرِه ومعرِّفٌ معدومٌ جوابُهما
 *        `JOB_NOT_FOUND` بالحرفِ نفسِه.
 *     ــ أنَّ **حمولةَ المَهمّةِ بلا هاتفٍ ولا معرِّفِ تلغرامَ** للراكبِ، وفيها
 *        اسمُه الأوّلُ ولغتُه فحسب — وهوَ الحدُّ المُعلَنُ في `ADR 0118` §٤.
 *     ــ أنَّ **حاجزَ المخطَّطِ يمنعُ ختماً بلا سائقٍ**: قيدُ
 *        `orders_arrived_requires_driver` يُسقِطُ كتابةً مباشرةً تتجاوزُ الكاتبَ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` (الأرباحُ) — يقرأُ رحلةً مُنهاةً زرعَها هذا
 *   الملفُّ بأطوارٍ حقيقيّةٍ لا بتحديثٍ يدويٍّ للحالةِ.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ صدقُ الختمِ في الميدانِ**: أنَّ السائقَ يضغطُ «وصلتُ» حينَ يقفُ
 *    عندَ الراكبِ حقّاً **ليسَ مقيساً** ولا يُدَّعى؛ المقيسُ أنَّ النظامَ لا
 *    يخترعُ الختمَ عنه ولا يُزحزِحُه بعدَ وقوعِه.
 * ــ **لا تُقاسُ ذرّيّةُ `start_ride`/`complete_ride` أنفسِهما**: مقيسةٌ في
 *    اختباراتٍ سابقةٍ لهذا البندِ. المقيسُ ههنا أنَّ غلافَ `F3-03` **يُفوِّضُ**
 *    إليهما ولا يُضيفُ كاتباً ولا شرطاً.
 * ــ **لا تُقاسُ الشاشةُ ولا البوّابةُ**: عقدُهما مقيسٌ في
 *    `scripts/check-driver-job-contract.ts` ووحدةُ نماذجِه.
 * ــ **لا تُقاسُ الصلاحيّاتُ أثراً**: الاتّصالُ بمالكِ القاعدةِ وهوَ يتخطّى
 *    `revoke`؛ والنزعُ مقيسٌ نصّاً في الحاجزِ الساكنِ.
 * ــ **لا يُقاسُ إشعارُ الراكبِ بالوصولِ**: سطحُ الراكبِ زيادةٌ لاحقةٌ، وعائقُ
 *    `F2-06` **يبقى مفتوحاً** ولا يُقرأُ هذا الملفُّ إغلاقاً له.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_351;
const RIVAL_TELEGRAM_ID = 900_000_352;
const RIDER_TELEGRAM_ID = 900_000_353;
const ABSENT_TELEGRAM_ID = 900_000_354;
const RIDER_PHONE = "+966500000353";

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let rivalUserId = "";
let rivalDriverId = "";
let riderUserId = "";
let riderId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

interface Job {
  readonly order_id: string;
  readonly status: string;
  readonly next_action: string | null;
  readonly matched_at: string | null;
  readonly arrived_at: string | null;
  readonly started_at: string | null;
  readonly rider: Readonly<Record<string, unknown>>;
  readonly dropoff: Readonly<Record<string, unknown>> | null;
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function activeJob(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_active_job(${telegramId}::bigint) as result
  `);
}

function markArrived(telegramId: number, orderId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_mark_arrived(${telegramId}::bigint, ${orderId}::uuid) as result
  `);
}

function startRide(telegramId: number, orderId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_start_ride(${telegramId}::bigint, ${orderId}::uuid) as result
  `);
}

function completeRide(telegramId: number, orderId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_complete_ride(${telegramId}::bigint, ${orderId}::uuid) as result
  `);
}

function job(payload: Payload): Job {
  const value = payload.job;
  if (value === null || typeof value !== "object") throw new Error("لا مَهمّةَ في الحمولةِ");
  return value as Job;
}

/**
 * مَهمّةٌ في حالةِ `matched` **بإيكالٍ حقيقيٍّ**: طلبٌ يبحثُ، وعرضٌ صالحٌ، ثمَّ
 * `claim_ride` — لا `update orders set status` يدويٌّ. والحالةُ التي يُقاسُ عليها
 * البندُ يجبُ أن تُصنَعَ بالطريقِ الذي يصنعُها في الإنتاجِ، وإلّا قِيسَ سطحٌ على
 * حالةٍ لا تقعُ.
 */
async function seedMatchedOrder(options?: { readonly withDropoff?: boolean }): Promise<string> {
  const withDropoff = options?.withDropoff ?? true;
  const [order] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label, notes
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      ${
        withDropoff
          ? sql`st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography`
          : sql`null`
      },
      'دوّارُ الانطلاقِ', ${withDropoff ? "بوّابةُ الوجهةِ" : null}, 'أمامَ البابِ الشماليِّ'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");

  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, 'pending'::offer_status,
            now() + make_interval(secs => 120))
  `;
  const claim = await callJson(sql<{ result: Payload }[]>`
    select claim_ride(${order.id}::uuid, ${driverId}::uuid) as result
  `);
  if (claim.ok !== true) throw new Error(`تعذّر الإيكالُ: ${String(claim.error)}`);
  return order.id;
}

/** يُفرِغُ ما زرعَه قياسٌ سابقٌ كي يبدأَ كلُّ قياسٍ من لوحٍ معروفٍ. */
async function clearOrders(): Promise<void> {
  await sql`
    delete from notification_outbox
     where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from audit_log
     where entity_type = 'order'
       and entity_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // **الشرطُ المسبقُ يُصنَعُ ههنا لا يُستعارُ** (`OPS-019`): مدنُ الإطلاقِ تُنشأُ
  // معطَّلةً بقرارِ `F2-05`، فأخضرٌ يعتمدُ على ملفٍّ سابقٍ فعَّلَ مدينةً أخضرُ
  // رهنَ ترتيبِ التشغيلِ لا أخضرُ حقيقةً.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedDriver = async (
    telegramId: number,
    name: string,
    phone: string,
  ): Promise<{ userId: string; driverId: string }> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'driver', ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (
        ${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان',
        ${`م ه م ${telegramId % 10_000}`}
      )
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${driver.id}, ${cityId}, true)
      on conflict (driver_id) do update set is_available = true
    `;
    return { userId: user.id, driverId: driver.id };
  };

  const main = await seedDriver(DRIVER_TELEGRAM_ID, "سائقُ المَهمّةِ", "+966500000351");
  driverUserId = main.userId;
  driverId = main.driverId;
  const rival = await seedDriver(RIVAL_TELEGRAM_ID, "سائقٌ آخرُ", "+966500000352");
  rivalUserId = rival.userId;
  rivalDriverId = rival.driverId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'مريمُ الأنصاريّةُ', ${RIDER_PHONE}, 'ar')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  for (const id of [driverId, rivalDriverId]) {
    if (id === "") continue;
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
    await sql`delete from driver_availability where driver_id = ${id}`;
    await sql`delete from driver_documents where driver_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of [driverId, rivalDriverId]) {
    if (id !== "") await sql`delete from drivers where id = ${id}`;
  }
  for (const id of [driverUserId, rivalUserId, riderUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  // ترجعُ المدينةُ إلى حالتِها قبلَ هذا الملفِّ: تركُها مفعَّلةً يُورِّثُ لِمَن
  // بعدَها شرطاً لم يطلُبْه.
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("قراءةُ المَهمّةِ — هويّةٌ أوّلاً ثمَّ حكمُ الخادمِ على الزرِّ", () => {
  it("١) معرِّفٌ معدومٌ يُرَدُّ `USER_NOT_FOUND`", async () => {
    expect(await activeJob(ABSENT_TELEGRAM_ID)).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });

  it("٢) راكبةٌ تطلبُ مَهمّةَ سائقٍ تُرَدُّ `NOT_A_DRIVER`", async () => {
    expect(await activeJob(RIDER_TELEGRAM_ID)).toEqual({ ok: false, error: "NOT_A_DRIVER" });
  });

  it("٣) لا مَهمّةَ: تُنشَرُ لحظةُ الخادمِ و`job: null` — الغيابُ عَدَمٌ لا صفرٌ", async () => {
    await clearOrders();
    const payload = await activeJob(DRIVER_TELEGRAM_ID);
    expect(payload.ok).toBe(true);
    expect(typeof payload.server_time).toBe("string");
    expect(payload.job).toBeNull();
  });

  it("٤) مَهمّةٌ مُوكَلةٌ لم يُختَم وصولُها: الفعلُ التاليُ `MARK_ARRIVED` والأختامُ صادقةٌ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(current.order_id).toBe(orderId);
    expect(current.status).toBe("matched");
    expect(current.next_action).toBe("MARK_ARRIVED");
    expect(typeof current.matched_at).toBe("string");
    expect(current.arrived_at).toBeNull();
    expect(current.started_at).toBeNull();
    expect(current.notes).toBe("أمامَ البابِ الشماليِّ");
  });

  it("٥) حمولةُ المَهمّةِ: اسمٌ أوّلُ ولغةٌ — ولا هاتفَ ولا معرِّفَ تلغرامَ ولا لقبَ", async () => {
    await clearOrders();
    await seedMatchedOrder();
    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(Object.keys(current.rider).sort()).toEqual(["first_name", "language_code"]);
    expect(current.rider.first_name).toBe("مريمُ");
    expect(current.rider.language_code).toBe("ar");
    const wire = JSON.stringify(current);
    expect(wire).not.toContain(RIDER_PHONE);
    expect(wire).not.toContain(String(RIDER_TELEGRAM_ID));
    expect(wire).not.toContain("الأنصاريّةُ");
    expect(wire).not.toContain(riderId);
  });

  it("٦) رحلةٌ بلا وجهةٍ تُنشِرُ `dropoff: null` لا نقطةً صفريّةً (`ADR 0023`)", async () => {
    await clearOrders();
    await seedMatchedOrder({ withDropoff: false });
    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(current.dropoff).toBeNull();
    expect((current.pickup as { latitude: number }).latitude).toBeCloseTo(PICKUP.lat, 5);
  });
});

describeIf("ختمُ الوصولِ — كاتبٌ واحدٌ لِـ`arrived_at`", () => {
  it("٧) الختمُ يُكتَبُ مرّةً ويتقدَّمُ الفعلُ التاليُ إلى `START_RIDE`", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const stamped = await markArrived(DRIVER_TELEGRAM_ID, orderId);
    expect(stamped.ok).toBe(true);
    expect(typeof stamped.arrived_at).toBe("string");

    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(current.arrived_at).not.toBeNull();
    expect(current.status).toBe("matched");
    expect(current.next_action).toBe("START_RIDE");
  });

  it("٨) ختمٌ ثانٍ يُرَدُّ `ALREADY_ARRIVED` **ولحظةُ الوصولِ لا تُزحزَحُ**", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const first = await markArrived(DRIVER_TELEGRAM_ID, orderId);
    const second = await markArrived(DRIVER_TELEGRAM_ID, orderId);
    expect(second.ok).toBe(false);
    expect(second.error).toBe("ALREADY_ARRIVED");
    expect(second.arrived_at).toBe(first.arrived_at);
    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(current.arrived_at).toBe(first.arrived_at as string);
  });

  it("٩) ختمانِ متزامنانِ: واحدٌ ينجحُ والآخرُ يُصنَّفُ — والقفلُ يمنعُ ختمَينِ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const [left, right] = await Promise.all([
      markArrived(DRIVER_TELEGRAM_ID, orderId),
      markArrived(DRIVER_TELEGRAM_ID, orderId),
    ]);
    const succeeded = [left, right].filter((payload) => payload.ok === true);
    const refused = [left, right].filter((payload) => payload.ok !== true);
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.error).toBe("ALREADY_ARRIVED");
  });

  it("١٠) مَهمّةُ غيرِه ومعرِّفٌ معدومٌ: `JOB_NOT_FOUND` بالحرفِ نفسِه", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const foreign = await markArrived(RIVAL_TELEGRAM_ID, orderId);
    const [absent] = await sql<{ result: Payload }[]>`
      select driver_mark_arrived(
        ${RIVAL_TELEGRAM_ID}::bigint, '00000000-0000-0000-0000-000000000000'::uuid
      ) as result
    `;
    expect(foreign).toEqual({ ok: false, error: "JOB_NOT_FOUND" });
    expect(absent?.result).toEqual({ ok: false, error: "JOB_NOT_FOUND" });
  });

  it("١١) ختمٌ على رحلةٍ جارية يُرَدُّ `PHASE_MISMATCH` — الطَورُ لا يُختَمُ خارجَ حالتِه", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await startRide(DRIVER_TELEGRAM_ID, orderId);
    const refused = await markArrived(DRIVER_TELEGRAM_ID, orderId);
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("PHASE_MISMATCH");
  });

  it("١٢) الختمُ يكتبُ سجلَّ تدقيقٍ باسمِه ولا يُحدِّثُ حالةَ الطلبِ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await markArrived(DRIVER_TELEGRAM_ID, orderId);
    const [audit] = await sql<{ action: string }[]>`
      select action from audit_log
       where entity_id = ${orderId} and action = 'order.driver_arrived'
    `;
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    expect(audit?.action).toBe("order.driver_arrived");
    expect(row?.status).toBe("matched");
  });

  it("١٣) قيدُ المخطَّطِ يمنعُ ختماً بلا سائقٍ مُسنَدٍ — تجاوزُ الكاتبِ يسقطُ", async () => {
    await clearOrders();
    const [order] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
      values (
        ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
        st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'نقطةٌ'
      ) returning id
    `;
    if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
    let message = "";
    try {
      await sql`update orders set arrived_at = now() where id = ${order.id}`;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("orders_arrived_requires_driver");
  });
});

describeIf("البدءُ والإنهاءُ — تفويضٌ إلى الكاتبِ القائمِ لا كاتبٌ ثانٍ", () => {
  it("١٤) بدءٌ بلا ختمِ وصولٍ **يمرُّ**: لا شرطَ يُخترَعُ في الغلافِ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    const started = await startRide(DRIVER_TELEGRAM_ID, orderId);
    expect(started.ok).toBe(true);
    const current = job(await activeJob(DRIVER_TELEGRAM_ID));
    expect(current.status).toBe("in_progress");
    expect(current.next_action).toBe("COMPLETE_RIDE");
    expect(current.arrived_at).toBeNull();
    expect(typeof current.started_at).toBe("string");
  });

  it("١٥) بدءٌ مرّتَينِ يُرَدُّ `PHASE_MISMATCH` — والرمزُ الخامُ لا يُمرَّرُ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await startRide(DRIVER_TELEGRAM_ID, orderId);
    const again = await startRide(DRIVER_TELEGRAM_ID, orderId);
    expect(again).toEqual({ ok: false, error: "PHASE_MISMATCH" });
  });

  it("١٦) بدءُ مَهمّةِ غيرِه يُرَدُّ `JOB_NOT_FOUND` لا `PHASE_MISMATCH`", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    expect(await startRide(RIVAL_TELEGRAM_ID, orderId)).toEqual({
      ok: false,
      error: "JOB_NOT_FOUND",
    });
  });

  it("١٧) إنهاءٌ قبلَ البدءِ يُرَدُّ `PHASE_MISMATCH`", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    expect(await completeRide(DRIVER_TELEGRAM_ID, orderId)).toEqual({
      ok: false,
      error: "PHASE_MISMATCH",
    });
  });

  it("١٨) الإنهاءُ يُغلِقُ المَهمّةَ ويُعيدُ السائقَ متاحاً — أثرُ الكاتبِ المُفوَّضِ إليه", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await markArrived(DRIVER_TELEGRAM_ID, orderId);
    await startRide(DRIVER_TELEGRAM_ID, orderId);
    await sql`update driver_availability set is_available = false where driver_id = ${driverId}`;

    const done = await completeRide(DRIVER_TELEGRAM_ID, orderId);
    expect(done.ok).toBe(true);
    expect(typeof done.completed_at).toBe("string");
    expect(typeof done.duration_seconds).toBe("number");
    expect(done.duration_seconds as number).toBeGreaterThanOrEqual(0);

    const after = await activeJob(DRIVER_TELEGRAM_ID);
    expect(after.ok).toBe(true);
    expect(after.job).toBeNull();

    const [availability] = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(availability?.is_available).toBe(true);
  });

  it("١٩) جوابُ الإنهاءِ منقّىً من هويّةِ الراكبِ — ما لا تحتاجُه الشاشةُ لا يُنشَرُ", async () => {
    await clearOrders();
    const orderId = await seedMatchedOrder();
    await startRide(DRIVER_TELEGRAM_ID, orderId);
    const done = await completeRide(DRIVER_TELEGRAM_ID, orderId);
    expect(Object.keys(done).sort()).toEqual([
      "completed_at",
      "duration_seconds",
      "ok",
      "order_id",
    ]);
    expect(JSON.stringify(done)).not.toContain(String(RIDER_TELEGRAM_ID));
  });
});
