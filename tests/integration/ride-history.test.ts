/**
 * الغرض: قياسُ `rider_ride_history` و`rider_ride_detail` على قاعدةٍ حقيقيّةٍ
 *   (`F2-08` · `SR-09` · `SR-10`) — وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ حاجزٌ
 *   ساكنٌ ولا محرِّكٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ المِلكيّةَ **قيدُ استعلامٍ** لا فحصُ تطبيقٍ: سجلُّ راكبٍ لا يحملُ
 *        رحلةَ راكبٍ آخرَ ولو صحَّ معرِّفُها، وتفصيلُها يُرَدُّ `ORDER_NOT_FOUND`.
 *     ــ أنَّ الترقيمَ **بمفتاحٍ لا بإزاحةٍ**: صفحاتٌ متتابعةٌ تُعطي كلَّ رحلةٍ
 *        مرّةً واحدةً **ولو كُتِبَ صفٌّ جديدٌ بينَ الصفحتَينِ** — وهذا الحكمُ
 *        بالذاتِ يسقطُ مع `offset` ولا يسقطُ معَ المفتاحِ، ولا يظهرُ إلّا ههنا.
 *     ــ أنَّ منطقةَ الشهرِ تأتي من `platform_settings` **بساعةِ القاعدةِ**،
 *        وأنَّ رحلةَ الساعاتِ الأولى تقعُ في شهرِ المدينةِ لا في شهرِ UTC.
 *     ــ أنَّ الإعدادَ الغائبَ أو المجهولَ يُعلَنُ سقوطاً **بمصدرٍ مُسمًّى** ولا
 *        يُسكَتُ عنه.
 *     ــ أنَّ لحظةَ الإلغاءِ تُقرأُ من `audit_log`، وأنَّ إلغاءً بلا صفِّ تدقيقٍ
 *        يُعطي حدثاً بـ`at: null` **لا حدثاً محذوفاً ولا لحظةَ صفرٍ**.
 *     ــ أنَّ الحدَّ خارجَ المدى والمؤشِّرَ الناقصَ **يُرَدّانِ** لا يُقصَرانِ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F2-09` إذ يزيدُ رابطَ مشاركةٍ على الصفِّ نفسِه.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ أجرةٌ ولا إيصالٌ**: محجوبانِ بـ`ADR 0039` §٤ و`م13-7` و`DEC-11`،
 *    والمقيسُ ههنا **غيابُهما من الحمولةِ** لا صحّةُ حسابٍ لا وجودَ له.
 * ــ **لا يُقاسُ بحثٌ عربيٌّ مُطبَّعٌ**: لا `unaccent` ولا `pg_trgm` في القاعدةِ،
 *    والبحثُ اليومَ `ilike` على الوسمِ حرفاً — وهذا دَينٌ مُصرَّحٌ في `ADR 0108`
 *    لا نقصٌ يُخفى، فلا يُزعَمُ ما ليسَ مبنيّاً.
 * ــ `RLS` يُقاسُ وجوداً لا أثراً: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
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
const RIDER_TELEGRAM_ID = 900_000_981;
const OTHER_RIDER_TELEGRAM_ID = 900_000_982;
const DRIVER_TELEGRAM_ID = 900_000_983;
const STRANGER_TELEGRAM_ID = 900_000_984;
const ABSENT_TELEGRAM_ID = 900_000_985;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";
let otherUserId = "";
let otherRiderId = "";
let driverUserId = "";
let driverId = "";
let strangerUserId = "";
let strangerRiderId = "";

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

interface HistoryRow {
  readonly order_id: string;
  readonly status: string;
  readonly service: string;
  readonly pickup_label: string | null;
  readonly dropoff_label: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly month_key: string;
}

interface HistoryPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly month_timezone?: string;
  readonly month_timezone_source?: string;
  readonly query?: string | null;
  readonly limit?: number;
  readonly rides?: readonly HistoryRow[];
  readonly has_more?: boolean;
  readonly next_cursor?: { created_at: string; id: string } | null;
}

interface DetailEvent {
  readonly kind: string;
  readonly at: string | null;
  readonly source: string;
  readonly detail?: Record<string, unknown>;
}

interface DetailPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly found?: boolean;
  readonly refusal?: string;
  readonly order_id?: string;
  readonly status?: string;
  readonly service?: string;
  readonly pickup_label?: string | null;
  readonly dropoff_label?: string | null;
  readonly cancelled_reason?: string | null;
  readonly driver?: {
    first_name: string | null;
    vehicle_type: string | null;
    plate_number: string | null;
  } | null;
  readonly events?: readonly DetailEvent[];
}

async function history(options: {
  readonly telegramId: number;
  readonly query?: string | null;
  readonly beforeCreatedAt?: string | null;
  readonly beforeId?: string | null;
  readonly limit?: number | null;
}): Promise<HistoryPayload> {
  const [row] = await sql<{ result: HistoryPayload }[]>`
    select rider_ride_history(
      ${options.telegramId}::bigint,
      ${options.query ?? null}::text,
      ${options.beforeCreatedAt ?? null}::timestamptz,
      ${options.beforeId ?? null}::uuid,
      ${options.limit === undefined ? 20 : options.limit}::integer
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function detail(telegramId: number, orderId: string): Promise<DetailPayload> {
  const [row] = await sql<{ result: DetailPayload }[]>`
    select rider_ride_detail(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * قيدُ المخطَّطِ `orders_matched_requires_driver` يمنعُ `matched` و`in_progress`
 * و`completed` **بلا سائقٍ مُسنَدٍ** — وهوَ قيدٌ في القاعدةِ لا شرطٌ في
 * التطبيقِ. فالزرعُ يحترمُه بدلاً من أن يُخفِقَ به: حالةٌ تستوجبُ سائقاً
 * تأخذُ سائقَ الملفِّ، وما عداها يُزرَعُ بلا إسنادٍ. **ولا يُخفَّفُ القيدُ
 * ولا يُلتَفُّ عليه** — المقيسُ قراءةُ السجلِّ لا كتابةُ صفوفٍ مستحيلةٍ.
 */
const DRIVER_REQUIRING_STATUSES = new Set(["matched", "in_progress", "completed"]);

function defaultDriverFor(status: string): string | null {
  return DRIVER_REQUIRING_STATUSES.has(status) ? driverId : null;
}

/**
 * طلبٌ مزروعٌ بلحظةِ إنشاءٍ مُعيَّنةٍ. والزرعُ مباشرٌ لا عبرَ `request_ride`:
 * المقيسُ ههنا **قراءةُ سجلٍّ**، والسجلُّ يحتاجُ رحلاتٍ في أشهرٍ مختلفةٍ
 * وبأختامٍ متباعدةٍ — وذاكَ ما لا يصنعُه مسارُ الطلبِ الحيُّ.
 *
 * و`created_at` يُكتَبُ **إزاحةً عن ساعةِ القاعدةِ** لا نصّاً ثابتاً: القصدُ
 * قياسُ أنَّ القاعدةَ تحكمُ بساعتِها، فلو زُرِعَ وقتٌ ثابتٌ لَشاخَ الاختبارُ.
 */
async function seedOrder(options: {
  readonly riderId: string;
  readonly status: string;
  readonly driver?: string | null;
  readonly pickupLabel?: string | null;
  readonly dropoffLabel?: string | null;
  readonly createdMinutesAgo?: number;
  readonly createdAt?: string | null;
  readonly matchedMinutesAgo?: number | null;
  readonly startedMinutesAgo?: number | null;
  readonly completedMinutesAgo?: number | null;
  readonly cancelledReason?: string | null;
}): Promise<string> {
  const stamp = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? sql`null::timestamptz`
      : sql`now() - make_interval(mins => ${minutes})`;
  const createdAt =
    options.createdAt !== undefined && options.createdAt !== null
      ? sql`${options.createdAt}::timestamptz`
      : sql`now() - make_interval(mins => ${options.createdMinutesAgo ?? 60})`;
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
      assigned_driver_id, idempotency_key, created_at, matched_at, started_at, completed_at,
      cancelled_reason
    ) values (
      ${cityId}, ${options.riderId}, 'transport'::service_type, ${options.status}::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      ${options.pickupLabel === undefined ? "البلد" : options.pickupLabel},
      ${options.dropoffLabel === undefined ? "الروضة" : options.dropoffLabel},
      ${options.driver === undefined ? defaultDriverFor(options.status) : options.driver},
      ${`ride-history:${crypto.randomUUID()}`},
      ${createdAt},
      ${stamp(options.matchedMinutesAgo)},
      ${stamp(options.startedMinutesAgo)},
      ${stamp(options.completedMinutesAgo)},
      ${options.cancelledReason ?? null}
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** رحلاتُ السجلِّ الأساسيَّةُ — الأحدثُ أوّلاً بترتيبِ الدقائقِ التنازليِّ. */
let seededIds: string[] = [];

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب السجلِّ', '+966500000981')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [otherUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${OTHER_RIDER_TELEGRAM_ID}, 'rider', 'راكب آخر للسجلِّ', '+966500000982')
    returning id
  `;
  if (otherUser === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherUserId = otherUser.id;
  const [otherRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${otherUserId}) returning id
  `;
  if (otherRider === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherRiderId = otherRider.id;

  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}, 'rider', 'غريبٌ عن السجلِّ', '+966500000984')
    returning id
  `;
  if (stranger === undefined) throw new Error("تعذّر زرعُ الغريبِ");
  strangerUserId = stranger.id;
  // **وللغريبِ صفُّ راكبٍ بلا رحلةٍ واحدةٍ**: المقيسُ في الحالةِ ٢ سجلٌّ فارغٌ
  // لراكبٍ **مُسجَّلٍ**، لا رفضُ `RIDER_NOT_REGISTERED` — وذاكَ مَقيسٌ وحدَه
  // في الحالةِ ٤ بمستخدمِ السائقِ. فبلا صفِّ راكبٍ ههنا كانَ الاختبارانِ
  // يقيسانِ الشيءَ نفسَه ويبقى الفراغُ بلا قياسٍ.
  const [strangerRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${strangerUserId}) returning id
  `;
  if (strangerRider === undefined) throw new Error("تعذّر زرعُ راكبِ الغريبِ");
  strangerRiderId = strangerRider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سالم خالد العمري', '+966500000983')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 9812')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  // خمسُ رحلاتٍ متدرِّجةٍ في القِدَمِ — الأحدثُ أوّلاً حينَ تُقرأُ.
  seededIds = [];
  for (const minutes of [10, 20, 30, 40, 50]) {
    seededIds.push(
      await seedOrder({
        riderId,
        status: "completed",
        driver: driverId,
        createdMinutesAgo: minutes,
        matchedMinutesAgo: minutes - 2,
        startedMinutesAgo: minutes - 4,
        completedMinutesAgo: minutes - 6,
      }),
    );
  }
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  const riderIds = [riderId, otherRiderId, strangerRiderId].filter((id) => id !== "");
  const userIds = [riderUserId, otherUserId, strangerUserId, driverUserId].filter(
    (id) => id !== "",
  );
  if (riderIds.length > 0) {
    await sql`
      delete from ratings
       where order_id in (select id from orders where rider_id = any(${riderIds}::uuid[]))
    `;
    await sql`
      delete from order_offers
       where order_id in (select id from orders where rider_id = any(${riderIds}::uuid[]))
    `;
    await sql`delete from orders where rider_id = any(${riderIds}::uuid[])`;
    await sql`delete from riders where id = any(${riderIds}::uuid[])`;
  }
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  if (userIds.length > 0) {
    await sql`delete from audit_log where actor_user_id = any(${userIds}::uuid[])`;
    await sql`delete from users where id = any(${userIds}::uuid[])`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("السجلُّ — المِلكيّةُ قيدُ استعلامٍ", () => {
  it("١) سجلُّ الراكبِ يحملُ رحلاتِه وحدَها", async () => {
    const foreign = await seedOrder({ riderId: otherRiderId, status: "completed" });
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 50 });
    expect(payload.ok).toBe(true);
    const ids = (payload.rides ?? []).map((row) => row.order_id);
    expect(ids).not.toContain(foreign);
    for (const id of seededIds) expect(ids).toContain(id);
  });

  it("٢) والراكبُ الفارغُ سجلُّه فارغٌ — لا عطبٌ ولا `null`", async () => {
    const payload = await history({ telegramId: STRANGER_TELEGRAM_ID });
    expect(payload.ok).toBe(true);
    expect(payload.rides).toEqual([]);
    expect(payload.has_more).toBe(false);
    expect(payload.next_cursor).toBeNull();
  });

  it("٣) ومَن ليسَ في `users` يُرَدُّ `USER_NOT_FOUND`", async () => {
    const payload = await history({ telegramId: ABSENT_TELEGRAM_ID });
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("USER_NOT_FOUND");
  });

  it("٤) ومَن هوَ مستخدمٌ بلا صفِّ راكبٍ يُرَدُّ `RIDER_NOT_REGISTERED`", async () => {
    const payload = await history({ telegramId: DRIVER_TELEGRAM_ID });
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("RIDER_NOT_REGISTERED");
  });
});

describeIf("السجلُّ — ترتيبٌ وترقيمٌ بمفتاحٍ", () => {
  it("٥) الأحدثُ أوّلاً بلحظةِ الإنشاءِ تنازليّاً", async () => {
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 50 });
    const stamps = (payload.rides ?? []).map((row) => Date.parse(row.created_at));
    const sorted = [...stamps].sort((a, b) => b - a);
    expect(stamps).toEqual(sorted);
  });

  it("٦) الحدُّ يُحتَرَمُ، و`has_more` تُعلَنُ معَ مؤشِّرٍ صالحٍ", async () => {
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 2 });
    expect(payload.rides).toHaveLength(2);
    expect(payload.has_more).toBe(true);
    expect(payload.next_cursor?.id).toBe(payload.rides?.[1]?.order_id);
    expect(payload.next_cursor?.created_at).toBe(payload.rides?.[1]?.created_at);
  });

  it("٧) الصفحةُ الأخيرةُ تُعلِنُ `has_more: false` وتُعطي مؤشِّراً عَدَماً", async () => {
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 50 });
    expect(payload.has_more).toBe(false);
    expect(payload.next_cursor).toBeNull();
  });

  it("٨) الصفحاتُ المتتابعةُ تُعطي كلَّ رحلةٍ **مرّةً واحدةً**", async () => {
    const seen: string[] = [];
    let cursor: { created_at: string; id: string } | null = null;
    for (let page = 0; page < 10; page += 1) {
      const payload: HistoryPayload = await history({
        telegramId: RIDER_TELEGRAM_ID,
        beforeCreatedAt: cursor?.created_at ?? null,
        beforeId: cursor?.id ?? null,
        limit: 2,
      });
      for (const row of payload.rides ?? []) seen.push(row.order_id);
      if (payload.has_more !== true) break;
      cursor = payload.next_cursor ?? null;
      expect(cursor).not.toBeNull();
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of seededIds) expect(seen).toContain(id);
  });

  it("٩) وكتابةُ صفٍّ جديدٍ بينَ الصفحتَينِ **لا تُكرِّرُ ولا تُسقِطُ** — وهذا حكمُ المفتاحِ لا الإزاحةِ", async () => {
    const first = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 2 });
    const firstIds = (first.rides ?? []).map((row) => row.order_id);

    // رحلةٌ أحدثُ من كلِّ ما مضى تُكتَبُ **بينَ** قراءتَي الصفحتَينِ.
    // ومعَ الإزاحةِ لَانزاحَ كلُّ شيءٍ صفّاً فتكرَّرَ آخرُ صفٍّ في الأولى.
    const intruder = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      createdMinutesAgo: 1,
    });

    const second = await history({
      telegramId: RIDER_TELEGRAM_ID,
      beforeCreatedAt: first.next_cursor?.created_at ?? null,
      beforeId: first.next_cursor?.id ?? null,
      limit: 2,
    });
    const secondIds = (second.rides ?? []).map((row) => row.order_id);

    for (const id of secondIds) expect(firstIds).not.toContain(id);
    expect([...firstIds, ...secondIds]).not.toContain(intruder);
    await sql`delete from orders where id = ${intruder}`;
  });

  it("١٠) الحدُّ خارجَ المدى **يُرَدُّ ولا يُقصَرُ**", async () => {
    for (const limit of [0, -1, 51, 1000]) {
      const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit });
      expect(payload.ok).toBe(false);
      expect(payload.error).toBe("INVALID_LIMIT");
    }
  });

  it("١١) والحدُّ العَدَمُ يُرَدُّ كذلكَ — فالافتراضُ حكمُ المُنادي لا حكمُ القاعدةِ", async () => {
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: null });
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("INVALID_LIMIT");
  });

  it("١٢) ونصفُ مؤشِّرٍ يُرَدُّ `INVALID_CURSOR` — فلا يُخمَّنُ نصفُه الآخرُ", async () => {
    const one = await history({
      telegramId: RIDER_TELEGRAM_ID,
      beforeCreatedAt: new Date().toISOString(),
    });
    expect(one.error).toBe("INVALID_CURSOR");
    const two = await history({ telegramId: RIDER_TELEGRAM_ID, beforeId: seededIds[0] ?? null });
    expect(two.error).toBe("INVALID_CURSOR");
  });
});

describeIf("السجلُّ — منطقةُ الشهرِ من الإعدادِ لا من الجهازِ", () => {
  it("١٣) المنطقةُ تُقرأُ من `platform_settings` ومصدرُها `CITY_SETTING`", async () => {
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID });
    expect(payload.month_timezone).toBe("Asia/Riyadh");
    expect(payload.month_timezone_source).toBe("CITY_SETTING");
  });

  it("١٤) و`month_key` يُحسَبُ بتلكَ المنطقةِ — فرحلةُ الساعاتِ الأولى في شهرِ المدينةِ", async () => {
    // لحظةٌ في أوَّلِ سبتمبرَ بتوقيتِ الرياضِ وهيَ في أغسطسَ بـUTC.
    const edge = await seedOrder({
      riderId,
      status: "completed",
      createdAt: "2026-08-31T21:30:00Z",
    });
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, limit: 50 });
    const row = (payload.rides ?? []).find((item) => item.order_id === edge);
    expect(row?.month_key).toBe("2026-09");
    expect(new Date(row?.created_at ?? "").toISOString()).toBe("2026-08-31T21:30:00.000Z");
    await sql`delete from orders where id = ${edge}`;
  });

  it("١٥) والإعدادُ المجهولُ يُعلَنُ سقوطاً بمصدرٍ مُسمًّى ولا يُسكَتُ عنه", async () => {
    // القيمةُ تُلتَقَطُ **نصّاً داخليّاً** (`#>> '{}'`) وتُعادُ بـ`to_jsonb`:
    // فتمريرُ نصِّ `value::text` كمُعامِلٍ إلى `::jsonb` يُرمِّزُه المُشغِّلُ
    // ترميزاً ثانياً فيصيرُ `"\"Asia/Riyadh\""` — قيمةٌ صحيحةُ النوعِ
    // فاسدةُ المعنى، تُفسِدُ ما بعدَها من قياساتٍ. وهوَ عطبُ مقياسٍ لا مَقيسٍ.
    const [before] = await sql<{ value: string }[]>`
      select value #>> '{}' as value from platform_settings
       where city_id = ${cityId} and key = 'ride_history_month_timezone'
    `;
    await sql`
      update platform_settings set value = '"Mars/Olympus"'::jsonb
       where city_id = ${cityId} and key = 'ride_history_month_timezone'
    `;
    try {
      const payload = await history({ telegramId: RIDER_TELEGRAM_ID });
      expect(payload.month_timezone).toBe("UTC");
      expect(payload.month_timezone_source).toBe("FALLBACK_UTC_SETTING_UNKNOWN");
    } finally {
      await sql`
        update platform_settings set value = to_jsonb(${before?.value ?? "Asia/Riyadh"}::text)
         where city_id = ${cityId} and key = 'ride_history_month_timezone'
      `;
    }
  });

  it("١٦) والإعدادُ الغائبُ يُعلَنُ سقوطاً بمصدرٍ آخرَ مفصولٍ", async () => {
    // يُلتَقَطُ الصفُّ **بحقولِه التي لا تقبلُ العدمَ** لا بقيمتِه وحدَها:
    // `description_ar` في `platform_settings` `not null`، فإعادةُ الزرعِ بلا
    // وصفٍ تُخفِقُ بـ`23502` — وهوَ عطبُ مقياسٍ لا عطبُ مَقيسٍ.
    const [before] = await sql<{ value: string; description_ar: string }[]>`
      select value #>> '{}' as value, description_ar from platform_settings
       where city_id = ${cityId} and key = 'ride_history_month_timezone'
    `;
    await sql`
      delete from platform_settings
       where city_id = ${cityId} and key = 'ride_history_month_timezone'
    `;
    try {
      const payload = await history({ telegramId: RIDER_TELEGRAM_ID });
      expect(payload.month_timezone).toBe("UTC");
      expect(payload.month_timezone_source).toBe("FALLBACK_UTC_SETTING_ABSENT");
    } finally {
      await sql`
        insert into platform_settings
          (city_id, key, value, value_type, description_ar, is_provisional)
        values (${cityId}, 'ride_history_month_timezone',
                to_jsonb(${before?.value ?? "Asia/Riyadh"}::text), 'string',
                ${before?.description_ar ?? "المنطقةُ الزمنيّةُ التي يُحسَبُ بها عنوانُ الشهرِ في سجلِّ رحلاتِ الراكبِ (SR-09). تُنشَرُ في الردِّ نفسِه."},
                false)
        on conflict (city_id, key) do update
          set value = excluded.value, description_ar = excluded.description_ar
      `;
    }
  });
});

describeIf("السجلُّ — البحثُ على الوسمِ", () => {
  it("١٧) البحثُ يُضيِّقُ على وسمِ الانطلاقِ أو الوصولِ", async () => {
    const marked = await seedOrder({
      riderId,
      status: "completed",
      pickupLabel: "حيُّ السلامةِ",
      dropoffLabel: "مطارُ الملكِ عبدِ العزيزِ",
      createdMinutesAgo: 70,
    });
    const byPickup = await history({ telegramId: RIDER_TELEGRAM_ID, query: "السلامةِ", limit: 50 });
    expect((byPickup.rides ?? []).map((row) => row.order_id)).toEqual([marked]);
    const byDropoff = await history({ telegramId: RIDER_TELEGRAM_ID, query: "مطارُ", limit: 50 });
    expect((byDropoff.rides ?? []).map((row) => row.order_id)).toEqual([marked]);
    await sql`delete from orders where id = ${marked}`;
  });

  it("١٨) وما لا يُطابِقُ يُعطي فراغاً لا كلَّ شيءٍ", async () => {
    const payload = await history({
      telegramId: RIDER_TELEGRAM_ID,
      query: "موضعٌ لا وجودَ له",
      limit: 50,
    });
    expect(payload.rides).toEqual([]);
  });

  it("١٩) والبحثُ يبقى محكوماً بالمِلكيّةِ", async () => {
    const foreign = await seedOrder({
      riderId: otherRiderId,
      status: "completed",
      pickupLabel: "حيُّ الغريبِ",
    });
    const payload = await history({ telegramId: RIDER_TELEGRAM_ID, query: "الغريبِ", limit: 50 });
    expect((payload.rides ?? []).map((row) => row.order_id)).not.toContain(foreign);
    await sql`delete from orders where id = ${foreign}`;
  });
});

describeIf("التفاصيلُ — الحالةُ والأحداثُ", () => {
  it("٢٠) تفصيلُ رحلةٍ منتهيةٍ يحملُ السائقَ وأحداثَ الأختامِ بترتيبِها", async () => {
    const id = seededIds[0] ?? "";
    const payload = await detail(RIDER_TELEGRAM_ID, id);
    expect(payload.ok).toBe(true);
    expect(payload.found).toBe(true);
    expect(payload.order_id).toBe(id);
    expect(payload.driver?.first_name).toBe("سالم");
    const kinds = (payload.events ?? []).map((event) => event.kind);
    expect(kinds).toEqual(["REQUESTED", "MATCHED", "STARTED", "COMPLETED"]);
    const stamps = (payload.events ?? []).map((event) => Date.parse(event.at ?? ""));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    // والمصدرُ يُسمّي العمودَ لا نوعَه — فالمراجِعُ يعرفُ من أينَ جاءَ الوقتُ.
    expect((payload.events ?? []).map((event) => event.source)).toEqual([
      "orders.created_at",
      "orders.matched_at",
      "orders.started_at",
      "orders.completed_at",
    ]);
  });

  it("٢١) والأجرةُ والإيصالُ **غائبانِ من الحمولةِ** لا صفرانِ (ADR 0039 §٤)", async () => {
    const payload = await detail(RIDER_TELEGRAM_ID, seededIds[0] ?? "");
    const keys = Object.keys(payload as Record<string, unknown>);
    for (const forbidden of ["fare", "price", "amount", "receipt", "tip", "total", "currency"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("٢٢) ولا مدّةَ ولا مسافةَ ولا تقييمَ ههنا — تلكَ شاشةُ `F2-07` ولا تُكرَّرُ", async () => {
    const payload = await detail(RIDER_TELEGRAM_ID, seededIds[0] ?? "");
    const keys = Object.keys(payload as Record<string, unknown>);
    for (const absent of ["duration_seconds", "straight_line_meters", "rating"]) {
      expect(keys).not.toContain(absent);
    }
  });

  it("٢٣) ورحلةٌ لم تُطابَقْ: أحداثُها الموجودةُ وحدَها والسائقُ عَدَمٌ", async () => {
    const id = await seedOrder({ riderId, status: "searching", createdMinutesAgo: 80 });
    const payload = await detail(RIDER_TELEGRAM_ID, id);
    expect(payload.driver).toBeNull();
    expect((payload.events ?? []).map((event) => event.kind)).toEqual(["REQUESTED"]);
    await sql`delete from orders where id = ${id}`;
  });
});

describeIf("التفاصيلُ — لحظةُ الإلغاءِ من سجلِّ التدقيقِ", () => {
  it("٢٤) الإلغاءُ المكتوبُ في `audit_log` يُعطي حدثاً بلحظتِه ومصدرِه", async () => {
    const id = await seedOrder({
      riderId,
      status: "cancelled",
      createdMinutesAgo: 90,
      cancelledReason: "تأخَّرَ السائقُ",
    });
    await sql`
      insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
      values (${cityId}, ${riderUserId}, 'order.cancelled', 'order', ${id},
              ${JSON.stringify({ reason: "تأخَّرَ السائقُ", previous_status: "searching" })}::jsonb)
    `;
    const payload = await detail(RIDER_TELEGRAM_ID, id);
    const cancelled = (payload.events ?? []).find((event) => event.kind === "CANCELLED");
    expect(cancelled?.source).toBe("audit_log");
    expect(cancelled?.at).not.toBeNull();
    expect(payload.cancelled_reason).toBe("تأخَّرَ السائقُ");
    await sql`delete from audit_log where entity_id = ${id}`;
    await sql`delete from orders where id = ${id}`;
  });

  it("٢٥) وإلغاءٌ بلا صفِّ تدقيقٍ يُعطي حدثاً بـ`at: null` **لا حدثاً محذوفاً**", async () => {
    const id = await seedOrder({
      riderId,
      status: "cancelled",
      createdMinutesAgo: 95,
      cancelledReason: "بلا أثرٍ مكتوبٍ",
    });
    const payload = await detail(RIDER_TELEGRAM_ID, id);
    const cancelled = (payload.events ?? []).find((event) => event.kind === "CANCELLED");
    expect(cancelled).toBeDefined();
    expect(cancelled?.at).toBeNull();
    expect(cancelled?.source).toBe("UNRECORDED");
    await sql`delete from orders where id = ${id}`;
  });
});

describeIf("التفاصيلُ — المِلكيّةُ والرفضُ", () => {
  it("٢٦) رحلةُ راكبٍ آخرَ تُرَدُّ `ORDER_NOT_FOUND` من القاعدةِ نفسِها", async () => {
    const foreign = await seedOrder({ riderId: otherRiderId, status: "completed" });
    const payload = await detail(RIDER_TELEGRAM_ID, foreign);
    expect(payload.found).toBe(false);
    expect(payload.refusal).toBe("ORDER_NOT_FOUND");
    // ولا يُفرَّقُ بينَ «ليست لكَ» و«لا وجودَ لها»: الفرقُ يُفشي وجودَ رحلةٍ.
    const absent = await detail(RIDER_TELEGRAM_ID, crypto.randomUUID());
    expect(absent.refusal).toBe("ORDER_NOT_FOUND");
    await sql`delete from orders where id = ${foreign}`;
  });

  it("٢٧) والطلبُ العَدَمُ يُرَدُّ `INVALID_ORDER_ID`", async () => {
    const [row] = await sql<{ result: DetailPayload }[]>`
      select rider_ride_detail(${RIDER_TELEGRAM_ID}::bigint, null::uuid) as result
    `;
    expect(row?.result.ok).toBe(false);
    expect(row?.result.error).toBe("INVALID_ORDER_ID");
  });

  it("٢٨) ومَن ليسَ راكباً يُرَدُّ قبلَ أيِّ قراءةِ طلبٍ", async () => {
    const payload = await detail(DRIVER_TELEGRAM_ID, seededIds[0] ?? "");
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("RIDER_NOT_REGISTERED");
    const absent = await detail(ABSENT_TELEGRAM_ID, seededIds[0] ?? "");
    expect(absent.error).toBe("USER_NOT_FOUND");
  });
});

describeIf("سطحُ الصلاحيّاتِ لدالّتَي البندِ", () => {
  it("٢٩) لا يُنفِّذُهما `anon` ولا `authenticated` ولا `public`", async () => {
    const rows = await sql<{ name: string; anon: boolean; authenticated: boolean }[]>`
      select p.proname as name,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('rider_ride_history', 'rider_ride_detail')
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect({ name: row.name, anon: row.anon, authenticated: row.authenticated }).toEqual({
        name: row.name,
        anon: false,
        authenticated: false,
      });
    }
  });

  it("٣٠) وكلتاهما قراءةٌ: `stable security invoker` لا `definer`", async () => {
    const rows = await sql<{ name: string; secdef: boolean; volatility: string }[]>`
      select proname as name, prosecdef as secdef, provolatile as volatility
        from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('rider_ride_history', 'rider_ride_detail')
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect({ name: row.name, secdef: row.secdef, volatility: row.volatility }).toEqual({
        name: row.name,
        secdef: false,
        volatility: "s",
      });
    }
  });

  it("٣١) وإعدادُ المنطقةِ مزروعٌ نهائيّاً لا مؤقَّتاً — فلا يُقرأُ ظنّاً", async () => {
    const [row] = await sql<{ value: string; kind: string; provisional: boolean }[]>`
      select value #>> '{}' as value, value_type as kind, is_provisional as provisional
        from platform_settings
       where city_id = ${cityId} and key = 'ride_history_month_timezone'
    `;
    expect(row?.value).toBe("Asia/Riyadh");
    expect(row?.kind).toBe("string");
    expect(row?.provisional).toBe(false);
  });
});
