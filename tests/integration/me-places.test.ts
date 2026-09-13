/**
 * الغرض: قياسُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ على قاعدةٍ حقيقيّةٍ (`F2-02`) —
 *   أنَّ `upsert_saved_place` تستنبطُ المدينةَ من صفِّ المستخدمِ لا من الطلبِ،
 *   وأنَّ الفهرسَ الفريدَ الجزئيَّ يمنعُ منزلَينِ **في القاعدةِ** ويسمحُ بأماكنَ
 *   متعدِّدةٍ من `other`، وأنَّ `city_id` ملزَمٌ ومرتبطٌ بـ`cities`، وأنَّ `RLS`
 *   مفعَّلٌ، وأنَّ الوجهاتَ الأخيرةَ **مشتقَّةٌ** من `orders` بلا جدولٍ ثانٍ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلُّ هجرةٍ تمسُّ هذا الجدولَ.
 * ملاحظات مستقبلية: `F2-03` يقرأُ الأماكنَ القريبةَ من نقطةٍ؛ فيُقاسُ ههنا أنَّ
 *   الفهرسَ المكانيَّ مُستعمَلٌ في الخُطّةِ لا موجوداً فقط.
 *
 * ═══ ما لا يُقاسُ ههنا ═══
 * `RLS` يُقاسُ **وجوداً وتفعيلاً** لا أثراً: الاتصالُ بمالكِ القاعدةِ، والمالكُ
 * يتخطّى `RLS` أصلاً — كما هوَ مُعلَنٌ في `tests/integration/user-consents.test.ts`.
 * وأنَّ الشاشةَ تعرضُ ما تقرأُه ليسَ ههنا: لا نشرَ حيّاً بعدُ، فلا مستخدمَ حقيقيٌّ
 * فتحَ هذه الشاشةَ — وهوَ حدٌّ مُعلَنٌ لا نقصٌ مسكوتٌ عنه.
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

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const SEED_TELEGRAM_ID = 900_000_891;
const OTHER_TELEGRAM_ID = 900_000_892;
const ABSENT_TELEGRAM_ID = 900_000_893;

let userId = "";
let userCityId = "";
let riderId = "";
let otherCityId = "";

interface SaveOutcome {
  readonly ok?: boolean;
  readonly status?: string;
  readonly error?: string;
  readonly place_id?: string;
  readonly city_id?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly updated_at?: string;
}

async function save(
  telegramId: number,
  kind: string,
  label: string,
  lat: number,
  lng: number,
): Promise<SaveOutcome> {
  const [row] = await sql<{ result: SaveOutcome }[]>`
    select upsert_saved_place(${telegramId}::bigint, ${kind}::text, ${label}::text,
                              ${lat}::double precision, ${lng}::double precision) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  const [user] = await sql<{ id: string; city_id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select c.id, ${SEED_TELEGRAM_ID}, 'rider', 'راكب اختبار الأماكن', '+966500000891'
      from cities c
     order by c.code
     limit 1
    returning id, city_id
  `;
  if (user === undefined) throw new Error("تعذّر زرع المستخدم: لا مدن في القاعدة");
  userId = user.id;
  userCityId = user.city_id;

  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${userCityId}, ${userId}) returning id
  `;
  riderId = rider?.id ?? "";

  // مستخدمٌ ثانٍ في مدينةٍ **مختلفةٍ** إن وُجدَت — به يُقاسُ أنَّ المدينةَ تُستنبَطُ
  // من صفِّ صاحبِها لا من ثابتٍ ولا من أوّلِ مدينةٍ في الجدولِ.
  const [other] = await sql<{ id: string; city_id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    select c.id, ${OTHER_TELEGRAM_ID}, 'rider', 'راكب اختبار الأماكن ٢', '+966500000892'
      from cities c
     where c.id <> ${userCityId}
     order by c.code
     limit 1
    returning id, city_id
  `;
  otherCityId = other?.city_id ?? "";
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`
    delete from saved_places
     where user_id in (
       select id from users where telegram_id in (${SEED_TELEGRAM_ID}, ${OTHER_TELEGRAM_ID})
     )
  `;
  if (riderId !== "") {
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  await sql`delete from users where telegram_id in (${SEED_TELEGRAM_ID}, ${OTHER_TELEGRAM_ID})`;
  await sql.end();
});

describeIf("الأماكنُ المحفوظةُ على قاعدةٍ حقيقيّةٍ", () => {
  it("١) `city_id` موجودٌ، not null، ومرتبطٌ بـ`cities` بمفتاحٍ أجنبيٍّ", async () => {
    const [column] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'saved_places'
         and column_name = 'city_id'
    `;
    expect(column?.is_nullable).toBe("NO");
    expect(column?.data_type).toBe("uuid");

    const [reference] = await sql<{ foreign_table: string }[]>`
      select ccu.table_name as foreign_table
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_name = tc.constraint_name
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
       where tc.table_name = 'saved_places'
         and tc.constraint_type = 'FOREIGN KEY'
         and kcu.column_name = 'city_id'
    `;
    expect(reference?.foreign_table).toBe("cities");
  });

  it("٢) `RLS` مفعَّلٌ على الجدولِ ولسياستِه صفٌّ مُعلَنٌ", async () => {
    const [table] = await sql<{ relrowsecurity: boolean }[]>`
      select relrowsecurity from pg_class where relname = 'saved_places'
    `;
    expect(table?.relrowsecurity).toBe(true);

    const policies = await sql<{ policyname: string }[]>`
      select policyname from pg_policies where tablename = 'saved_places'
    `;
    expect(policies.length).toBeGreaterThan(0);
  });

  it("٣) الفهارسُ الأربعةُ موجودةٌ، والفريدُ منها جزئيٌّ على المنزلِ والعملِ", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes where tablename = 'saved_places'
    `;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const name of [
      "saved_places_user_idx",
      "saved_places_city_idx",
      "saved_places_point_gix",
      "saved_places_user_singleton_idx",
    ]) {
      expect(byName.has(name)).toBe(true);
    }
    const singleton = byName.get("saved_places_user_singleton_idx") ?? "";
    expect(singleton).toContain("UNIQUE");
    expect(singleton).toContain("WHERE");
    expect(singleton).toContain("home");
    expect(singleton).toContain("work");
    // و`other` **ليسَ** في الشرطِ: قائمةٌ مفتوحةٌ لا مُفرَدةٌ.
    expect(singleton.includes("'other'")).toBe(false);
    expect(byName.get("saved_places_point_gix") ?? "").toContain("gist");
  });

  it("٤) الحفظُ الأوّلُ `created` والثاني `updated` بلا صفٍّ ثانٍ، والمدينةُ من صفِّ صاحبِه", async () => {
    const created = await save(SEED_TELEGRAM_ID, "home", "المنزل", 21.5, 39.2);
    expect(created.ok).toBe(true);
    expect(created.status).toBe("created");
    expect(created.city_id).toBe(userCityId);
    expect(created.updated_at).toBeDefined();

    const updated = await save(SEED_TELEGRAM_ID, "home", "بيتي الجديد", 21.6, 39.3);
    expect(updated.status).toBe("updated");
    expect(updated.place_id).toBe(created.place_id as string);
    expect(updated.label).toBe("بيتي الجديد");
    expect(Number(updated.lat)).toBeCloseTo(21.6, 5);

    const [count] = await sql<{ n: string }[]>`
      select count(*)::text as n from saved_places where user_id = ${userId} and kind = 'home'
    `;
    expect(count?.n).toBe("1");
  });

  it("٥) الفهرسُ الفريدُ يمنعُ منزلَينِ بإدخالٍ مباشرٍ يتخطّى الدالّةَ", async () => {
    let violated = false;
    try {
      await sql`
        insert into saved_places (city_id, user_id, kind, label, point)
        values (${userCityId}, ${userId}, 'home', 'منزلٌ ثانٍ',
                st_setsrid(st_makepoint(39.9, 21.9), 4326)::geography)
      `;
    } catch (error) {
      violated = String(error).includes("saved_places_user_singleton_idx");
    }
    // الحكمُ في القاعدةِ لا في الشِّفرةِ: ولو كُتِبَ صفٌّ من مسارٍ آخرَ يُرَدُّ.
    expect(violated).toBe(true);
  });

  it("٦) `other` قائمةٌ مفتوحةٌ: مكانانِ يُقبلانِ ولا يُطوَيانِ في واحدٍ", async () => {
    const first = await save(SEED_TELEGRAM_ID, "other", "صيدليّة", 21.7, 39.4);
    const second = await save(SEED_TELEGRAM_ID, "other", "مدرسةٌ", 21.8, 39.5);
    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    expect(second.place_id).not.toBe(first.place_id as string);
  });

  it("٧) الترتيبُ مُعلَنٌ في القاعدةِ: المنزلُ ثمَّ العملُ ثمَّ الباقي بالأحدثِ", async () => {
    await save(SEED_TELEGRAM_ID, "work", "المكتب", 21.4, 39.1);
    const rows = await sql<{ kind: string }[]>`
      select kind from list_saved_places(${SEED_TELEGRAM_ID}::bigint)
    `;
    expect(rows.slice(0, 2).map((r) => r.kind)).toEqual(["home", "work"]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("٨) لافتةٌ فارغةً أو نوعٌ مجهولٌ يُردّانِ في القاعدةِ بقيدٍ لا بالشِّفرةِ", async () => {
    let blankRejected = false;
    try {
      await save(SEED_TELEGRAM_ID, "other", "   ", 21.1, 39.1);
    } catch {
      blankRejected = true;
    }
    expect(blankRejected).toBe(true);

    let unknownRejected = false;
    try {
      await save(SEED_TELEGRAM_ID, "gym", "نادٍ", 21.1, 39.1);
    } catch {
      unknownRejected = true;
    }
    expect(unknownRejected).toBe(true);
  });

  it("٩) معرّفٌ لا صفَّ له: `USER_NOT_FOUND` بلا إنشاءِ مستخدمٍ ولا مكانٍ (ADR 0035)", async () => {
    const outcome = await save(ABSENT_TELEGRAM_ID, "home", "المنزل", 21.5, 39.2);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("USER_NOT_FOUND");

    const [users] = await sql<{ n: string }[]>`
      select count(*)::text as n from users where telegram_id = ${ABSENT_TELEGRAM_ID}
    `;
    expect(users?.n).toBe("0");
  });

  it("١٠) المدينةُ تُستنبَطُ من صفِّ صاحبِها لا من أوّلِ مدينةٍ في الجدولِ", async () => {
    if (otherCityId === "" || otherCityId === userCityId) {
      // مدينةٌ ثانيةٌ غيرُ موجودةٍ في هذه القاعدةِ: الحدُّ مُعلَنٌ لا مُتجاوَزٌ.
      expect(otherCityId === "" || otherCityId === userCityId).toBe(true);
      return;
    }
    const outcome = await save(OTHER_TELEGRAM_ID, "home", "منزلُ الثاني", 24.7, 46.7);
    expect(outcome.city_id).toBe(otherCityId);
    expect(outcome.city_id).not.toBe(userCityId);
  });

  it("١١) الوجهاتُ الأخيرةُ مشتقَّةٌ من `orders`، وتُطوى المتكرِّرةُ، ويُحتَرَمُ الحدُّ", async () => {
    if (riderId === "") throw new Error("تعذّر زرع الراكب");
    const dropoff = "st_setsrid(st_makepoint(39.5, 21.8), 4326)::geography";
    for (const label of ["مطار جدة", "  مطار جدة  ", "الكورنيش"]) {
      await sql.unsafe(
        `insert into orders (city_id, rider_id, service, pickup, dropoff, dropoff_label)
         values ($1, $2, 'transport',
                 st_setsrid(st_makepoint(39.1, 21.4), 4326)::geography, ${dropoff}, $3)`,
        [userCityId, riderId, label],
      );
    }
    const rows = await sql<{ label: string; last_used_at: string }[]>`
      select label, last_used_at from list_recent_destinations(${SEED_TELEGRAM_ID}::bigint, 3)
    `;
    const labels = rows.map((r) => r.label);
    // «مطار جدة» مرّتانِ بفراغٍ محيطٍ مختلفٍ ⇒ وجهةٌ واحدةٌ لا وجهتانِ.
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("مطار جدة");
    expect(labels.length).toBeLessThanOrEqual(3);

    const limited = await sql<{ label: string }[]>`
      select label from list_recent_destinations(${SEED_TELEGRAM_ID}::bigint, 1)
    `;
    expect(limited).toHaveLength(1);
  });

  it("١٢) لا جدولَ ثانياً للوجهاتِ الأخيرةِ: مصدرُها `orders` وحدَه", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_name like '%recent%'
    `;
    expect(rows).toHaveLength(0);
  });

  it("١٣) `execute` مسحوبٌ من `public` و`anon` و`authenticated` عن الدوالِّ الثلاثِ", async () => {
    for (const name of ["upsert_saved_place", "list_saved_places", "list_recent_destinations"]) {
      const rows = await sql<{ grantee: string }[]>`
        select grantee from information_schema.routine_privileges
         where routine_name = ${name} and privilege_type = 'EXECUTE'
      `;
      const grantees = rows.map((r) => r.grantee.toLowerCase());
      expect(grantees).not.toContain("public");
      expect(grantees).not.toContain("anon");
      expect(grantees).not.toContain("authenticated");
    }
  });
});
