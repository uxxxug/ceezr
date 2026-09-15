/**
 * الغرض: قياسُ حصيلةِ السائقِ على PostgreSQL حقيقيٍّ — **المقامُ من صفوفٍ لا من
 *   شِعارٍ**، والنافذةُ بمنطقةِ زمنِ المدينةِ، والتواجدُ من أزواجِ التبديلِ،
 *   وعواملُ الترتيبِ من نفسِ الإعداداتِ التي تقرأُها المطابَقةُ (البند `F3-05`).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — البند `F3-05`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ولِمَ على قاعدةٍ حقيقيّةٍ: كلُّ رقمٍ ههنا **مجموعُ صفوفٍ بشرطِ نافذةٍ**، وقياسُه
 * بمُهايِئٍ مصنوعٍ يقيسُ الكاذبَ نفسَه الذي كُتِبَ الحاجزُ لمنعِه: `count` على
 * شرطٍ خاطئٍ يُرجِعُ رقماً يُقرأُ صحيحاً ولا يسقُطُ به شيءٌ.
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ شاشةً ولا مُضيفَ تلغرامَ**: المُحوِّلاتُ في `tests/unit`.
 * - **لا يقيسُ صدقَ منطقةِ زمنٍ في كلِّ مدينةٍ**: يقيسُ أنَّ الحدَّ يُحسَبُ بها
 *   وأنَّ غيابَها **رفضٌ مُسمّىً** لا نافذةٌ مُخترَعةٌ.
 * - **لا يدَّعي مبلغاً**: المالُ مفتاحٌ مُعلَنُ الغيابِ، ويُقاسُ أنَّه معدومٌ.
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
const DRIVER_TELEGRAM_ID = 900_000_371;
const RIDER_TELEGRAM_ID = 900_000_372;
const STRANGER_TELEGRAM_ID = 900_000_373;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

const KEY_TIMEZONE = "city_timezone";
const KEY_TRUST = "rating_min_count_for_trust";
const KEY_WEIGHT_AREA = "match_weight_preferred_area";

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let riderUserId = "";
let riderId = "";
let strangerUserId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function summary(telegramId: number, period: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_activity_summary(${telegramId}::bigint, ${period}::text) as result
  `);
}

function entries(telegramId: number, period: string, limit: number | null): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_activity_entries(${telegramId}::bigint, ${period}::text, ${limit}::int) as result
  `);
}

function block(payload: Payload, key: string): Record<string, unknown> {
  const value = payload[key];
  if (value === null || typeof value !== "object") throw new Error(`لا كتلةَ «${key}»`);
  return value as Record<string, unknown>;
}

async function setSetting(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
): Promise<void> {
  if (value === null) {
    await sql`delete from platform_settings where city_id = ${cityId} and key = ${key}`;
    return;
  }
  const json =
    valueType === "number"
      ? sql`to_jsonb(${Number(value)}::numeric)`
      : sql`to_jsonb(${String(value)}::text)`;
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar)
    values (${cityId}, ${key}, ${json}, ${valueType}, 'قياسٌ')
    on conflict (city_id, key) do update set value = ${json}, value_type = ${valueType}
  `;
}

/**
 * لقطةُ إعدادٍ **كما وُجِدَ** — قيمةً ونوعاً أو غياباً. وهيَ الفرقُ بينَ إرجاعِ
 * الحالِ وبينَ **اختراعِ** قيمةٍ «معقولةٍ» في `finally`: أوزانُ المطابَقةِ يجبُ أن
 * يكونَ مجموعُها واحداً، فوزنٌ يُكتَبُ 0.2 حيثُ لم يكن شيءٌ يُفسِدُ كلَّ ما يقرأُ
 * إعداداتَ المدينةِ بعدَ هذا الملفِّ — وهوَ عطبٌ **يظهرُ في ملفٍّ آخرَ** فيُقرأُ
 * عطبَ غيرِنا.
 */
interface SettingSnapshot {
  readonly key: string;
  /** القيمةُ **مُقشَّرةً** نصّاً (`#>> '{}'`) أو `null` إن لم يكن للمفتاحِ صفٌّ. */
  readonly text: string | null;
  readonly valueType: "string" | "number" | null;
}

const snapshots = new Map<string, SettingSnapshot>();

/**
 * تُقرأُ القيمةُ **مُقشَّرةً** لا بـ`value::text`: الأخيرةُ تُعيدُ نصَّ JSON
 * (`"Asia/Riyadh"` بعلامتَي تنصيصٍ)، ورَدُّه معامِلاً يُغلَّفُ مرّةً أخرى فيصيرُ
 * الإرجاعُ **إفساداً متزايداً** في كلِّ تشغيلٍ. فالطريقُ الواحدُ للكتابةِ هوَ
 * `setSetting` نفسُه — مصدرُ تحويلٍ واحدٌ لا اثنانِ.
 */
async function snapshotSetting(key: string): Promise<SettingSnapshot> {
  const existing = snapshots.get(key);
  if (existing !== undefined) return existing;
  const [row] = await sql<{ text: string; value_type: string }[]>`
    select value #>> '{}' as text, value_type
      from platform_settings
     where city_id = ${cityId} and key = ${key}
  `;
  let snapshot: SettingSnapshot;
  if (row === undefined) {
    snapshot = { key, text: null, valueType: null };
  } else {
    if (row.value_type !== "string" && row.value_type !== "number") {
      throw new Error(`نوعٌ لا يُرجِعُه هذا الملفُّ: ${key}=${row.value_type}`);
    }
    snapshot = { key, text: row.text, valueType: row.value_type };
  }
  snapshots.set(key, snapshot);
  return snapshot;
}

async function restoreSetting(snapshot: SettingSnapshot): Promise<void> {
  if (snapshot.valueType === null || snapshot.text === null) {
    await setSetting(snapshot.key, null, "string");
    return;
  }
  const value = snapshot.valueType === "number" ? Number(snapshot.text) : snapshot.text;
  await setSetting(snapshot.key, value, snapshot.valueType);
}

async function restoreSnapshots(): Promise<void> {
  for (const snapshot of snapshots.values()) await restoreSetting(snapshot);
  snapshots.clear();
}

/**
 * بصمةُ **كلِّ** إعداداتِ المدينةِ — تُقاسُ قبلَ الملفِّ وبعدَه فلا يُغادِرُ الملفُّ
 * أثراً. والفحصُ هنا لا في مكانٍ عامٍّ لأنَّ العطبَ الذي وقعَ ظهرَ في ملفٍّ آخرَ
 * فقُرِئَ عطبَ غيرِنا؛ فمَن يُبدِّلُ إعداداً يُثبِتُ بنفسِه أنَّه أرجعَه.
 */
async function settingsDigest(): Promise<string> {
  const rows = await sql<{ key: string; text: string; value_type: string }[]>`
    select key, value::text as text, value_type
      from platform_settings
     where city_id = ${cityId}
     order by key
  `;
  return rows.map((row) => `${row.key}=${row.text}:${row.value_type}`).join("\n");
}

let settingsDigestBefore = "";

/**
 * تُبدِّلُ إعداداً لمُدّةِ فحصٍ واحدٍ ثمَّ **تُرجِعُ ما كانَ** — لا ما نحسبُه
 * صواباً. وهذا فرقٌ قِيسَ لا فرقٌ نظريٌّ: وزنُ المنطقةِ المُفضَّلةِ في المدينةِ
 * **صفرٌ** بذراً، فكتابةُ 0.2 في `finally` جعلَت مجموعَ الأوزانِ 1.2 فسقطَ
 * `INCONSISTENT_WEIGHTS` في **ملفٍّ آخرَ** (`scheduled-jobs`) بعدَ هذا الملفِّ —
 * عطبٌ يُقرأُ عطبَ غيرِنا.
 */
async function withSetting<T>(
  key: string,
  value: string | number | null,
  valueType: "string" | "number",
  body: () => Promise<T>,
): Promise<T> {
  const snapshot = await snapshotSetting(key);
  await setSetting(key, value, valueType);
  try {
    return await body();
  } finally {
    snapshots.set(key, snapshot);
    await restoreSetting(snapshot);
  }
}

/** رحلةٌ **مُكتمِلةٌ** بأختامِها وعرضٌ مقبولٌ لها — الحالةُ تُصنَعُ بالإيكالِ الحقيقيِّ. */
async function seedCompletedRide(options: {
  readonly completedAt: string;
  readonly startedAt: string | null;
  readonly distanceKm: number | null;
}): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'دوّارُ الانطلاقِ', 'بوّابةُ الوجهةِ'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at, distance_km)
    values (${cityId}, ${order.id}, ${driverId}, 1, 'pending'::offer_status,
            now() + make_interval(secs => 120), ${options.distanceKm})
  `;
  const claim = await callJson(sql<{ result: Payload }[]>`
    select claim_ride(${order.id}::uuid, ${driverId}::uuid) as result
  `);
  if (claim.ok !== true) throw new Error(`تعذّر الإيكالُ: ${String(claim.error)}`);
  await sql`
    update orders
       set status = 'completed'::order_status,
           started_at = ${options.startedAt}::timestamptz,
           completed_at = ${options.completedAt}::timestamptz
     where id = ${order.id}
  `;
  return order.id;
}

/** عرضٌ **لم يُقبَلْ** — يزيدُ المقامَ وحدَه فيُقاسُ أنَّ المقامَ ليسَ البَسْطَ. */
async function seedPendingOffer(): Promise<void> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'مبدأٌ ثانٍ', 'وجهةٌ ثانيةٌ'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ الثاني");
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, 'expired'::offer_status,
            now() - make_interval(secs => 10))
  `;
}

async function clearOrders(): Promise<void> {
  await sql`
    delete from notification_outbox
     where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`
    delete from ratings where order_id in (select id from orders where rider_id = ${riderId})
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

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الحصيلةِ', '+966500000371')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = user.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ح ص ل 371')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
  await sql`
    insert into driver_availability (driver_id, city_id, is_available)
    values (${driverId}, ${cityId}, true)
    on conflict (driver_id) do update set is_available = true
  `;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبةُ الحصيلةِ', '+966500000372', 'ar')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;

  // حسابٌ **ليسَ سائقاً** — يُقاسُ به أنَّ الرفضَ مُصنَّفٌ لا تقريرٌ فارغٌ.
  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}, 'rider', 'قارئٌ غريبٌ', '+966500000373')
    returning id
  `;
  if (stranger === undefined) throw new Error("تعذّر زرعُ الغريبِ");
  strangerUserId = stranger.id;

  settingsDigestBefore = await settingsDigest();
  await snapshotSetting(KEY_TIMEZONE);
  await setSetting(KEY_TIMEZONE, "Asia/Riyadh", "string");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  if (driverId !== "") {
    await sql`delete from notification_outbox where driver_id = ${driverId}`;
    await sql`delete from order_offers where driver_id = ${driverId}`;
    await sql`delete from attendance_log where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from driver_documents where driver_id = ${driverId}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [driverUserId, riderUserId, strangerUserId]) {
    if (id === "") continue;
    await sql`delete from ratings where ratee_user_id = ${id} or rater_user_id = ${id}`;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreSnapshots();
  await restoreCityBaseline(sql, cityHandle);
  const settingsDigestAfter = await settingsDigest();
  const settingsClean = settingsDigestAfter === settingsDigestBefore;
  await sql.end();
  if (!settingsClean) {
    throw new Error("إعداداتُ المدينةِ لم تُرجَع كما كانت — تلويثٌ يسقُطُ على ملفٍّ آخرَ");
  }
});

describeIf("النافذةُ — حقيقةُ خادمٍ بمنطقةِ زمنٍ منشورةٍ", () => {
  it("١) مُدّةٌ مجهولةٌ ⇒ رفضٌ مُسمّىً لا نافذةٌ مُخترَعةٌ", async () => {
    const [row] = await sql<{ result: unknown }[]>`
      select driver_activity_window('year'::text, 'Asia/Riyadh'::text, now()) as result
    `;
    expect(row?.result).toBeNull();
  });

  it("٢) منطقةُ زمنٍ غائبةٌ ⇒ لا نافذةَ — والحدُّ لا يُستبدَلُ بـUTC", async () => {
    const [row] = await sql<{ result: unknown }[]>`
      select driver_activity_window('day'::text, null::text, now()) as result
    `;
    expect(row?.result).toBeNull();
  });

  it("٣) النافذةُ `[from, to)` ومنطقةُ الزمنِ معَها لتُعرَضَ", async () => {
    const [row] = await sql<{ result: Payload }[]>`
      select driver_activity_window('day'::text, 'Asia/Riyadh'::text,
                                    '2026-09-15T22:30:00Z'::timestamptz) as result
    `;
    const window = row?.result;
    if (window === undefined) throw new Error("لا نافذةَ");
    expect(window.period).toBe("day");
    expect(window.timezone).toBe("Asia/Riyadh");
    // ٢٢:٣٠ بتوقيتِ UTC هيَ الواحدةُ والنصفُ من صباحِ ١٦ سبتمبر بتوقيتِ الرياضِ،
    // فحدُّ «اليومِ» ٢١:٠٠Z من ١٥ سبتمبر — ولو حُسِبَ بـUTC لَبدأَ يوماً كاملاً قبلَه.
    expect(String(window.from)).toContain("2026-09-15");
    expect(new Date(String(window.to)).getTime()).toBeGreaterThan(
      new Date(String(window.from)).getTime(),
    );
  });

  it("٤) إعدادُ منطقةِ الزمنِ غائبٌ ⇒ `WINDOW_UNRESOLVED` لا أرقامٌ على نافذةٍ خاطئةٍ", async () => {
    await withSetting(KEY_TIMEZONE, null, "string", async () => {
      const result = await summary(DRIVER_TELEGRAM_ID, "day");
      expect(result).toEqual({ ok: false, error: "WINDOW_UNRESOLVED" });
      const log = await entries(DRIVER_TELEGRAM_ID, "day", 10);
      expect(log).toEqual({ ok: false, error: "WINDOW_UNRESOLVED" });
    });
  });
});

describeIf("الملكيّةُ — تقريرٌ عن نفسِه وحدَه", () => {
  it("٥) حسابٌ لا صفَّ له ⇒ `USER_NOT_FOUND`", async () => {
    expect(await summary(900_000_999, "day")).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });

  it("٦) حسابٌ ليسَ سائقاً ⇒ `NOT_A_DRIVER` لا تقريرٌ فارغٌ", async () => {
    expect(await summary(STRANGER_TELEGRAM_ID, "day")).toEqual({
      ok: false,
      error: "NOT_A_DRIVER",
    });
    expect(await entries(STRANGER_TELEGRAM_ID, "day", 5)).toEqual({
      ok: false,
      error: "NOT_A_DRIVER",
    });
  });

  it("٧) مُدّةٌ خارجَ المجالِ تُرفَضُ في القاعدةِ أيضاً — لا في الطبقةِ وحدَها", async () => {
    expect(await summary(DRIVER_TELEGRAM_ID, "decade")).toEqual({
      ok: false,
      error: "WINDOW_UNRESOLVED",
    });
  });
});

describeIf("المقامُ — من صفوفٍ لا من شِعارٍ", () => {
  it("٨) بلا عرضٍ ألبتّةَ ⇒ مقامٌ صفرٌ و`rate` معدومٌ — لا صفرٌ يُقرأُ حكماً", async () => {
    await clearOrders();
    const result = await summary(DRIVER_TELEGRAM_ID, "day");
    expect(result.ok).toBe(true);
    expect(block(result, "acceptance")).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(block(result, "cancellation")).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(block(result, "rides")).toEqual({ completed: 0 });
  });

  it("٩) عرضٌ مقبولٌ وعرضٌ منتهٍ ⇒ ١ من ٢ بمقامٍ منشورٍ", async () => {
    await clearOrders();
    await seedCompletedRide({
      completedAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - 1_500_000).toISOString(),
      distanceKm: 4.2,
    });
    await seedPendingOffer();
    const result = await summary(DRIVER_TELEGRAM_ID, "day");
    expect(block(result, "acceptance")).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(block(result, "rides")).toEqual({ completed: 1 });
  });

  it("١٠) مقامُ الإلغاءِ **ما قبِلَه** لا ما عُرِضَ عليه — فلا تخفُّ بكثرةِ العروضِ", async () => {
    await clearOrders();
    await seedCompletedRide({
      completedAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      distanceKm: null,
    });
    await seedPendingOffer();
    await seedPendingOffer();
    const cancellation = block(await summary(DRIVER_TELEGRAM_ID, "day"), "cancellation");
    expect(cancellation.denominator).toBe(1);
  });

  it("١١) رحلةٌ خارجَ النافذةِ لا تُحسَبُ — الحدُّ شرطٌ لا زينةٌ", async () => {
    await clearOrders();
    await seedCompletedRide({
      completedAt: "2026-01-05T09:00:00Z",
      startedAt: "2026-01-05T08:30:00Z",
      distanceKm: 3,
    });
    expect(block(await summary(DRIVER_TELEGRAM_ID, "day"), "rides")).toEqual({ completed: 0 });
    const log = await entries(DRIVER_TELEGRAM_ID, "day", 10);
    expect(log.entries).toEqual([]);
  });
});

describeIf("التقييمُ وعواملُ الترتيبِ — من مصادرِ الإسنادِ نفسِها", () => {
  it("١٢) لا تقييمَ بعدُ ⇒ متوسّطٌ معدومٌ لا صفرُ نجومٍ", async () => {
    const rating = block(await summary(DRIVER_TELEGRAM_ID, "month"), "rating");
    expect(rating.average).toBeNull();
    expect(rating.count).toBe(0);
  });

  it("١٣) حدُّ ثقةٍ غيرُ مضبوطٍ ⇒ `below_trust` معدومٌ — لا حدَّ يُخترَعُ", async () => {
    await withSetting(KEY_TRUST, null, "number", async () => {
      const rating = block(await summary(DRIVER_TELEGRAM_ID, "day"), "rating");
      expect(rating.trust_min_count).toBeNull();
      expect(rating.below_trust).toBeNull();
    });
  });

  it("١٤) تقييمٌ مَوسومٌ (`is_flagged`) لا يدخلُ المتوسّطَ — كما يستثنيهِ الإسنادُ", async () => {
    await clearOrders();
    const orderId = await seedCompletedRide({
      completedAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - 900_000).toISOString(),
      distanceKm: 2.5,
    });
    await sql`
      insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id, stars)
      values (${cityId}, ${orderId}, 'rider_to_driver'::rating_direction,
              ${riderUserId}, ${driverUserId}, 5)
    `;
    const before = block(await summary(DRIVER_TELEGRAM_ID, "day"), "rating");
    expect(before.count).toBe(1);
    expect(Number(before.average)).toBe(5);

    await sql`update ratings set is_flagged = true where order_id = ${orderId}`;
    const after = block(await summary(DRIVER_TELEGRAM_ID, "day"), "rating");
    expect(after.count).toBe(0);
    expect(after.average).toBeNull();
  });

  it("١٥) العواملُ ثلاثٌ بأوزانِها، ووزنٌ غائبٌ `null` لا صفرٌ", async () => {
    await withSetting(KEY_WEIGHT_AREA, null, "number", async () => {
      const ranking = block(await summary(DRIVER_TELEGRAM_ID, "day"), "ranking");
      const factors = ranking.factors as { key: string; weight: number | null }[];
      expect(factors.map((factor) => factor.key)).toEqual([
        "PROXIMITY",
        "RATING",
        "PREFERRED_AREA",
      ]);
      expect(factors[2]?.weight).toBeNull();
      // **الحقيقةُ كما هيَ**: معادلةُ النقاطِ اليومَ لا تقرأُ سلوكاً.
      expect(ranking.behaviour_affects_ranking).toBe(false);
    });
  });

  it("١٦) المالُ مفتاحٌ **مُعلَنُ الغيابِ** بسببِه لا صفرٌ ولا وعدٌ", async () => {
    expect(block(await summary(DRIVER_TELEGRAM_ID, "day"), "money")).toEqual({
      amount: null,
      basis: "NOT_INTERMEDIATED",
    });
  });
});

describeIf("التواجدُ — من أزواجِ التبديلِ لا من عدَّادٍ مخزونٍ", () => {
  it("١٧) ساعةٌ متاحةٌ داخلَ النافذةِ ⇒ ٣٦٠٠ ثانيةً تقريباً وفترةٌ مغلقةٌ", async () => {
    await sql`delete from attendance_log where driver_id = ${driverId}`;
    const from = "2026-09-14T06:00:00Z";
    const to = "2026-09-14T09:00:00Z";
    await sql`
      insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
      values (${cityId}, ${driverId}, true, 'test', '2026-09-14T07:00:00Z'::timestamptz),
             (${cityId}, ${driverId}, false, 'test', '2026-09-14T08:00:00Z'::timestamptz)
    `;
    const [row] = await sql<{ result: Payload }[]>`
      select driver_attendance_seconds(${driverId}::uuid, ${from}::timestamptz,
                                       ${to}::timestamptz, now()) as result
    `;
    expect(row?.result.available_seconds).toBe(3600);
    expect(row?.result.open).toBe(false);
  });

  it("١٨) تبديلٌ قبلَ النافذةِ يُقصُّ على حدِّها — لا ثانيةً من قبلِها", async () => {
    await sql`delete from attendance_log where driver_id = ${driverId}`;
    await sql`
      insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
      values (${cityId}, ${driverId}, true, 'test', '2026-09-14T04:00:00Z'::timestamptz)
    `;
    const [row] = await sql<{ result: Payload }[]>`
      select driver_attendance_seconds(${driverId}::uuid,
                                       '2026-09-14T06:00:00Z'::timestamptz,
                                       '2026-09-14T09:00:00Z'::timestamptz,
                                       '2026-09-14T09:00:00Z'::timestamptz) as result
    `;
    expect(row?.result.available_seconds).toBe(10_800);
  });

  it("١٩) نافذةٌ جاريةٌ وسائقٌ متاحٌ ⇒ `open` صادقةٌ — الرقمُ ما زالَ يزيدُ", async () => {
    await sql`delete from attendance_log where driver_id = ${driverId}`;
    await sql`
      insert into attendance_log (city_id, driver_id, is_available, source, changed_at)
      values (${cityId}, ${driverId}, true, 'test', now() - make_interval(mins => 30))
    `;
    const attendance = block(await summary(DRIVER_TELEGRAM_ID, "day"), "attendance");
    expect(attendance.open).toBe(true);
    expect(Number(attendance.available_seconds)).toBeGreaterThan(1500);
  });
});

describeIf("جدولُ الرحلاتِ — أختامٌ ومسافةٌ موسومةٌ وبلا هويّةِ راكبٍ", () => {
  it("٢٠) صفٌّ بمسافةٍ موسومةٍ ومُدّةٍ من ختمِ البدءِ", async () => {
    await clearOrders();
    await seedCompletedRide({
      completedAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - 1_500_000).toISOString(),
      distanceKm: 4.2,
    });
    const log = await entries(DRIVER_TELEGRAM_ID, "day", 10);
    const rows = log.entries as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.service).toBe("transport");
    expect(Number(row.duration_seconds)).toBe(1500);
    expect(row.distance).toEqual({ km: 4.2, basis: "STRAIGHT_LINE" });
    // **لا هويّةَ راكبٍ ولا أجرةَ** في الحمولةِ — الصفُّ سجلُّ السائقِ عن نفسِه.
    for (const forbidden of ["rider_id", "rider_name", "rider_phone", "phone", "fare", "price"]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });

  it("٢١) ختمُ بدءٍ غائبٌ ⇒ مُدّةٌ معدومةٌ لا صفرُ ثوانٍ", async () => {
    await clearOrders();
    await seedCompletedRide({
      completedAt: new Date().toISOString(),
      startedAt: null,
      distanceKm: null,
    });
    const rows = (await entries(DRIVER_TELEGRAM_ID, "day", 10)).entries as Record<
      string,
      unknown
    >[];
    expect(rows[0]?.duration_seconds).toBeNull();
    expect(rows[0]?.distance).toBeNull();
  });

  it("٢٢) السقفُ مقصورٌ في الخادمِ: خرافيٌّ ⇒ ٥٠، ومعدومٌ ⇒ ٢٠، وصفرٌ ⇒ ١", async () => {
    expect((await entries(DRIVER_TELEGRAM_ID, "day", 5000)).limit).toBe(50);
    expect((await entries(DRIVER_TELEGRAM_ID, "day", null)).limit).toBe(20);
    expect((await entries(DRIVER_TELEGRAM_ID, "day", 0)).limit).toBe(1);
  });

  it("٢٣) الجدولُ مرتَّبٌ بالأحدثِ أوّلاً — قراءةٌ لا بحثٌ", async () => {
    await clearOrders();
    const older = new Date(Date.now() - 7_200_000).toISOString();
    const newer = new Date(Date.now() - 600_000).toISOString();
    await seedCompletedRide({ completedAt: older, startedAt: null, distanceKm: null });
    await seedCompletedRide({ completedAt: newer, startedAt: null, distanceKm: null });
    const rows = (await entries(DRIVER_TELEGRAM_ID, "day", 10)).entries as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(2);
    const first = new Date(String(rows[0]?.completed_at)).getTime();
    const second = new Date(String(rows[1]?.completed_at)).getTime();
    expect(first).toBeGreaterThan(second);
  });
});
