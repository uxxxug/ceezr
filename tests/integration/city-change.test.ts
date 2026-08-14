/**
 * الغرض: تغييرُ مدينةِ السائق والراكب يعمل فعلاً، ويُمنع أثناء رحلةٍ قائمة.
 *   الاختبارُ على PostgreSQL حقيقية لأنّ الحُكمَ كلَّه داخل `update_driver_city`
 *   و`update_rider_city`، والعيبُ الذي وُجِد لأجله لا يظهر إلّا في القاعدة:
 *   الدالّتان كانتا تقارنان `orders.status` بأسماءٍ ليست في النوع order_status،
 *   فترفع القاعدةُ 22P02 عند أوّل تقييم — أي أنّ التغييرَ كان مُعطَّلاً لكلِّ
 *   سائقٍ وكلِّ راكب، لا للمشغولين فقط. ولا يكشفه اختبارُ وحدةٍ بمحاكاة.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تعديلٍ يمسّ حالاتِ الطلب أو شرطَ نقل المدينة.
 * ملاحظات مستقبلية: المدنُ والمستخدمون المُختبَرون يُحذفون في `afterAll` — صفٌّ
 *   متروك يُسمّم كلَّ اختبارٍ يعدّ المدن أو المستخدمين.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;

/** رموزُ المدن المُختبَرة: الأولى مصدرٌ، والثانية هدفٌ مُفعَّل، والثالثة معطَّلة. */
const HOME_CODE = "ZC1";
const AWAY_CODE = "ZC2";
const OFF_CODE = "ZC3";

const TELEGRAM_BASE = 947300;

interface Actors {
  readonly driverId: string;
  readonly riderId: string;
}

let home = "";
let away = "";
let off = "";

/**
 * مدينةٌ تُضاف ثمّ تُفعَّل بقروباتها الثلاثة في العبارة نفسها — شرطُ
 * `cities_active_requires_groups` وحارسُ check-test-city-activation.
 */
async function addCity(code: string, groupBase: number, active: boolean): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into cities (code, name_ar, name_en, is_active,
                        telegram_support_group_id, telegram_escalation_group_id,
                        telegram_unsubscribed_drivers_group_id)
    values (${code}, ${`مدينة ${code}`}, ${`City ${code}`}, ${active},
            ${groupBase}, ${groupBase - 1}, ${groupBase - 2})
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر إنشاء المدينة ${code}`);
  return id;
}

async function seedActors(seq: number): Promise<Actors> {
  const driverUsers = await sql<{ id: string }[]>`
    insert into users (telegram_id, role, full_name, city_id, language_code)
    values (${TELEGRAM_BASE + seq}, 'driver', 'سائقُ نقلِ المدينة', ${home}, 'ar')
    returning id
  `;
  const driverUserId = driverUsers[0]?.id;
  const riderUsers = await sql<{ id: string }[]>`
    insert into users (telegram_id, role, full_name, city_id, language_code)
    values (${TELEGRAM_BASE + seq + 500}, 'rider', 'راكبُ نقلِ المدينة', ${home}, 'ar')
    returning id
  `;
  const riderUserId = riderUsers[0]?.id;
  if (driverUserId === undefined || riderUserId === undefined) {
    throw new Error("تعذّر إنشاء المستخدمين");
  }
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (user_id, city_id, verification_status)
    values (${driverUserId}::uuid, ${home}, 'verified')
    returning id
  `;
  const riders = await sql<{ id: string }[]>`
    insert into riders (user_id, city_id) values (${riderUserId}::uuid, ${home})
    returning id
  `;
  const driverId = drivers[0]?.id;
  const riderId = riders[0]?.id;
  if (driverId === undefined || riderId === undefined) {
    throw new Error("تعذّر إنشاء السائق أو الراكب");
  }
  return { driverId, riderId };
}

/** طلبٌ في حالةٍ محدّدة — `matched` و`in_progress` يشترطان سائقاً مُسنداً. */
async function insertOrder(
  riderId: string,
  status: "searching" | "matched" | "in_progress" | "completed",
  driverId: string | null,
): Promise<void> {
  await sql`
    insert into orders (city_id, rider_id, service, status, pickup, assigned_driver_id,
                        matched_at, started_at)
    values (${home}, ${riderId}::uuid, 'transport', ${status}::order_status,
            st_point(39.1751, 21.5471)::geography, ${driverId}::uuid,
            ${status === "searching" ? null : new Date()},
            ${status === "in_progress" || status === "completed" ? new Date() : null})
  `;
}

async function changeDriverCity(
  driverId: string,
  cityId: string,
): Promise<Record<string, unknown>> {
  const rows = await sql<{ update_driver_city: Record<string, unknown> }[]>`
    select update_driver_city(${driverId}::uuid, ${cityId}::uuid)
  `;
  const value = rows[0]?.update_driver_city;
  if (value === undefined) throw new Error("update_driver_city لم تُعِد نتيجة");
  return value;
}

async function changeRiderCity(riderId: string, cityId: string): Promise<Record<string, unknown>> {
  const rows = await sql<{ update_rider_city: Record<string, unknown> }[]>`
    select update_rider_city(${riderId}::uuid, ${cityId}::uuid)
  `;
  const value = rows[0]?.update_rider_city;
  if (value === undefined) throw new Error("update_rider_city لم تُعِد نتيجة");
  return value;
}

describeIf("نقلُ مدينةِ السائق والراكب على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    home = await addCity(HOME_CODE, -940001, true);
    away = await addCity(AWAY_CODE, -940011, true);
    off = await addCity(OFF_CODE, -940021, false);
  });

  afterAll(async () => {
    // الترتيبُ مقصود: `audit_log` يشير إلى المستخدم، و`users.city_id` يشير إلى
    // المدينة، فحذفٌ بالمقلوب يُرفَض ويُخلّف صفوفاً تُسمّم كلَّ تشغيلٍ تالٍ.
    const cities = [home, away, off];
    await sql`delete from audit_log where city_id = any(${cities}::uuid[])`;
    await sql`delete from orders where city_id = any(${cities}::uuid[])`;
    await sql`delete from drivers where city_id = any(${cities}::uuid[])`;
    await sql`delete from riders where city_id = any(${cities}::uuid[])`;
    await sql`delete from users where telegram_id between ${TELEGRAM_BASE} and ${TELEGRAM_BASE + 999}`;
    await sql`delete from cities where code = any(${[HOME_CODE, AWAY_CODE, OFF_CODE]}::text[])`;
    await sql.end({ timeout: 5 });
  });

  /**
   * الاختبارُ الأوّل هو الانحدارُ نفسه: قبل الإصلاح كان هذا النداء يرفع 22P02
   * ولا يصل إلى تحديثٍ ولا إلى خطأٍ مفهوم، فيقرأ السائقُ «حدث خطأ» أبداً.
   */
  it("السائقُ الفارغُ من الرحلات يُنقل فعلاً ويُسجَّل نقلُه", async () => {
    const { driverId } = await seedActors(1);

    const result = await changeDriverCity(driverId, away);

    expect(result.ok).toBe(true);
    expect(result.already_same).toBe(false);
    const rows = await sql<{ city_id: string }[]>`
      select city_id from drivers where id = ${driverId}::uuid
    `;
    expect(rows[0]?.city_id).toBe(away);
    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log
       where action = 'driver.city_changed' and entity_id = ${driverId}::uuid
         and city_id = ${away}
    `;
    expect(Number(audit[0]?.count)).toBe(1);
  });

  it("السائقُ في رحلةٍ مُسندة لا يُنقل، ويُسمّى السببُ لا يُرفَع استثناء", async () => {
    const { driverId, riderId } = await seedActors(2);
    await insertOrder(riderId, "matched", driverId);

    const result = await changeDriverCity(driverId, away);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ACTIVE_ORDER_IN_PROGRESS");
    const rows = await sql<{ city_id: string }[]>`
      select city_id from drivers where id = ${driverId}::uuid
    `;
    expect(rows[0]?.city_id).toBe(home);
  });

  it("رحلةٌ منتهية لا تمنع النقل — الحراسةُ على القائم لا على التاريخ", async () => {
    const { driverId, riderId } = await seedActors(3);
    await insertOrder(riderId, "completed", driverId);

    const result = await changeDriverCity(driverId, away);

    expect(result.ok).toBe(true);
  });

  it("الراكبُ وطلبُه يبحثُ عن سائق لا يُنقل — الطلبُ المعلَّق يبقى في مدينته", async () => {
    const { riderId } = await seedActors(4);
    await insertOrder(riderId, "searching", null);

    const result = await changeRiderCity(riderId, away);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ACTIVE_ORDER_IN_PROGRESS");
  });

  it("الراكبُ الفارغُ من الطلبات يُنقل فعلاً", async () => {
    const { riderId } = await seedActors(5);

    const result = await changeRiderCity(riderId, away);

    expect(result.ok).toBe(true);
    const rows = await sql<{ city_id: string }[]>`
      select city_id from riders where id = ${riderId}::uuid
    `;
    expect(rows[0]?.city_id).toBe(away);
  });

  it("مدينةٌ غير مُفعَّلة تُرفض للطرفين", async () => {
    const { driverId, riderId } = await seedActors(6);

    expect((await changeDriverCity(driverId, off)).error).toBe("CITY_NOT_FOUND_OR_INACTIVE");
    expect((await changeRiderCity(riderId, off)).error).toBe("CITY_NOT_FOUND_OR_INACTIVE");
  });

  it("النقلُ إلى المدينة نفسها يُقبل بلا تسجيلٍ مكرَّر", async () => {
    const { driverId } = await seedActors(7);

    const result = await changeDriverCity(driverId, home);

    expect(result.ok).toBe(true);
    expect(result.already_same).toBe(true);
    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log
       where action = 'driver.city_changed' and entity_id = ${driverId}::uuid
    `;
    expect(Number(audit[0]?.count)).toBe(0);
  });
});
