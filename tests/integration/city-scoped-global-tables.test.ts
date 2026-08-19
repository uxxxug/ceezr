/**
 * الغرض: إثبات أن الجدولين اللذين كانا يُعَدّان «عالميين» — `db_backups`
 *   و`webhook_events` — صارا مرتبطين بمدينة حقيقية، وأن الارتباط مقيس من
 *   القاعدة نفسها لا من قراءة ملفات الهجرات.
 *
 *   سبب وجود هذا الملف أن حرس `scripts/check-migrations.ts` كان أحمر على
 *   `main`، وكان تعليق الهجرتين يصف الحالة بأنها «استثناء موثَّق». القاعدة
 *   في التوجيه مطلقة: كل جدول يحمل `city_id` من أول هجرة. فأُزيل الاستثناء
 *   وأُضيف العمودان فعلاً. لكن إزالة الاستثناء من الملف لا تُثبت شيئاً عن
 *   القاعدة المنشورة، ولذلك تقيس هذه الاختبارات السلوك:
 *
 *     ١. العمودان موجودان وnot null ومرتبطان بـ`cities` بمفتاح أجنبي.
 *     ٢. `record_webhook_event` الرباعية تقرأ مدينة الحدث من معاملة الدفع،
 *        فلا تُلفّق مدينة، وترفض المعاملة المجهولة بخطأ صريح.
 *     ٣. التوقيع الثلاثي القديم موقوف بخطأ يشرح البديل، لا يفشل بقيدٍ غامض.
 *     ٤. `db_backups` لا يقبل صفّاً بلا مدينة، والتفريغ الواحد يُسجَّل صفّاً
 *        لكل مدينة بمعرّف تفريغٍ واحد يجمعها.
 *
 *   البند ٣ ليس تجميلاً: أول صياغة للهجرة استعملت
 *   `pg_get_function_identity_arguments(oid) = 'text, text, text'`، وتلك
 *   الدالة تُعيد أسماء الوسائط مع أنواعها، فالشرط لم يتحقّق قط ومرّت الهجرة
 *   بنجاح تاركةً الدالة القديمة عاملة. كشفه تشغيلٌ على قاعدة حقيقية، ويحرسه
 *   هذا الاختبار من العودة.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكل هجرة تمسّ هذين الجدولين
 * ملاحظات مستقبلية: إن أُضيف مزوّد دفع حقيقي بأحداث لا تخصّ معاملةً بعينها
 *   (مثل أحداث حالة الحساب)، فالحلّ ليس تخفيف not null بل جدول منفصل لتلك
 *   الأحداث — لا تُرخّص `city_id` هنا.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفات الصفوف التي يزرعها هذا الملف، لتُنظَّف في النهاية دون لمس غيرها. */
const SEED_TELEGRAM_ID = 900000777;
const SEED_IDEMPOTENCY_KEY = "city-scoped-global-tables-test-key";
const SEED_EVENT_PREFIX = "city-scoped-test-evt-";
const SEED_BACKUP_FILE = "city-scoped-test-backup.sql.gz";

let transactionId = "";
let transactionCityCode = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // معاملة دفع حقيقية لنقيس بها وراثة المدينة. تُبنى من مدينة موجودة فعلاً
  // في القاعدة، لا من قائمة مدن مكتوبة في الاختبار.
  const [user] = await sql<{ id: string; city_id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select c.id, ${SEED_TELEGRAM_ID}, 'driver', 'سائق اختبار ربط المدينة', '+966500000777'
      from cities c
     order by c.code
     limit 1
    returning id, city_id
  `;
  if (user === undefined) throw new Error("تعذّر زرع المستخدم: لا مدن في القاعدة");

  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${user.city_id}, ${user.id}, 'verified')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرع السائق");

  const [txn] = await sql<{ id: string }[]>`
    insert into payment_transactions
      (city_id, payer_driver_id, amount_minor, currency, provider, status, idempotency_key)
    values (${user.city_id}, ${driver.id}, 25000, 'SAR', 'test-provider', 'pending',
            ${SEED_IDEMPOTENCY_KEY})
    returning id
  `;
  if (txn === undefined) throw new Error("تعذّر زرع معاملة الدفع");
  transactionId = txn.id;

  const [city] = await sql<{ code: string }[]>`
    select code from cities where id = ${user.city_id}
  `;
  if (city === undefined) throw new Error("تعذّر قراءة رمز المدينة");
  transactionCityCode = city.code;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from webhook_events where event_id like ${`${SEED_EVENT_PREFIX}%`}`;
  await sql`delete from db_backups where file_name = ${SEED_BACKUP_FILE}`;
  await sql`delete from payment_transactions where idempotency_key = ${SEED_IDEMPOTENCY_KEY}`;
  await sql`
    delete from drivers
     where user_id in (select id from users where telegram_id = ${SEED_TELEGRAM_ID})
  `;
  await sql`delete from users where telegram_id = ${SEED_TELEGRAM_ID}`;
  await sql.end();
});

describeIf("الجدولان العالميان سابقاً: ربطٌ حقيقي بمدينة", () => {
  it("العمودان موجودان، not null، ومرتبطان بـcities بمفتاح أجنبي", async () => {
    const columns = await sql<{ table_name: string; column_name: string; is_nullable: string }[]>`
      select table_name, column_name, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and table_name in ('db_backups', 'webhook_events')
         and column_name = 'city_id'
       order by table_name
    `;

    expect(columns.map((c) => c.table_name)).toEqual(["db_backups", "webhook_events"]);
    for (const column of columns) {
      expect(column.is_nullable).toBe("NO");
    }

    // المفتاح الأجنبي مقيس من pg_constraint: عمودٌ اسمه city_id بلا ارتباط
    // فعليّ بـcities يمرّ على الحرس النصّي ولا يمنع معرّفاً مُلفّقاً.
    const foreignKeys = await sql<{ table_name: string; definition: string }[]>`
      select c.conrelid::regclass::text as table_name,
             pg_get_constraintdef(c.oid)  as definition
        from pg_constraint c
       where c.contype = 'f'
         and c.conrelid in ('db_backups'::regclass, 'webhook_events'::regclass)
         and pg_get_constraintdef(c.oid) like '%city_id%'
       order by 1
    `;

    expect(foreignKeys).toHaveLength(2);
    for (const key of foreignKeys) {
      expect(key.definition).toContain("REFERENCES cities(id)");
    }
  });

  it("حدث الويبهوك يرث مدينة معاملته، ولا تُلفّق له مدينة", async () => {
    const [result] = await sql<{ result: { ok: boolean; is_new?: boolean } }[]>`
      select record_webhook_event(
        ${`${SEED_EVENT_PREFIX}inherit`}, 'test-provider', '{}', ${transactionId}
      ) as result
    `;
    expect(result?.result.ok).toBe(true);
    expect(result?.result.is_new).toBe(true);

    const [row] = await sql<{ city_code: string; transaction_id: string }[]>`
      select c.code as city_code, e.transaction_id
        from webhook_events e
        join cities c on c.id = e.city_id
       where e.event_id = ${`${SEED_EVENT_PREFIX}inherit`}
    `;
    expect(row?.city_code).toBe(transactionCityCode);
    expect(row?.transaction_id).toBe(transactionId);
  });

  it("تكرار الحدث لا يُنشئ صفّاً ثانياً ولا يفشل", async () => {
    const [again] = await sql<{ result: { ok: boolean; is_new?: boolean } }[]>`
      select record_webhook_event(
        ${`${SEED_EVENT_PREFIX}inherit`}, 'test-provider', '{}', ${transactionId}
      ) as result
    `;
    expect(again?.result.ok).toBe(true);
    expect(again?.result.is_new).toBe(false);

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from webhook_events
       where event_id = ${`${SEED_EVENT_PREFIX}inherit`}
    `;
    expect(count?.n).toBe(1);
  });

  it("المعاملة المجهولة تُرفض بخطأ صريح، بلا صفٍّ وبلا نجاحٍ كاذب", async () => {
    const [result] = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select record_webhook_event(
        ${`${SEED_EVENT_PREFIX}unknown`}, 'test-provider', '{}',
        '00000000-0000-0000-0000-000000000000'
      ) as result
    `;
    expect(result?.result.ok).toBe(false);
    expect(result?.result.error).toBe("TRANSACTION_NOT_FOUND");

    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n
        from webhook_events
       where event_id = ${`${SEED_EVENT_PREFIX}unknown`}
    `;
    expect(count?.n).toBe(0);
  });

  it("التوقيع الثلاثي القديم موقوف بخطأ يشرح البديل", async () => {
    // القاعدة المبنية من الصفر لا تحمل هذا التوقيع أصلاً — وذلك مقبول ومقصود.
    // أمّا إن كان موجوداً (قاعدة مُرقّاة)، فيجب أن يرفض صراحةً لا أن يعمل.
    const [exists] = await sql<{ present: boolean }[]>`
      select exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.oid::regprocedure::text = 'record_webhook_event(text,text,text)'
      ) as present
    `;
    if (exists?.present !== true) return;

    let message = "";
    try {
      await sql`select record_webhook_event(${`${SEED_EVENT_PREFIX}legacy`}, 'p', '{}')`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain("موقوفة");
    expect(message).toContain("record_webhook_event(text,text,text,uuid)");
  });

  it("db_backups يرفض صفّاً بلا مدينة", async () => {
    let failed = false;
    try {
      await sql`
        insert into db_backups (backup_run_id, remote_file_id, file_name, bytes, status)
        values (gen_random_uuid(), 'no-city', ${SEED_BACKUP_FILE}, 1, 'success')
      `;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("التفريغ الواحد يُسجَّل صفّاً لكل مدينة بمعرّف تفريغٍ واحد", async () => {
    // نفس العبارة التي تستعملها وظيفة النسخ الاحتياطي: معرّف مُولَّد مرّة
    // واحدة خارج الـselect، لأن gen_random_uuid() داخلها تُقيَّم لكل صفّ.
    const [generated] = await sql<{ run_id: string }[]>`select gen_random_uuid() as run_id`;
    const runId = generated?.run_id;
    expect(runId).toBeString();

    await sql`
      insert into db_backups (city_id, backup_run_id, remote_file_id, file_name, bytes, status)
      select c.id, ${runId ?? null}, 'fan-out', ${SEED_BACKUP_FILE}, 4096, 'success'
        from cities c
    `;

    const [cityCount] = await sql<{ n: number }[]>`select count(*)::int as n from cities`;
    const rows = await sql<{ n: number; runs: number }[]>`
      select count(*)::int as n, count(distinct backup_run_id)::int as runs
        from db_backups
       where file_name = ${SEED_BACKUP_FILE}
    `;

    expect(rows[0]?.n).toBe(cityCount?.n);
    expect(rows[0]?.runs).toBe(1);
  });
});
