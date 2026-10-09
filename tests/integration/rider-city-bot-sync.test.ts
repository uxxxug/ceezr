/**
 * الغرض: تغييرُ مدينةِ الراكبِ من البوت يصلُ حكمَ الطلب (ADR 0255 · دَينُ ADR 0252).
 *   قبلَ الإصلاح كانت `update_rider_city` تكتبُ `riders.city_id` وحدَه و`request_ride`
 *   تقرأُ `users.city_id`، فينتقلُ الراكبُ في البوتِ ويُحكَمُ طلبُه بالمدينةِ القديمة.
 *   على PostgreSQL حقيقيّة: الأقفالُ والحراساتُ والكتابةُ كلُّها داخلَ القاعدة.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-10-10.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: كلُّ شيءٍ داخلَ معاملةٍ تُرجَعُ في `afterAll`، فلا صفوفَ متروكة.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverDirectory,
  createRiderDirectory,
} from "../../packages/infrastructure/identity/directories.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;

const RUN = Date.now() % 1_000_000;
const TG = {
  mover: 9_551_000_000 + RUN,
  busy: 9_552_000_000 + RUN,
  drift: 9_553_000_000 + RUN,
  dual: 9_554_000_000 + RUN,
  driver: 9_555_000_000 + RUN,
} as const;

const ID = {
  home: "a1000000-0000-4000-8000-000000000001",
  away: "a1000000-0000-4000-8000-000000000002",
  off: "a1000000-0000-4000-8000-000000000003",
  mover: "a1000000-0000-4000-8000-000000000011",
  busy: "a1000000-0000-4000-8000-000000000012",
  drift: "a1000000-0000-4000-8000-000000000013",
  dual: "a1000000-0000-4000-8000-000000000014",
  driverUser: "a1000000-0000-4000-8000-000000000015",
  moverRow: "a1000000-0000-4000-8000-000000000021",
  busyRow: "a1000000-0000-4000-8000-000000000022",
  driftRow: "a1000000-0000-4000-8000-000000000023",
  dualRow: "a1000000-0000-4000-8000-000000000024",
  driver: "a1000000-0000-4000-8000-000000000031",
  busyOrder: "a1000000-0000-4000-8000-000000000041",
} as const;

const BOX = {
  home: "POLYGON((-120 20, -119 20, -119 21, -120 21, -120 20))",
  away: "POLYGON((-110 20, -109 20, -109 21, -110 21, -110 20))",
} as const;
const IN_HOME = { lat: 20.5, lng: -119.5 };
const IN_AWAY = { lat: 20.5, lng: -109.5 };

interface Cities {
  readonly user: string | null;
  readonly rider: string | null;
}

async function citiesOf(userId: string): Promise<Cities> {
  const rows = await sql<{ user_city: string | null; rider_city: string | null }[]>`
    select u.city_id as user_city, r.city_id as rider_city
      from users u left join riders r on r.user_id = u.id
     where u.id = ${userId}`;
  return { user: rows[0]?.user_city ?? null, rider: rows[0]?.rider_city ?? null };
}

async function changeViaRpc(riderRowId: string, cityId: string): Promise<Record<string, unknown>> {
  const rows = await sql<{ r: Record<string, unknown> }[]>`
    select update_rider_city(${riderRowId}::uuid, ${cityId}::uuid) as r`;
  return rows[0]?.r ?? {};
}

async function requestRide(telegramId: number, key: string, at: { lat: number; lng: number }) {
  const rows = await sql<{ result: { ok: boolean; error?: string; order_id?: string } }[]>`
    select request_ride(${telegramId}::bigint, ${key}, 'transport'::service_type,
      ${at.lat}::double precision, ${at.lng}::double precision, null, null, null) as result`;
  return rows[0]?.result;
}

describeIf("مدينةُ الراكبِ من البوت بكتابةٍ واحدة — ADR 0255", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    await sql`begin`;
    for (const [id, code, active] of [
      [ID.home, "BH1", true],
      [ID.away, "BA1", true],
      [ID.off, "BO1", false],
    ] as const) {
      await sql`insert into cities (id, code, name_ar, name_en, is_active,
          telegram_support_group_id, telegram_escalation_group_id, telegram_unsubscribed_drivers_group_id)
        values (${id}, ${code}, ${`مدينة ${code}`}, ${`City ${code}`}, ${active}, -1001, -1002, -1003)`;
    }
    for (const [city, box] of [
      [ID.home, BOX.home],
      [ID.away, BOX.away],
    ] as const) {
      await sql`insert into city_service_areas (city_id, area, area_version, source, is_active)
        values (${city}, st_geogfromtext(${`SRID=4326;${box}`}), 'city-sync-test', 'اختبار ADR 0255', true)`;
    }
    for (const [id, tg, role, city] of [
      [ID.mover, TG.mover, "rider", ID.home],
      [ID.busy, TG.busy, "rider", ID.home],
      [ID.drift, TG.drift, "rider", ID.home],
      [ID.dual, TG.dual, "driver", ID.home],
      [ID.driverUser, TG.driver, "driver", ID.away],
    ] as const) {
      await sql`insert into users (id, city_id, telegram_id, role, full_name, language_code, is_blocked)
        values (${id}, ${city}, ${tg}, ${role}, 'اختبار', 'ar', false)`;
    }
    await sql`insert into riders (id, city_id, user_id) values
      (${ID.moverRow}, ${ID.home}, ${ID.mover}),
      (${ID.busyRow}, ${ID.home}, ${ID.busy}),
      (${ID.driftRow}, ${ID.away}, ${ID.drift}),
      (${ID.dualRow}, ${ID.home}, ${ID.dual})`;
    await sql`insert into orders (id, city_id, rider_id, service, status, pickup)
      values (${ID.busyOrder}, ${ID.home}, ${ID.busyRow}, 'transport', 'searching',
              st_geogfromtext(${`SRID=4326;POINT(${IN_HOME.lng} ${IN_HOME.lat})`}))`;
    // سائقٌ موثَّقٌ مشترِكٌ قادرٌ في المدينةِ الهدف: شرطُ القدرةِ في `request_ride` يُستوفى لا يُخفَّف.
    await sql`insert into drivers (id, city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${ID.driver}, ${ID.away}, ${ID.driverUser}, 'verified', 'سيدان', 'ب ع ك 4455')`;
    await sql`insert into subscriptions (city_id, driver_id, plan, status)
      values (${ID.away}, ${ID.driver}, 'both', 'active')`;
    await sql`insert into driver_capabilities (city_id, driver_id, service, is_enabled)
      values (${ID.away}, ${ID.driver}, 'transport', true)`;
  });

  afterAll(async () => {
    await sql`rollback`;
    await sql.end();
  });

  it("١. التغييرُ عبرَ مُحوِّلِ البوت يكتبُ السجلَّين معاً ويُدقَّق", async () => {
    const riders = createRiderDirectory(sql);
    const result = await riders.changeCity(ID.moverRow as never, ID.away as never);
    expect(result.ok && result.value).toEqual({ ok: true, error: null });
    expect(await citiesOf(ID.mover)).toEqual({ user: ID.away, rider: ID.away });
    const audit = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log
       where action = 'rider.city_changed' and entity_id = ${ID.moverRow}::uuid and city_id = ${ID.away}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.payload).toMatchObject({
      old_city_id: ID.home,
      new_city_id: ID.away,
      old_user_city_id: ID.home,
      old_rider_city_id: ID.home,
      source: "bot_city_change",
    });
  });

  it("٢. الطلبُ بعدَ التغييرِ يُنشأُ فعلاً في المدينةِ الجديدة", async () => {
    const created = await requestRide(TG.mover, `sync-${RUN}`, IN_AWAY);
    expect(created?.ok).toBe(true);
    const orders = await sql<{ city_id: string }[]>`
      select o.city_id from orders o where o.rider_id = ${ID.moverRow}::uuid`;
    expect(orders.map((o) => o.city_id)).toEqual([ID.away]);
    // ونقطةٌ في المدينةِ القديمةِ تُرفَضُ بحدِّ الخدمةِ: الحكمُ بالمدينةِ الجديدةِ لا القديمة.
    const old = await requestRide(TG.mover, `sync-old-${RUN}`, IN_HOME);
    expect(old?.ok).toBe(false);
  });

  it("٣. رحلةٌ قائمةٌ تمنعُ التغيير، ومدينةُ الرحلةِ لا تُمَسّ", async () => {
    const result = await changeViaRpc(ID.busyRow, ID.away);
    expect(result).toEqual({ ok: false, error: "ACTIVE_ORDER_IN_PROGRESS" });
    expect(await citiesOf(ID.busy)).toEqual({ user: ID.home, rider: ID.home });
    const order = await sql<
      { city_id: string }[]
    >`select city_id from orders where id = ${ID.busyOrder}`;
    expect(order[0]?.city_id).toBe(ID.home);
  });

  it("٤. مدينةٌ غيرُ مفعَّلةٍ مرفوضةٌ بلا كتابة", async () => {
    const result = await changeViaRpc(ID.driftRow, ID.off);
    expect(result).toEqual({ ok: false, error: "CITY_NOT_FOUND_OR_INACTIVE" });
    expect(await citiesOf(ID.drift)).toEqual({ user: ID.home, rider: ID.away });
  });

  it("٥. تباعدٌ سابقٌ لا يُقرأُ «نفسَ المدينة»: يُكتَبُ الهدفُ في السجلَّين", async () => {
    const result = await changeViaRpc(ID.driftRow, ID.away);
    expect(result).toMatchObject({ ok: true, already_same: false, new_city_id: ID.away });
    expect(await citiesOf(ID.drift)).toEqual({ user: ID.away, rider: ID.away });
  });

  it("٦. السجلّانِ متطابقانِ معَ الهدف ⇒ already_same بلا تدقيقٍ جديد", async () => {
    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${ID.driftRow}::uuid`;
    const result = await changeViaRpc(ID.driftRow, ID.away);
    expect(result).toEqual({ ok: true, already_same: true });
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${ID.driftRow}::uuid`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("٧. صفُّ مستخدمٍ دورُه سائقٌ لا تُمَسُّ مدينتُه ولو كانَ له صفُّ راكب", async () => {
    const result = await changeViaRpc(ID.dualRow, ID.away);
    expect(result).toEqual({ ok: false, error: "NOT_A_RIDER" });
    expect(await citiesOf(ID.dual)).toEqual({ user: ID.home, rider: ID.home });
  });

  it("٨. مدينةُ السائقِ في المدينةِ الهدفِ لم تتغيّر بأيٍّ ممّا سبق", async () => {
    const rows = await sql<{ d: string; u: string }[]>`
      select d.city_id as d, u.city_id as u from drivers d join users u on u.id = d.user_id
       where d.id = ${ID.driver}`;
    expect(rows[0]).toEqual({ d: ID.away, u: ID.away });
  });

  it("٩. راكبٌ غيرُ موجودٍ ⇒ RIDER_NOT_FOUND", async () => {
    const result = await changeViaRpc("a1000000-0000-4000-8000-0000000000ff", ID.away);
    expect(result).toEqual({ ok: false, error: "RIDER_NOT_FOUND" });
  });

  it("١٠. مُحوِّلُ السائقِ يقرأُ نتيجةَ الدالّةِ نفسَها (كانَ `select *` يُضيِّعُها)", async () => {
    const drivers = createDriverDirectory(sql);
    const refused = await drivers.changeCity(ID.driver as never, ID.off as never);
    expect(refused.ok && refused.value).toEqual({ ok: false, error: "CITY_NOT_FOUND_OR_INACTIVE" });
    const same = await drivers.changeCity(ID.driver as never, ID.away as never);
    expect(same.ok && same.value).toEqual({ ok: true, error: null });
    const rows = await sql<
      { d: string }[]
    >`select city_id as d from drivers where id = ${ID.driver}`;
    expect(rows[0]?.d).toBe(ID.away);
  });

  it("١١. مُحوِّلُ الراكبِ يُعيدُ رمزَ الرفضِ للبوت (ACTIVE_ORDER_IN_PROGRESS)", async () => {
    const riders = createRiderDirectory(sql);
    const result = await riders.changeCity(ID.busyRow as never, ID.away as never);
    expect(result.ok && result.value).toEqual({ ok: false, error: "ACTIVE_ORDER_IN_PROGRESS" });
  });
});
