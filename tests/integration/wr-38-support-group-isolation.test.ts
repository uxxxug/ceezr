/**
 * الغرض: `WR-38` — عزلُ مسارِ الدعمِ على قاعدةٍ حقيقيةٍ: بطاقةُ التذكرةِ تُوجَّهُ
 *   إلى قروبِ الدعمِ حصراً (`cities.telegram_support_group_id`)، وقروباتُ المدينةِ
 *   الثلاثةُ مساراتٌ مستقلةٌ ترفضُ القاعدةُ تطابقَ اثنينِ منها، ودالةُ الإدارةِ
 *   ترفضُ التطابقَ قبلَ الوصولِ إلى القاعدة، والمدينةُ بلا قروبِ دعمٍ لا تُفتحُ
 *   فيها تذكرةٌ (CITY_GROUP_MISSING).
 * الحالة: اختبار تكامل فعلي — يتطلّب TEST_DATABASE_URL بها الهجرات مطبَّقة.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وكلُّ تعديلٍ يمسّ قروباتِ المدنِ أو مسارَ الدعمِ.
 * ملاحظات مستقبلية: عضويةُ القروباتِ الفعليةِ في تيليجرامَ (منْ فيها وما طبيعتُها)
 *   لا تُقاسُ هنا — قرارُ مالكٍ (WR-38 · BLOCKED) لأنَّها خارجَ القاعدةِ والكودِ.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
  SEED_GROUP_IDS,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه — سالبةٌ بعيدةٌ عن أيِّ قروبٍ حقيقيٍّ. */
const RIDER_TG = 900_003_380;
const ADMIN_TG = 900_003_381;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
const seededUserIds: string[] = [];
let supportGroupId: string | null = null;

async function expectSqlError(run: () => Promise<unknown>, constraint: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(String(error)).toContain(constraint);
    return;
  }
  expect.unreachable(`كانَ يُنتظَرُ رفضُ القاعدةِ بقيدِ ${constraint}`);
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql);
  cityId = cityHandle.cityId;
  const [row] = await sql<{ support: string | null }[]>`
    select telegram_support_group_id::text as support from cities where id = ${cityId}`;
  supportGroupId = row?.support ?? null;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider'::user_role, 'راكبُ عزلِ الدعمِ', null)
    returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  seededUserIds.push(rider.id);
  await sql`insert into riders (city_id, user_id) values (${cityId}, ${rider.id})`;

  const [admin] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${ADMIN_TG}, 'admin'::user_role, 'مديرُ عزلِ الدعمِ', null)
    returning id`;
  if (admin === undefined) throw new Error("تعذّر زرعُ المديرِ");
  seededUserIds.push(admin.id);
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from support_tickets where rider_id in (
              select id from riders where user_id = any(${seededUserIds}::uuid[]))`.catch(() => {});
  await sql`delete from riders where user_id = any(${seededUserIds}::uuid[])`;
  await sql`delete from audit_log where actor_user_id = any(${seededUserIds}::uuid[])`;
  await sql`delete from users where id = any(${seededUserIds}::uuid[])`;
  await restoreCityBaseline(sql, cityHandle);
  await sql.end?.();
});

describeIf("WR-38 — عزلُ مسارِ الدعمِ", () => {
  it("بطاقةُ التذكرةِ تُوجَّهُ إلى قروبِ الدعمِ حصراً: `open_support_ticket` و`get_support_ticket_context` يعيدانِ قروبَ الدعمِ", async () => {
    expect(supportGroupId).not.toBeNull();
    const expectedGroup = supportGroupId ?? "";
    const [ticket] = await sql<{ result: Record<string, unknown> }[]>`
      select open_support_ticket(${RIDER_TG}::bigint, 'ride_dispute'::support_ticket_type,
                                'رسالةُ عزلِ قروبِ الدعمِ'::text) as result`;
    if (ticket === undefined) throw new Error("تعذّر فتحُ التذكرةِ");
    expect(ticket.result.ok).toBe(true);
    expect(String(ticket.result.group_id)).toBe(expectedGroup);

    const [context] = await sql<{ result: Record<string, unknown> }[]>`
      select get_support_ticket_context(${String(ticket.result.ticket_id)}::uuid) as result`;
    if (context === undefined) throw new Error("تعذّر قراءةُ سياقِ التذكرةِ");
    expect(context.result.ok).toBe(true);
    expect(String(context.result.group_id)).toBe(expectedGroup);
  });

  it("قيدُ القاعدةِ يرفضُ قروبَ دعمٍ يطابقُ قروبَ التصعيدِ (`cities_group_ids_distinct`)", async () => {
    await expectSqlError(
      () =>
        sql`
          update cities
             set telegram_escalation_group_id = telegram_support_group_id
           where id = ${cityId}`,
      "cities_group_ids_distinct",
    );
  });

  it("قيدُ القاعدةِ يرفضُ قروبَ دعمٍ يطابقُ قروبَ غيرِ المشتركينَ (`cities_group_ids_distinct_unsubscribed_support`)", async () => {
    await expectSqlError(
      () =>
        sql`
          update cities
             set telegram_unsubscribed_drivers_group_id = telegram_support_group_id
           where id = ${cityId}`,
      "cities_group_ids_distinct_unsubscribed_support",
    );
  });

  it("دالةُ الإدارةِ ترفضُ القروباتِ المتطابقةَ قبلَ الوصولِ إلى القاعدةِ (`DUPLICATE_GROUP_ID`)", async () => {
    const adminId = seededUserIds[1];
    if (adminId === undefined) throw new Error("المديرُ غيرُ مزروعٍ");
    const same = SEED_GROUP_IDS.support;
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select admin_update_city_group_ids(${adminId}::uuid, ${cityId}::uuid,
                                         ${same}::bigint, ${same}::bigint, ${same}::bigint) as result`;
    if (row === undefined) throw new Error("تعذّر نداءُ دالةِ الإدارةِ");
    expect(row.result.ok).toBe(false);
    expect(row.result.error).toBe("DUPLICATE_GROUP_ID");
    // لم تتغيّر حالةُ المدينةِ
    const [city] = await sql<{ support: string | null }[]>`
      select telegram_support_group_id::text as support from cities where id = ${cityId}`;
    expect(city?.support).toBe(supportGroupId);
  });

  it("مدينةٌ بلا قروبِ دعمٍ: لا تُفتحُ تذكرةٌ (`CITY_GROUP_MISSING`)", async () => {
    // القيدُ `cities_active_requires_groups` يوجِبُ تعطيلَ المدينةِ عندَ إفراغِ قروبٍ —
    // فالإفراغُ هنا متعمَّدٌ ويُردُّ حرفاً في `afterAll`.
    await sql`
      update cities
         set is_active = false, telegram_support_group_id = null
       where id = ${cityId}`;
    const [ticket] = await sql<{ result: Record<string, unknown> }[]>`
      select open_support_ticket(${RIDER_TG}::bigint, 'ride_dispute'::support_ticket_type,
                                'لا ينبغي أن تُفتحَ'::text) as result`;
    if (ticket === undefined) throw new Error("تعذّر نداءُ open_support_ticket");
    expect(ticket.result.ok).toBe(false);
    expect(ticket.result.error).toBe("CITY_GROUP_MISSING");
  });
});
