/**
 * الغرض: قياسُ **حقَّي بيانةِ السائقِ** على قاعدةٍ حقيقيّةٍ (`SD-12`) — وأهمُّ
 *   ما يُقاسُ ههنا ما لا يقدرُ حاجزٌ ساكنٌ على قياسِه:
 *     ــ أنَّ **المالَ يمنعُ المحوَ**: محفظةٌ فيها رصيدٌ تردُّ `WALLET_HAS_BALANCE`
 *        **ومعَها الرقمُ**، وحينَ يُصفَّرُ الرصيدُ يمضي المحوُ.
 *     ــ أنَّ **الدورَ يُحكَمُ به**: `support` يُردُّ `ROLE_NOT_SELF_ERASABLE`.
 *     ــ أنَّ **رحلةً جاريةً في يدِ السائقِ** تمنعُ المحوَ (`ACTIVE_ORDER`).
 *     ــ أنَّ نداءً ثانياً بمعرِّفِ تيليجرامَ **لا يجدُ أحداً** لا أنَّه يُعيدُ
 *        `ALREADY_ERASED`: المعرِّفُ نفسُه بُدِّلَ.
 *     ــ أنَّ الإيصالَ **يصفُ ما جرى**: أعدادُه تُقابَلُ بعَدٍّ مستقلٍّ بعدَ المحوِ.
 *     ــ أنَّ صفَّ `drivers` **يُجهَّلُ ولا يُمحى** (أبناؤه `cascade` ومنهم واحدٌ
 *        `restrict`)، وأنَّ المالَ والحُضورَ والعروضَ **تبقى بأساسٍ مكتوبٍ**.
 *     ــ أنَّ سائقاً **بلا صفِّ سياقةٍ** يُمحى ولا يُخفِقُ.
 *     ــ أنَّ حزمةَ التنزيلِ للسائقِ **تُبنى بأقسامِها كلِّها** ولا تُخرِجُ رقمَ
 *        هويّةٍ ولا مسارَ ملفٍّ في المخزَنِ ولا مضمونَ إشعارٍ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgres)
 * الحاكم: docs/adr/0125-a-drivers-erasure-stops-at-money-not-at-role.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ أثرُ `RLS`**: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
 * ــ **لا يُقاسُ محوُ الملفّاتِ من المخزَنِ**: `driver_documents.object_path`
 *    يُمحى صفُّه ههنا، وأمّا البايتاتُ في `storage` فدَينٌ مُعلَنٌ في
 *    `docs/SYSTEM_STATE.md` — وادِّعاءُ قياسِه ادِّعاءٌ (`ح-5`).
 * ــ **لا تُقاسُ الشاشةُ**: هذا ملفُّ قاعدةٍ.
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

/** مُعرِّفاتٌ موجبةٌ عاليةٌ خاصّةٌ بهذا الملفِّ — والسالبُ محجوزٌ للمعرِضِ. */
const TG_MONEY = 992_200_001;
const TG_BUSY = 992_200_002;
const TG_SUPPORT = 992_200_003;
const TG_BARE = 992_200_004;

let cityId = "";
const createdUsers: string[] = [];

interface Seeded {
  readonly userId: string;
  readonly driverId: string;
}

async function seedUser(telegramId: number, role: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into users (telegram_id, city_id, role, full_name, phone, language_code)
    values (${telegramId}, ${cityId}, ${role}::user_role, ${`سائق اختبار ${telegramId}`},
            ${`+96650${telegramId % 1_000_000}`}, 'ar')
    returning id
  `;
  if (row === undefined) throw new Error("تعذّرَ بذرُ المستخدمِ");
  createdUsers.push(row.id);
  return row.id;
}

/** سائقٌ **كاملُ الأبناءِ**: كلُّ جدولٍ يملكُه `SD-12` له صفٌّ، وإلّا كانَ عَدٌّ صفريٌّ يُقرأُ نجاحاً. */
async function seedDriver(telegramId: number): Promise<Seeded> {
  const userId = await seedUser(telegramId, "driver");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number,
                         national_id, vehicle_photo_file_id, preferred_area_label,
                         preferred_area_location,
                         logo_object_path, barcode_object_path, rating_average, rating_count)
    values (${cityId}, ${userId}, 'verified', 'sedan', ${`ح ط ${telegramId % 10_000}`},
            ${`10${telegramId}`}, 'file-photo-1', 'حيُّ الاختبارِ',
            st_setsrid(st_makepoint(39.8, 21.4), 4326)::geography,
            'logos/test.png', 'barcodes/test.png', 4.5, 7)
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّرَ بذرُ صفِّ السياقةِ");
  const driverId = driver.id;

  await sql`insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at)
            values (${cityId}, ${driverId}, 'driving_license', 'accepted', 'docs/license.pdf',
                    now() + interval '90 days')`;
  await sql`insert into driver_availability (city_id, driver_id, is_available)
            values (${cityId}, ${driverId}, true)`;
  await sql`insert into driver_capabilities (city_id, driver_id, service, is_enabled)
            values (${cityId}, ${driverId}, 'transport', true)`;
  await sql`insert into attendance_log (city_id, driver_id, is_available, source)
            values (${cityId}, ${driverId}, true, 'driver_bot')`;
  await sql`insert into tracking_sessions (city_id, driver_id, started_at, last_sequence)
            values (${cityId}, ${driverId}, now(), 3)`;
  await sql`insert into driver_location_history (city_id, driver_id, position, quality, source, recorded_at)
            values (${cityId}, ${driverId},
                    st_setsrid(st_makepoint(39.82, 21.42), 4326)::geography, 'good', 'driver_bot', now())`;
  await sql`insert into subscriptions (city_id, driver_id, plan, status, price_amount, currency)
            values (${cityId}, ${driverId}, 'transport', 'active', 100, 'SAR')`;
  await sql`insert into user_consents (city_id, user_id, kind, version, accepted_at)
            values (${cityId}, ${userId}, 'terms_of_service', 'v1', now())
            on conflict do nothing`;
  await sql`insert into saved_places (city_id, user_id, kind, label, point)
            values (${cityId}, ${userId}, 'home', 'بيتُ اختبارٍ',
                    st_setsrid(st_makepoint(39.81, 21.41), 4326)::geography)`;
  return { userId, driverId };
}

/** محفظةٌ فيها رصيدٌ — القيدُ الموجبُ وحدَه، فالرصيدُ = المبلغُ. */
async function seedWalletWithBalance(driverId: string, amountMinor: number): Promise<void> {
  const [wallet] = await sql<{ id: string }[]>`
    insert into subscription_wallets (city_id, driver_id, currency)
    values (${cityId}, ${driverId}, 'SAR') returning id
  `;
  if (wallet === undefined) throw new Error("تعذّرَ بذرُ المحفظةِ");
  await sql`
    insert into subscription_wallet_entries
      (city_id, wallet_id, driver_id, entry_kind, direction, amount_minor, currency, idempotency_key, reason)
    values (${cityId}, ${wallet.id}, ${driverId}, 'subscription_top_up', 'credit',
            ${amountMinor}, 'SAR', ${`sd12-credit-${driverId}`}, 'بذرُ اختبارٍ')
  `;
}

describeIf("حقَّا بيانةِ السائقِ على قاعدةٍ حقيقيّةٍ (SD-12)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    store = new PostgresDataRightsStore(sql);
    const [city] = await sql<{ id: string }[]>`
      insert into cities (code, name_ar, name_en, is_active)
      values ('sd12', 'مدينة اختبار SD-12', 'SD-12 Test City', false)
      on conflict (code) do update set name_ar = excluded.name_ar
      returning id
    `;
    if (city === undefined) throw new Error("تعذّرَ تهيئةُ مدينةِ الاختبارِ");
    cityId = city.id;
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await sql`delete from user_consents where user_id = ${id}`;
      await sql`delete from audit_log where actor_user_id = ${id}`;
      await sql`delete from saved_places where user_id = ${id}`;
      await sql`delete from order_offers where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from orders where assigned_driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from orders where rider_id in (select id from riders where user_id = ${id})`;
      await sql`delete from riders where user_id = ${id}`;
      await sql`delete from attendance_log where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from driver_location_history where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from driver_documents where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from driver_availability where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from driver_capabilities where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from tracking_sessions where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from subscription_wallet_entries where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from subscription_wallets where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from subscriptions where driver_id in (select id from drivers where user_id = ${id})`;
      await sql`delete from drivers where user_id = ${id}`;
      await sql`delete from users where id = ${id}`;
    }
    await sql`delete from identity_marks where city_id = ${cityId}`;
    await sql`delete from cities where code = 'sd12'`;
    await sql.end();
  });

  it("المالُ يمنعُ المحوَ ويُقالُ رقمُه، ثمَّ يمضي المحوُ حينَ يُصفَّرُ", async () => {
    const { userId, driverId } = await seedDriver(TG_MONEY);
    await seedWalletWithBalance(driverId, 4_500);

    const refused = await store.eraseMyAccount({ telegramUserId: String(TG_MONEY) });
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(refused.value.erased).toBe(false);
    if (refused.value.erased) return;
    expect(refused.value.refusal).toBe("WALLET_HAS_BALANCE");
    // **الرقمُ مقروءٌ من القاعدةِ**: منعٌ بلا رقمٍ يُقرأُ تعلُّلاً.
    expect(refused.value.walletBalanceMinor).toBe(4_500);
    // ولم يُمَسَّ شيءٌ: الرفضُ **قبلَ** أوّلِ كتابةٍ.
    const [stillThere] = await sql<{ n: number }[]>`
      select count(*)::int as n from driver_documents where driver_id = ${driverId}
    `;
    expect(stillThere?.n).toBe(1);

    // يُصفَّرُ الرصيدُ بقيدٍ مقابلٍ لا بمحوِ القيدِ الأوّلِ: المالُ لا يُمحى.
    const [wallet] = await sql<{ id: string }[]>`
      select id from subscription_wallets where driver_id = ${driverId}
    `;
    await sql`
      insert into subscription_wallet_entries
        (city_id, wallet_id, driver_id, entry_kind, direction, amount_minor, currency, idempotency_key, reason)
      values (${cityId}, ${wallet?.id ?? null}, ${driverId}, 'subscription_charge', 'debit',
              4500, 'SAR', ${`sd12-debit-${driverId}`}, 'تسويةُ اختبارٍ')
    `;

    const erased = await store.eraseMyAccount({ telegramUserId: String(TG_MONEY) });
    expect(erased.ok).toBe(true);
    if (!erased.ok || !erased.value.erased) throw new Error("كانَ يجبُ أن يمضيَ المحوُ");
    const receipt = erased.value.receipt;
    if (receipt === null) throw new Error("إيصالٌ مفقودٌ");

    // ما مُحيَ: يُقابَلُ بعَدٍّ مستقلٍّ على القاعدةِ بعدَ المحوِ.
    expect(receipt.erased.driverDocuments).toBe(1);
    expect(receipt.erased.driverAvailability).toBe(1);
    expect(receipt.erased.trackingSessions).toBe(1);
    const [after] = await sql<{ docs: number; avail: number; sessions: number }[]>`
      select
        (select count(*)::int from driver_documents where driver_id = ${driverId}) as docs,
        (select count(*)::int from driver_availability where driver_id = ${driverId}) as avail,
        (select count(*)::int from tracking_sessions where driver_id = ${driverId}) as sessions
    `;
    expect(after).toEqual({ docs: 0, avail: 0, sessions: 0 });

    // ما بقيَ بأساسٍ: المالُ والحُضورُ — **بأسسٍ مكتوبةٍ لا بصمتٍ**.
    const bases = new Map(receipt.retained.map((row) => [row.section, row]));
    expect(bases.get("subscriptionWalletEntries")?.basis).toBe(
      "MONEY_RECORD_IS_ACCOUNTING_EVIDENCE",
    );
    expect(bases.get("subscriptionWalletEntries")?.rows).toBe(2);
    expect(bases.get("driverAttendance")?.basis).toBe("ATTENDANCE_PROVES_DRIVER_ENTITLEMENT");
    expect(bases.get("consents")?.basis).toBe("CONSENT_IS_COMPLIANCE_EVIDENCE");
    const [money] = await sql<{ n: number }[]>`
      select count(*)::int as n from subscription_wallet_entries where driver_id = ${driverId}
    `;
    expect(money?.n).toBe(2);

    // صفُّ السياقةِ **باقٍ مُجهَّلاً**: أبناؤه فيهم `restrict`، والتعريفُ ذهبَ.
    const [row] = await sql<
      {
        plate: string | null;
        nid: string | null;
        photo: string | null;
        logo: string | null;
        barcode: string | null;
        area: string | null;
        rating: string | null;
        count: number;
      }[]
    >`
      select plate_number as plate, national_id as nid, vehicle_photo_file_id as photo,
             logo_object_path as logo, barcode_object_path as barcode,
             preferred_area_label as area, rating_average::text as rating, rating_count as count
      from drivers where id = ${driverId}
    `;
    expect(row).toEqual({
      plate: null,
      nid: null,
      photo: null,
      logo: null,
      barcode: null,
      area: null,
      rating: null,
      count: 0,
    });

    // صفُّ المستخدمِ: مُعرِّفُ تيليجرامَ صارَ `null` (SEC-19 بندُ ٤) ووقتُ المحوِ مكتوبٌ.
    const [user] = await sql<{ tg: string | null; erased_at: Date | null }[]>`
      select telegram_id::text as tg, erased_at from users where id = ${userId}
    `;
    expect(user?.tg).toBeNull();
    expect(user?.erased_at).not.toBeNull();

    // نداءٌ ثانٍ بالمعرِّفِ نفسِه **لا يجدُ أحداً**: المعرِّفُ بُدِّلَ بسَنَدٍ
    // سالبٍ، فمَن حذفَ حسابَه ثمَّ عادَ **مستخدمٌ جديدٌ** لا عائدٌ إلى قبرِ
    // حسابِه. و`ALREADY_ERASED` بابُه القراءةُ بمعرِّفٍ داخليٍّ لا من تيليجرامَ
    // (سابقةٌ مكتوبةٌ في `account-data-rights.test.ts`).
    const again = await store.eraseMyAccount({ telegramUserId: String(TG_MONEY) });
    if (!again.ok || again.value.erased) throw new Error("كانَ يجبُ أن يُقالَ: لا أحدَ");
    expect(again.value.refusal).toBe("USER_NOT_FOUND");
  });

  it("رحلةٌ جاريةٌ في يدِ السائقِ تمنعُ المحوَ", async () => {
    const { driverId } = await seedDriver(TG_BUSY);
    const riderUserId = await seedUser(992_200_012, "rider");
    const [rider] = await sql<{ id: string }[]>`
      insert into riders (user_id, city_id) values (${riderUserId}, ${cityId}) returning id
    `;
    await sql`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status, pickup, pickup_label)
      values (${cityId}, ${rider?.id ?? null}, ${driverId}, 'transport', 'in_progress',
              st_setsrid(st_makepoint(39.8, 21.4), 4326)::geography, 'نقطةُ اختبارٍ')
    `;

    const result = await store.eraseMyAccount({ telegramUserId: String(TG_BUSY) });
    if (!result.ok || result.value.erased) throw new Error("كانَ يجبُ أن يُرَدَّ");
    expect(result.value.refusal).toBe("ACTIVE_ORDER");
    expect(result.value.activeOrders).toBe(1);
    expect(result.value.walletBalanceMinor).toBe(0);
  });

  it("دورٌ لا يمحو نفسَه: موظَّفُ الدعمِ يُرَدُّ", async () => {
    await seedUser(TG_SUPPORT, "support");
    const result = await store.eraseMyAccount({ telegramUserId: String(TG_SUPPORT) });
    if (!result.ok || result.value.erased) throw new Error("كانَ يجبُ أن يُرَدَّ");
    expect(result.value.refusal).toBe("ROLE_NOT_SELF_ERASABLE");
  });

  it("سائقٌ بلا صفِّ سياقةٍ يُمحى ولا يُخفِقُ", async () => {
    const userId = await seedUser(TG_BARE, "driver");
    await sql`insert into saved_places (city_id, user_id, kind, label, point)
              values (${cityId}, ${userId}, 'work', 'عملُ اختبارٍ',
                      st_setsrid(st_makepoint(39.83, 21.43), 4326)::geography)`;
    const result = await store.eraseMyAccount({ telegramUserId: String(TG_BARE) });
    if (!result.ok || !result.value.erased) throw new Error("كانَ يجبُ أن يمضيَ المحوُ");
    expect(result.value.receipt?.erased.savedPlaces).toBe(1);
    const [user] = await sql<{ tg: string | null }[]>`
      select telegram_id::text as tg from users where id = ${userId}
    `;
    expect(user?.tg).toBeNull();
  });

  it("حزمةُ التنزيلِ للسائقِ: أقسامُها مبنيّةٌ ولا تُخرِجُ بيانةَ غيرِه ولا مسارَ مخزَنٍ", async () => {
    const { driverId } = await seedDriver(992_200_021);
    await seedWalletWithBalance(driverId, 1_000);
    const result = await store.exportMyData({ telegramUserId: String(992_200_021) });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.exported) throw new Error("كانَ يجبُ أن يُنزَّلَ");
    const bundle = result.value.bundle;
    expect(bundle.subject).toBe("driver");

    const sections = bundle.sections;
    expect(Object.keys(sections)).toContain("driverProfile");
    expect(Array.isArray(sections.driverDocuments)).toBe(true);
    expect((sections.driverDocuments as readonly unknown[]).length).toBe(1);
    expect(Array.isArray(sections.subscriptionWalletEntries)).toBe(true);

    // **الرصيدُ يُقرأُ من مصدرِ حقيقتِه** لا يُجمَعُ في حزمةٍ.
    const wallets = sections.subscriptionWallets as readonly Record<string, unknown>[];
    expect((wallets[0]?.balance as Record<string, unknown>)?.balance_minor).toBe(1_000);

    // ولا يُنزَّلُ ما ليسَ له: رقمُ الهويّةِ نصّاً، ولا مسارُ ملفٍّ، ولا مضمونُ إشعارٍ.
    const text = JSON.stringify(sections);
    expect(text).not.toContain("10992200021");
    expect(text).not.toContain("docs/license.pdf");
    expect(text).not.toContain("logos/test.png");
    const doc = (sections.driverDocuments as readonly Record<string, unknown>[])[0];
    expect(doc?.file_disclosed).toBe(false);
    expect((sections.driverProfile as Record<string, unknown>)?.national_id_present).toBe(true);

    // سقفُ تاريخِ الموضعِ **مُعلَنٌ في الحزمةِ** لا مقطوعٌ صامتاً.
    const history = sections.driverLocationHistory as Record<string, unknown>;
    expect(history.cap).toBe(5_000);
    expect((history.rows as readonly unknown[]).length).toBe(1);
  });
});
