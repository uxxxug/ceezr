/**
 * الغرض: إثباتُ أنَّ **الحظرَ والمقامَ يَعبُرانِ الحذفَ** على قاعدةٍ حقيقيّةٍ —
 *   `ADR 0113` تصحيحاً لثغرةٍ في `F2-11`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 *
 * وهذه الحالاتُ **سالبةٌ بالدرجةِ الأولى** (`ح-7`): لا تسألُ «أَكُتِبَ الأثرُ؟»
 * بل «أيُفلِتُ المحظورُ؟». والفرقُ بينَهما هوَ الفرقُ بينَ اختبارٍ يُطمئِنُ
 * واختبارٍ يحرسُ. فالسيناريو المُشتكى منه يُعادُ حرفيّاً: يُحظَرُ، ثمَّ يحذفُ
 * حسابَه، ثمَّ يعودُ من تيليجرام نفسِه — ويُقاسُ هل عادَ محظوراً.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

/** معرّفاتٌ في مدىً محجوزٍ للقياسِ لا يُصادِفُ إنساناً ولا بديلاً سالباً. */
const TG_BANNED = 991_200_001;
const TG_CLEAN = 991_200_002;
const TG_PHONE_HOPPER_OLD = 991_200_003;
const TG_PHONE_HOPPER_NEW = 991_200_004;
const SHARED_PHONE = "+966500991203";

describeOrSkip("ADR 0113 · الحظرُ والمقامُ يَعبُرانِ الحذفَ", () => {
  let sql: ReturnType<typeof postgres>;
  let cityId: string;

  const allTelegramIds = [TG_BANNED, TG_CLEAN, TG_PHONE_HOPPER_OLD, TG_PHONE_HOPPER_NEW];

  /** يُزيلُ كلَّ ما زرعَه القياسُ، بما فيه الأثرُ نفسُه، فلا يتسرَّبُ إلى غيرِه. */
  async function purge(): Promise<void> {
    const hashes = await sql<{ h: string }[]>`
      select identity_hash(t::text) as h from unnest(${sql.array(allTelegramIds)}::bigint[]) as t`;
    const userIds = await sql<{ id: string }[]>`
      select id from users
       where telegram_id = any(${sql.array(allTelegramIds)}::bigint[])
          or city_id = ${cityId}`;
    const ids = userIds.map((r) => r.id);
    if (ids.length > 0) {
      await sql`delete from ratings where ratee_user_id = any(${sql.array(ids)}::uuid[])
                   or rater_user_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from audit_log where actor_user_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from user_consents where user_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from saved_places where user_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from riders where user_id = any(${sql.array(ids)}::uuid[])`;
      await sql`delete from users where id = any(${sql.array(ids)}::uuid[])`;
    }
    await sql`delete from identity_marks
               where telegram_hash = any(${sql.array(hashes.map((r) => r.h))}::text[])
                  or phone_hash = identity_hash(${SHARED_PHONE})`;
  }

  /**
   * يردُّ نصَّ الخطأِ الذي ردَّتْ بهِ القاعدةُ، أو يرمي إن لم تَرُدَّ. ولم
   * يُستعمَلْ `expect(...).rejects` لأنَّ كائنَ الاستعلامِ في `postgres.js`
   * كسولٌ، ومطالبتُه بالإنجازِ مرّتَينِ تُعلِّقُ المجرى بلا حدٍّ.
   */
  async function rejectionOf(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("القاعدةُ قبِلَت ما كانَ يجبُ أن تَرُدَّه");
  }

  /** يُنشئُ مستخدماً وملفَّ راكبٍ ويردُّ معرّفَ الصفِّ وحكمَ الحظرِ عليه. */
  async function signUp(
    telegramId: number,
    phone: string | null,
  ): Promise<{ id: string; isBlocked: boolean }> {
    const [row] = await sql<{ id: string; is_blocked: boolean }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${telegramId}, 'قياسُ ٠١١٣', ${phone}, 'ar', 'rider')
      returning id, is_blocked`;
    if (!row) throw new Error("لم يُنشَأْ صفُّ المستخدمِ");
    await sql`insert into riders (city_id, user_id) values (${cityId}, ${row.id})`;
    return { id: row.id, isBlocked: row.is_blocked };
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, {
      max: 1,
      ssl: "prefer",
      onnotice: () => {},
      connect_timeout: 20,
      connection: { statement_timeout: 15_000 },
    });
    const [city] = await sql<{ id: string }[]>`
      insert into cities (code, name_ar, name_en, is_active)
      values ('t113', 'مدينةُ قياسِ ٠١١٣', 'ADR 0113 Test City', false)
      on conflict (code) do update set name_ar = excluded.name_ar
      returning id`;
    if (!city) throw new Error("لم تُنشَأْ مدينةُ القياسِ");
    cityId = city.id;
    await purge();
  });

  afterAll(async () => {
    await purge();
    await sql`delete from cities where code = 't113'`;
    await sql.end();
  });

  test("التجزئةُ أحاديّةٌ وثابتةٌ ولا تُفشي المعرّفَ", async () => {
    const [row] = await sql<{ a: string; b: string; c: string | null }[]>`
      select identity_hash('12345') as a, identity_hash('12345') as b, identity_hash('') as c`;
    expect(row?.a).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.a).toBe(row?.b as string);
    expect(row?.a).not.toContain("12345");
    expect(row?.c).toBeNull();
  });

  test("الجدولُ يرفضُ معرّفاً صريحاً في خانةِ التجزئةِ", async () => {
    // لو كتبَ مُهاجِرٌ مستقبَليٌّ `telegram_id::text` بدلَ التجزئةِ، تَرُدَّه
    // القاعدةُ في وجهِه ولا يمرُّ صامتاً.
    //
    // **و`city_id` يُمرَّرُ صحيحاً عن قصدٍ**: أوّلُ صياغةٍ أسقطَتْه فردَّ
    // القاعدةُ الصفَّ بـ`not null` قبلَ أن تبلُغَ قيدَ التجزئةِ — فكانَ
    // الاختبارُ **يمرُّ على الرفضِ الخطأِ**، ولو حُذِفَ القيدُ يوماً لبقيَ
    // أخضرَ. فالمقيسُ ههنا قيدٌ بعينِه لا «أيُّ رفضٍ».
    const message = await rejectionOf(
      () =>
        sql`insert into identity_marks (city_id, telegram_hash, block_origin)
            values (${cityId}, '991200001', 'not-blocked')`,
    );
    expect(message).toContain("identity_marks_carry_no_plain_identity");
  });

  test("**محظورٌ حذفَ حسابَه ثمَّ عادَ — يعودُ محظوراً**", async () => {
    const first = await signUp(TG_BANNED, "+966500991201");
    await sql`update users set is_blocked = true where id = ${first.id}`;

    const [erased] = await sql<{ r: { ok: boolean; reason: string } }[]>`
      select erase_my_account(${TG_BANNED}::bigint) as r`;
    expect(erased?.r.ok).toBe(true);
    expect(erased?.r.reason).toBe("ERASED");

    // الصفُّ القديمُ مُجهَّلٌ فعلاً: لا يُصادَفُ بالمعرّفِ بعدَ اليومِ.
    const stillThere = await sql`select 1 from users where telegram_id = ${TG_BANNED}`;
    expect(stillThere.length).toBe(0);

    // ثمَّ يعودُ من تيليجرام نفسِه. هذا هوَ موضعُ الثغرةِ قبلَ `ADR 0113`.
    const second = await signUp(TG_BANNED, "+966500991201");
    expect(second.isBlocked).toBe(true);
  });

  test("غيرُ المحظورِ يعودُ غيرَ محظورٍ — الأثرُ لا يُعاقِبُ بريئاً", async () => {
    const first = await signUp(TG_CLEAN, "+966500991202");
    expect(first.isBlocked).toBe(false);
    await sql`select erase_my_account(${TG_CLEAN}::bigint)`;
    const second = await signUp(TG_CLEAN, "+966500991202");
    expect(second.isBlocked).toBe(false);
  });

  test("مَن بدَّلَ حسابَ تيليجرام وأبقى رقمَه يُمسَكُ بالرقمِ", async () => {
    const first = await signUp(TG_PHONE_HOPPER_OLD, SHARED_PHONE);
    await sql`update users set is_blocked = true where id = ${first.id}`;
    await sql`select erase_my_account(${TG_PHONE_HOPPER_OLD}::bigint)`;

    const second = await signUp(TG_PHONE_HOPPER_NEW, SHARED_PHONE);
    expect(second.isBlocked).toBe(true);
  });

  test("الإيصالُ يقولُ إنَّ أثراً بقيَ ويُسمّي أساسَه", async () => {
    const hashes = await sql`select identity_hash(${TG_CLEAN}::text) as h`;
    const mark = await sql`select 1 from identity_marks where telegram_hash = ${
      (hashes[0] as { h: string }).h
    }`;
    expect(mark.length).toBe(1);

    const [row] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log
       where action = 'account.erased'
       order by created_at desc limit 1`;
    expect(row).toBeDefined();
    const receipt = row?.payload as {
      retained: { section: string; basis: string; rows: number }[];
    };
    const bar = receipt.retained.find((r) => r.section === "identityBar");
    expect(bar).toBeDefined();
    expect(bar?.basis).toBe("BLOCK_AND_STANDING_SURVIVE_ERASURE");
    expect(bar?.rows).toBe(1);
  });

  test("التنزيلُ يكشفُ الأثرَ ولا يكشفُ التجزئةَ", async () => {
    const [row] = await sql<{ r: Record<string, unknown> }[]>`
      select export_my_data(${TG_CLEAN}::bigint) as r`;
    const payload = row?.r as {
      ok: boolean;
      sections: { identityBar: Record<string, unknown> | null };
    };
    expect(payload.ok).toBe(true);
    const bar = payload.sections.identityBar;
    expect(bar).not.toBeNull();
    expect(bar?.is_blocked).toBe(false);
    expect(bar?.hash_disclosed).toBe(false);
    expect(JSON.stringify(bar)).not.toMatch(/[0-9a-f]{64}/);
  });

  test("حذفٌ ثانٍ يُراكِمُ العدَّ ولا يرفعُ حظراً", async () => {
    // `TG_BANNED` حُذِفَ مرّةً وهوَ محظورٌ، ثمَّ عادَ. يحذفُ ثانيةً.
    await sql`select erase_my_account(${TG_BANNED}::bigint)`;
    const [mark] = await sql<
      { is_blocked: boolean; erasure_count: number }[]
    >`select is_blocked, erasure_count from identity_marks
       where telegram_hash = identity_hash(${TG_BANNED}::text)`;
    expect(mark?.erasure_count).toBe(2);
    expect(mark?.is_blocked).toBe(true);
  });

  test("الأثرُ لا يحملُ اسماً ولا رقماً ولا معرّفاً صريحاً", async () => {
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'identity_marks'`;
    const names = columns.map((c) => c.column_name).sort();
    // `city_id` عمودٌ **مقصودٌ** (القاعدةُ ٠.٤): يُحفَظُ ليُعرَفَ أيُّ مدينةٍ
    // حظرتْ، ولا تُصفّى بهِ المطابقةُ أبداً — وذاكَ مَحروسٌ نصّاً في
    // `tests/unit/identity-bar-survives-erasure.test.ts`. وأوّلُ صياغةٍ
    // أسقطَتْه من هذا الجردِ فمرَّت على جدولٍ قديمٍ في قاعدةِ التجريبِ لا على
    // الهجرةِ كما كُتِبَت — **فالأخضرُ كانَ على مخطَّطٍ متقادمٍ**.
    expect(names).toEqual([
      "block_origin",
      "city_id",
      "erasure_count",
      "first_marked_at",
      "id",
      "is_blocked",
      "last_marked_at",
      "phone_hash",
      "rating_count",
      "rating_sum",
      "telegram_hash",
    ]);
  });

  test("الفِلفِلُ صفٌّ واحدٌ لا يُزادُ عليه", async () => {
    const message = await rejectionOf(
      () =>
        sql`insert into identity_hash_pepper (only_row, pepper)
            values (false, gen_random_bytes(32))`,
    );
    expect(message).toContain("identity_hash_pepper_is_singleton");
    const rows = await sql`select 1 from identity_hash_pepper`;
    expect(rows.length).toBe(1);
  });
});
