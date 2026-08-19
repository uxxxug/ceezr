/**
 * الغرض: إثبات أنّ كل مدينة تحمل كل مفاتيح `platform_settings` — لا مدينةً
 *   ناقصةً مفتاحاً يُسقط مساراً فيها وحدها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: كل هجرة تبذر مفتاحاً جديداً.
 * ملاحظات مستقبلية: يقرأ فقط، ولا يكتب شيئاً في القاعدة.
 *
 * ## لماذا هذا الاختبار موجود
 *
 * `platform_settings` مفتاحه `(city_id, key)`، وكل قراءةٍ تمرّ بمدينة. ومفتاحٌ
 * غائبٌ عن مدينةٍ لا يُعطي قيمةً افتراضية بل يُنتج عطلاً في تلك المدينة وحدها:
 * `claim_safety_incident_delivery` كانت تُرجع `SOS_RETRY_SETTING_MISSING` لهذا
 * السبب بعينه، وبسببه تُعطَّل استغاثات المنصّة كلّها من مدينةٍ واحدة ناقصة.
 *
 * وهذا شرطٌ على البيانات لا على النصّ، فلا يصلح فيه حاجزٌ ساكن يقرأ الهجرات:
 * الهجرات تبذر بأنماطٍ مختلفة مشروعة (`from cities`، ونسخٌ من مدينةٍ مرجعية عند
 * إضافة مدينة). المهمّ نتيجتها بعد تطبيقها كلّها، وهو ما يُقاس هنا.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIf = databaseUrl === undefined ? describe.skip : describe;
let sql: Sql;

beforeAll(() => {
  if (databaseUrl !== undefined) sql = createSql({ connectionString: databaseUrl });
});
afterAll(async () => {
  if (databaseUrl !== undefined) await sql.end();
});

describeIf("تكافؤ إعدادات المنصّة بين المدن", () => {
  it("لا مدينةَ ينقصها مفتاحٌ موجودٌ عند غيرها", async () => {
    const gaps = await sql<{ code: string; key: string }[]>`
      select c.code, k.key
        from cities c
        cross join (select distinct key from platform_settings) k
       where not exists (
         select 1 from platform_settings s where s.city_id = c.id and s.key = k.key
       )
       order by c.code, k.key
    `;
    // الرسالة تُظهر الناقص باسمه: «فشل» بلا اسم المفتاح لا يُصلح شيئاً.
    expect(gaps.map((row) => `${row.code}:${row.key}`)).toEqual([]);
  });

  /**
   * مفاتيح لا قيمة احتياطية لها في الكود: غيابها عطلٌ مباشر لا تدهورٌ لطيف.
   * تُذكر صريحةً هنا لأنّ تكافؤ المدن وحده لا يكفي — لو غاب المفتاح عن المدن
   * كلّها لبقي التكافؤ سليماً والمسار معطوباً.
   */
  it("المفاتيح التي لا احتياطيَّ لها في الكود مبذورةٌ لكل مدينة", async () => {
    const required = [
      "sos_delivery_max_attempts",
      "sos_delivery_retry_seconds",
      "sos_dedup_window_seconds",
      "subscription_period_days",
      "subscription_price_transport",
      "subscription_price_delivery",
      "subscription_price_both",
      "offer_timeout_seconds",
      "max_broadcast_rounds",
      "search_radius_km",
      "supported_languages",
    ];
    const cityCount = (await sql<{ count: number }[]>`select count(*)::int as count from cities`)[0]
      ?.count;
    const rows = await sql<{ key: string; cities: number }[]>`
      select key, count(distinct city_id)::int as cities
        from platform_settings
       where key = any(${required})
       group by key
    `;
    const seen = new Map(rows.map((row) => [row.key, row.cities]));
    const missing = required.filter((key) => (seen.get(key) ?? 0) !== cityCount);
    expect(missing).toEqual([]);
  });
});
