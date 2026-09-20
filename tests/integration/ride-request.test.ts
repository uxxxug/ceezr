/**
 * الغرض: قياسُ حكمِ **إنشاءِ الرحلةِ** على قاعدةٍ حقيقيّةٍ (`F2-05`) — وأهمُّ ما
 *   يُقاسُ ههنا ما **لا يقدرُ حاجزٌ ساكنٌ ولا محرِّكٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ مفتاحَ التكرارِ **قيدُ مخطَّطٍ** لا اتّفاقُ تطبيقٍ: نداءانِ
 *        **متزامنانِ** بمفتاحٍ واحدٍ من حالةٍ نظيفةٍ يُنتِجانِ صفّاً واحداً
 *        وجواباً ثانياً `reused: true` (`ARCH-006`).
 *     ــ أنَّ منعَ الطلبَينِ النشطَينِ يقعُ في **معاملةٍ واحدةٍ** بقفلِ صفِّ
 *        الراكبِ، فلا يُنشئُ تبويبانِ رحلتَينِ لراكبٍ واحدٍ (القاعدة 0.5).
 *     ــ أنَّ رفضَ الانطلاقِ مفصولٌ عن رفضِ المقصدِ برمزَينِ، وأنَّ الرفضَ
 *        **لا يكتبُ صفّاً**.
 *     ــ أنَّ حالةَ البحثِ تُقرأُ من الصفوفِ لا من ذاكرةِ التطبيقِ، وأنَّ العددَ
 *        صفرٌ صادقٌ حينَ لا عرضَ (`ADR 0023`).
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F3` يُقاسُ بثُّه على الطلبِ المُنشأِ ههنا.
 * ملاحظات مستقبلية: حينَ يُبَثُّ الطلبُ فعلاً تُضافُ حالاتُ الأدوارِ المتعدِّدةِ
 *   على `broadcast_round` — ولا تُدَّعى قبلَ بنائِها.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ أجرةٌ ولا وسيلةُ دفعٍ ولا عقوبةُ إلغاءٍ**: محجوبةٌ بـ`ADR 0039`
 *    §٤ و`م13-7` حتّى `DEC-11`، وغيابُها مفروضٌ آليّاً في
 *    `scripts/check-ride-request-contract.ts`.
 * ــ **لا يُقاسُ إسنادُ سائقٍ**: الإنشاءُ يُنتِجُ `searching` والبثُّ `F3`.
 * ــ **لا يُقاسُ أنَّ راكباً طلبَ رحلةً من جهازٍ**: لا نشرَ حيَّ (`ADR 0099`)،
 *    وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**.
 * ــ `RLS` يُقاسُ وجوداً لا أثراً: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
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

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه، ومعرّفٌ غائبٌ عن قصدٍ. */
const RIDER_TELEGRAM_ID = 900_000_951;
const DRIVER_TELEGRAM_ID = 900_000_952;
const UNREGISTERED_TELEGRAM_ID = 900_000_953;
const ABSENT_TELEGRAM_ID = 900_000_954;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";
let unregisteredUserId = "";
let driverUserId = "";
let driverId = "";

/** نقطتانِ في غلافِ جدة وثالثةٌ في الرياضِ خارجَه. */
const ORIGIN = { lat: 21.4858, lng: 39.1925 } as const;
const DESTINATION = { lat: 21.5433, lng: 39.1728 } as const;
const RIYADH = { lat: 24.7136, lng: 46.6753 } as const;

interface RidePayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly reused?: boolean;
  readonly order_id?: string;
  readonly created_at?: string;
  readonly status?: string;
  readonly service?: string;
  readonly broadcast_round?: number;
  readonly notified_driver_count?: number | string;
  readonly wider_circle_opened?: boolean;
  readonly escalated?: boolean;
  readonly cancellable_without_penalty?: boolean;
}

/** مفتاحٌ فريدٌ لكلِّ حالةٍ: مفتاحٌ مشترَكٌ بينَ حالتَينِ يجعلُ التكرارَ ضجيجاً. */
function keyFor(label: string): string {
  return `ride:${label}:${crypto.randomUUID()}`;
}

async function request(
  telegramId: number,
  key: string,
  options: {
    readonly origin?: { lat: number; lng: number };
    readonly destination?: { lat: number; lng: number };
    readonly service?: string;
    readonly notes?: string | null;
  } = {},
): Promise<RidePayload> {
  const origin = options.origin ?? ORIGIN;
  const destination = options.destination ?? DESTINATION;
  const [row] = await sql<{ result: RidePayload }[]>`
    select request_ride(${telegramId}::bigint,
                        ${key}::text,
                        ${options.service ?? "transport"}::service_type,
                        ${origin.lat}::double precision, ${origin.lng}::double precision,
                        ${destination.lat}::double precision,
                        ${destination.lng}::double precision,
                        ${options.notes ?? null}::text) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function searchState(telegramId: number, orderId: string): Promise<RidePayload> {
  const [row] = await sql<{ result: RidePayload }[]>`
    select ride_search_state(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function cancel(telegramId: number, orderId: string): Promise<RidePayload> {
  const [row] = await sql<{ result: RidePayload }[]>`
    select cancel_ride_by_telegram(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function orderCount(key: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from orders where idempotency_key = ${key}
  `;
  return Number.parseInt(row?.count ?? "0", 10);
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب اختبار الطلب', '+966500000951')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = riderUser.id;

  // صفُّ `riders` مزروعٌ صراحةً: الدالّةُ **لا تُنشئُه ضمناً** (`ADR 0035`).
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  // مستخدمٌ بدورِ راكبٍ **بلا** صفِّ `riders`: يُقاسُ به فصلُ الرمزَينِ.
  const [unregistered] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${UNREGISTERED_TELEGRAM_ID}, 'rider', 'راكب غير مسجَّل', '+966500000953')
    returning id
  `;
  if (unregistered === undefined) throw new Error("تعذّر زرعُ المستخدمِ غيرِ المسجَّلِ");
  unregisteredUserId = unregistered.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق اختبار الطلب', '+966500000952')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;

  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status)
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'transport'::service_type, true),
           (${cityId}, ${driverId}, 'delivery'::service_type, false)
  `;
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
    values (${cityId}, ${driverId}, 'both'::subscription_plan, 'active'::subscription_status,
            now() + interval '30 days')
  `;
});

/**
 * تنظيفُ الطلباتِ بعدَ **كلِّ** حالةٍ لا في النهايةِ: منعُ الطلبَينِ النشطَينِ
 * يعني أنَّ طلباً باقياً من حالةٍ سابقةٍ يُخفِقُ ما بعدَه لسببٍ ليسَ هوَ
 * المقصودَ — فالحالةُ النظيفةُ شرطُ صدقِ القياسِ لا ترفٌ.
 */
afterEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (driverId !== "") {
    await sql`delete from subscriptions where driver_id = ${driverId}`;
    await sql`delete from driver_capabilities where driver_id = ${driverId}`;
  }
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [riderUserId, unregisteredUserId, driverUserId]) {
    if (id === "") continue;
    // الإلغاءُ يكتبُ سجلَ تدقيقٍ يشيرُ إلى فاعلِه، وهوَ مطلوبٌ لا عارضٌ:
    // فيُنزَعُ ما زرعَه هذا الملفُ وحدَه ولا تُمسَّ سجلاتُ غيرِه (`ح-8`).
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("إنشاءُ الرحلةِ نداءٌ واحدٌ ذرّيٌّ", () => {
  it("١) طلبٌ مقبولٌ: صفٌّ واحدٌ حالتُه `searching` بمدينةِ صاحبِ الحسابِ", async () => {
    const key = keyFor("accepted");
    const payload = await request(RIDER_TELEGRAM_ID, key);
    expect(payload.ok).toBe(true);
    expect(payload.reused).toBe(false);
    expect(typeof payload.order_id).toBe("string");
    expect(typeof payload.created_at).toBe("string");
    expect(Number.isFinite(Date.parse(payload.created_at ?? ""))).toBe(true);

    const [row] = await sql<
      { status: string; city_id: string; rider_id: string; key: string; round: number }[]
    >`
      select status::text as status, city_id, rider_id, idempotency_key as key, broadcast_round as round
        from orders where id = ${payload.order_id ?? ""}::uuid
    `;
    expect(row?.status).toBe("searching");
    expect(row?.city_id).toBe(cityId);
    expect(row?.rider_id).toBe(riderId);
    expect(row?.key).toBe(key);
    expect(row?.round).toBe(0);
  });

  it("٢) الملاحظةُ تُكتَبُ كما وردَت، والغيابُ `null` لا نصٌّ فارغٌ (`SR-04`)", async () => {
    const withNotes = await request(RIDER_TELEGRAM_ID, keyFor("notes"), {
      notes: "البوّابةُ الشماليّةُ",
    });
    const [noted] = await sql<{ notes: string | null }[]>`
      select notes from orders where id = ${withNotes.order_id ?? ""}::uuid
    `;
    expect(noted?.notes).toBe("البوّابةُ الشماليّةُ");
    await sql`delete from orders where rider_id = ${riderId}`;

    const without = await request(RIDER_TELEGRAM_ID, keyFor("no-notes"));
    const [bare] = await sql<{ notes: string | null }[]>`
      select notes from orders where id = ${without.order_id ?? ""}::uuid
    `;
    expect(bare?.notes).toBe(null);
  });

  it("٣) النقطتانِ تُكتَبانِ `geography` مقيسةً لا نصّاً: تُقابَلُ بحسبةِ القاعدةِ", async () => {
    const payload = await request(RIDER_TELEGRAM_ID, keyFor("points"));
    const [row] = await sql<{ dpickup: number; ddropoff: number }[]>`
      select st_distance(pickup, st_setsrid(st_makepoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography) as dpickup,
             st_distance(dropoff, st_setsrid(st_makepoint(${DESTINATION.lng}, ${DESTINATION.lat}), 4326)::geography) as ddropoff
        from orders where id = ${payload.order_id ?? ""}::uuid
    `;
    expect(row?.dpickup ?? 1).toBeLessThan(1);
    expect(row?.ddropoff ?? 1).toBeLessThan(1);
  });
});

describeIf("مفتاحُ التكرارِ قيدُ مخطَّطٍ لا اتّفاقُ تطبيقٍ (`ARCH-006`)", () => {
  it("٤) نداءٌ ثانٍ **متعاقبٌ** بالمفتاحِ نفسِه: الصفُّ نفسُه و`reused: true`", async () => {
    const key = keyFor("sequential");
    const first = await request(RIDER_TELEGRAM_ID, key);
    const second = await request(RIDER_TELEGRAM_ID, key);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.order_id).toBe(first.order_id);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await orderCount(key)).toBe(1);
  });

  /**
   * وهذه الحالةُ **هيَ** التي لا يقدرُ عليها اختبارُ وحدةٍ: نداءانِ يبدآنِ
   * من حالةٍ نظيفةٍ في اللحظةِ نفسِها على اتّصالَينِ. ولو كانَ المنعُ «اقرأْ
   * ثمَّ اكتبْ» في التطبيقِ لَمَرَّ كلاهما ولَكُتِبَ صفّانِ.
   */
  it("٥) نداءانِ **متزامنانِ** بالمفتاحِ نفسِه: صفٌّ واحدٌ، وأحدُ الجوابَينِ مُعادٌ", async () => {
    const key = keyFor("race");
    const [a, b] = await Promise.all([
      request(RIDER_TELEGRAM_ID, key),
      request(RIDER_TELEGRAM_ID, key),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.order_id).toBe(b.order_id);
    expect(await orderCount(key)).toBe(1);
    // أحدُهما أنشأَ والآخرُ قرأَ — ولا يُشتَرَطُ أيُّهما، فالترتيبُ للمحرِّكِ.
    expect([a.reused, b.reused].filter((value) => value === true).length).toBe(1);
  });

  it("٦) مفتاحٌ غائبٌ أو فارغٌ أو أطولُ من الحدِّ: رفضٌ مُعلَنٌ بلا كتابةِ صفٍّ", async () => {
    const before = await sql<{ count: string }[]>`
      select count(*)::text as count from orders where rider_id = ${riderId}
    `;
    for (const [key, code] of [
      ["", "IDEMPOTENCY_KEY_REQUIRED"],
      ["   ", "IDEMPOTENCY_KEY_REQUIRED"],
      ["k".repeat(201), "IDEMPOTENCY_KEY_TOO_LONG"],
    ] as const) {
      const payload = await request(RIDER_TELEGRAM_ID, key);
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe(code);
    }
    const after = await sql<{ count: string }[]>`
      select count(*)::text as count from orders where rider_id = ${riderId}
    `;
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it("٧) المفتاحُ مخصوصٌ بالراكبِ: راكبانِ بمفتاحٍ واحدٍ صفّانِ لا صفٌّ", async () => {
    const key = keyFor("shared");
    const mine = await request(RIDER_TELEGRAM_ID, key);
    expect(mine.ok).toBe(true);
    // راكبٌ ثانٍ حقيقيٌّ يُزرَعُ ههنا ويُنزَعُ في الحالةِ نفسِها: القيدُ
    // `(rider_id, idempotency_key)` لا المفتاحُ وحدَه.
    const [otherUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${RIDER_TELEGRAM_ID + 100}, 'rider', 'راكب ثانٍ', '+966500000955')
      returning id
    `;
    const [otherRider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${otherUser?.id ?? ""}) returning id
    `;
    try {
      const theirs = await request(RIDER_TELEGRAM_ID + 100, key);
      expect(theirs.ok).toBe(true);
      expect(theirs.order_id).not.toBe(mine.order_id);
      expect(await orderCount(key)).toBe(2);
    } finally {
      await sql`delete from orders where rider_id = ${otherRider?.id ?? ""}`;
      await sql`delete from riders where id = ${otherRider?.id ?? ""}`;
      await sql`delete from users where id = ${otherUser?.id ?? ""}`;
    }
  });
});

describeIf("منعُ الطلبَينِ النشطَينِ في معاملةٍ واحدةٍ (القاعدة 0.5)", () => {
  it("٨) طلبٌ ثانٍ بمفتاحٍ **مختلفٍ** ورحلةٌ قائمةٌ: رفضٌ معَ طريقِ الخروجِ", async () => {
    const first = await request(RIDER_TELEGRAM_ID, keyFor("active-first"));
    expect(first.ok).toBe(true);
    const second = await request(RIDER_TELEGRAM_ID, keyFor("active-second"));
    expect(second.ok).toBe(false);
    expect(second.error).toBe("ACTIVE_RIDE_EXISTS");
    expect(second.order_id).toBe(first.order_id);
    expect(second.status).toBe("searching");
    expect(
      (
        await sql<{ count: string }[]>`
          select count(*)::text as count from orders where rider_id = ${riderId}
        `
      )[0]?.count,
    ).toBe("1");
  });

  it("٩) طلبانِ **متزامنانِ** بمفتاحَينِ مختلفَينِ: صفٌّ واحدٌ والثاني مرفوضٌ", async () => {
    const [a, b] = await Promise.all([
      request(RIDER_TELEGRAM_ID, keyFor("race-a")),
      request(RIDER_TELEGRAM_ID, keyFor("race-b")),
    ]);
    const accepted = [a, b].filter((payload) => payload.ok === true);
    const refused = [a, b].filter((payload) => payload.ok !== true);
    expect(accepted.length).toBe(1);
    expect(refused.length).toBe(1);
    expect(refused[0]?.error).toBe("ACTIVE_RIDE_EXISTS");
    expect(
      (
        await sql<{ count: string }[]>`
          select count(*)::text as count from orders where rider_id = ${riderId}
        `
      )[0]?.count,
    ).toBe("1");
  });

  it("١٠) رحلةٌ منتهيةٌ لا تمنعُ طلباً جديداً: «نشطةٌ» حالةٌ لا تاريخٌ", async () => {
    const first = await request(RIDER_TELEGRAM_ID, keyFor("done-first"));
    // `completed` يلزَمُها سائقٌ مُسنَدٌ بقيدِ `orders_matched_requires_driver`،
    // والقيدُ **لا يُعطَّلُ لراحةِ اختبارٍ** (`ح-7`)؛ فيُسنَدُ السائقُ المزروعُ.
    await sql`update orders set status = 'completed'::order_status, completed_at = now(),
                     assigned_driver_id = ${driverId}, matched_at = now(), started_at = now()
               where id = ${first.order_id ?? ""}::uuid`;
    const second = await request(RIDER_TELEGRAM_ID, keyFor("done-second"));
    expect(second.ok).toBe(true);
    expect(second.order_id).not.toBe(first.order_id);
  });
});

describeIf("رفضا منطقةِ الخدمةِ والحسابُ الغائبُ", () => {
  it("١١) انطلاقٌ خارجَ الغلافِ ثمَّ مقصدٌ خارجَه: رمزانِ مفصولانِ بلا صفٍّ", async () => {
    const origin = await request(RIDER_TELEGRAM_ID, keyFor("out-origin"), { origin: RIYADH });
    expect(origin.error).toBe("ORIGIN_OUTSIDE_SERVICE_AREA");
    const destination = await request(RIDER_TELEGRAM_ID, keyFor("out-dest"), {
      destination: RIYADH,
    });
    expect(destination.error).toBe("DESTINATION_OUTSIDE_SERVICE_AREA");
    expect(
      (
        await sql<{ count: string }[]>`
          select count(*)::text as count from orders where rider_id = ${riderId}
        `
      )[0]?.count,
    ).toBe("0");
  });

  it("١٢) خدمةٌ لا يخدمُها أحدٌ في المدينةِ: رفضٌ مُعلَنٌ لا طلبٌ معلَّقٌ أبداً", async () => {
    const payload = await request(RIDER_TELEGRAM_ID, keyFor("no-service"), {
      service: "delivery",
    });
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("SERVICE_NOT_AVAILABLE_IN_CITY");
  });

  it("١٣) حسابٌ غائبٌ ومستخدمٌ بلا صفِّ راكبٍ: رمزانِ مفصولانِ ولا إنشاءَ ضمنيَّ", async () => {
    const absent = await request(ABSENT_TELEGRAM_ID, keyFor("absent"));
    expect(absent.error).toBe("USER_NOT_FOUND");
    const unregistered = await request(UNREGISTERED_TELEGRAM_ID, keyFor("unregistered"));
    expect(unregistered.error).toBe("RIDER_NOT_REGISTERED");
    // `ADR 0035`: لم يُنشأْ صفُّ راكبٍ ضمناً لأيٍّ منهما.
    expect(
      (
        await sql<{ count: string }[]>`
          select count(*)::text as count from riders where user_id = ${unregisteredUserId}
        `
      )[0]?.count,
    ).toBe("0");
  });
});

describeIf("حالةُ البحثِ مقروءةٌ من الصفوفِ لا مُجمَّلةٌ", () => {
  it("١٤) بعدَ الإنشاءِ: `searching` وعدُّ إخطارٍ **صفرٌ صادقٌ** لا فراغٌ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("state"));
    const state = await searchState(RIDER_TELEGRAM_ID, created.order_id ?? "");
    expect(state.ok).toBe(true);
    expect(state.status).toBe("searching");
    expect(state.service).toBe("transport");
    expect(Number(state.notified_driver_count)).toBe(0);
    expect(Number(state.broadcast_round)).toBe(0);
    expect(state.cancellable_without_penalty).toBe(true);
    expect(Number.isFinite(Date.parse(state.created_at ?? ""))).toBe(true);
  });

  it("١٥) العدُّ مشتقٌّ من صفوفِ العروضِ: عرضٌ واحدٌ يرفعُه إلى واحدٍ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("offers"));
    await sql`
      insert into order_offers (city_id, order_id, driver_id, round, expires_at)
      values (${cityId}, ${created.order_id ?? ""}::uuid, ${driverId}, 1, now() + interval '1 minute')
    `;
    const state = await searchState(RIDER_TELEGRAM_ID, created.order_id ?? "");
    expect(Number(state.notified_driver_count)).toBe(1);
  });

  it("١٦) رحلةُ راكبٍ آخرَ تُقالُ «غيرُ موجودةٍ» لا «ممنوعةٌ»: لا عدَّادَ معرّفاتٍ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("foreign"));
    const state = await searchState(UNREGISTERED_TELEGRAM_ID, created.order_id ?? "");
    // مستخدمٌ بلا صفِّ راكبٍ يُرَدُّ برمزِه قبلَ أن يُقرأَ الطلبُ ألبتّةَ.
    expect(state.error).toBe("RIDER_NOT_REGISTERED");

    const absent = await searchState(ABSENT_TELEGRAM_ID, created.order_id ?? "");
    expect(absent.error).toBe("USER_NOT_FOUND");
  });

  it("١٧) معرّفٌ غيرُ موجودٍ: `ORDER_NOT_FOUND` لا حالةٌ مُختلَقةٌ", async () => {
    const state = await searchState(RIDER_TELEGRAM_ID, crypto.randomUUID());
    expect(state.ok).toBe(false);
    expect(state.error).toBe("ORDER_NOT_FOUND");
  });
});

describeIf("مآلُ الانتظارِ رايتانِ من الصفوفِ القائمةِ (`PD-050`)", () => {
  // فتحُ الدورةِ يُودِعُ خبرَ «الدائرةِ الأوسعِ» في صندوقِ الصادرِ، ورفضُ الصادرِ
  // للطلبِ يمنعُ التنظيفَ العامَّ من حذفِ الطلبِ — فيعلَّقُ الركبُ كلُّهُ. فتنظيفُ
  // ما زرعَتْهُ هذهِ الكتلةُ وحدَها قبلَ التنظيفِ العامِّ (`ح-8`: لا يُمسُّ ما لم يُزرَعْ هنا).
  afterEach(async () => {
    if (DATABASE_URL === undefined || riderId === "") return;
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from audit_log where entity_type = 'order' and entity_id in (select id from orders where rider_id = ${riderId}) and actor_user_id is null`;
  });

  it("٢٣) السردُ من المصادرِ التشغيليّةِ: صمتٌ ← توسيعٌ ← تصعيدٌ مسلَّمٌ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("narrative"));
    const orderId = created.order_id ?? "";

    // ١) طلبٌ حديثٌ: لا دائرةً أوسعَ ولا تصعيدًا — الصمتُ وقائعُ لا تخمينُ.
    const fresh = await searchState(RIDER_TELEGRAM_ID, orderId);
    expect(fresh.wider_circle_opened).toBe(false);
    expect(fresh.escalated).toBe(false);

    // ٢) فُتِحَتْ دورةُ الدائرةِ الأوسعِ — «وسّعنا البحثَ» تُقرأُ من الصفِّ لا من الرسالةِ.
    const opened = await sql<{ result: { ok: boolean } }[]>`
      select open_unsubscribed_cycle(${orderId}::uuid) as result
    `;
    expect(opened[0]?.result.ok).toBe(true);
    const widened = await searchState(RIDER_TELEGRAM_ID, orderId);
    expect(widened.wider_circle_opened).toBe(true);
    expect(widened.escalated).toBe(false);

    // ٣) أثرُ تصعيدٍ **غيرُ مسلَّمٍ** لا يُقالُ للراكبِ: الشوطُ الذي أخفقَ إرسالُهُ
    //    يُعادُ استعمالُهُ، فعرضُهُ «مُصعَّدًا» يقولُ ما لم يحدثْ بعدُ.
    await sql`
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (${cityId}, null, 'order.escalated', 'order', ${orderId}::uuid,
              jsonb_build_object('reason', 'unsubscribed_cycles_exhausted', 'delivered', false))
    `;
    const pending = await searchState(RIDER_TELEGRAM_ID, orderId);
    expect(pending.escalated).toBe(false);

    // ٤) سُلِّمَ الأثرُ — الآنَ وحدَهُ يُقالُ «أحلينا طلبك إلى فريق الإسناد».
    await sql`
      update audit_log
         set payload = payload || jsonb_build_object('delivered', true, 'message_id', '1')
       where entity_type = 'order' and entity_id = ${orderId}::uuid
         and action = 'order.escalated'
    `;
    const escalated = await searchState(RIDER_TELEGRAM_ID, orderId);
    expect(escalated.escalated).toBe(true);
  });

  it("٢٤) أثرٌ قديمٌ بلا مفتاحِ التسليمِ يُقرَأُ مُسلَّمًا — دلالةُ `coalesce` محفوظةٌ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("legacy-escalation"));
    const orderId = created.order_id ?? "";
    // صفٌّ بصيغةِ ما قبلَ هجرةِ `20260813090000`: لا `delivered` في الحمولةِ —
    // وهيَ تصعيداتٌ سلّمتْ فعلاً فلا تُعامَلُ معلَّقةً (راجعْ تعليقَ الرأسِ في الهجرةِ).
    await sql`
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (${cityId}, null, 'order.escalated', 'order', ${orderId}::uuid,
              jsonb_build_object('reason', 'no_driver_at_all'))
    `;
    const state = await searchState(RIDER_TELEGRAM_ID, orderId);
    expect(state.escalated).toBe(true);
    expect(state.wider_circle_opened).toBe(false);
  });
});

describeIf("الإلغاءُ يُفوَّضُ إلى الدالّةِ الذرّيّةِ القائمةِ", () => {
  it("١٨) إلغاءُ رحلةٍ قائمةٍ: الحالةُ `cancelled` والراكبُ يقدرُ على طلبٍ جديدٍ", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("cancel"));
    const result = await cancel(RIDER_TELEGRAM_ID, created.order_id ?? "");
    expect(result.ok).toBe(true);
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${created.order_id ?? ""}::uuid
    `;
    expect(row?.status).toBe("cancelled");
    const again = await request(RIDER_TELEGRAM_ID, keyFor("cancel-then-new"));
    expect(again.ok).toBe(true);
  });

  it("١٩) إلغاءٌ مكرَّرٌ: `ORDER_NOT_CANCELLABLE` مفصولٌ عن «غيرُ موجودةٍ»", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("cancel-twice"));
    expect((await cancel(RIDER_TELEGRAM_ID, created.order_id ?? "")).ok).toBe(true);
    const second = await cancel(RIDER_TELEGRAM_ID, created.order_id ?? "");
    expect(second.ok).toBe(false);
    expect(second.error).toBe("ORDER_NOT_CANCELLABLE");
    const missing = await cancel(RIDER_TELEGRAM_ID, crypto.randomUUID());
    expect(missing.error).toBe("ORDER_NOT_FOUND");
  });

  it("٢٠) الإلغاءُ لا يحملُ أجرةً ولا عقوبةً: الحمولةُ رمزٌ وحالةٌ فقط", async () => {
    const created = await request(RIDER_TELEGRAM_ID, keyFor("cancel-shape"));
    const result = await cancel(RIDER_TELEGRAM_ID, created.order_id ?? "");
    const keys = Object.keys(result as Record<string, unknown>);
    for (const forbidden of ["fare", "price", "penalty", "amount", "payment", "currency"]) {
      expect(keys.some((key) => key.includes(forbidden))).toBe(false);
    }
  });
});

describeIf("القيدُ والصلاحيّاتُ موجودةٌ في المخطَّطِ نفسِه", () => {
  it("٢١) فهرسٌ فريدٌ على `(rider_id, idempotency_key)` موجودٌ وجزئيٌّ", async () => {
    const [row] = await sql<{ def: string }[]>`
      select indexdef as def from pg_indexes
       where tablename = 'orders' and indexname = 'orders_rider_idempotency_uidx'
    `;
    expect(row).toBeDefined();
    expect(row?.def ?? "").toContain("UNIQUE");
    expect(row?.def ?? "").toContain("idempotency_key IS NOT NULL");
  });

  it("٢٢) الدوالُّ الثلاثُ منزوعةُ التنفيذِ عن `public` و`anon` و`authenticated`", async () => {
    const rows = await sql<{ name: string; role: string; allowed: boolean }[]>`
      select p.proname as name, r.rolname as role,
             has_function_privilege(r.rolname, p.oid, 'EXECUTE') as allowed
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
       where p.proname in ('request_ride', 'ride_search_state', 'cancel_ride_by_telegram')
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.allowed).map((row) => `${row.name}:${row.role}`)).toEqual([]);

    // و`public` تُقرأُ من قائمةِ الصلاحيّاتِ نفسِها: `has_*_privilege` لا تسألُ عنها.
    const publicGrants = await sql<{ name: string }[]>`
      select p.proname as name
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.proname in ('request_ride', 'ride_search_state', 'cancel_ride_by_telegram')
         and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    `;
    expect(publicGrants.length).toBe(0);
  });
});
