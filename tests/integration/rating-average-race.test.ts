/**
 * الغرض: حرس انحدار دائم على سباق «فحص-ثم-كتابة بلا قفل» في متوسط التقييم.
 *
 *   العيب الذي يحرسه هذا الملف كان حقيقياً ومقيساً، لا مفترضاً: كانت
 *   `submit_rating` تُدرج التقييم ثم تُعيد حساب متوسط الطرف المُقيَّم عبر
 *   `update ... from (select avg(...))` بلا قفل على صفّه. فراكبان يقيّمان
 *   السائق نفسه على طلبين مختلفين في اللحظة نفسها كان كلٌّ منهما يحسب المتوسط
 *   في لقطته الخاصة، ثم يكتب الثاني فوق الأول. النتيجة المقيسة قبل الإصلاح:
 *   السائق يحمل 1.00 من تقييم واحد، وجدول `ratings` يحمل تقييمين متوسطهما 3.00.
 *   أي أن سائقاً أُخذ عليه أسوأ تقييميه وأُسقط أحسنهما من الحساب.
 *
 *   ولمَ يستحقّ هذا حرساً دائماً لا إصلاحاً عابراً: §4.3 من أمر المالك يجعل
 *   السمعة هي رادع العبث والاستهزاء. رادعٌ يضيع منه نصف الشواهد لا يردع، ورقمٌ
 *   يظلم سائقاً يُفقده رزقه في المطابقة. فالعيب مالي الأثر وإن لم يكن مالي الشكل.
 *
 *   وهذا الملف يقيس السلوك من القاعدة لا من الكود: يفتح جلستين حقيقيتين
 *   متزامنتين على PostgreSQL، ويجبر التداخل بترتيب محتوم لا احتمالي — الجلسة
 *   الأولى تُبقي معاملتها مفتوحة بعد نداء الدالّة، فلو عاد نمط «اقرأ ثم اكتب»
 *   لأي سبب (إعادة كتابة الدالّة، أو تحسين ظنّه أحدهم بلا قفل) انكسر الاختبار.
 *
 *   ويقيس معه ثلاثة إصلاحات صحبت الأول في نفس الهجرة:
 *     • فلترة الاتجاه: متوسط المستخدم كسائق لا يتلوّث بتقييمه كراكب.
 *     • أثر الشطب الفوريّ: `flag_rating` يُخرج التقييم المشطوب من الرقم فوراً.
 *     • غياب البديل المرمَّز: نافذة التقييم غير المُعَدّة تُعلَن ولا تُخترَع.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكل تعديل يمسّ submit_rating
 *   أو flag_rating أو recompute_ratee_averages.
 * ملاحظات مستقبلية: إن أُضيفت أبعاد للتقييم (نظافة، التزام بالوقت) فالحرس
 *   يُوسَّع بتأكيد على كل بُعد داخل هذا الملف، لا بملف موازٍ يكرّر التهيئة.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفات تلغرام خاصة بهذا الملف وحده، فلا يتداخل مع بذور اختبار أخرى. */
const DRIVER_TG = 900_100_501;
const RIDER_A_TG = 900_100_502;
const RIDER_B_TG = 900_100_503;
const SUPPORT_TG = 900_100_504;

let sql: Sql;
let cityId = "";
let driverUserId = "";
let driverRowId = "";
let riderAUserId = "";
let orderAId = "";
let orderBId = "";

/** يزرع سائقاً وراكبين وطلبين مكتملين لنفس السائق. طلبان لا طلب: القيد الفريد
 *  `ratings_one_per_order_direction` يمنع تسابق تقييمين على طلب واحد، فالسباق
 *  الحقيقي إنما يقع بين طلبين مختلفين يشتركان في الطرف المُقيَّم. */
async function seed(): Promise<void> {
  const [city] = await sql<{ id: string }[]>`
    select id from cities where code = 'JED' limit 1
  `;
  if (city === undefined) throw new Error("مدينة جدة غير مزروعة: هجرات ناقصة");
  cityId = city.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, language_code)
    values (${cityId}::uuid, ${DRIVER_TG}, 'driver', 'سائق حرس السباق', 'ar')
    on conflict (telegram_id) do update set full_name = excluded.full_name
    returning id
  `;
  driverUserId = driverUser?.id ?? "";

  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}::uuid, ${driverUserId}::uuid, 'verified')
    on conflict (user_id) do update set verification_status = excluded.verification_status
    returning id
  `;
  driverRowId = driver?.id ?? "";

  const riderIds: string[] = [];
  for (const telegramId of [RIDER_A_TG, RIDER_B_TG]) {
    const [riderUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, language_code)
      values (${cityId}::uuid, ${telegramId}, 'rider', 'راكب حرس السباق', 'ar')
      on conflict (telegram_id) do update set full_name = excluded.full_name
      returning id
    `;
    // تضييق النوع قبل التمرير: معرّفٌ مفقود يعني أن البذرة فشلت، وإعلانه هنا
    // أفضل من تمرير undefined إلى القاعدة فيفشل الاختبار برسالة غامضة.
    const riderUserId = riderUser?.id;
    if (riderUserId === undefined) throw new Error("تعذّر زرع مستخدم الراكب");

    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      values (${cityId}::uuid, ${riderUserId}::uuid)
      on conflict (user_id) do update set city_id = excluded.city_id
      returning id
    `;
    riderIds.push(rider?.id ?? "");
    if (telegramId === RIDER_A_TG) riderAUserId = riderUserId;
  }

  await sql`
    insert into users (city_id, telegram_id, role, full_name, language_code)
    values (${cityId}::uuid, ${SUPPORT_TG}, 'support', 'دعم حرس السباق', 'ar')
    on conflict (telegram_id) do update set role = 'support'
  `;

  const orderIds: string[] = [];
  for (const riderId of riderIds) {
    const [order] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status,
                          pickup, dropoff, completed_at)
      values (${cityId}::uuid, ${riderId}::uuid, ${driverRowId}::uuid, 'transport',
              'completed',
              st_setsrid(st_makepoint(39.1751, 21.5471), 4326)::geography,
              st_setsrid(st_makepoint(39.1901, 21.5601), 4326)::geography,
              now())
      returning id
    `;
    orderIds.push(order?.id ?? "");
  }
  orderAId = orderIds[0] ?? "";
  orderBId = orderIds[1] ?? "";
}

/** يمحو أثر التقييمات بين الحالات فقط — بيانات اختبار لا كود ولا هجرات. */
async function resetRatings(): Promise<void> {
  await sql`delete from ratings where order_id in (${orderAId}::uuid, ${orderBId}::uuid)`;
  await sql`
    update drivers set rating_average = null, rating_count = 0 where id = ${driverRowId}::uuid
  `;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  await seed();
});

beforeEach(async () => {
  if (DATABASE_URL === undefined) return;
  await resetRatings();
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from ratings where order_id in (${orderAId}::uuid, ${orderBId}::uuid)`;
  await sql`delete from orders where id in (${orderAId}::uuid, ${orderBId}::uuid)`;
  // صفوف التدقيق ترتبط بالفاعل بمفتاح أجنبي، فحذف المستخدم قبلها يفشل
  // بـ audit_log_actor_user_id_fkey. ولا يُحذف إلا ما أنشأه هذا الملف من فاعلين
  // معروفين بأعيانهم، فلا يمسّ سجلّ تدقيق غيره.
  await sql`
    delete from audit_log where actor_user_id in (
      select id from users where telegram_id in
        (${DRIVER_TG}, ${RIDER_A_TG}, ${RIDER_B_TG}, ${SUPPORT_TG})
    )
  `;
  await sql`
    delete from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER_TG}
    )
  `;
  await sql`
    delete from riders where user_id in (
      select id from users where telegram_id in
        (${DRIVER_TG}, ${RIDER_A_TG}, ${RIDER_B_TG})
    )
  `;
  await sql`
    delete from users where telegram_id in
      (${DRIVER_TG}, ${RIDER_A_TG}, ${RIDER_B_TG}, ${SUPPORT_TG})
  `;
  await sql.end({ timeout: 5 });
});

describeIf("متوسط التقييم تحت التزامن الحقيقي", () => {
  it("تقييمان متزامنان على طلبين مختلفين لا يضيع أحدهما من الرقم المخزَّن", async () => {
    // جلستان مستقلتان: التزامن لا يُحاكى بوعدين على اتصال واحد، فحوض الاتصالات
    // قد يُسلسلهما فيمرّ الاختبار على عيب قائم.
    const first = createSql({ connectionString: DATABASE_URL as string });
    const second = createSql({ connectionString: DATABASE_URL as string });

    // يُعلَن خارج المعاملة عن قصد: الثانية محجوزة على قفل تحمله الأولى، فلو
    // انتُظرت داخل معاملة الأولى لتعانق الطرفان ولم يتقدّم أحد.
    let contender: Promise<unknown> = Promise.resolve();

    // تهيئة الاتصالين قبل القياس: postgres.js يفتح الاتصال عند أول استعلام، وزمن
    // المصادقة والتهيئة يجعل الثانية لم تبلغ القفل بعد، فيُقاس انتظارٌ لم يبدأ.
    await first`select 1`;
    await second`select 1`;

    try {
      // الترتيب محتوم: الأولى تُدرج وتحسب وتبقى مفتوحة، فلقطة الثانية لا ترى
      // إدراجها. هكذا كان العيب يُنتج ضياعاً في كل مرة، لا في مرة من عشر.
      await first.begin(async (tx) => {
        await tx`select submit_rating(${orderAId}::uuid, ${RIDER_A_TG}::bigint, 5::smallint)`;

        // ملحوظة جوهرية عن postgres.js: الاستعلام مُرجأ لا فوريّ، لا يُرسل إلى
        // القاعدة إلا حين تُربط به معالجة (`then`/`catch`/`await`). فمجرّد إسناده
        // إلى متغير لا يبدأ شيئاً: أوّل صياغة لهذا الملف فعلت ذلك، فمرّت مرحلة
        // الرقم ولم يكن ثمّ تزامن أصلاً — وهو أسوأ من فشل: نجاحٌ كاذب. فربطُ
        // المعالجة هنا شرط إرساله، وتأكيدُ الحجز أدناه هو ما يكشف التزييف.
        contender = second`
          select submit_rating(${orderBId}::uuid, ${RIDER_B_TG}::bigint, 1::smallint)
        `.then(
          (rows) => rows,
          (error: unknown) => {
            throw error;
          },
        );

        // انتظارٌ مرصود لا مهلةٌ مقدّرة: نسأل pg_stat_activity حتى نرى الثانية
        // محجوزةً على قفل فعلاً. والتأكيد ليس تزييناً: بلاه يمرّ الاختبار على
        // تسلسلٍ لم يتداخل أصلاً، فيُعلن نجاحاً لم يختبر شيئاً.
        let waiting = 0;
        for (let attempt = 0; attempt < 100 && waiting === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const [blocked] = await sql<{ waiting: number }[]>`
            select count(*)::int as waiting from pg_stat_activity
             where datname = current_database()
               and wait_event_type = 'Lock'
               and query ilike '%submit_rating%'
          `;
          waiting = blocked?.waiting ?? 0;
        }
        expect(waiting).toBeGreaterThan(0);
      });

      // بعد إتمام الأولى يتحرّر القفل، فتقرأ الثانية حالةً تضمّ إدراج الأولى.
      await contender;

      const [stored] = await sql<{ average: string | null; count: number }[]>`
        select rating_average as average, rating_count as count
          from drivers where id = ${driverRowId}::uuid
      `;
      const [truth] = await sql<{ average: string | null; count: number }[]>`
        select round(avg(stars)::numeric, 2) as average, count(*)::int as count
          from ratings
         where ratee_user_id = ${driverUserId}::uuid
           and is_flagged = false
           and direction = 'rider_to_driver'
      `;

      expect(truth?.count).toBe(2);
      expect(stored?.count).toBe(truth?.count);
      expect(stored?.average).toBe(truth?.average);
    } finally {
      await contender.catch(() => undefined);
      await first.end({ timeout: 5 });
      await second.end({ timeout: 5 });
    }
  }, 30_000);

  it("متوسط المستخدم كسائق لا يتلوّث بتقييمه كراكب", async () => {
    // نفس صفّ users يحمل الدورين عبر جدولَي drivers و riders. الحساب الفوريّ
    // كان يجمع الاتجاهين، والمهمة الدورية تفلترهما، فكان الرقم يتغيّر وحده.
    await sql`select submit_rating(${orderAId}::uuid, ${RIDER_A_TG}::bigint, 5::smallint)`;

    await sql`
      insert into riders (city_id, user_id) values (${cityId}::uuid, ${driverUserId}::uuid)
      on conflict (user_id) do nothing
    `;
    await sql`
      insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id, stars)
      values (${cityId}::uuid, ${orderBId}::uuid, 'driver_to_rider',
              ${driverUserId}::uuid, ${riderAUserId}::uuid, 1)
      on conflict do nothing
    `;
    // تقييمٌ نحو السائق كـ«راكب» — لا يجوز أن يظهر في متوسطه كسائق
    await sql`
      insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id, stars)
      values (${cityId}::uuid, ${orderBId}::uuid, 'rider_to_driver',
              ${riderAUserId}::uuid, ${driverUserId}::uuid, 1)
      on conflict do nothing
    `;
    await sql`select recompute_ratee_averages(${driverUserId}::uuid, 'rider_to_driver')`;

    const [stored] = await sql<{ average: string | null; count: number }[]>`
      select rating_average as average, rating_count as count
        from drivers where id = ${driverRowId}::uuid
    `;
    const [truth] = await sql<{ count: number }[]>`
      select count(*)::int as count from ratings
       where ratee_user_id = ${driverUserId}::uuid
         and direction = 'rider_to_driver' and is_flagged = false
    `;
    expect(stored?.count).toBe(truth?.count);

    await sql`
      delete from ratings where ratee_user_id = ${riderAUserId}::uuid
        or (order_id = ${orderBId}::uuid and direction = 'rider_to_driver')
    `;
    await sql`delete from riders where user_id = ${driverUserId}::uuid`;
  });

  it("شطب تقييم يُخرجه من الرقم المعروض فوراً لا بعد المهمة الدورية", async () => {
    await sql`select submit_rating(${orderAId}::uuid, ${RIDER_A_TG}::bigint, 5::smallint)`;
    await sql`select submit_rating(${orderBId}::uuid, ${RIDER_B_TG}::bigint, 1::smallint)`;

    const [before] = await sql<{ average: string | null; count: number }[]>`
      select rating_average as average, rating_count as count
        from drivers where id = ${driverRowId}::uuid
    `;
    expect(before?.count).toBe(2);

    const [worst] = await sql<{ id: string }[]>`
      select id from ratings
       where order_id = ${orderBId}::uuid and direction = 'rider_to_driver'
    `;
    const worstId = worst?.id;
    if (worstId === undefined) throw new Error("لم يُعثر على التقييم المراد شطبه");

    const [flagged] = await sql<{ result: { ok: boolean } }[]>`
      select flag_rating(${worstId}::uuid, ${SUPPORT_TG}::bigint) as result
    `;
    expect(flagged?.result.ok).toBe(true);

    const [after] = await sql<{ average: string | null; count: number }[]>`
      select rating_average as average, rating_count as count
        from drivers where id = ${driverRowId}::uuid
    `;
    // بلا انتظار recompute_rating_averages: الأثر فوريّ أو لا أثر للقرار
    expect(after?.count).toBe(1);
    expect(after?.average).toBe("5.00");
  });

  it("نافذة تقييم غير مُعَدّة تُسقط النداء ولا تُخترَع قيمتها", async () => {
    // توضيح لما يقيسه هذا التأكيد بالدقة: الرقم `48` كان مكتوباً في
    // `coalesce(get_setting_number(...), 48)` فيوهم القارئ بأن القاعدة تخترع
    // نافذة 48 ساعة عند غياب الإعداد. والحقيقة أن `get_setting_number` تُطلق
    // `MISSING_SETTING` ولا تُعيد NULL، فذراع البديل ميتة. فالمقيس هنا أن
    // الإعداد ملزم فعلاً: غيابه يُسقط النداء بصراحة ولا يمرّ برقمٍ مخترع، وأن
    // إعادة أي بديل مرمَّز لاحقاً تكسر الاختبار.
    //
    // ويقيسه داخل معاملة تُرجع حتماً: حذف صفّ إعداد حقيقيّ ثم إعادته في
    // `finally` ليس أماناً — أوّل صياغة لهذا الملف فعلت ذلك، فأخطأت الإعادة
    // (أعمدة not null ناقصة) وبقيت قاعدة التطوير بلا إعداد حتى أُصلحت يدوياً.
    // الإرجاع واجب القاعدة لا واجب انتباهي.
    const [saved] = await sql<{ value: string }[]>`
      select value from platform_settings
       where city_id = ${cityId}::uuid and key = 'rating_prompt_window_hours'
    `;
    expect(saved?.value).toBeDefined();

    const ROLLBACK = "rollback-on-purpose";
    let raised: unknown;

    await sql
      .begin(async (tx) => {
        await tx`
          delete from platform_settings
           where city_id = ${cityId}::uuid and key = 'rating_prompt_window_hours'
        `;
        try {
          await tx`
            select submit_rating(${orderAId}::uuid, ${RIDER_A_TG}::bigint, 5::smallint)
          `;
        } catch (error) {
          raised = error;
        }
        throw new Error(ROLLBACK);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
      });

    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toContain("MISSING_SETTING:rating_prompt_window_hours");

    // الإرجاع تمّ داخل القاعدة، وهذا تأكيدٌ عليه لا ثقةٌ فيه
    const [after] = await sql<{ value: string }[]>`
      select value from platform_settings
       where city_id = ${cityId}::uuid and key = 'rating_prompt_window_hours'
    `;
    expect(after?.value).toBe(saved?.value);
  });
});
