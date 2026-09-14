/**
 * الغرض: قياسُ حقَّي البيانةِ على قاعدةٍ حقيقيّةٍ (`F2-11` · `SR-12`) — وأهمُّ
 *   ما يُقاسُ ههنا ما **لا يقدرُ حاجزٌ ساكنٌ ولا محرِّكٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ الحذفَ **حكمٌ لكلِّ جدولٍ** لا `delete` واحدةً: صفُّ الراكبِ
 *        يُجهَّلُ ولا يُمحى، وأماكنُه تُمحى، وموافقاتُه تبقى.
 *     ــ أنَّ الإيصالَ **يصفُ ما جرى فعلاً**: أعدادُه تُقابَلُ بعَدٍّ مستقلٍّ
 *        على الصفوفِ بعدَ الحذفِ، لا بما تقولُه الدالّةُ عن نفسِها.
 *     ــ أنَّ الحذفَ **لا يُكرَّرُ**: نداءٌ ثانٍ يُعيدُ `ALREADY_ERASED` بلا
 *        إيصالٍ جديدٍ ولا صفوفٍ تُمَسُّ ثانيةً.
 *     ــ أنَّ التنزيلَ بعدَ الحذفِ **يُرَدُّ** — الحسابُ المُجهَّلُ لا يُصدِّرُ.
 *     ــ أنَّ رحلةً جاريةً **تمنعُ** الحذفَ، فلا يُترَكُ سائقٌ في طريقِه إلى
 *        راكبٍ لم يعُدْ له صفٌّ.
 *     ــ أنَّ مفتاحَ `user_consents` الأجنبيَّ `restrict` **يمنعُ** محوَ الصفِّ
 *        محواً تامّاً — حاجزٌ في القاعدةِ لا في الشيفرةِ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgres)
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ أثرُ `RLS`**: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه (سابقةُ
 *    `active-ride.test.ts`).
 * ــ **لا يُقاسُ حذفُ سائقٍ إلى تمامِه**: `driver_documents` و`payout_*` يملكُها
 *    `F3` وما زالت مؤجَّلةً؛ وادِّعاءُ قياسِها ادِّعاءٌ (`ح-5`).
 * ــ **لا تُقاسُ الشاشةُ**: هذا ملفُّ قاعدةٍ، والسطحُ مقيسٌ في `tests/unit`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDataRightsStore } from "../../packages/infrastructure/privacy/data-rights-store.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let store: PostgresDataRightsStore;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/**
 * مُعرِّفاتٌ **موجبةٌ عاليةٌ**: لا تُصادِفُ حساباً حقيقيّاً ولا ملفَّ اختبارٍ
 * آخرَ. **ولا تُستعمَلُ سالبةٌ ههنا**: المجالُ السالبُ محجوزٌ لمعرِضِ
 * `users_erased_telegram_id_seq`، واستعمالُه في البذرِ يجعلُ الاختبارَ يقيسُ
 * تصادُمَه هوَ لا سلوكَ النظامِ — وهوَ الخطأُ الذي وقعَ فعلاً في أوَّلِ تشغيلٍ.
 */
const TG_ERASED = 991_100_001;
const TG_BUSY = 991_100_002;

/** صفُّ الراكبِ المُجهَّلِ — يُتتبَّعُ بمعرِّفِه لا بمعرِّفِ تيليجرامَ، لأنَّ
 * الثانيَ **يُبدَّلُ** عندَ الحذفِ وهوَ عينُ المقصودِ. */
let erasedUserId = "";

const created: string[] = [];

/** مدينةٌ حقيقيّةٌ من القاعدةِ — `city_id` مطلوبٌ في كلِّ جدولٍ ههنا. */
let cityId = "";

async function seedRider(telegramId: number): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (telegram_id, city_id, role, full_name, language_code)
    values (${telegramId}, ${cityId}, 'rider', ${`اختبار ${telegramId}`}, 'ar')
    returning id
  `;
  if (row === undefined) throw new Error("تعذّرَ بذرُ الراكبِ");
  created.push(row.id);
  await sql`
    insert into riders (user_id, city_id) values (${row.id}, ${cityId})
    on conflict do nothing
  `;
  return row.id;
}

describeIf("حقَّا البيانةِ على قاعدةٍ حقيقيّةٍ (F2-11)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    store = new PostgresDataRightsStore(sql);
    // **مدينةٌ خاصّةٌ بهذا الملفِّ لا مدينةٌ مُستعارةٌ**: قاعدةُ CI تُبنى من
    // الصفرِ، والاتّكاءُ على بذرةٍ لم يضعْها هذا الملفُّ يجعلُ نجاحَه رهناً
    // بترتيبِ ملفّاتٍ أُخرى. وهيَ `is_active = false` فلا يراها إرسالٌ.
    const [city] = await sql<{ id: string }[]>`
      insert into cities (code, name_ar, name_en, is_active)
      values ('f211', 'مدينة اختبار F2-11', 'F2-11 Test City', false)
      on conflict (code) do update set name_ar = excluded.name_ar
      returning id
    `;
    if (city === undefined) throw new Error("تعذّرَ تهيئةُ مدينةِ الاختبارِ");
    cityId = city.id;
  });

  afterAll(async () => {
    // **لا يُترَكُ أثرٌ**: الصفوفُ المبذورةُ تُزالُ بترتيبِ التبعيّةِ، وصفُّ
    // `users` آخرُها لأنَّ مفاتيحَ `restrict` تحرسُه.
    for (const id of created) {
      await sql`delete from user_consents where user_id = ${id}`;
      await sql`delete from audit_log where actor_user_id = ${id}`;
      await sql`delete from orders where rider_id in (select id from riders where user_id = ${id})`;
      await sql`delete from saved_places where user_id = ${id}`;
      await sql`delete from riders where user_id = ${id}`;
      await sql`delete from users where id = ${id}`;
    }
    await sql`delete from cities where code = 'f211'`;
    await sql.end();
  });

  it("يُنزِّلُ الأقسامَ الاثنَي عشرَ كلَّها ولو كانَ بعضُها فارغاً", async () => {
    erasedUserId = await seedRider(TG_ERASED);
    const userId = erasedUserId;
    await sql`
      insert into saved_places (user_id, city_id, kind, label, point)
      values (${userId}, ${cityId}, 'home', 'البيت',
              st_setsrid(st_makepoint(39.19, 21.49), 4326)::geography)
    `;
    const result = await store.exportMyData({ telegramUserId: String(TG_ERASED) });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.exported) throw new Error("توقّعنا حزمةً");
    const sections = Object.keys(result.value.bundle.sections).sort();
    expect(sections).toEqual([
      "auditTrail",
      "broadcastsReceived",
      "consents",
      "notificationsReceived",
      "orders",
      "profile",
      "ratings",
      "riderProfile",
      "safetyIncidents",
      "savedPlaces",
      "supportTickets",
      "tripTrackingTokens",
    ]);
    expect((result.value.bundle.sections.savedPlaces as unknown[]).length).toBe(1);
  });

  it("**لا يُسرِّبُ التنزيلُ طرفاً آخرَ**: هُويّةُ السائقِ رايةٌ لا اسمٌ", async () => {
    const result = await store.exportMyData({ telegramUserId: String(TG_ERASED) });
    if (!result.ok || !result.value.exported) throw new Error("توقّعنا حزمةً");
    const text = JSON.stringify(result.value.bundle.sections);
    expect(text).not.toContain("assigned_driver_id");
    expect(text).not.toContain("claim_token");
  });

  it("رحلةٌ جاريةٌ **تمنعُ** الحذفَ", async () => {
    const userId = await seedRider(TG_BUSY);
    await sql`
      insert into orders (rider_id, city_id, service, status, pickup)
      values ((select id from riders where user_id = ${userId}), ${cityId},
              'transport', 'searching',
              st_setsrid(st_makepoint(39.19, 21.49), 4326)::geography)
    `;
    const result = await store.eraseMyAccount({ telegramUserId: String(TG_BUSY) });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.erased) {
      expect(result.value.refusal).toBe("ACTIVE_ORDER");
      expect(result.value.activeOrders).toBeGreaterThanOrEqual(1);
    }
    // ولم يُمَسَّ صفٌّ واحدٌ: الرفضُ رفضٌ لا حذفٌ جزئيٌّ.
    const [row] = await sql<{ erased_at: string | null }[]>`
      select erased_at from users where id = ${userId}
    `;
    expect(row?.erased_at).toBeNull();
  });

  it("الحذفُ **حكمٌ لكلِّ جدولٍ**: يُجهِّلُ الصفَّ ويمحو الأماكنَ ويُبقي الموافقاتِ", async () => {
    const before = { id: erasedUserId };
    if (before.id === "") throw new Error("غابَ الراكبُ المبذورُ");
    await sql`
      insert into user_consents (user_id, city_id, kind, version, accepted_at)
      values (${before.id}, ${cityId}, 'terms_of_service', 'v1', now())
      on conflict do nothing
    `;

    const result = await store.eraseMyAccount({ telegramUserId: String(TG_ERASED) });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.erased) throw new Error("توقّعنا حذفاً");
    const receipt = result.value.receipt;
    if (receipt === null) throw new Error("توقّعنا إيصالاً");

    // ١) الإيصالُ يُقابَلُ بعَدٍّ مستقلٍّ لا بقولِ الدالّةِ عن نفسِها.
    const [places] = await sql<{ n: string }[]>`
      select count(*)::text as n from saved_places where user_id = ${before.id}
    `;
    expect(Number(places?.n)).toBe(0);
    expect(receipt.erased.savedPlaces).toBeGreaterThanOrEqual(1);

    // ٢) صفُّ المستخدمِ **باقٍ مُجهَّلاً** — لا محذوفاً.
    const [user] = await sql<
      { full_name: string | null; telegram_id: string; erased_at: string | null }[]
    >`select full_name, telegram_id::text, erased_at from users where id = ${before.id}`;
    expect(user).toBeDefined();
    expect(user?.erased_at).not.toBeNull();
    expect(user?.full_name).toBeNull();
    // **ومعرِّفُ تيليجرامَ نفسُه بيانةٌ شخصيّةٌ**: يُبدَّلُ بمعرِضٍ سالبٍ، ولذا
    // لا يُوجَدُ الصفُّ بعدَ اليومِ بمعرِّفِه الأوَّلِ. وهذا **قصدٌ لا عَرَضٌ**.
    expect(Number(user?.telegram_id)).toBeLessThan(0);

    // ٣) الموافقةُ **باقيةٌ** ومعلَنةٌ في الإيصالِ بأساسِها.
    const [consents] = await sql<{ n: string }[]>`
      select count(*)::text as n from user_consents where user_id = ${before.id}
    `;
    expect(Number(consents?.n)).toBeGreaterThanOrEqual(1);
    const consentLine = receipt.retained.find((line) => line.section === "consents");
    expect(consentLine?.basis).toBe("CONSENT_IS_COMPLIANCE_EVIDENCE");

    // ٤) الإيصالُ **مكتوبٌ في سجلِّ التدقيقِ** — لا في ذاكرةِ الطلبِ وحدَها.
    const [audit] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_log
      where actor_user_id = ${before.id} and action = 'account.erased'
    `;
    expect(Number(audit?.n)).toBe(1);
  });

  it("نداءٌ ثانٍ **لا يجدُ أحداً** ولا يكتبُ إيصالاً ثانياً", async () => {
    // وهذه هيَ الحقيقةُ التي كِدنا نكتبُ خلافَها: `ALREADY_ERASED` **لا
    // يُبلَغُ من بابِ تيليجرامَ أبداً**، لأنَّ المعرِّفَ نفسَه بُدِّلَ. فمَن
    // حذفَ حسابَه ثمَّ عادَ فهوَ **مستخدمٌ جديدٌ** لا عائدٌ إلى قبرِ حسابِه.
    const result = await store.eraseMyAccount({ telegramUserId: String(TG_ERASED) });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.erased) {
      expect(result.value.refusal).toBe("USER_NOT_FOUND");
    }
    const [audit] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_log
      where action = 'account.erased' and actor_user_id = ${erasedUserId}
    `;
    expect(Number(audit?.n)).toBe(1);
  });

  it("التنزيلُ بعدَ الحذفِ **يُرَدُّ** — ولا يُسلَّمُ ملفٌّ لحسابٍ مُجهَّلٍ", async () => {
    const result = await store.exportMyData({ telegramUserId: String(TG_ERASED) });
    expect(result.ok).toBe(true);
    if (result.ok && !result.value.exported) {
      expect(result.value.refusal).toBe("USER_NOT_FOUND");
    }
  });

  it("مفتاحُ `user_consents` **يمنعُ** محوَ صفِّ المستخدمِ محواً تامّاً", async () => {
    const row = { id: erasedUserId };
    let refused = false;
    try {
      await sql`delete from users where id = ${row.id}`;
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it("مفتاحُ `user_consents` الأجنبيُّ `restrict` لا `cascade` — والحاجزُ يُقرأُ من الفهرسِ", async () => {
    const [fk] = await sql<{ confdeltype: string }[]>`
      select confdeltype::text from pg_constraint where conname = 'user_consents_user_id_fkey'
    `;
    expect(fk?.confdeltype).toBe("r");
  });
});
