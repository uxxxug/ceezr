/**
 * الغرض: قياسُ اختيارِ الوجهةِ على قاعدةٍ حقيقيّةٍ (`F2-03`) — وأهمُّ ما يُقاسُ
 *   ههنا **التطابقُ التنفيذيُّ** بينَ `normalize_search_text` في PostgreSQL
 *   و`normalizeSearchText` في تايبسكربت محرفاً بمحرفٍ على كلِّ سطرٍ من
 *   `NORMALIZATION_CORPUS`، وكذا `word_start_match` مقابلَ `wordStartMatch`.
 *   والحاجزُ الساكنُ يُقارِنُ **جدولَينِ**؛ وهذا الملفُّ يُقارِنُ **سلوكَينِ** —
 *   ولولاه لَظنَّ الحاجزُ أنَّه يُقارِنُ ما لا يُقارِنُ.
 *
 *   ويُقاسُ معه: أنَّ `city_id` ملزَمٌ ومرتبطٌ بـ`cities` (القاعدة 0.4)، وأنَّ
 *   `RLS` مفعَّلٌ، وأنَّ الفهارسَ الثلاثةَ موجودةٌ، وأنَّ الحكمَ على الاحتواءِ
 *   في منطقةِ الخدمةِ **في القاعدةِ** لا في التطبيقِ (القاعدة 0.5)، وأنَّ الرفضَ
 *   يعودُ رمزاً في حمولةٍ لا استثناءً، وأنَّ الترتيبَ يُقدِّمُ مطابقةَ بدايةِ
 *   الكلمةِ على مطابقةِ وسطِها.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: كلُّ هجرةٍ تمسُّ التطبيعَ أو الدليلَ أو حدَّ الخدمةِ.
 * ملاحظات مستقبلية: حينَ يُركَّبُ `pg_trgm` (دَينٌ في ADR 0102 §٧) تُضافُ ههنا
 *   حالاتُ الخطأِ المطبعيِّ — ولا تُضافُ قبلَ تركيبِه ادّعاءً لتغطيةٍ.
 *
 * ═══ ما لا يُقاسُ ههنا ═══
 * ــ `RLS` يُقاسُ **وجوداً وتفعيلاً** لا أثراً: الاتصالُ بمالكِ القاعدةِ، والمالكُ
 *    يتخطّى `RLS` أصلاً — كما هوَ مُعلَنٌ في `tests/integration/me-places.test.ts`.
 * ــ **لا يُقاسُ أنَّ مستخدماً فتحَ الشاشةَ**: لا نشرَ حيَّ (ADR 0099)، وبوّابةُ
 *    `F2` (رحلةٌ على جهازٍ حقيقيٍّ) **غيرُ مُدَّعاةٍ**.
 * ــ **لا تُقاسُ دِقّةُ الغلافِ**: `jed-envelope-v1` مستطيلٌ تقريبيٌّ مُعلَنٌ لا
 *    حدٌّ بلديٌّ رسميٌّ (ADR 0102 §٦) — فيُقاسُ أنَّ الحكمَ يعملُ لا أنَّه صائبٌ
 *    جغرافيّاً على المترِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  DESTINATION_REFUSALS,
  LANDMARK_KINDS,
} from "../../packages/domain/destinations/landmark-kinds.ts";
import {
  NORMALIZATION_CORPUS,
  normalizeSearchText,
  wordStartMatch,
} from "../../packages/domain/destinations/search-text.ts";
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

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const SEED_TELEGRAM_ID = 900_000_931;
const ABSENT_TELEGRAM_ID = 900_000_939;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let userId = "";

/** نقطتانِ مُعلَنتانِ: واحدةٌ في غلافِ جدة وأخرى في الرياضِ خارجَه. */
const INSIDE = { lat: 21.515_56, lng: 39.145 } as const;
const OUTSIDE = { lat: 24.7136, lng: 46.6753 } as const;

interface Verdict {
  readonly ok?: boolean;
  readonly error?: string;
  readonly city_code?: string;
  readonly area_version?: string;
  readonly nearest?: {
    readonly kind?: string;
    readonly name_ar?: string;
    readonly straight_distance_m?: number;
  } | null;
}

async function resolve(telegramId: number, lat: number, lng: number): Promise<Verdict> {
  const [row] = await sql<{ result: Verdict }[]>`
    select resolve_destination(${telegramId}::bigint, ${lat}::double precision,
                               ${lng}::double precision) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

interface SearchRow {
  readonly source: string;
  readonly ref_id: string | null;
  readonly label_ar: string;
  readonly label_en: string | null;
  readonly kind: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly match_rank: number;
}

async function search(telegramId: number, query: string, limit = 10): Promise<SearchRow[]> {
  return await sql<SearchRow[]>`
    select * from search_destinations(${telegramId}::bigint, ${query}::text, ${limit}::integer)
  `;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // المستخدمُ يُزرَعُ في **المدينةِ التي لها منطقةُ خدمةٍ مفعَّلةٌ**، لا في أوّلِ
  // مدينةٍ في الجدولِ: القاعدةُ تستنبطُ المدينةَ من صفِّ صاحبِها، فمستخدمٌ في
  // مدينةٍ بلا غلافٍ يُعطي `SERVICE_AREA_NOT_DEFINED` ويُخفِقُ الاختبارُ لسببٍ
  // ليسَ هوَ المقصودَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${SEED_TELEGRAM_ID}, 'rider', 'راكب اختبار الوجهات', '+966500000931')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ المستخدمِ");
  userId = user.id;

  await sql`
    insert into saved_places (city_id, user_id, kind, label, point)
    values (${cityId}, ${userId}, 'home', 'بيت جدة',
            st_setsrid(st_makepoint(${INSIDE.lng}, ${INSIDE.lat}), 4326)::geography)
  `;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (userId !== "") {
    await sql`delete from saved_places where user_id = ${userId}`;
    await sql`delete from users where id = ${userId}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("تطابقُ التطبيعِ بينَ PostgreSQL وتايبسكربت", () => {
  it("١) كلُّ سطرٍ في المعجمِ يُعطي المخرَجَ نفسَه محرفاً بمحرفٍ", async () => {
    // الجدولانِ قد يتطابقانِ نصّاً ويختلفانِ تنفيذاً: `translate` تعتمدُ ترتيبَ
    // المحارفِ، و`lower` تعتمدُ التجميعَ، و`regexp_replace` تعتمدُ صنفَ المحارفِ.
    // فلا يُقاسُ التطابقُ إلّا بتشغيلِ الاثنَينِ.
    const rows = await sql<{ input: string; normalized: string }[]>`
      select t.input, normalize_search_text(t.input) as normalized
        from unnest(${NORMALIZATION_CORPUS as string[]}::text[]) as t(input)
    `;
    expect(rows.length).toBe(NORMALIZATION_CORPUS.length);
    const mismatches: string[] = [];
    for (const row of rows) {
      const typescript = normalizeSearchText(row.input);
      if (typescript !== row.normalized) {
        mismatches.push(`«${row.input}» → قاعدةٌ: «${row.normalized}» · نطاقٌ: «${typescript}»`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("٢) `word_start_match` تُطابِقُ `wordStartMatch` على كلِّ زوجٍ", async () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["جده البلد", "جده"],
      ["جده البلد", "البلد"],
      ["جده البلد", "ده"],
      ["نافوره الملك فهد king fahd s fountain", "king f"],
      ["نافوره الملك فهد king fahd s fountain", "fountain"],
      ["نافوره الملك فهد king fahd s fountain", "ing"],
      ["مطار الملك عبدالعزيز", "الملك"],
      ["مطار", ""],
      ["", "جده"],
    ];
    const mismatches: string[] = [];
    for (const [haystack, needle] of pairs) {
      const [row] = await sql<{ matched: boolean }[]>`
        select word_start_match(${haystack}::text, ${needle}::text) as matched
      `;
      const typescript = wordStartMatch(haystack, needle);
      if (row?.matched !== typescript) {
        expect(row).toBeDefined();
        mismatches.push(`«${haystack}» ← «${needle}»: قاعدةٌ ${row?.matched} · نطاقٌ ${typescript}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("٣) الدالّتانِ `immutable` — وإلّا لا عمودَ مُولَّدٌ ولا فهرسَ عليهما", async () => {
    const rows = await sql<{ proname: string; provolatile: string }[]>`
      select proname, provolatile
        from pg_proc
       where proname in ('normalize_search_text', 'word_start_match')
         and pronamespace = 'public'::regnamespace
    `;
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.provolatile).toBe("i");
  });

  it("٤) `search_key` عمودٌ مُولَّدٌ مُخزَّنٌ لا عمودٌ يُكتَبُ باليدِ", async () => {
    // لو كُتِبَ باليدِ لَتباعدَ عن الاسمِ عندَ أوّلِ تحديثٍ يَغفُلُ عنه.
    const [column] = await sql<{ is_generated: string; generation_expression: string }[]>`
      select is_generated, generation_expression
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'destination_landmarks'
         and column_name = 'search_key'
    `;
    expect(column?.is_generated).toBe("ALWAYS");
    expect(column?.generation_expression ?? "").toContain("normalize_search_text");
  });
});

describeIf("منطقةُ الخدمةِ ودليلُ المعالمِ على قاعدةٍ حقيقيّةٍ", () => {
  it("٥) `city_id` ملزَمٌ ومرتبطٌ بـ`cities` في الجدولَينِ (القاعدة 0.4)", async () => {
    for (const table of ["city_service_areas", "destination_landmarks"]) {
      const [column] = await sql<{ is_nullable: string }[]>`
        select is_nullable
          from information_schema.columns
         where table_schema = 'public' and table_name = ${table} and column_name = 'city_id'
      `;
      expect(column?.is_nullable).toBe("NO");

      const [reference] = await sql<{ foreign_table: string }[]>`
        select ccu.table_name as foreign_table
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name
          join information_schema.constraint_column_usage ccu
            on ccu.constraint_name = tc.constraint_name
         where tc.table_name = ${table}
           and tc.constraint_type = 'FOREIGN KEY'
           and kcu.column_name = 'city_id'
      `;
      expect(reference?.foreign_table).toBe("cities");
    }
  });

  it("٦) `RLS` مفعَّلٌ على الجدولَينِ ولسياستِه صفٌّ مُعلَنٌ", async () => {
    for (const table of ["city_service_areas", "destination_landmarks"]) {
      const [row] = await sql<{ relrowsecurity: boolean }[]>`
        select relrowsecurity from pg_class where relname = ${table}
      `;
      expect(row?.relrowsecurity).toBe(true);
      const policies = await sql<{ policyname: string }[]>`
        select policyname from pg_policies where tablename = ${table}
      `;
      expect(policies.length).toBeGreaterThan(0);
    }
  });

  it("٧) الفهارسُ الثلاثةُ موجودةٌ بأسمائِها وأنواعِها", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
        from pg_indexes
       where tablename in ('city_service_areas', 'destination_landmarks')
    `;
    const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.has("city_service_areas_active_city_idx")).toBe(true);
    expect(byName.get("city_service_areas_active_city_idx") ?? "").toContain("UNIQUE");
    expect(byName.get("city_service_areas_active_city_idx") ?? "").toContain("WHERE");
    expect(byName.get("destination_landmarks_search_idx") ?? "").toContain("search_key");
    expect(byName.get("destination_landmarks_point_idx") ?? "").toContain("gist");
  });

  it("٨) قيدُ الصنفِ في القاعدةِ هوَ قائمةُ النطاقِ نفسُها", async () => {
    const [row] = await sql<{ definition: string }[]>`
      select pg_get_constraintdef(oid) as definition
        from pg_constraint
       where conrelid = 'destination_landmarks'::regclass
         and contype = 'c'
         and pg_get_constraintdef(oid) like '%kind%'
       limit 1
    `;
    const definition = row?.definition ?? "";
    for (const kind of LANDMARK_KINDS) expect(definition).toContain(`'${kind}'`);
  });

  it("٩) لكلِّ مدينةٍ منطقةُ خدمةٍ مفعَّلةٌ واحدةٌ على الأكثرِ — يفرضُه الفهرسُ", async () => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n
        from city_service_areas
       where is_active
       group by city_id
      having count(*) > 1
    `;
    expect(rows.length).toBe(0);
  });
});

describeIf("حكمُ المصادقةِ في القاعدةِ لا في التطبيقِ", () => {
  it("١٠) نقطةٌ داخلَ الغلافِ تُقبَلُ وتُعيدُ المدينةَ وإصدارَ المنطقةِ", async () => {
    const verdict = await resolve(SEED_TELEGRAM_ID, INSIDE.lat, INSIDE.lng);
    expect(verdict.ok).toBe(true);
    expect(verdict.error).toBeUndefined();
    // الحكمُ يعودُ بـ`city_code` لا بـ`city_id`: المعرّفُ داخليٌّ لا يُعرَضُ،
    // والرمزُ هوَ ما يُقرأُ في لافتةٍ وفي سجلٍّ. ويُقاسُ ههنا أنَّه رمزُ **مدينةِ
    // صاحبِ الحسابِ** لا رمزٌ ثابتٌ.
    const [row] = await sql<{ code: string }[]>`select code from cities where id = ${cityId}`;
    expect(verdict.city_code).toBe(row?.code);
    // إصدارُ المنطقةِ يعودُ **مع الحكمِ**: قبولٌ بلا إصدارٍ لا يُراجَعُ بعدَ تغيُّرِ
    // الحدِّ، ولا يُعرَفُ بأيِّ حدٍّ قُبِلَ.
    expect((verdict.area_version ?? "").length).toBeGreaterThan(0);
  });

  it("١١) نقطةٌ خارجَ الغلافِ تُرفَضُ برمزٍ في حمولةٍ لا باستثناءٍ", async () => {
    const verdict = await resolve(SEED_TELEGRAM_ID, OUTSIDE.lat, OUTSIDE.lng);
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBe("OUTSIDE_SERVICE_AREA");
    expect((DESTINATION_REFUSALS as readonly string[]).includes(verdict.error as string)).toBe(
      true,
    );
  });

  it("١٢) إحداثيّةٌ مستحيلةٌ تُرفَضُ قبلَ أيِّ هندسةٍ", async () => {
    for (const point of [
      { lat: 91, lng: 39 },
      { lat: 21, lng: 181 },
      { lat: Number.NaN, lng: 39 },
    ]) {
      const verdict = await resolve(SEED_TELEGRAM_ID, point.lat, point.lng);
      expect(verdict.ok).toBe(false);
      expect(verdict.error).toBe("INVALID_POINT");
    }
  });

  it("١٣) الصفرُ إحداثيّةٌ مشروعةٌ شكلاً — يُرفَضُ بالحدِّ لا بالشكلِ", async () => {
    // `0,0` نقطةٌ في المحيطِ الأطلسيِّ: ترفضُها منطقةُ الخدمةِ لا مُتحقِّقُ
    // المدى. ولو رُفِضَت شكلاً لَكانَ الصفرُ «غياباً» وهوَ قيمةٌ.
    const verdict = await resolve(SEED_TELEGRAM_ID, 0, 0);
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBe("OUTSIDE_SERVICE_AREA");
  });

  it("١٤) مستخدمٌ لا صفَّ له: عطبُ حسابٍ مفصولٌ عن رفضِ وجهةٍ", async () => {
    const verdict = await resolve(ABSENT_TELEGRAM_ID, INSIDE.lat, INSIDE.lng);
    expect(verdict.ok).toBe(false);
    expect(verdict.error).toBe("USER_NOT_FOUND");
    // و**ليسَ** رفضاً في النطاقِ: المحوِّلُ يُترجِمُه 404 لا 200 برفضٍ.
    expect((DESTINATION_REFUSALS as readonly string[]).includes("USER_NOT_FOUND")).toBe(false);
  });

  it("١٥) أقربُ معلَمٍ يعودُ بمسافةٍ مقيسةٍ لا بوصفٍ مُخمَّنٍ", async () => {
    const verdict = await resolve(SEED_TELEGRAM_ID, INSIDE.lat, INSIDE.lng);
    expect(verdict.nearest).not.toBeNull();
    expect((verdict.nearest?.name_ar ?? "").length).toBeGreaterThan(0);
    expect(Number(verdict.nearest?.straight_distance_m)).toBeGreaterThanOrEqual(0);
    expect((LANDMARK_KINDS as readonly string[]).includes(verdict.nearest?.kind as string)).toBe(
      true,
    );
  });
});

describeIf("ترتيبُ البحثِ وحدودُه", () => {
  it("١٦) المحفوظُ يتقدَّمُ، ومطابقةُ بدايةِ الكلمةِ رتبتُها صفرٌ", async () => {
    const rows = await search(SEED_TELEGRAM_ID, "جده");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.source).toBe("saved");
    expect(Number(rows[0]?.match_rank)).toBe(0);
    // والترتيبُ غيرُ متناقصٍ: رتبةٌ أعلى لا تسبقُ أدنى.
    const ranks = rows.map((row) => Number(row.match_rank));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("١٧) استفهامٌ بلوحةٍ لاتينيّةٍ يُطابِقُ بدايةَ الاسمِ اللاتينيِّ برتبةٍ صفرٍ", async () => {
    // وهذا سببُ وجودِ `word_start_match`: مفتاحُ البحثِ يبتدئُ بالاسمِ العربيِّ،
    // فبدايةُ الحقلِ وحدَها تُنزِلُ النتيجةَ الصحيحةَ خلفَ مطابقاتِ الوسطِ.
    const rows = await search(SEED_TELEGRAM_ID, "king f");
    expect(rows.length).toBeGreaterThan(0);
    expect(Number(rows[0]?.match_rank)).toBe(0);
    expect((rows[0]?.label_en ?? "").toLowerCase()).toContain("king f");
  });

  it("١٨) الاستفهامُ يُطبَّعُ داخلَ الدالّةِ — «جدة» و«جِدَّة» سواءٌ", async () => {
    const plain = await search(SEED_TELEGRAM_ID, "جده");
    const shaped = await search(SEED_TELEGRAM_ID, "جِدَّة");
    expect(shaped.map((row) => row.label_ar)).toEqual(plain.map((row) => row.label_ar));
  });

  it("١٩) ما لا يُطابِقُ يعودُ فارغاً — لا صفَّ «قريبٍ» يُخمَّنُ", async () => {
    expect(await search(SEED_TELEGRAM_ID, "zzzqqq")).toEqual([]);
    expect(await search(SEED_TELEGRAM_ID, "")).toEqual([]);
    expect(await search(SEED_TELEGRAM_ID, "   ")).toEqual([]);
  });

  it("٢٠) الحدُّ الأقصى مُحترَمٌ، ومستخدمٌ لا صفَّ له يعودُ فارغاً لا مُخفِقاً", async () => {
    const limited = await search(SEED_TELEGRAM_ID, "ا", 2);
    expect(limited.length).toBeLessThanOrEqual(2);
    // ومستخدمٌ مجهولٌ: بحثٌ فارغٌ لا استثناءٌ — البحثُ قراءةٌ لا كتابةٌ، وسقوطُه
    // يُسقِطُ الشاشةَ على حسابٍ لم يُنشَأْ بعدُ.
    expect(await search(ABSENT_TELEGRAM_ID, "جده")).toEqual([]);
  });

  it("٢١) كلُّ صفٍّ يعودُ بإحداثيّةٍ صالحةٍ ومصدرٍ معروفٍ", async () => {
    const rows = await search(SEED_TELEGRAM_ID, "ا", 25);
    for (const row of rows) {
      expect(["saved", "recent", "landmark"]).toContain(row.source);
      expect(Number.isFinite(Number(row.lat))).toBe(true);
      expect(Number.isFinite(Number(row.lng))).toBe(true);
      expect(Math.abs(Number(row.lat))).toBeLessThanOrEqual(90);
      expect(Math.abs(Number(row.lng))).toBeLessThanOrEqual(180);
      expect(row.label_ar.trim().length).toBeGreaterThan(0);
    }
  });

  it("٢٢) الدالّتانِ محجوبتانِ عن `public` و`anon` و`authenticated`", async () => {
    for (const name of ["resolve_destination", "search_destinations"]) {
      const rows = await sql<{ grantee: string }[]>`
        select r.grantee
          from information_schema.role_routine_grants r
          join pg_proc p on p.proname = r.routine_name
         where r.routine_name = ${name}
           and r.grantee in ('PUBLIC', 'anon', 'authenticated')
      `;
      expect(rows.length).toBe(0);
    }
  });
});
