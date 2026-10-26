/**
 * الغرض: LOAD-01 · C2 — إثبات عقدِ القراءةِ المدمجةِ لسياقِ المرسلِ (`findSenderContext`)
 *   على PostgreSQL الحقيقيّ: تبدأُ من `users` (فلا تُفقدُ لغةُ مسجَّلٍ بغيرِ جمهورِ السائقينَ)،
 *   وتربطُ `drivers` اختياريًا (لا ملفَّ مصطنَعًا)، وغيابُ المستخدمِ ⇒ `null`، والملفُّ
 *   المُعادُ مطابقٌ حرفيًّا لقراءةِ `findByTelegramId`، وكلُّ ذلك برحلةٍ واحدةٍ إلى القاعدة.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وكلِّ تعديلٍ يمسُّ `users`/`drivers`/`driver_availability`.
 * ملاحظات مستقبلية: لا شيء.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import type { RegisterDriverInput } from "../../packages/application/bots/types.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتُ الصفوفِ التي يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TG = "900009321";
const RIDER_TG = "900009322"; // مسجَّلٌ في users بلا صفٍّ في drivers
const ABSENT_TG = "900009399";
const TGS = [DRIVER_TG, RIDER_TG];

let sql: Sql;
/** اتصالٌ ثانٍ يعدُّ كلَّ جملةٍ يرسلُها — لإثباتِ أنَّ القراءةَ رحلةٌ واحدة. */
let counted: Sql;
let statements = 0;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";

function driverInput(tg: string): RegisterDriverInput {
  return {
    telegramUserId: tg,
    cityId: cityId as CityId,
    fullName: "سائق القراءة المدمجة",
    phone: `+9665${tg.slice(-8)}`,
    service: "transport",
    language: "ur",
    vehicleType: "sedan",
    plateNumber: `C2 ${tg.slice(-4)}`,
    nationalId: `10${tg}`,
    vehiclePhotoFileId: null,
  } as RegisterDriverInput;
}

async function seedNonDriver(telegramId: string, languageCode: string): Promise<void> {
  // ملاحظةٌ صريحة: users.language_code NOT NULL مقيّدةٌ بـ(ar/en/ur) — فحالةُ «مسجَّلٌ
  // بلغةٍ NULL» مستحيلةٌ في المخططِ أصلًا، وتغطيةُ `normalizeLanguageTag(null)` عقدُ كودٍ
  // مُغطّى في اختبارات الوحدة، لا حالةَ قاعدةٍ تُزرعُ هنا.
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, language_code, role)
    values (${cityId}::uuid, ${telegramId}::bigint, 'مستخدم بلا صف سائق', '+966500000000', ${languageCode}, 'rider')
    on conflict (telegram_id) do update set language_code = excluded.language_code
  `;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  counted = postgres(DATABASE_URL, {
    max: 1,
    onnotice: () => {},
    transform: { undefined: null },
    debug: (_conn, _query, params) => {
      if (params.length === 0) statements += 1;
    },
  });
  cityHandle = await ensureActiveCity(sql);
  cityId = cityHandle.cityId;
  // زرعُ الصفوفِ: سائقٌ كاملٌ عبرَ المنفذِ نفسِهِ (فيلزمُ أن يكونَ الملفُّ المُعادُ مطابقًا)،
  // ومسجَّلانِ في users بلا drivers (راكبٌ بلغةٍ، وآخرُ بلغةٍ NULL).
  await createDriverDirectory(sql).register(driverInput(DRIVER_TG));
  await seedNonDriver(RIDER_TG, "en");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql`delete from users where telegram_id::text in ${sql(TGS)}`;
  await sql.end({ timeout: 5 });
  await counted.end({ timeout: 5 });
});

describeIf("findSenderContext على القاعدة الحقيقية (LOAD-01 · C2)", () => {
  it("سائق مسجّل: لغته وملفّه معًا، والملفّ مطابق حرفيًّا لقراءة findByTelegramId", async () => {
    const directory = createDriverDirectory(sql);

    const context = await directory.findSenderContext?.(DRIVER_TG);
    const profile = await directory.findByTelegramId(DRIVER_TG);

    expect(context?.ok).toBe(true);
    const ctx = context?.ok ? context.value : undefined;
    expect(ctx?.language).toBe("ur");
    expect(ctx?.driver).toEqual(profile.ok ? profile.value : undefined);
  });

  it("مسجّل بلا صفّ سائق (راكب يراسل بوت السائق): لغته لا تُفقد وملفّ السائق null — لا مصانعة", async () => {
    const context = await createDriverDirectory(sql).findSenderContext?.(RIDER_TG);

    expect(context?.ok).toBe(true);
    const ctx = context?.ok ? context.value : undefined;
    expect(ctx?.language).toBe("en");
    expect(ctx?.driver).toBeNull();
  });

  it("مسجّل بلغةٍ لا تُدعَم؟ لا — المخطط يمنعها: هنا حالته الممكنة فقط (راكب بلغة صحيحة)", async () => {
    // users.language_code مقيّدةٌ بـ(ar/en/ur) وNOT NULL — فحالةُ «مسجَّلٌ بلا لغةٍ»
    // مستحيلةٌ في القاعدة. هذا الاختبارُ يوثّقِ ذلك صراحةً: كلُّ مسجَّلٍ له لغةٌ صالحة.
    const context = await createDriverDirectory(sql).findSenderContext?.(RIDER_TG);
    const ctx = context?.ok ? context.value : undefined;
    expect(ctx?.language).toBe("en");
  });

  it("غائب عن users كلّها: لا سياق أصلًا — null كما يُعيد المنفذان المنفصلان", async () => {
    const context = await createDriverDirectory(sql).findSenderContext?.(ABSENT_TG);

    expect(context?.ok).toBe(true);
    const ctx = context?.ok ? context.value : undefined;
    expect(ctx).toBeNull();
  });

  it("رحلة واحدة إلى القاعدة: جملة واحدة لا جملتين", async () => {
    const directory = createDriverDirectory(counted);
    statements = 0;

    await directory.findSenderContext?.(DRIVER_TG);

    expect(statements).toBe(1);
  });
});
