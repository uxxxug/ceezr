/**
 * الغرض: إثباتُ تقييمِ الراكبِ الإحصائيّ على لوحِ عروضِ السائقِ (`WR-30`) على
 *   قاعدةٍ PostgreSQL حقيقيةٍ: من عمودَي `riders.rating_average/rating_count`
 *   إلى بطاقةِ اللوحِ وتفاصيلِ العرضِ — ولا هويّةَ راكبٍ في شيءٍ من ذلك.
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيةٍ — البندُ `WR-30`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 *
 * ## ما يُثبِتُه هذا الملفُّ
 *
 * 1. **راكبٌ مُقيَّمٌ**: عرضٌ مفتوحٌ على طلبِهِ تُقرأُ بطاقتُهُ من اللوحِ فتحملُ
 *    `riderRating` كما في القاعدةِ حرفاً — وتفاصيلُ العرضِ كالبطاقةِ سواءً.
 * 2. **راكبٌ بلا تقييمٍ بعدُ** (`rating_count = 0`): لا مفتاحَ لا صفرَ — فلا يُقالُ
 *    عن بريءٍ «صفرُ نجومٍ».
 * 3. **قراءةُ الملاحقِ وحدَها** (`readOrderPlaceExtras`) تُخرِجُ التقييمَ من
 *    `riders` بالانضمامِ نفسِهِ الذي يقرأُ به اللوحُ الموحّدُ.
 *
 * ## وما لا يقيسُه عن قصدٍ
 *
 * - لا يقيسُ مسارَ HTTP ولا الجلسةَ: في `tests/unit`.
 * - لا يقيسُ إعادةَ حسابِ المعدَّلِ (`recompute_ratee_averages`): مقيسةٌ في
 *   اختباراتِ التقييمِ (f2_07) — هذا الملفُّ يقرأُ ما حُسِبَ فحسب.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDriverOfferStore } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import { readOrderPlaceExtras } from "../../packages/infrastructure/transport/order-place-extras.ts";
import { ensureActiveCity, restoreCityBaseline } from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_001_341;
const RATED_RIDER_TELEGRAM_ID = 900_001_342;
const FRESH_RIDER_TELEGRAM_ID = 900_001_343;

const PICKUP = { lat: 21.4858, lng: 39.1925 };

let sql: Sql;
let cityHandle: ReturnType<typeof ensureActiveCity> extends Promise<infer T> ? T : never;
let cityId: string;
let driverId: string;
let driverUserId = "";
let ratedRiderId = "";
let ratedRiderUserId = "";
let freshRiderId = "";
let freshRiderUserId = "";
let ratedOrderId = "";
let freshOrderId = "";
let offerId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql);
  cityId = cityHandle.cityId;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ تقييمِ الراكبِ', '+966500001341')
    returning id`;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ع ر ض 1341')
    returning id`;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  const [ratedRiderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RATED_RIDER_TELEGRAM_ID}, 'rider', 'راكبٌ مُقيَّمٌ', '+966500001342')
    returning id`;
  if (ratedRiderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ المُقيَّمِ");
  ratedRiderUserId = ratedRiderUser.id;
  // الحقلانِ يُزرعانِ كما كتبَهُما `recompute_ratee_averages` — لا يُعادُ الحسابُ ههنا.
  const [ratedRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id, rating_average, rating_count)
    values (${cityId}, ${ratedRiderUser.id}, 4.5, 12)
    returning id`;
  if (ratedRider === undefined) throw new Error("تعذّر زرعُ الراكبِ المُقيَّمِ");
  ratedRiderId = ratedRider.id;

  const [freshRiderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${FRESH_RIDER_TELEGRAM_ID}, 'rider', 'راكبٌ جديدٌ', '+966500001343')
    returning id`;
  if (freshRiderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ الجديدِ");
  freshRiderUserId = freshRiderUser.id;
  const [freshRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${freshRiderUser.id}) returning id`;
  if (freshRider === undefined) throw new Error("تعذّر زرعُ الراكبِ الجديدِ");
  freshRiderId = freshRider.id;

  const [ratedOrder] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
    values (
      ${cityId}, ${ratedRiderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'دوّارُ الانطلاقِ'
    ) returning id`;
  if (ratedOrder === undefined) throw new Error("تعذّر زرعُ طلبِ الراكبِ المُقيَّمِ");
  ratedOrderId = ratedOrder.id;

  const [freshOrder] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
    values (
      ${cityId}, ${freshRiderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'دوّارُ الانطلاقِ'
    ) returning id`;
  if (freshOrder === undefined) throw new Error("تعذّر زرعُ طلبِ الراكبِ الجديدِ");
  freshOrderId = freshOrder.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  for (const orderId of [ratedOrderId, freshOrderId]) {
    if (orderId === "") continue;
    await sql`delete from order_offers where order_id = ${orderId}`;
    await sql`delete from notification_outbox where order_id = ${orderId}`;
    await sql`delete from orders where id = ${orderId}`;
  }
  if (offerId !== "") await sql`delete from order_offers where id = ${offerId}`;
  if (driverId !== "") await sql`delete from order_offers where driver_id = ${driverId}`;
  for (const riderId of [ratedRiderId, freshRiderId]) {
    if (riderId === "") continue;
    await sql`delete from riders where id = ${riderId}`;
  }
  await sql`delete from audit_log where actor_user_id in (${driverUserId}, ${ratedRiderUserId}, ${freshRiderUserId})`;
  await sql`delete from users where id in (${driverUserId}, ${ratedRiderUserId}, ${freshRiderUserId})`;
  await sql`delete from drivers where id = ${driverId}`;
  await sql`delete from audit_log where actor_user_id = ${driverUserId}`;
  await sql`delete from users where id = ${driverUserId}`;
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

/** عرضٌ مفتوحٌ على الطلبِ للسائقِ — مهلةٌ منسوبةٌ إلى ساعةِ القاعدةِ. */
async function seedOpenOffer(orderId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, distance_km, status, expires_at)
    values (
      ${cityId}, ${orderId}, ${driverId}, 1, 2.5, 'pending'::offer_status,
      now() + make_interval(secs => 90)
    ) returning id`;
  if (row === undefined) throw new Error("تعذّر زرعُ العرضِ");
  return row.id;
}

describeIf("WR-30 — تقييمُ الراكبِ الإحصائيّ على لوحِ العروضِ", () => {
  // المتجرُ يُبنى داخلَ كلِّ اختبارٍ: متنُّ الوصفِ يُنفَّذُ قبلَ `beforeAll` فلا
  // يكونُ `sql` معرَّفاً بعدُ.
  const store = () => new PostgresDriverOfferStore(sql);

  it("١) راكبٌ مُقيَّمٌ: بطاقةُ اللوحِ تحملُ معدَّلَهُ وعددَهُ كما في القاعدةِ", async () => {
    offerId = await seedOpenOffer(ratedOrderId);
    const board = await store().readBoard({ telegramUserId: String(DRIVER_TELEGRAM_ID) });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const card = board.value.offers.find((c) => c.orderId === ratedOrderId);
    expect(card).toBeDefined();
    // القيمةُ من القاعدةِ نصَّاً (numeric) أو رقماً — كِلاهُما 4.5/12.
    expect(card?.riderRating).toEqual({ average: 4.5, count: 12 });
    // ولا هويّةَ في البطاقةِ: الحقلانِ الإحصائيّانِ فحسب.
    expect(card?.riderRating).not.toHaveProperty("phone");
  });

  it("٢) راكبٌ جديدٌ بلا تقييمٍ: لا مفتاحَ لا صفرَ — البطاقةُ كما هي", async () => {
    await seedOpenOffer(freshOrderId);
    const board = await store().readBoard({ telegramUserId: String(DRIVER_TELEGRAM_ID) });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const card = board.value.offers.find((c) => c.orderId === freshOrderId);
    expect(card).toBeDefined();
    expect(card?.riderRating).toBeUndefined();
    expect("riderRating" in (card ?? {})).toBe(false);
  });

  it("٣) قراءةُ الملاحقِ وحدَها تُخرِجُ التقييمَ من `riders` بالانضمامِ نفسِهِ", async () => {
    const extras = await readOrderPlaceExtras(sql, [ratedOrderId, freshOrderId]);
    expect(extras.get(ratedOrderId)?.riderRating).toEqual({ average: 4.5, count: 12 });
    expect(extras.get(freshOrderId)?.riderRating).toBeNull();
  });

  it("٤) تفاصيلُ العرضِ تحملُ التقييمَ كالبطاقةِ سواءً", async () => {
    const detail = await store().readDetail({
      telegramUserId: String(DRIVER_TELEGRAM_ID),
      offerId,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.orderId).toBe(ratedOrderId);
    expect(detail.value.riderRating).toEqual({ average: 4.5, count: 12 });
  });
});
