/**
 * الغرض: قياسُ وثائقِ السائقِ على قاعدةٍ حقيقيّةٍ (`F3-01` · `SD-01` · `SD-02` ·
 *   `F12-14`) — وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ عليه حاجزٌ ساكنٌ**:
 *     ــ أنَّ **الحجبَ ساعةٌ لا رايةٌ**: صفٌّ «مقبولٌ» تجاوزَ تاريخَه يُحجَبُ
 *        بلا وظيفةٍ تُشغَّلُ ولا عمودٍ يُقلَبُ (`ADR 0115`).
 *     ــ أنَّ **الحاجزَ آخرُ بابٍ**: `open_offer_round` نفسُها تُصفّي المحجوبَ،
 *        فلا مسارٌ إداريٌّ ولا سكربتٌ يُدخِلُ عرضاً لسائقٍ محجوبٍ.
 *     ــ أنَّ **القيدَ والفهرسَ موجودانِ مُصدَّقَينِ** في كتالوجِ القاعدةِ لا في
 *        نصِّ هجرةٍ: قيدٌ `not valid` يُقرأُ في الهجرةِ حاجزاً وهوَ لا يحرسُ
 *        صفّاً قديماً، والفهرسُ المُنشَأُ `concurrently` قد يُخلَقُ `invalid`.
 *     ــ أنَّ **المسارَ حكمُ القاعدةِ**: مسارُ غيرِكَ يُرَدُّ ولا يُسجَّلُ.
 *     ــ أنَّ **الرفعَ لا يُقاسُ ههنا** — التوقيعُ أثرٌ عندَ مزوِّدٍ حقيقيٍّ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F4-xx` (لوحُ المراجعةِ) — يقيسُ القبولَ والرفضَ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا توقيعَ ولا رفعَ بايتٍ**: لا مخزنَ في CI؛ الأثرُ الحقيقيُّ في
 *    `docs/evidence/storage/F3-01-SIGNED-UPLOAD-20260915.md`، والمحوّلُ مقيسٌ
 *    بجالبٍ محقونٍ في `tests/unit/signed-upload.test.ts`.
 * ــ **لا يُقاسُ وجودُ الكائنِ فعلاً**: `record_driver_document` تُسجِّلُ ما قالَه
 *    العميلُ — ومطابقةُ الوجودِ **دَينٌ مُعلَنٌ**.
 * ــ `RLS` يُقاسُ وجوداً لا أثراً: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
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

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_301;
const OTHER_DRIVER_TELEGRAM_ID = 900_000_302;
const RIDER_TELEGRAM_ID = 900_000_303;
const ABSENT_TELEGRAM_ID = 900_000_304;
const BLOCKED_TELEGRAM_ID = 900_000_305;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

/** مدينةُ الزرعِ: إحداثيّاتُ `PICKUP`/`DROPOFF` أعلاه داخلَ منطقةِ خدمةِ جدّة. */
const SEED_CITY_CODE = "JED";

/** قروباتُ التفعيلِ الثلاثةُ — قيدُ `cities_active_requires_groups` يوجِبُها. */
const SEED_GROUP_IDS = { support: -1_003_001, escalation: -1_003_002, unsubscribed: -1_003_003 };

let cityId = "";
let cityWasActive = false;
let driverUserId = "";
let driverId = "";
let otherUserId = "";
let otherDriverId = "";
let riderUserId = "";
let riderId = "";
let blockedUserId = "";
let requiredTypes: readonly string[] = [];

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

function slot(
  telegramId: number,
  docType: string,
  contentType = "image/png",
  sizeBytes = 1024,
): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_document_upload_slot(
      ${telegramId}::bigint, ${docType}::driver_document_type, ${contentType}, ${sizeBytes}::bigint
    ) as result
  `);
}

function record(
  telegramId: number,
  docType: string,
  objectPath: string,
  expiresAt: string | null,
): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select record_driver_document(
      ${telegramId}::bigint, ${docType}::driver_document_type, ${objectPath}, ${expiresAt}::date
    ) as result
  `);
}

function dashboard(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_document_dashboard(${telegramId}::bigint) as result
  `);
}

function submit(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select submit_driver_documents_for_review(${telegramId}::bigint) as result
  `);
}

async function blockReasons(driver: string, today?: string): Promise<readonly string[]> {
  const [row] =
    today === undefined
      ? await sql<{ reasons: string[] }[]>`
          select driver_document_block_reasons(${driver}::uuid) as reasons
        `
      : await sql<{ reasons: string[] }[]>`
          select driver_document_block_reasons(${driver}::uuid, ${today}::date) as reasons
        `;
  return row?.reasons ?? [];
}

/** يومٌ مدنيٌّ **بساعةِ القاعدةِ** — لا بساعةِ المُشغِّلِ. */
async function dbDay(offsetDays: number): Promise<string> {
  const [row] = await sql<{ day: string }[]>`
    select to_char(current_date + ${offsetDays}::integer, 'YYYY-MM-DD') as day
  `;
  if (row === undefined) throw new Error("تعذّر قراءةُ يومِ القاعدةِ");
  return row.day;
}

/** يُقبَلُ صفٌّ مباشرةً — لوحُ المراجعةِ بندٌ لاحقٌ، والقبولُ ههنا حالةٌ مزروعةٌ. */
async function acceptRow(driver: string, docType: string, expiresAt: string): Promise<void> {
  await sql`
    update driver_documents
       set status = 'accepted', expires_at = ${expiresAt}::date, reviewed_at = now()
     where driver_id = ${driver}::uuid and doc_type = ${docType}::driver_document_type
  `;
}

/**
 * يجعلُ سائقاً **محجوباً بوثيقةٍ مُناقِضةٍ**: كلُّ وثائقِه مقبولةٌ إلّا واحدةً
 * انتهى تاريخُها أمسِ. وهذا هوَ الحجبُ الذي يُسقِطُ مرشَّحاً من دورةِ العرضِ
 * بعدَ تضييقِ البابِ في `20260915010000` — لا مجرَّدُ غيابِ صفٍّ.
 */
async function makeExpired(telegramId: number, driver: string): Promise<void> {
  await makeClear(telegramId, driver);
  await sql`
    update driver_documents set expires_at = current_date - 1
     where driver_id = ${driver}::uuid and doc_type = 'insurance'
  `;
}

/** يُفرِغُ وثائقَ سائقٍ — حالُ سائقٍ اعتمدَته الإدارةُ قبلَ `F3-01`. */
async function makeUndocumented(driver: string): Promise<void> {
  await sql`delete from driver_documents where driver_id = ${driver}::uuid`;
}

/** كلُّ الوثائقِ الإلزاميّةِ مقبولةً وصالحةً — نقطةُ بدءٍ «غيرِ محجوبٍ». */
async function makeClear(telegramId: number, driver: string): Promise<void> {
  const future = await dbDay(400);
  for (const docType of requiredTypes) {
    const granted = await slot(telegramId, docType);
    const objectPath = String(granted.object_path);
    await record(telegramId, docType, objectPath, future);
    await acceptRow(driver, docType, future);
  }
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // **الشرطُ المسبقُ يُصنَعُ ههنا لا يُستعارُ.** بذرةُ الهجراتِ تُنشئُ مدنَ
  // الإطلاقِ الخمسَ **معطَّلةً** (`is_active = false`) بقرارِ `F2-05`، ومنطقةُ
  // خدمةٍ مفعَّلةٌ واحدةٌ لـ`JED` وحدَها. فاستعلامٌ يطلبُ «أوّلَ مدينةٍ مفعَّلةٍ»
  // لا يجدُ شيئاً على قاعدةٍ نظيفةٍ، ولا ينجحُ إلّا إن سبقَه ملفُّ اختبارٍ آخرُ
  // فعَّلَ مدينةً ولم يُرجِعْها — فيصيرُ الأخضرُ رهنَ ترتيبِ التشغيلِ لا سلوكِ
  // المنتَجِ (وهذا عينُ ما أسقطَ وظيفةَ التكاملِ في الجولةِ `34909694080`).
  // فالمدينةُ تُختارُ بالرمزِ، وتُفعَّلُ صراحةً، وتُردُّ إلى حالتِها في `afterAll`.
  const [city] = await sql<{ id: string; was_active: boolean }[]>`
    select c.id, c.is_active as was_active from cities c
      join city_service_areas a on a.city_id = c.id and a.is_active
     where c.code = ${SEED_CITY_CODE}
     limit 1
  `;
  if (city === undefined) {
    throw new Error(`تعذّر الزرعُ: لا مدينةَ بالرمزِ ${SEED_CITY_CODE} لها منطقةُ خدمةٍ مفعَّلةٌ`);
  }
  cityId = city.id;
  cityWasActive = city.was_active;
  if (!cityWasActive) {
    // `cities_active_requires_groups`: مدينةٌ مفعَّلةٌ بلا قروباتٍ حالةٌ ممنوعةٌ
    // في القاعدةِ نفسِها (`F2-05`)، فالتفعيلُ يستوفي القيدَ ولا يُخفِّفُه.
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = coalesce(telegram_support_group_id, ${SEED_GROUP_IDS.support}),
             telegram_escalation_group_id = coalesce(telegram_escalation_group_id, ${SEED_GROUP_IDS.escalation}),
             telegram_unsubscribed_drivers_group_id = coalesce(telegram_unsubscribed_drivers_group_id, ${SEED_GROUP_IDS.unsubscribed})
       where id = ${cityId}
    `;
  }

  const [types] = await sql<{ types: string[] }[]>`
    select driver_required_document_types(${cityId}::uuid)::text[] as types
  `;
  requiredTypes = types?.types ?? [];
  if (requiredTypes.length === 0) {
    throw new Error("تعذّر الزرعُ: لا أنواعَ إلزاميّةً في إعداداتِ المدينةِ");
  }

  const seedDriver = async (
    telegramId: number,
    name: string,
    phone: string,
  ): Promise<{ userId: string; driverId: string }> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'driver', ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ر س د ${telegramId % 10_000}`})
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    return { userId: user.id, driverId: driver.id };
  };

  const main = await seedDriver(DRIVER_TELEGRAM_ID, "سائقُ الوثائقِ", "+966500000301");
  driverUserId = main.userId;
  driverId = main.driverId;
  const other = await seedDriver(OTHER_DRIVER_TELEGRAM_ID, "سائقٌ آخرُ", "+966500000302");
  otherUserId = other.userId;
  otherDriverId = other.driverId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبةُ الوثائقِ', '+966500000303')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;

  const [blocked] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, is_blocked)
    values (${cityId}, ${BLOCKED_TELEGRAM_ID}, 'driver', 'سائقٌ موقوفٌ', '+966500000305', true)
    returning id
  `;
  if (blocked === undefined) throw new Error("تعذّر زرعُ الموقوفِ");
  blockedUserId = blocked.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // **الترتيبُ مقصودٌ**: `notification_outbox` يشيرُ إلى `order_offers`، فحذفُ
  // العرضِ قبلَ إشعارِه يُوقِعُ `23001` ويُترِكُ صفوفاً مزروعةً في القاعدةِ.
  for (const id of [driverId, otherDriverId]) {
    if (id === "") continue;
    await sql`delete from driver_documents where driver_id = ${id}`;
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
  }
  if (riderId !== "") {
    await sql`
      delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})
    `;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  for (const id of [driverId, otherDriverId]) {
    if (id !== "") await sql`delete from drivers where id = ${id}`;
  }
  for (const id of [driverUserId, otherUserId, riderUserId, blockedUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  // ترجعُ المدينةُ إلى حالتِها قبلَ هذا الملفِّ: تركُها مفعَّلةً يُورِّثُ لِمَن
  // بعدَها شرطاً لم يطلُبْه، وهوَ الداءُ نفسُه معكوساً.
  if (cityId !== "" && !cityWasActive) {
    await sql`
      update cities
         set is_active = false,
             telegram_support_group_id = case when telegram_support_group_id = ${SEED_GROUP_IDS.support}
               then null else telegram_support_group_id end,
             telegram_escalation_group_id = case when telegram_escalation_group_id = ${SEED_GROUP_IDS.escalation}
               then null else telegram_escalation_group_id end,
             telegram_unsubscribed_drivers_group_id = case
               when telegram_unsubscribed_drivers_group_id = ${SEED_GROUP_IDS.unsubscribed}
               then null else telegram_unsubscribed_drivers_group_id end
       where id = ${cityId}
    `;
  }
  await sql.end();
});

describeIf("بنيةُ القاعدةِ — القيدُ والفهرسُ مُصدَّقانِ في الكتالوجِ لا في نصِّ هجرةٍ", () => {
  it("١) القيودُ الثلاثةُ **مُصدَّقةٌ** (`convalidated`) — قيدٌ `not valid` لا يحرسُ صفّاً قديماً", async () => {
    const rows = await sql<{ conname: string; convalidated: boolean }[]>`
      select conname, convalidated
        from pg_constraint
       where conrelid = 'driver_documents'::regclass and contype = 'c'
       order by conname
    `;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row.convalidated).toBe(true);
  });

  it("٢) فهرسا الحجبِ **صالحانِ** (`indisvalid`) — فهرسٌ معطوبٌ يُقرأُ موجوداً ولا يُستعمَلُ", async () => {
    const rows = await sql<{ indexrelid: string; indisvalid: boolean; indisready: boolean }[]>`
      select i.indexrelid::regclass::text as indexrelid, i.indisvalid, i.indisready
        from pg_index i
       where i.indrelid = 'driver_documents'::regclass
    `;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.indisvalid).toBe(true);
      expect(row.indisready).toBe(true);
    }
  });

  it("٣) نوعٌ واحدٌ لكلِّ سائقٍ — الإحلالُ يُحدِّثُ صفّاً ولا يُكوِّمُ صفوفاً", async () => {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::integer as count
        from pg_constraint
       where conrelid = 'driver_documents'::regclass and contype = 'u'
    `;
    expect(row?.count).toBeGreaterThanOrEqual(1);
  });
});

describeIf("خانةُ الرفعِ — المسارُ حكمُ القاعدةِ والسياسةُ من الإعداداتِ", () => {
  it("٤) خانةٌ ممنوحةٌ تحملُ مساراً ببادئةِ السائقِ ومدّةً وحدّاً من الإعداداتِ", async () => {
    const granted = await slot(DRIVER_TELEGRAM_ID, "driving_license");
    expect(granted.ok).toBe(true);
    expect(String(granted.object_path).startsWith(`drivers/${driverId}/driving_license/`)).toBe(
      true,
    );
    expect(granted.content_type).toBe("image/png");
    expect(Number(granted.max_bytes)).toBeGreaterThan(0);
    expect(Number(granted.ttl_seconds)).toBeGreaterThan(0);
  });

  it("٥) مسارانِ لطلبَينِ **لا يتشابهانِ** — رفعٌ جديدٌ لا يكتبُ فوقَ كائنٍ قائمٍ", async () => {
    const first = await slot(DRIVER_TELEGRAM_ID, "insurance");
    const second = await slot(DRIVER_TELEGRAM_ID, "insurance");
    expect(first.object_path).not.toBe(second.object_path);
  });

  it("٦) نوعُ محتوىً غيرُ مسموحٍ وحجمٌ فوقَ الحدِّ وحجمٌ غيرُ موجبٍ — ثلاثةُ رفوضٍ مُسمّاةٍ", async () => {
    expect((await slot(DRIVER_TELEGRAM_ID, "insurance", "image/gif")).error).toBe(
      "CONTENT_TYPE_NOT_ALLOWED",
    );
    expect((await slot(DRIVER_TELEGRAM_ID, "insurance", "image/png", 99_999_999)).error).toBe(
      "FILE_TOO_LARGE",
    );
    expect((await slot(DRIVER_TELEGRAM_ID, "insurance", "image/png", 0)).error).toBe(
      "SIZE_NOT_POSITIVE",
    );
  });

  it("٧) حسابٌ معدومٌ وراكبةٌ وموقوفٌ — كلٌّ برفضِه ولا خانةَ لأحدِهم", async () => {
    expect((await slot(ABSENT_TELEGRAM_ID, "insurance")).error).toBe("USER_NOT_FOUND");
    expect((await slot(RIDER_TELEGRAM_ID, "insurance")).error).toBe("NOT_A_DRIVER");
    expect((await slot(BLOCKED_TELEGRAM_ID, "insurance")).error).toBe("USER_BLOCKED");
  });
});

describeIf("تسجيلُ الوثيقةِ — لا مسارَ لغيرِكَ ولا تاريخَ يمضي", () => {
  it("٨) **مسارُ غيرِكَ يُرَدُّ**: بادئةُ سائقٍ آخرَ لا تُسجَّلُ ولو كانت صحيحةَ الشكلِ", async () => {
    const future = await dbDay(200);
    const stolen = `drivers/${otherDriverId}/insurance/${crypto.randomUUID()}.png`;
    expect((await record(DRIVER_TELEGRAM_ID, "insurance", stolen, future)).error).toBe(
      "OBJECT_PATH_NOT_MINE",
    );
    const [row] = await sql<{ count: number }[]>`
      select count(*)::integer as count from driver_documents where object_path = ${stolen}
    `;
    expect(row?.count).toBe(0);
  });

  it("٩) تاريخٌ غائبٌ أو ماضٍ أو بعيدٌ جدّاً — ثلاثةُ رفوضٍ، واليومُ نفسُه ماضٍ", async () => {
    const granted = await slot(DRIVER_TELEGRAM_ID, "insurance");
    const objectPath = String(granted.object_path);
    expect((await record(DRIVER_TELEGRAM_ID, "insurance", objectPath, null)).error).toBe(
      "EXPIRY_REQUIRED",
    );
    expect((await record(DRIVER_TELEGRAM_ID, "insurance", objectPath, await dbDay(-1))).error).toBe(
      "EXPIRY_IN_PAST",
    );
    expect((await record(DRIVER_TELEGRAM_ID, "insurance", objectPath, await dbDay(0))).error).toBe(
      "EXPIRY_IN_PAST",
    );
    expect(
      (await record(DRIVER_TELEGRAM_ID, "insurance", objectPath, await dbDay(9000))).error,
    ).toBe("EXPIRY_TOO_FAR");
  });

  it("١٠) تسجيلٌ صحيحٌ يُنشِئُ صفّاً `received` ويُكتَبُ في سجلِّ التدقيقِ", async () => {
    const future = await dbDay(300);
    const granted = await slot(DRIVER_TELEGRAM_ID, "medical_exam");
    const recorded = await record(
      DRIVER_TELEGRAM_ID,
      "medical_exam",
      String(granted.object_path),
      future,
    );
    expect(recorded.ok).toBe(true);
    expect(recorded.status).toBe("received");
    expect(recorded.replaced).toBe(false);
    const [audited] = await sql<{ count: number }[]>`
      select count(*)::integer as count from audit_log
       where actor_user_id = ${driverUserId} and action = 'driver.document_recorded'
    `;
    expect(Number(audited?.count)).toBeGreaterThan(0);
  });

  it("١١) إحلالٌ ثانٍ يُعلَنُ `replaced` ويبقى الصفُّ واحداً — لا تكويمَ نسخٍ", async () => {
    const future = await dbDay(310);
    const granted = await slot(DRIVER_TELEGRAM_ID, "medical_exam");
    const recorded = await record(
      DRIVER_TELEGRAM_ID,
      "medical_exam",
      String(granted.object_path),
      future,
    );
    expect(recorded.ok).toBe(true);
    expect(recorded.replaced).toBe(true);
    const [row] = await sql<{ count: number }[]>`
      select count(*)::integer as count from driver_documents
       where driver_id = ${driverId} and doc_type = 'medical_exam'
    `;
    expect(row?.count).toBe(1);
  });
});

describeIf("أسبابُ الحجبِ — **ساعةٌ لا رايةٌ**", () => {
  it("١٢) الغيابُ يُقالُ `MISSING:` باسمِ النوعِ لكلِّ إلزاميٍّ لم يُرفَعْ", async () => {
    const reasons = await blockReasons(otherDriverId);
    expect(reasons.length).toBe(requiredTypes.length);
    for (const type of requiredTypes) expect(reasons).toContain(`MISSING:${type}`);
  });

  it("١٣) المُستلَمُ غيرُ المُراجَعِ يُقالُ `UNVERIFIED:` — ولا يُقرأُ قبولاً", async () => {
    const future = await dbDay(320);
    const granted = await slot(OTHER_DRIVER_TELEGRAM_ID, "driving_license");
    await record(OTHER_DRIVER_TELEGRAM_ID, "driving_license", String(granted.object_path), future);
    expect(await blockReasons(otherDriverId)).toContain("UNVERIFIED:driving_license");
  });

  it("١٤) المرفوضُ يُقالُ `REJECTED:` بنوعِه", async () => {
    await sql`
      update driver_documents set status = 'rejected', review_note = 'صورةٌ مقطوعةٌ'
       where driver_id = ${otherDriverId} and doc_type = 'driving_license'
    `;
    expect(await blockReasons(otherDriverId)).toContain("REJECTED:driving_license");
  });

  it("١٥) **صفٌّ مقبولٌ مضى تاريخُه يُحجَبُ بلا وظيفةٍ تُشغَّلُ**: الغدُ يمرُّ واليومُ التالي يحجبُ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    expect(await blockReasons(driverId)).toEqual([]);

    const tomorrow = await dbDay(1);
    await acceptRow(driverId, "insurance", tomorrow);
    // اليومَ: صالحةٌ. وبعدَ غدٍ: منتهيةٌ — **بالساعةِ نفسِها ولا كتابةَ صفٍّ**.
    expect(await blockReasons(driverId)).toEqual([]);
    expect(await blockReasons(driverId, await dbDay(2))).toEqual(["EXPIRED:insurance"]);
  });

  it("١٦) يومُ الانتهاءِ نفسُه **ليسَ حجباً** — الوثيقةُ صالحةٌ إلى آخرِ يومِها", async () => {
    const today = await dbDay(0);
    await acceptRow(driverId, "insurance", today);
    expect(await blockReasons(driverId, today)).toEqual([]);
    expect(await blockReasons(driverId, await dbDay(1))).toEqual(["EXPIRED:insurance"]);
  });
});

describeIf("لوحُ السائقِ — صفٌّ لكلِّ إلزاميٍّ وحجبٌ محسوبٌ مرّةً", () => {
  it("١٧) اللوحُ يُعيدُ صفّاً لكلِّ نوعٍ إلزاميٍّ وإن لم يُرفَعْ، والغيابُ `status: null`", async () => {
    const board = await dashboard(OTHER_DRIVER_TELEGRAM_ID);
    expect(board.ok).toBe(true);
    const documents = board.documents as ReadonlyArray<Record<string, unknown>>;
    expect(documents.length).toBe(requiredTypes.length);
    const missing = documents.find((row) => row.submitted === false);
    expect(missing?.status).toBeNull();
  });

  it("١٨) `is_blocked` وأسبابُه من **الحَكَمِ نفسِه** الذي يُصفّي العروضَ", async () => {
    const board = await dashboard(OTHER_DRIVER_TELEGRAM_ID);
    expect(board.is_blocked).toBe(true);
    expect(board.block_reasons).toEqual([...(await blockReasons(otherDriverId))]);
    expect(Number(board.warning_days)).toBeGreaterThan(0);
  });

  it("١٩) وثيقةٌ مقبولةٌ تقتربُ من الانتهاءِ تُعلَنُ `expires_soon` بأيّامٍ باقيةٍ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    await acceptRow(driverId, "criminal_record", await dbDay(5));
    const board = await dashboard(DRIVER_TELEGRAM_ID);
    const documents = board.documents as ReadonlyArray<Record<string, unknown>>;
    const row = documents.find((entry) => entry.doc_type === "criminal_record");
    expect(row?.expires_soon).toBe(true);
    expect(Number(row?.days_left)).toBe(5);
    expect(board.is_blocked).toBe(false);
  });

  it("٢٠) حسابٌ معدومٌ وراكبةٌ — رفضانِ مُسمّيانِ ولا لوحَ فارغٍ يُقرأُ نجاحاً", async () => {
    expect((await dashboard(ABSENT_TELEGRAM_ID)).error).toBe("USER_NOT_FOUND");
    expect((await dashboard(RIDER_TELEGRAM_ID)).error).toBe("NOT_A_DRIVER");
  });
});

describeIf("الإرسالُ للمراجعةِ", () => {
  it("٢١) ناقصُ الوثائقِ يُرَدُّ `DOCUMENTS_INCOMPLETE` **بتسميةِ الناقصِ** لا برسالةٍ عامّةٍ", async () => {
    const result = await submit(OTHER_DRIVER_TELEGRAM_ID);
    expect(result.error).toBe("DOCUMENTS_INCOMPLETE");
    // `SD-02` ينصُّ «ناقص (بتحديد الناقص)»: الرفضُ يحملُ أسماءَ الأنواعِ الغائبةِ،
    // فلا يُخمِّنُ السائقُ أيَّ وثيقةٍ يرفعُ.
    const missing = result.missing as readonly string[];
    expect(missing.length).toBeGreaterThan(0);
    for (const type of missing) expect(requiredTypes).toContain(type);
  });

  it("٢٢) المكتملُ يُرسَلُ ويُكتَبُ في سجلِّ التدقيقِ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    // كلُّ الوثائقِ مقبولةٌ؛ فالإرسالُ يُعادُ بنجاحٍ ولا صفَّ `received` يُقلَبُ.
    const result = await submit(DRIVER_TELEGRAM_ID);
    expect(result.ok).toBe(true);
    expect(result.block_reasons).toEqual([]);
    const [audited] = await sql<{ count: number }[]>`
      select count(*)::integer as count from audit_log
       where actor_user_id = ${driverUserId} and action = 'driver.documents_submitted'
    `;
    expect(Number(audited?.count)).toBeGreaterThan(0);
  });
});

describeIf("`F12-14` — الدالّةُ آخرُ بابٍ: المحجوبُ لا يُدرَجُ له عرضٌ", () => {
  async function seedSearchingOrder(): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (
        city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
        broadcast_round, idempotency_key
      ) values (
        ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
        st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
        st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
        'البلد', 'الروضة', 0, ${`f3-01:${crypto.randomUUID()}`}
      ) returning id
    `;
    if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
    return row.id;
  }

  /** مدخلُ مرشَّحٍ كما يُمرِّرُه مُحرِّكُ المطابقةِ — قيمٌ قابلةٌ للتحويلِ إلى JSON. */
  type RoundEntry = { readonly [key: string]: string | number };

  function openRound(orderId: string, entries: readonly RoundEntry[]) {
    return callJson(sql<{ result: Payload }[]>`
      select open_offer_round(
        ${orderId}::uuid, 1, now() + interval '30 seconds', ${sql.json([...entries])}
      ) as result
    `);
  }

  it("٢٣) دورةٌ فيها محجوبٌ وسليمٌ: عرضٌ واحدٌ، والمحجوبُ **معدودٌ باسمِه**", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    // المحجوبُ محجوبٌ **بوثيقةٍ منتهيةٍ** لا بغيابِ صفٍّ: هذا ما يُسقِطُ مرشَّحاً
    // بعدَ `20260915010000`، والاختبارُ يقيسُ الحاجزَ القائمَ لا حاجزاً مُتخيَّلاً.
    await makeExpired(OTHER_DRIVER_TELEGRAM_ID, otherDriverId);
    expect(await blockReasons(otherDriverId)).toContain("EXPIRED:insurance");
    const orderId = await seedSearchingOrder();
    const result = await openRound(orderId, [
      { driver_id: driverId, score: 1, distance_km: 1 },
      { driver_id: otherDriverId, score: 2, distance_km: 2 },
    ]);
    expect(result.ok).toBe(true);
    expect(result.offers).toBe(1);
    expect(result.blocked_by_documents).toBe(1);
    const rows = await sql<{ driver_id: string }[]>`
      select driver_id from order_offers where order_id = ${orderId}
    `;
    expect(rows.map((row) => row.driver_id)).toEqual([driverId]);
  });

  it("٢٤) **ولا إشعارَ للمحجوبِ**: ما لم يُدرَجْ عرضُه لم يُكتَبْ صفُّ إشعارٍ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    await makeExpired(OTHER_DRIVER_TELEGRAM_ID, otherDriverId);
    const orderId = await seedSearchingOrder();
    await openRound(orderId, [
      { driver_id: driverId, score: 1, distance_km: 1 },
      { driver_id: otherDriverId, score: 2, distance_km: 2 },
    ]);
    const rows = await sql<{ driver_id: string }[]>`
      select driver_id from notification_outbox where order_id = ${orderId}
    `;
    expect(rows.map((row) => row.driver_id)).toEqual([driverId]);
  });

  it("٢٥) انتهاءُ وثيقةٍ **وحدَه** يُخرِجُ سائقاً كانَ يُعرَضُ عليه أمسِ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    const before = await openRound(await seedSearchingOrder(), [
      { driver_id: driverId, score: 1, distance_km: 1 },
    ]);
    expect(before.offers).toBe(1);

    // لا رايةَ تُقلَبُ ولا حسابَ يُوقَفُ: تاريخٌ يمضي فحسب.
    await sql`
      update driver_documents set expires_at = current_date - 1
       where driver_id = ${driverId} and doc_type = 'insurance'
    `;
    const after = await openRound(await seedSearchingOrder(), [
      { driver_id: driverId, score: 1, distance_km: 1 },
    ]);
    expect(after.offers).toBe(0);
    expect(after.blocked_by_documents).toBe(1);
  });

  it("٢٦) **الرفضُ يحجبُ كالانتهاءِ**: وثيقةٌ مرفوضةٌ بسببٍ تُسقِطُ المرشَّحَ", async () => {
    await makeClear(DRIVER_TELEGRAM_ID, driverId);
    await sql`
      update driver_documents
         set status = 'rejected', review_note = 'الصورةُ غيرُ مقروءةٍ', reviewed_at = now()
       where driver_id = ${driverId} and doc_type = 'driving_license'
    `;
    expect(await blockReasons(driverId)).toContain("REJECTED:driving_license");
    const result = await openRound(await seedSearchingOrder(), [
      { driver_id: driverId, score: 1, distance_km: 1 },
    ]);
    expect(result.offers).toBe(0);
    expect(result.blocked_by_documents).toBe(1);
  });

  it("٢٧) **وغيابُ الوثائقِ كلِّها لا يُسقِطُ سائقاً اعتمدَته الإدارةُ** — حدُّ البندِ مكتوبٌ ومقيسٌ", async () => {
    // سائقٌ `verified` بلا صفِّ وثيقةٍ واحدٍ: حالُ كلِّ سائقٍ في القاعدةِ قبلَ
    // نشرِ `F3-01`. حجبُه ههنا يعني انقطاعَ خدمةٍ في لحظةِ الهجرةِ، ومنعُ
    // اعتمادِه ابتداءً بابُ لوحِ المراجعةِ (`SD-02`) — دَينٌ مُعلَنٌ لا مُنجَزٌ.
    await makeUndocumented(driverId);
    expect(await blockReasons(driverId)).toContain("MISSING:insurance");
    const [dispatchOnly] = await sql<{ reasons: string[] }[]>`
      select driver_document_dispatch_block_reasons(${driverId}::uuid) as reasons
    `;
    expect(dispatchOnly?.reasons).toEqual([]);
    const result = await openRound(await seedSearchingOrder(), [
      { driver_id: driverId, score: 1, distance_km: 1 },
    ]);
    expect(result.offers).toBe(1);
    expect(result.blocked_by_documents).toBe(0);
  });
});
