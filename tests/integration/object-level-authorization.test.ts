/**
 * الغرض: قياسُ **التفويضِ على مستوى الكائنِ** (`F8-08` — الضابطُ الأوّلُ) على
 *   قاعدةٍ حقيقيّةٍ: أنَّ المِلكِيَّةَ **قيدُ استفسارٍ في القاعدةِ** لا فحصٌ في
 *   طبقةٍ يمكنُ أن تُنسى، وأنَّ ردَّ «ليسَ لكَ» **لا يُميَّزُ** عن ردِّ «لا وجودَ
 *   لهُ».
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ «تكامل على PostgreSQL حقيقي»)
 * الحاكم: ADR 0132 · البند `F8-08` (الضابطُ الأوّلُ وحدَه)
 *
 * ## لِمَ لا يكفي الحاجزُ الساكنُ
 *
 * `scripts/check-object-authorization.ts` يقيسُ **شكلَ المُعالِجِ**: أنَّ هويّةَ
 * الناظرِ تُسافِرُ معَ معرِّفِ الكائنِ. وذاكَ لا يُثبِتُ أنَّ الدالّةَ في القاعدةِ
 * **استعمَلَت** الهويّةَ في قيدٍ. فههنا تُنادى الدوالُّ أنفسُها بهويّةِ غيرِ
 * المالكِ.
 *
 * ## ولِمَ يُقاسُ التماثلُ لا الرفضُ وحدَه
 *
 * رفضٌ يقولُ «ليسَ لكَ» يُخبِرُ السائلَ أنَّ الكائنَ **موجودٌ** — فيصيرُ المسارُ
 * عدّادَ وجودٍ: يُجرَّبُ معرِّفٌ بعدَ معرِّفٍ فيُعرَفُ مَن سافرَ ومتى. فالدعوى
 * ههنا: **ردُّ غيرِ المالكِ يطابقُ ردَّ المعدومِ حرفاً**.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ سطحُ HTTP**: المقيسُ القيدُ في القاعدةِ. وشكلُ المُعالِجِ يحرسُه
 *    الحاجزُ الساكنُ، ولا يُدَّعى أنَّ الاثنَينِ معاً «إثباتٌ إنتاجيٌّ» (`ح-5`).
 * ــ **لا تُقاسُ الضوابطُ الخمسةَ عشرَ الأخرى** في `F8-08`.
 * ــ `RLS` يُقاسُ في ملفٍّ آخرَ وجوداً لا أثراً: الاتّصالُ ههنا بمالكِ القاعدةِ.
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
const OWNER_RIDER_TELEGRAM_ID = 900_000_881;
const STRANGER_RIDER_TELEGRAM_ID = 900_000_882;
const OWNER_DRIVER_TELEGRAM_ID = 900_000_883;
const STRANGER_DRIVER_TELEGRAM_ID = 900_000_884;

/** معرِّفٌ سليمُ الشكلِ لا يوافقُ صفّاً — «المعدومُ» الذي يُقاسُ التماثلُ معَه. */
const ABSENT_UUID = "00000000-0000-4000-8000-000000000000";

const PICKUP = { lat: 21.4225, lng: 39.8262 } as const;
const DROPOFF = { lat: 21.3891, lng: 39.8579 } as const;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let ownerUserId = "";
let ownerRiderId = "";
let strangerUserId = "";
let strangerRiderId = "";
let ownerDriverUserId = "";
let ownerDriverId = "";
let strangerDriverUserId = "";
let strangerDriverId = "";
let orderId = "";
let completedOrderId = "";
let offerId = "";
let notificationId = "";
let outboxId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly found?: boolean;
  readonly refusal?: string;
  readonly [key: string]: unknown;
}

/**
 * **شكلا الرفضِ في المستودَعِ اثنانِ لا واحدٌ**، مقروءَينِ من الهجراتِ لا
 * مُفترَضَينِ: `{ok:false, error}` في الكاتباتِ وبعضِ القارئاتِ، و
 * `{ok:true, found:false, refusal}` في قارئاتِ `F2` (وذاكَ لأنَّ «لا رحلةَ لكَ
 * الآنَ» جوابٌ لا عطبٌ). فالمقيسُ **الرفضُ** لا حرفُ الحقلِ — والتماثلُ معَ
 * ردِّ المعدومِ هوَ ما يمنعُ عدَّ الوجودِ.
 */
function refusalCodeOf(payload: Payload): string | null {
  if (typeof payload.error === "string") return `error:${payload.error}`;
  if (payload.found === false && typeof payload.refusal === "string") {
    return `refusal:${payload.refusal}`;
  }
  return null;
}

async function callFunction(
  statement: string,
  parameters: readonly (string | number)[],
): Promise<Payload> {
  const rows = await sql.unsafe<{ result: Payload }[]>(statement, [...parameters]);
  const row = rows[0];
  if (row === undefined) throw new Error(`لا ردَّ من الدالّةِ: ${statement}`);
  return row.result;
}

/**
 * الدوالُّ المقيسةُ، وكلُّها بشكلٍ واحدٍ: هويّةُ الناظرِ أوّلاً ثمَّ معرِّفُ
 * الكائنِ. **وهذا الشكلُ نفسُه دعوى**: دالّةٌ تأخذُ المعرِّفَ وحدَه لا تستطيعُ أن
 * تقيسَ مِلكِيَّةً مهما كتبَ المُعالِجُ.
 */
interface MeasuredFunction {
  readonly name: string;
  readonly statement: string;
  /** الكائنُ المزروعُ الذي يملكُه المالكُ. */
  readonly object: () => string;
  /** هويّةُ المالكِ وهويّةُ الغريبِ. */
  readonly owner: () => number;
  readonly stranger: () => number;
  /** `true` متى كانَت الدالّةُ كاتبةً — فتُقاسُ مرّةً واحدةً بترتيبٍ محفوظٍ. */
  readonly mutates: boolean;
}

const READ_FUNCTIONS: readonly MeasuredFunction[] = [
  {
    name: "active_ride_snapshot",
    statement: "select active_ride_snapshot($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: false,
  },
  {
    name: "ride_search_state",
    statement: "select ride_search_state($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: false,
  },
  {
    name: "rider_ride_detail",
    statement: "select rider_ride_detail($1::bigint, $2::uuid) as result",
    object: () => completedOrderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: false,
  },
  {
    name: "completed_ride_summary",
    statement: "select completed_ride_summary($1::bigint, $2::uuid) as result",
    object: () => completedOrderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: false,
  },
  {
    name: "rider_ride_share_state",
    statement: "select rider_ride_share_state($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: false,
  },
  {
    name: "driver_offer_detail",
    statement: "select driver_offer_detail($1::bigint, $2::uuid) as result",
    object: () => offerId,
    owner: () => OWNER_DRIVER_TELEGRAM_ID,
    stranger: () => STRANGER_DRIVER_TELEGRAM_ID,
    mutates: false,
  },
] as const;

const WRITE_FUNCTIONS: readonly MeasuredFunction[] = [
  {
    name: "mark_notification_read",
    statement: "select mark_notification_read($1::bigint, $2::uuid) as result",
    object: () => notificationId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: true,
  },
  {
    name: "driver_mark_arrived",
    statement: "select driver_mark_arrived($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_DRIVER_TELEGRAM_ID,
    stranger: () => STRANGER_DRIVER_TELEGRAM_ID,
    mutates: true,
  },
  {
    name: "driver_start_ride",
    statement: "select driver_start_ride($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_DRIVER_TELEGRAM_ID,
    stranger: () => STRANGER_DRIVER_TELEGRAM_ID,
    mutates: true,
  },
  {
    name: "driver_complete_ride",
    statement: "select driver_complete_ride($1::bigint, $2::uuid) as result",
    object: () => orderId,
    owner: () => OWNER_DRIVER_TELEGRAM_ID,
    stranger: () => STRANGER_DRIVER_TELEGRAM_ID,
    mutates: true,
  },
  {
    name: "cancel_ride_by_telegram",
    statement: "select cancel_ride_by_telegram($1::bigint, $2::uuid) as result",
    object: () => completedOrderId,
    owner: () => OWNER_RIDER_TELEGRAM_ID,
    stranger: () => STRANGER_RIDER_TELEGRAM_ID,
    mutates: true,
  },
  {
    name: "driver_accept_offer",
    statement: "select driver_accept_offer($1::bigint, $2::uuid) as result",
    object: () => offerId,
    owner: () => OWNER_DRIVER_TELEGRAM_ID,
    stranger: () => STRANGER_DRIVER_TELEGRAM_ID,
    mutates: true,
  },
] as const;

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedUser = async (telegramId: number, role: string, name: string, phone: string) => {
    const [row] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, ${role}::user_role, ${name}, ${phone})
      returning id
    `;
    if (row === undefined) throw new Error(`تعذّر زرعُ المستخدمِ ${name}`);
    return row.id;
  };

  ownerUserId = await seedUser(OWNER_RIDER_TELEGRAM_ID, "rider", "مالكُ الرحلةِ", "+966500000881");
  strangerUserId = await seedUser(
    STRANGER_RIDER_TELEGRAM_ID,
    "rider",
    "راكبٌ غريبٌ",
    "+966500000882",
  );
  ownerDriverUserId = await seedUser(
    OWNER_DRIVER_TELEGRAM_ID,
    "driver",
    "سائقُ الرحلةِ",
    "+966500000883",
  );
  strangerDriverUserId = await seedUser(
    STRANGER_DRIVER_TELEGRAM_ID,
    "driver",
    "سائقٌ غريبٌ",
    "+966500000884",
  );

  const seedRider = async (userId: string) => {
    const [row] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${userId}) returning id
    `;
    if (row === undefined) throw new Error("تعذّر زرعُ الراكبِ");
    return row.id;
  };
  ownerRiderId = await seedRider(ownerUserId);
  strangerRiderId = await seedRider(strangerUserId);

  const seedDriver = async (userId: string, plate: string) => {
    const [row] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}, 'verified'::verification_status, 'سيدان', ${plate})
      returning id
    `;
    if (row === undefined) throw new Error("تعذّر زرعُ السائقِ");
    return row.id;
  };
  ownerDriverId = await seedDriver(ownerDriverUserId, "ر س ب 8801");
  strangerDriverId = await seedDriver(strangerDriverUserId, "ر س ب 8802");

  const seedOrder = async (status: string, driver: string | null, matched: boolean) => {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (
        city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
        assigned_driver_id, idempotency_key, matched_at
      ) values (
        ${cityId}, ${ownerRiderId}, 'transport'::service_type, ${status}::order_status,
        st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
        st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
        'الحرم', 'العزيزية', ${driver}, ${`object-authz:${crypto.randomUUID()}`},
        ${matched ? sql`now()` : null}
      ) returning id
    `;
    if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
    return row.id;
  };
  orderId = await seedOrder("matched", ownerDriverId, true);
  completedOrderId = await seedOrder("searching", null, false);

  const [offer] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${completedOrderId}, ${ownerDriverId}, 1, 'pending'::offer_status, now() + interval '5 minutes')
    returning id
  `;
  if (offer === undefined) throw new Error("تعذّر زرعُ العرضِ");
  offerId = offer.id;

  const [outbox] = await sql<{ id: string }[]>`
    insert into notification_outbox (city_id, kind, order_id, status, payload, dedup_key)
    values (
      ${cityId}, 'order_cancelled', ${orderId}, 'pending', '{}'::jsonb,
      ${`object-authz:${crypto.randomUUID()}`}
    )
    returning id
  `;
  if (outbox === undefined) throw new Error("تعذّر زرعُ صفِّ الإشعارِ");
  outboxId = outbox.id;

  const [notification] = await sql<{ id: string }[]>`
    insert into user_notifications (city_id, user_id, outbox_id, kind, channel, payload)
    values (${cityId}, ${ownerUserId}, ${outboxId}, 'order_cancelled', 'in_app', '{}'::jsonb)
    returning id
  `;
  if (notification === undefined) throw new Error("تعذّر زرعُ الإشعارِ");
  notificationId = notification.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from user_notifications where user_id in (${ownerUserId}, ${strangerUserId})`;
  if (outboxId !== "") await sql`delete from notification_outbox where id = ${outboxId}`;
  for (const id of [ownerRiderId, strangerRiderId]) {
    if (id === "") continue;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${id})`;
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${id})`;
    await sql`delete from orders where rider_id = ${id}`;
  }
  for (const id of [ownerRiderId, strangerRiderId]) {
    if (id !== "") await sql`delete from riders where id = ${id}`;
  }
  for (const id of [ownerDriverId, strangerDriverId]) {
    if (id !== "") await sql`delete from drivers where id = ${id}`;
  }
  for (const id of [ownerUserId, strangerUserId, ownerDriverUserId, strangerDriverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("التفويضُ على مستوى الكائنِ — القيدُ في القاعدةِ لا في الطبقةِ", () => {
  it("١) المالكُ يقرأُ كائنَه في كلِّ دالّةِ قراءةٍ", async () => {
    for (const measured of READ_FUNCTIONS) {
      const payload = await callFunction(measured.statement, [measured.owner(), measured.object()]);
      // **والدعوى «لا رفضَ» لا «حقلٌ بعينِه»**: لكلِّ دالّةٍ شكلُ ردٍّ يخصُّها،
      // والمقيسُ ههنا المِلكِيَّةُ لا شكلُ الجسمِ.
      expect({ name: measured.name, refusal: refusalCodeOf(payload) }).toEqual({
        name: measured.name,
        refusal: null,
      });
    }
  });

  it("٢) الغريبُ يُرَدُّ في كلِّ دالّةِ قراءةٍ — ولا يُسرَّبُ جسمُ الكائنِ", async () => {
    for (const measured of READ_FUNCTIONS) {
      const payload = await callFunction(measured.statement, [
        measured.stranger(),
        measured.object(),
      ]);
      expect({ name: measured.name, refused: refusalCodeOf(payload) !== null }).toEqual({
        name: measured.name,
        refused: true,
      });
      expect(JSON.stringify(payload)).not.toContain(measured.object());
    }
  });

  it("٣) ردُّ الغريبِ يطابقُ ردَّ المعدومِ حرفاً — فلا يُعَدُّ المسارُ عدّادَ وجودٍ", async () => {
    for (const measured of READ_FUNCTIONS) {
      const stranger = await callFunction(measured.statement, [
        measured.stranger(),
        measured.object(),
      ]);
      const absent = await callFunction(measured.statement, [measured.owner(), ABSENT_UUID]);
      expect({ name: measured.name, code: refusalCodeOf(stranger) }).toEqual({
        name: measured.name,
        code: refusalCodeOf(absent),
      });
    }
  });

  it("٤) الكاتباتُ تُرَدُّ للغريبِ، ولا تُغيِّرُ صفّاً، وردُّها يطابقُ ردَّ المعدومِ", async () => {
    const before = await sql<
      { status: string; matched: string | null; read_at: string | null; offer: string }[]
    >`
      select o.status::text as status,
             o.matched_at::text as matched,
             n.read_at::text as read_at,
             f.status::text as offer
      from orders o
        cross join (select read_at from user_notifications where id = ${notificationId}) n
        cross join (select status from order_offers where id = ${offerId}) f
      where o.id = ${orderId}
    `;

    for (const measured of WRITE_FUNCTIONS) {
      const stranger = await callFunction(measured.statement, [
        measured.stranger(),
        measured.object(),
      ]);
      expect({ name: measured.name, refused: refusalCodeOf(stranger) !== null }).toEqual({
        name: measured.name,
        refused: true,
      });
      const absent = await callFunction(measured.statement, [measured.owner(), ABSENT_UUID]);
      expect({ name: measured.name, code: refusalCodeOf(stranger) }).toEqual({
        name: measured.name,
        code: refusalCodeOf(absent),
      });
    }

    const after = await sql<
      { status: string; matched: string | null; read_at: string | null; offer: string }[]
    >`
      select o.status::text as status,
             o.matched_at::text as matched,
             n.read_at::text as read_at,
             f.status::text as offer
      from orders o
        cross join (select read_at from user_notifications where id = ${notificationId}) n
        cross join (select status from order_offers where id = ${offerId}) f
      where o.id = ${orderId}
    `;
    // **الرفضُ يُقاسُ بأثرِه لا بنصِّه**: دالّةٌ تُعيدُ خطأً بعدَ أن كتبَت أسوأُ
    // من دالّةٍ تُعيدُ الصفَّ — تُفسِدُ حالةً تجاريّةً بيدِ غريبٍ.
    expect(after).toEqual(before);
  });

  it("٥) ولا واحدةٌ من الدوالِّ المقيسةِ تقبلُ معرِّفَ الكائنِ وحدَه", async () => {
    const names = [...READ_FUNCTIONS, ...WRITE_FUNCTIONS].map((measured) => measured.name);
    const rows = await sql<{ proname: string; args: string }[]>`
      select p.proname, pg_get_function_arguments(p.oid) as args
      from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(${names}::text[])
    `;
    expect(rows.length).toBeGreaterThanOrEqual(names.length);
    for (const row of rows) {
      // هويّةُ الناظرِ **في التوقيعِ**: دالّةٌ لا تأخذُها لا تستطيعُ أن تقيسَ
      // مِلكِيَّةً مهما كتبَ المُعالِجُ فوقَها.
      expect({ name: row.proname, carriesViewer: row.args.includes("telegram_id") }).toEqual({
        name: row.proname,
        carriesViewer: true,
      });
    }
  });
});
