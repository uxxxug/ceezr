/**
 * الغرض: قياسُ **قيدِ التجهيلِ `users_erased_rows_carry_no_identity` أمامَ هويّةٍ
 *   خارجيّةٍ غائبةٍ** على PostgreSQL حقيقيٍّ (`SEC-19-أ`) — بثلاثةِ أضلاعٍ **لا
 *   تلمسُ جدولَ `users`**: القيدُ كما هوَ **منشورٌ** لا كما في ملفِّ الهجرةِ ·
 *   دلالةُ SQL الثلاثيّةُ مُقاسةً · وجدولٌ مؤقَّتٌ يحملُ المُسنَدَ عينَه بعمودٍ
 *   اختياريٍّ فتُعَدَّ حالاتُه صفًّا صفًّا.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22 (القياسُ الأوّلُ)، و`2026-09-22` بعدَ التقويةِ
 *   (هجرةُ `20260922070000`، `ADR 0175`).
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-19` · `ADR 0112` (التجهيلُ) · `F2-11` · `ADR 0136` (الأثرُ يُقاسُ بالأثرِ)
 *   · `ADR 0175` (`null` تمثيلُ المستقبلِ).
 *
 * ## ولِمَ جدولٌ مؤقَّتٌ، ولِمَ لا يُلمَسُ `users`
 *
 * لأنَّ `users.telegram_id` **لا يزالُ `not null`** — وذاكَ عينُ ما لم يُنزَعْ بعدُ.
 * فإدخالُ صفٍّ بـ`telegram_id = null` في `users` يُرفَضُ بخطأِ **العمودِ** قبلَ أن
 * يبلُغَ `check` ألبتّةَ، فيُنتِجُ اختباراً **مُضلِّلاً**: يحمرُّ أو يخضرُّ لسببٍ
 * غيرِ السببِ المُدَّعى. والجدولُ المؤقَّتُ يحملُ المُسنَدَ حرفاً بعمودٍ اختياريٍّ،
 * فيُقاسُ **المُسنَدُ** لا العمودُ.
 *
 * ## وما لا يُقاسُ ههنا — مُسمّىً لا مسكوتاً عنه
 *
 * **لا يُقاسُ أنَّ `users` يَقبَلُ `telegram_id = null`. هوَ لا يَقبَلُه.** ولا
 * يُدَّعى أنَّ قيدَ التجهيلِ اختُبِرَ على `users` نفسِه — اختُبِرَ **نصُّه كما هوَ
 * منشورٌ**، و**سلوكُه** على جدولٍ يحاكيه. فمن قرأَ هذا الملفَّ فلا يقُلْ إنَّ
 * `users` قِيسَ أمامَ الغيابِ.
 *
 * **ولا يُقاسُ مسارُ التجهيلِ نفسُه** (`erase_my_account`): ذاكَ يُسكُّ مُعرِّفاً
 * سالباً منَ المَعرِضِ، ولا يُنادى ههنا.
 *
 * ## تاريخُ التقويةِ
 *
 * **قبلَ `2026-09-22`/هجرةِ `20260922070000`** كانَ المُسنَدُ المنشورُ يشتملُ على
 * `telegram_id < 0` وحدَه دونَ ذكرِ `null`، فقِيسَ أنَّ سلوكَه يَقبَلُ `null` بحكمِ
 * المجهولِ الثلاثيِّ — فكانَ **التقويةُ إفصاحاً لا إصلاحاً**. وبهذه الهجرةِ صارَ
 * المُسنَدُ المنشورُ يذكرُ `telegram_id is null or telegram_id < 0` صراحةً. والضلعُ
 * الأوّلُ ههنا يتحوَّلُ من «لا ذكرَ للغيابِ» إلى «ذكرٌ صريحٌ». والضلعانِ الثاني
 * والثالثُ لا يتغيّرانِ: المُسنَدُ القديمُ (السالبُ وحدَه) والمُسنَدُ الجديدُ
 * (الغيابُ أو السالبُ) لا يزالانِ **متساويَينِ سلوكاً**، وقياسُ ذلكَ هوَ الأساسُ
 * الذي قامَ عليهِ القرارُ — فلا يُمحى.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ قيدِ التجهيلِ أمامَ هويّةٍ غائبةٍ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const CONSTRAINT = "users_erased_rows_carry_no_identity";

/** المُسنَدُ **المنشورُ** اليومَ (بعدَ هجرةِ `20260922070000`): يذكرُ الغيابَ
 *   صراحةً. **قبلَها** كانَ `telegram_id < 0` وحدَه — انظرْ «تاريخُ التقويةِ» أعلاه. */
const PREDICATE_TODAY = "(telegram_id is null or telegram_id < 0)";

/** المُسنَدُ القديمُ (قبلَ `20260922070000`): كانَ يشترطُ عدداً سالباً ولا يذكرُ
 *   الغيابَ. يُستعمَلُ ههنا لإثباتِ **تساوي السلوكِ** بينَ القديمِ والجديدِ،
 *   فلا يُمحى القياسُ الذي قامَ عليهِ القرارُ. */
const PREDICATE_LEGACY = "telegram_id < 0";

/** حالاتُ التجهيلِ الستُّ، ونتيجتُها المُنتظَرةُ — واحدةٌ لكلا المُسنَدَينِ. */
const CASES: readonly {
  readonly label: string;
  readonly erasedAt: string;
  readonly telegramId: string;
  readonly fullName: string;
  readonly accepted: boolean;
}[] = [
  {
    label: "غيرُ مُجهَّلٍ وغيرُ مربوطٍ",
    erasedAt: "null",
    telegramId: "null",
    fullName: "null",
    accepted: true,
  },
  {
    label: "مُجهَّلٌ وغيرُ مربوطٍ",
    erasedAt: "now()",
    telegramId: "null",
    fullName: "null",
    accepted: true,
  },
  {
    label: "مُجهَّلٌ بمُعرِّفٍ سالبٍ منَ المَعرِضِ",
    erasedAt: "now()",
    telegramId: "-5",
    fullName: "null",
    accepted: true,
  },
  {
    label: "مُجهَّلٌ ومُعرِّفٌ حقيقيٌّ موجَبٌ باقٍ",
    erasedAt: "now()",
    telegramId: "99",
    fullName: "null",
    accepted: false,
  },
  {
    label: "مُجهَّلٌ ومُعرِّفُه صفرٌ — حدُّ المُسنَدِ",
    erasedAt: "now()",
    telegramId: "0",
    fullName: "null",
    accepted: false,
  },
  {
    label: "مُجهَّلٌ واسمٌ باقٍ — تجهيلٌ نصفُ تامٍّ",
    erasedAt: "now()",
    telegramId: "null",
    fullName: "'Ali'",
    accepted: false,
  },
];

describeIf("قيدُ التجهيلِ أمامَ هويّةٍ خارجيّةٍ غائبةٍ (SEC-19-أ)", () => {
  let sql: Sql;

  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL as string });
  });

  afterAll(async () => {
    await sql.end();
  });

  // ------------------------------------------------------------------
  // الضلعُ الأوّلُ: القيدُ كما هوَ **منشورٌ**، لا كما في ملفِّ الهجرةِ
  // ------------------------------------------------------------------

  it("القيدُ المنشورُ يذكرُ الغيابَ صراحةً (بعدَ `ADR 0175` وهجرةِ `20260922070000`)", async () => {
    const rows = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.users'::regclass and conname = ${CONSTRAINT}`;

    expect(rows).toHaveLength(1);
    const def = rows[0]?.def ?? "";
    // الحكمُ على القاعدةِ الفعليّةِ: لو خالفَ المنشورُ ملفَّ الهجرةِ فالمنشورُ هوَ الحقُّ.
    expect(def).toContain("telegram_id < 0");
    expect(def).toContain("erased_at IS NULL");
    // **بعدَ التقويةِ**: النصُّ يذكرُ الغيابَ صراحةً، فلا يُضلِّلُ قارئَه بعدَ اليومِ.
    // (قبلَ 2026-09-22 كانَ هذا التوكيدُ معكوساً — انظرْ `ADR 0175` للتاريخِ.)
    expect(def).toContain("telegram_id IS NULL");
  });

  it("القيدُ نافذٌ لا `not valid`", async () => {
    const rows = await sql<{ convalidated: boolean; conislocal: boolean }[]>`
      select convalidated, conislocal
      from pg_constraint
      where conrelid = 'public.users'::regclass and conname = ${CONSTRAINT}`;

    expect(rows[0]?.convalidated).toBe(true);
    expect(rows[0]?.conislocal).toBe(true);
  });

  it("`users.telegram_id` لا يزالُ `not null` — فلا يُقاسُ عليه غيابٌ", async () => {
    const rows = await sql<{ attnotnull: boolean }[]>`
      select attnotnull from pg_attribute
      where attrelid = 'public.users'::regclass and attname = 'telegram_id'`;

    // هذا التوكيدُ هوَ **سببُ وجودِ الجدولِ المؤقَّتِ**: ما دامَ هذا `true` فإدخالُ
    // غيابٍ في `users` يُرفَضُ بخطأِ العمودِ لا بحكمِ `check`.
    expect(rows[0]?.attnotnull).toBe(true);
  });

  // ------------------------------------------------------------------
  // الضلعُ الثاني: دلالةُ SQL الثلاثيّةُ مُقاسةً لا مُستنتَجةً
  // ------------------------------------------------------------------

  it("`null < 0` مجهولٌ لا كاذبٌ، و`check` يَقبَلُ المجهولَ", async () => {
    const rows = await sql<{ a: boolean | null; b: boolean; c: boolean }[]>`
      select (null::bigint < 0) as a,
             ((null::bigint < 0) is null) as b,
             ((null::bigint < 0) is not false) as c`;

    expect(rows[0]?.a).toBeNull();
    expect(rows[0]?.b).toBe(true);
    // `check` لا يَسقُطُ إلّا على `false`؛ فالمجهولُ يمرُّ.
    expect(rows[0]?.c).toBe(true);
  });

  // ------------------------------------------------------------------
  // الضلعُ الثالثُ: جدولٌ مؤقَّتٌ يحملُ المُسنَدَ بعمودٍ اختياريٍّ
  // ------------------------------------------------------------------

  const measure = async (predicate: string): Promise<Map<string, boolean>> => {
    await sql.unsafe("drop table if exists sec19_check_probe");
    await sql.unsafe(`create temp table sec19_check_probe (
      id bigserial primary key,
      erased_at timestamptz,
      full_name text,
      phone text,
      telegram_username text,
      telegram_id bigint,
      constraint sec19_probe_no_identity check (
        erased_at is null
        or (full_name is null and phone is null and telegram_username is null and ${predicate})))`);

    const outcomes = new Map<string, boolean>();
    for (const c of CASES) {
      try {
        await sql.unsafe(
          `insert into sec19_check_probe (erased_at, telegram_id, full_name)
           values (${c.erasedAt}, ${c.telegramId}, ${c.fullName})`,
        );
        outcomes.set(c.label, true);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // يُشترَطُ أن يكونَ الرفضُ **بحكمِ القيدِ** لا بعطبٍ آخرَ.
        expect(message).toContain("sec19_probe_no_identity");
        outcomes.set(c.label, false);
      }
    }
    await sql.unsafe("drop table if exists sec19_check_probe");
    return outcomes;
  };

  it("المُسنَدُ المنشورُ الحاليُّ يَقبَلُ الغيابَ صراحةً، والهويّةُ الباقيةُ تُرفَضُ", async () => {
    const outcomes = await measure(PREDICATE_TODAY);
    for (const c of CASES) {
      expect(outcomes.get(c.label)).toBe(c.accepted);
    }
  });

  it("المُسنَدُ القديمُ (السالبُ وحدَه) يَقبَلُ الغيابَ بحكمِ المجهولِ", async () => {
    const outcomes = await measure(PREDICATE_LEGACY);
    for (const c of CASES) {
      expect(outcomes.get(c.label)).toBe(c.accepted);
    }
  });

  it("المُسنَدانِ **متساويانِ سلوكاً** في الحالاتِ السّتِّ — فالتقويةُ إفصاحٌ لا إصلاحُ ثقبٍ", async () => {
    const today = await measure(PREDICATE_TODAY);
    const legacy = await measure(PREDICATE_LEGACY);

    // هذا التوكيدُ يُكذِّبُ دعوى «الحارسُ يصمُتُ فيمرُّ تجهيلٌ نصفُ تامٍّ»: لا حالةَ
    // تفترقُ فيها النتيجتانِ. وسببُه أنَّ سلسلةَ `and` تَسقُطُ على أوّلِ `false`،
    // فبقاءُ اسمٍ أو رقمٍ أو مُعرِّفٍ موجَبٍ يُرفَضُ في المُسنَدَينِ سواءً.
    expect([...legacy.entries()]).toEqual([...today.entries()]);
  });
});
