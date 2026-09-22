/**
 * الغرض: قياسُ **استقلالِ مركزِ الإشعاراتِ عن هويّةِ تيليجرام في القراءةِ**
 *   (`SEC-19` · الخطوةُ الأولى) على PostgreSQL حقيقيٍّ: مسلكٌ يقرأُ بـ`users.id`
 *   ويوسِمُ بها، ويُكافِئُ المسلكَ القديمَ حرفاً لمَن لهُ ربطٌ، ويخدُمُ حساباً
 *   لم يَعُدْ مُعرِّفُه الخارجيُّ مُعرِّفَ تيليجرامَ حقيقيّاً.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22.
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-19` · `F6-05` (مركزُ الإشعاراتِ) · `ADR 0031` (المعرِّفُ وسيلةُ ربطٍ
 *   لا مفتاحٌ أساسيٌّ) · `ADR 0136` (الأثرُ يُقاسُ بالأثرِ)
 *
 * ## المسألةُ التي يقيسُها هذا الملفُّ
 *
 * مركزُ الإشعاراتِ **يُكتَبُ** بمفتاحٍ داخليٍّ (`recipient_user_id` أي `users.id`)
 * **ويُقرَأُ** بمفتاحٍ خارجيٍّ (`get_user_notifications(p_telegram_id bigint)`).
 * فهوَ مستقلٌّ في التخزينِ تابعٌ في القراءةِ، **فيسقُطُ بسقوطِ الأصلِ**. ولذلكَ
 * لا يصلُحُ اليومَ مبرِّراً لوصفِ إشعارٍ بأنّه «غيرُ جوهريٍّ».
 *
 * ## وما لا يُقاسُ ههنا — مُسمّىً لا مسكوتاً عنه (`ح-5`)
 *
 * **لا يُقاسُ مستخدِمٌ بـ`telegram_id = null`. وذلكَ متعذِّرٌ اليومَ** إذ العمودُ
 * `not null` — والحالةُ المقيسةُ **أقربُ ما يُمكِنُ قياسُه**: حسابٌ مُجهَّلٌ
 * مُعرِّفُه الخارجيُّ عددٌ **سالبٌ** من مَعرِضِ التجهيلِ، أي **ليسَ مُعرِّفَ
 * تيليجرامَ ألبتّةَ** ولا يصِلُ إليهِ عميلٌ. فمن قرأَ هذا الملفَّ فلا يقُلْ إنَّ
 * القراءةَ قِيسَت أمامَ غيابٍ تامٍّ؛ قِيسَت أمامَ **هويّةٍ خارجيّةٍ لا معنى لها**.
 *
 * ولا يُدَّعى أنَّ مسلكاً واحداً من مسالكِ الإرسالِ حُصِّنَ: هذه الخطوةُ تُصلِحُ
 * **قارئَ البديلِ** وحدَه، وهيَ شرطٌ سابقٌ للحرسِ لا بديلٌ عنه.
 *
 * ولا يُقاسُ سطحُ HTTP ولا `user-notification-center.ts`: لم يُعدَّلْ سطرٌ منهما
 * في هذا الطورِ، والتوقيعُ القديمُ قائمٌ بعقدِه.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ قراءةِ مركزِ الإشعاراتِ بالهويّةِ الداخليّةِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

/** بادئةٌ تُميِّزُ صفوفَ هذا الملفِّ فتُمحى وحدَها ولا يُمَسُّ سواها. */
const MARK = "sec19-center-read";

type MarkResult = {
  readonly ok: boolean;
  readonly error?: string;
  readonly already_read?: boolean;
};

/**
 * صفٌّ واحدٌ مُنتظَرٌ. وغيابُه **عطلٌ يُعلَنُ** لا سلسلةٌ اختياريّةٌ تُمرِّرُ
 * `undefined` إلى توكيدٍ فيُقارَنُ بلا معنى: توكيدٌ على `undefined` قد يخضرُّ
 * صدفةً وقد يُلقي، وكلاهما جوابٌ عن سؤالٍ غيرِ المسؤولِ عنه.
 */
function only<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`لم يُعِدِ المحرِّكُ صفّاً لـ${what}.`);
  return row;
}

type Feed = {
  readonly ok: boolean;
  readonly error?: string;
  readonly unread?: number;
  readonly items?: readonly { readonly id: string; readonly kind: string }[];
};

describeIf("مركزُ الإشعاراتِ يُقرَأُ بالهويّةِ الداخليّةِ (SEC-19-ب-١)", () => {
  let sql: Sql;
  let cityId: string;
  /** مستخدِمٌ مربوطٌ: مُعرِّفٌ خارجيٌّ موجَبٌ قائمٌ. */
  let linkedUser: string;
  // نصّاً لا `bigint`: مُحرِّكُ `postgres` لا يقبلُ `bigint` مُعامِلاً، والقالبُ
  // `::bigint` هوَ الذي يُحوِّلُ — فالنوعُ في المحرِّكِ لا في المُعامِلِ.
  let linkedTelegram: string;
  /** مستخدِمٌ مُجهَّلٌ: مُعرِّفٌ خارجيٌّ **سالبٌ** — ليسَ مُعرِّفَ تيليجرامَ. */
  let erasedUser: string;
  let erasedSentinel: string;
  let linkedNotification: string;
  let erasedNotification: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });

    const cities = await sql<{ id: string }[]>`select id from cities order by created_at limit 1`;
    const city = cities[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدةِ: القياسُ يحتاجُ مدينةً قائمةً.");
    cityId = city.id;

    // مُعرِّفانِ خارجيّانِ لا يتعارضانِ مع صفٍّ قائمٍ: الموجَبُ للمربوطِ، والسالبُ
    // للمُجهَّلِ كما يسُكُّه مَعرِضُ التجهيلِ. والقيدُ `unique` يفرِضُ التفرُّدَ.
    const sentinel = 7_000_000_000_000 + Date.now();
    linkedTelegram = String(sentinel);
    erasedSentinel = String(-sentinel);

    const linked = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${linkedTelegram}::bigint, ${`${MARK}-linked`}, 'ar', 'rider')
      returning id
    `;
    linkedUser = linked[0]?.id as string;

    // الحسابُ المُجهَّلُ: `erased_at` مضبوطٌ والهويّةُ منزوعةٌ — فيوافِقُ قيدَ
    // `users_erased_rows_carry_no_identity` بمُعرِّفٍ سالبٍ، وهوَ الحالُ الذي
    // يُنتِجُه `erase_my_account` فعلاً.
    const erased = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, telegram_username, language_code, role, erased_at)
      values (${cityId}::uuid, ${erasedSentinel}::bigint, null, null, null, 'ar', 'rider', now())
      returning id
    `;
    erasedUser = erased[0]?.id as string;

    // الصفَّانِ يُكتَبانِ **بالمسلكِ الحقيقيِّ**: يُدرَجُ صفٌّ في الصندوقِ
    // بـ`recipient_user_id`، فيُنادي المُشغِّلُ `notification_outbox_record_in_center()`
    // فيُدرِجُ صفَّ المركزِ. وإدراجٌ مباشرٌ في `user_notifications` كانَ سيقيسُ
    // قراءةَ صفٍّ صنعتُهُ بيدي لا صفٍّ **يصنعُهُ النظامُ**، فيُخضِرُّ الاختبارَ
    // ولو كانَ مسلكُ الكتابةِ معطوباً.
    await sql`
      insert into notification_outbox (city_id, kind, recipient_user_id, dedup_key, payload)
      values
        (${cityId}::uuid, 'no_driver_found', ${linkedUser}::uuid,
         ${`${MARK}:linked:${linkedUser}`}, ${sql.json({ mark: MARK })}),
        (${cityId}::uuid, 'no_driver_found', ${erasedUser}::uuid,
         ${`${MARK}:erased:${erasedUser}`}, ${sql.json({ mark: MARK })})
    `;

    const forLinked = await sql<{ id: string }[]>`
      select id from user_notifications where user_id = ${linkedUser}::uuid limit 1
    `;
    const forErased = await sql<{ id: string }[]>`
      select id from user_notifications where user_id = ${erasedUser}::uuid limit 1
    `;
    if (forLinked.length !== 1 || forErased.length !== 1) {
      throw new Error("المُشغِّلُ لم يُدرِجْ صفَّ المركزِ: مسلكُ الكتابةِ نفسُه معطوبٌ.");
    }
    linkedNotification = forLinked[0]?.id as string;
    erasedNotification = forErased[0]?.id as string;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    // المحوُ بالمعرِّفاتِ المُدرَجةِ وحدَها: لا `truncate` ولا حذفٌ بنمطٍ واسعٍ.
    await sql`delete from notification_outbox where recipient_user_id in (${linkedUser}::uuid, ${erasedUser}::uuid)`;
    await sql`delete from user_notifications where user_id in (${linkedUser}::uuid, ${erasedUser}::uuid)`;
    await sql`delete from users where id in (${linkedUser}::uuid, ${erasedUser}::uuid)`;
    await sql.end();
  });

  it("١) المسلكُ الجديدُ لا يذكرُ `telegram_id` في نصِّه المنشورِ — استقلالٌ مقيسٌ لا مُدَّعىً", async () => {
    // الاستقلالُ يُقاسُ من **تعريفِ الدالّةِ في المحرِّكِ** لا من ملفِّ الهجرةِ:
    // لو خالفَ المنشورُ الملفَّ لكانَ الحاجزُ النصّيُّ يُخضِرُّ على دالّةٍ أخرى.
    const rows = await sql<{ def: string }[]>`
      select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_user_notifications_by_user_id'
    `;
    expect(rows).toHaveLength(1);
    const def = rows[0]?.def as string;
    expect(def).not.toContain("telegram_id");
    expect(def).toContain("n.user_id = p_user_id");
  });

  it("٢) القراءةُ بـ`users.id` تُعيدُ موجَزَ صاحبِها — لمَن لهُ ربطٌ", async () => {
    const rows = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${linkedUser}::uuid, 20, null) as result
    `;
    const feed = only(rows, "موجَزِ المربوطِ").result;
    expect(feed.ok).toBe(true);
    expect(feed.items).toHaveLength(1);
    expect(feed.items?.[0]?.id).toBe(linkedNotification);
    expect(feed.unread).toBe(1);
  });

  it("٣) المسلكانِ **يتكافآنِ حرفاً** لمَن لهُ ربطٌ — فلا انحدارَ في العقدِ القديمِ", async () => {
    // هذا هوَ حاجزُ اللاانحدارِ: الغلافُ القديمُ يُفوِّضُ، فلو تباعَدَ المنطقانِ
    // لاختلفَ الجوابانِ ههنا. والمقارنةُ على الموجَزِ كلِّه لا على حقلٍ منه.
    const oldPath = await sql<{ result: Feed }[]>`
      select get_user_notifications(${linkedTelegram}::bigint, 20, null) as result
    `;
    const newPath = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${linkedUser}::uuid, 20, null) as result
    `;
    expect(oldPath[0]?.result).toEqual(newPath[0]?.result);
  });

  it("٤) حسابٌ مُجهَّلٌ مُعرِّفُه الخارجيُّ **سالبٌ**: يُقرَأُ بهويّتِه الداخليّةِ", async () => {
    const rows = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${erasedUser}::uuid, 20, null) as result
    `;
    const feed = only(rows, "موجَزِ المربوطِ").result;
    expect(feed.ok).toBe(true);
    expect(feed.items).toHaveLength(1);
    expect(feed.items?.[0]?.id).toBe(erasedNotification);
  });

  it("٥) ويُوسَمُ مقروءاً بهويّتِه الداخليّةِ — فالعدَّادُ يُنقَصُ لا يعلو أبداً", async () => {
    const before = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${erasedUser}::uuid, 20, null) as result
    `;
    expect(only(before, "الموجَزِ قبلَ الوسمِ").result.unread).toBe(1);

    const marked = await sql<{ result: MarkResult }[]>`
      select mark_notification_read_by_user_id(${erasedUser}::uuid, ${erasedNotification}::uuid) as result
    `;
    const markedRow = only(marked, "الوسمِ الأوّلِ").result;
    expect(markedRow.ok).toBe(true);
    expect(markedRow.already_read).toBe(false);

    const after = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${erasedUser}::uuid, 20, null) as result
    `;
    expect(only(after, "الموجَزِ بعدَ الوسمِ").result.unread).toBe(0);

    // ثابتُ الأثرِ: إعادةُ الوسمِ تُعلِنُ «كانَ موسوماً» ولا تُحرِّكُ الطابعَ.
    const again = await sql<{ result: MarkResult }[]>`
      select mark_notification_read_by_user_id(${erasedUser}::uuid, ${erasedNotification}::uuid) as result
    `;
    expect(only(again, "إعادةِ الوسمِ").result.already_read).toBe(true);
  });

  it("٦) إشعارُ غيرِكَ لا يُقرَأُ ولا يُوسَمُ — و«ليسَ لك» لا يُميَّزُ من «لا وجودَ له»", async () => {
    const feed = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(${erasedUser}::uuid, 20, null) as result
    `;
    const ids = (only(feed, "موجَزِ المُجهَّلِ").result.items ?? []).map((i) => i.id);
    expect(ids).not.toContain(linkedNotification);

    const foreign = await sql<{ result: MarkResult }[]>`
      select mark_notification_read_by_user_id(${erasedUser}::uuid, ${linkedNotification}::uuid) as result
    `;
    const absent = await sql<{ result: MarkResult }[]>`
      select mark_notification_read_by_user_id(${erasedUser}::uuid, gen_random_uuid()) as result
    `;
    const foreignError = only(foreign, "إشعارِ غيرِه").result.error;
    expect(foreignError).toBe("NOTIFICATION_NOT_FOUND");
    expect(only(absent, "إشعارٍ لا وجودَ له").result.error).toBe(foreignError);
  });

  it("٧) معرِّفٌ داخليٌّ لا وجودَ له يُعلَنُ `USER_NOT_FOUND` — لا موجَزاً فارغاً صامتاً", async () => {
    // موجَزٌ فارغٌ بـ`ok = true` كانَ سيخلِطُ «لا إشعاراتَ لكَ» بـ«لا وجودَ لكَ»،
    // فيُخفي عطبَ استدعاءٍ في البوّابةِ بدلَ أن يُعلِنَه.
    const read = await sql<{ result: Feed }[]>`
      select get_user_notifications_by_user_id(gen_random_uuid(), 20, null) as result
    `;
    const mark = await sql<{ result: MarkResult }[]>`
      select mark_notification_read_by_user_id(gen_random_uuid(), gen_random_uuid()) as result
    `;
    const readResult = only(read, "قراءةٍ بمعرِّفٍ لا وجودَ له").result;
    expect(readResult.ok).toBe(false);
    expect(readResult.error).toBe("USER_NOT_FOUND");
    expect(only(mark, "وسمٍ بمعرِّفٍ لا وجودَ له").result.error).toBe("USER_NOT_FOUND");
  });

  it("٨) سطحُ الصلاحيّاتِ مغلقٌ: لا `anon` ولا `authenticated` ينفِّذُ المسلكَ الجديدَ", async () => {
    // `create or replace` **يُعيدُ منحَ التنفيذِ ضمنيّاً**، فالنزعُ يُقاسُ بالأثرِ
    // في القاعدةِ لا يُفترَضُ من وجودِ سطرِ `revoke` في ملفٍّ.
    const rows = await sql<{ proname: string; role: string; allowed: boolean }[]>`
      select p.proname, r.rolname as role,
             has_function_privilege(r.rolname, p.oid, 'execute') as allowed
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join (select unnest(array['anon', 'authenticated']) as rolname) r
       where n.nspname = 'public'
         and p.proname in ('get_user_notifications_by_user_id', 'mark_notification_read_by_user_id')
       order by p.proname, r.rolname
    `;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.allowed).toBe(false);
    }
  });
});
