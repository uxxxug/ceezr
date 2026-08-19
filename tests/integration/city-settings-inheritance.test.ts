/**
 * الغرض: مدينةٌ تُضاف تُبذَر إعداداتُها في اللحظة نفسها، ولا تُفعَّل مدينةٌ ينقصها
 *   مفتاح. الاختبارُ على PostgreSQL حقيقية لأنّ الحُكمَ كلَّه في مُنبِّهات القاعدة.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: كلُّ تغييرٍ يمسّ بذرَ المدن أو شرطَ تفعيلها.
 * ملاحظات مستقبلية: المدنُ المُختبَرة تُحذف في `afterEach` — صفُّ مدينةٍ متروك
 *   يُسمَّم كلَّ اختبارٍ يعدّ المدن.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;

/** رموزُ المدن المُختبَرة: تُحذف كلُّها بعد كلّ اختبار. */
const PROBE_CODES = ["ZY1", "ZY2"] as const;

async function addCity(code: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into cities (code, name_ar, name_en, is_active)
    values (${code}, ${`مدينة ${code}`}, ${`City ${code}`}, false)
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّر إنشاء المدينة ${code}`);
  return id;
}

describeIf("بذرُ إعدادات مدينةٍ جديدة على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  afterEach(async () => {
    await sql`delete from cities where code = any(${[...PROBE_CODES]}::text[])`;
  });

  /**
   * `insert into cities` وحده — من اللوحة أو من سكربتٍ تشغيليّ — كان يُنشئ مدينةً
   * بصفرِ إعدادات، فتردّ كلُّ مهمّةٍ فيها `*_SETTING_MISSING` بلا أن يقول شيءٌ لماذا.
   */
  it("المدينةُ الجديدة تُبذَر بكلّ مفاتيح أخواتها، كلُّها مبدئية", async () => {
    const reference = await sql<{ count: string }[]>`
      select count(*) from platform_settings
       where city_id = (select id from cities where code = 'JED')
    `;
    const expected = Number(reference[0]?.count ?? 0);
    expect(expected).toBeGreaterThan(0);

    const cityId = await addCity("ZY1");

    const seeded = await sql<{ total: string; provisional: string }[]>`
      select count(*) total, count(*) filter (where is_provisional) provisional
        from platform_settings where city_id = ${cityId}
    `;
    expect(Number(seeded[0]?.total)).toBe(expected);
    // القيمةُ المنسوخة مبدئيةٌ ولو كانت محسومةً في مصدرها: سعرُ جدة ليس سعرَ
    // غيرها، وعرضُه محسوماً يعني أنّ أحداً لن ينظر إليه.
    expect(Number(seeded[0]?.provisional)).toBe(expected);

    const missing = await sql<{ key: string }[]>`
      select s.key from platform_settings s
       where s.city_id = (select id from cities where code = 'JED')
         and not exists (
           select 1 from platform_settings t where t.city_id = ${cityId} and t.key = s.key
         )
    `;
    expect(missing.length).toBe(0);
  });

  it("مدينتان تُضافان في اللحظة نفسها تُبذَران من الأصل نفسه", async () => {
    const first = await addCity("ZY1");
    const second = await addCity("ZY2");

    const drift = await sql<{ key: string }[]>`
      select s.key from platform_settings s
       where s.city_id = ${first}
         and not exists (
           select 1 from platform_settings t where t.city_id = ${second} and t.key = s.key
         )
      union
      select s.key from platform_settings s
       where s.city_id = ${second}
         and not exists (
           select 1 from platform_settings t where t.city_id = ${first} and t.key = s.key
         )
    `;
    expect(drift.length).toBe(0);
  });

  /**
   * مدينةٌ مفعَّلةٌ ناقصةُ مفتاحٍ تظهر للركّاب ثمّ ترفض كلَّ طلبٍ برمزٍ داخليّ.
   * التفعيلُ يُردّ في القاعدة لا في المسار: التفعيلُ يجري بأكثر من طريق.
   */
  it("لا تُفعَّل مدينةٌ ينقصها مفتاحُ إعداد", async () => {
    const cityId = await addCity("ZY1");
    await sql`delete from platform_settings where city_id = ${cityId} and key = 'currency'`;

    let rejected = false;
    try {
      await sql`
        update cities
           set telegram_support_group_id = -1009901,
               telegram_escalation_group_id = -1009902,
               telegram_unsubscribed_drivers_group_id = -1009903,
               is_active = true
         where id = ${cityId}
      `;
    } catch (error) {
      rejected = true;
      expect(String(error)).toContain("CITY_SETTINGS_INCOMPLETE");
      // الرسالةُ تُسمّي المفتاحَ الناقص: مسؤولٌ يقرأ «ناقصة» بلا اسمٍ يبحث عمياً.
      expect(String(error)).toContain("currency");
    }
    expect(rejected).toBe(true);

    const state = await sql<{ is_active: boolean }[]>`
      select is_active from cities where id = ${cityId}
    `;
    expect(state[0]?.is_active).toBe(false);
  });

  it("المدينةُ الكاملةُ تُفعَّل، والمدينةُ المطفأةُ الناقصة حالةٌ مشروعة", async () => {
    const cityId = await addCity("ZY1");

    // ناقصةٌ ومطفأة: تعديلٌ آخر عليها لا يُردّ، فالملءُ يجري على مهل.
    await sql`delete from platform_settings where city_id = ${cityId} and key = 'currency'`;
    await sql`update cities set name_en = 'City ZY1 renamed' where id = ${cityId}`;

    await sql`
      insert into platform_settings (city_id, key, value, value_type, description_ar)
      select ${cityId}, key, value, value_type, description_ar
        from platform_settings
       where city_id = (select id from cities where code = 'JED') and key = 'currency'
    `;
    await sql`
      update cities
         set telegram_support_group_id = -1009911,
             telegram_escalation_group_id = -1009912,
             telegram_unsubscribed_drivers_group_id = -1009913,
             is_active = true
       where id = ${cityId}
    `;

    const state = await sql<{ is_active: boolean }[]>`
      select is_active from cities where id = ${cityId}
    `;
    expect(state[0]?.is_active).toBe(true);
  });

  it("البذرُ لا يطأ قيمةً موجودة ولا يُكرّر مفتاحاً", async () => {
    const cityId = await addCity("ZY1");
    await sql`
      update platform_settings set value = '"XYZ"'::jsonb, is_provisional = false
       where city_id = ${cityId} and key = 'currency'
    `;

    const again = await sql<{ result: { seeded: number } }[]>`
      select seed_city_settings(${cityId}::uuid) as result
    `;
    expect(again[0]?.result.seeded).toBe(0);

    const kept = await sql<{ value: string; is_provisional: boolean }[]>`
      select value #>> '{}' as value, is_provisional from platform_settings
       where city_id = ${cityId} and key = 'currency'
    `;
    expect(kept[0]?.value).toBe("XYZ");
    expect(kept[0]?.is_provisional).toBe(false);
  });

  it("البذرُ يرفض أصلاً هو الهدفُ نفسه أو أصلاً بلا إعدادات", async () => {
    const cityId = await addCity("ZY1");
    const itself = await sql<{ result: { error?: string } }[]>`
      select seed_city_settings(${cityId}::uuid, ${cityId}::uuid) as result
    `;
    expect(itself[0]?.result.error).toBe("TEMPLATE_IS_TARGET");

    const empty = await addCity("ZY2");
    await sql`delete from platform_settings where city_id = ${empty}`;
    const fromEmpty = await sql<{ result: { error?: string } }[]>`
      select seed_city_settings(${cityId}::uuid, ${empty}::uuid) as result
    `;
    expect(fromEmpty[0]?.result.error).toBe("TEMPLATE_HAS_NO_SETTINGS");
  });
});
