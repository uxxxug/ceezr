/**
 * الغرض: LOAD-01 · `driver/location` — إثباتُ عقدِ القراءةِ المدمجةِ (`findViewerAndDriver`)
 *   على PostgreSQL الحقيقيّ: الحسابُ المُعادُ مطابقٌ حرفيًا لقارئِ الحسابِ
 *   (`createViewerAccountReader`)، والملفُّ مطابقٌ حرفيًا لـ`findByTelegramId`، في كلِّ حالةٍ
 *   (سائقٌ · محجوبٌ · مسجَّلٌ بلا سائقٍ · غائبٌ · معرّفٌ ليس رقمًا · تعذّرُ القاعدة)، وكلُّ ذلك
 *   بجملةٍ واحدةٍ إلى القاعدة.
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
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
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
const DRIVER_TG = "900009331";
const RIDER_TG = "900009332"; // مسجَّلٌ في users بلا صفٍّ في drivers
const BLOCKED_TG = "900009333"; // سائقٌ محجوب
const ABSENT_TG = "900009398";
const TGS = [DRIVER_TG, RIDER_TG, BLOCKED_TG];

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
    fullName: "سائق قراءة الموقع المدمجة",
    phone: `+9665${tg.slice(-8)}`,
    service: "transport",
    language: "ur",
    vehicleType: "sedan",
    plateNumber: `LM ${tg.slice(-4)}`,
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
  await createDriverDirectory(sql).register(driverInput(BLOCKED_TG));
  await sql`update users set is_blocked = true where telegram_id = ${BLOCKED_TG}::bigint`;
  // موقعٌ سابقٌ للسائقِ: فتُقارَنُ أعمدةُ `lastFix` المشتقّةُ من PostGIS لا القيمُ الفارغةُ وحدَها.
  await sql`
    update drivers set last_location = st_setsrid(st_makepoint(39.1751, 21.5471), 4326)::geography,
                       last_location_recorded_at = now()
     where user_id = (select id from users where telegram_id = ${DRIVER_TG}::bigint)
  `;
  await seedNonDriver(RIDER_TG, "en");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql`delete from users where telegram_id::text in ${sql(TGS)}`;
  await sql.end({ timeout: 5 });
  await counted.end({ timeout: 5 });
});

describeIf("findViewerAndDriver على القاعدة الحقيقية (LOAD-01 · driver/location)", () => {
  for (const [label, tg] of [
    ["سائقٌ مسجَّلٌ بموقعٍ سابق", DRIVER_TG],
    ["سائقٌ محجوب", BLOCKED_TG],
    ["مسجَّلٌ بلا صفِّ سائق", RIDER_TG],
    ["غائبٌ عن users", ABSENT_TG],
    ["معرّفٌ ليس رقمًا", "not-a-number"],
  ] as const) {
    it(`${label}: الحسابُ والملفُّ مطابقانِ حرفيًا للقارئَينِ المنفصلَين`, async () => {
      const lookup = await createDriverDirectory(sql).findViewerAndDriver?.(tg);
      const account = await createViewerAccountReader(sql).findByTelegramUserId(tg);
      const driver =
        tg === "not-a-number" ? null : await createDriverDirectory(sql).findByTelegramId(tg);

      expect(lookup).toBeDefined();
      expect(lookup?.account).toEqual(account);
      if (driver === null) {
        expect(lookup?.driver).toEqual({ ok: true, value: null });
      } else {
        expect(lookup?.driver).toEqual(driver);
      }
    });
  }

  it("السائقُ: الحسابُ دورُه driver وملفُّه بموقعِه السابق — لا قيمٌ فارغةٌ تتطابقُ صدفةً", async () => {
    const lookup = await createDriverDirectory(sql).findViewerAndDriver?.(DRIVER_TG);
    expect(lookup?.account).toEqual({
      ok: true,
      value: { role: "driver", isBlocked: false, languageCode: "ur" },
    });
    const driver = lookup?.driver.ok ? lookup.driver.value : undefined;
    expect(driver?.telegramUserId).toBe(DRIVER_TG);
    expect(driver?.hasLocation).toBe(true);
    expect(driver?.lastFix?.latitude).toBeCloseTo(21.5471, 6);
    expect(driver?.lastFix?.longitude).toBeCloseTo(39.1751, 6);
  });

  it("المحجوبُ: isBlocked صادقٌ من القاعدة", async () => {
    const lookup = await createDriverDirectory(sql).findViewerAndDriver?.(BLOCKED_TG);
    expect(lookup?.account.ok ? lookup.account.value?.isBlocked : undefined).toBe(true);
  });

  it("رحلة واحدة إلى القاعدة: جملة واحدة لا جملتين", async () => {
    const directory = createDriverDirectory(counted);
    statements = 0;

    await directory.findViewerAndDriver?.(DRIVER_TG);

    expect(statements).toBe(1);
  });

  it("معرّفٌ ليس رقمًا لا يصلُ إلى القاعدةِ أصلًا", async () => {
    const directory = createDriverDirectory(counted);
    statements = 0;

    await directory.findViewerAndDriver?.("not-a-number");

    expect(statements).toBe(0);
  });

  it("تعذّرُ القاعدة: الحسابُ READER_ERROR والملفُّ خطأُ منفذ — لا null يُقرأُ «غيرَ مسجَّل»", async () => {
    const broken = postgres("postgres://127.0.0.1:1/none", {
      max: 1,
      connect_timeout: 1,
      onnotice: () => {},
    });
    try {
      const lookup = await createDriverDirectory(broken).findViewerAndDriver?.(DRIVER_TG);
      expect(lookup?.account).toEqual({
        ok: false,
        error: { code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" },
      });
      expect(lookup?.driver.ok).toBe(false);
    } finally {
      await broken.end({ timeout: 1 });
    }
  });
});
