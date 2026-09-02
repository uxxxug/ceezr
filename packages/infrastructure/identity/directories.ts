/**
 * الغرض: تسجيل السائق والعميل فعلاً في القاعدة، وقراءة ملفيهما، وتبديل حالة التوافر.
 *   التسجيل يمسّ ثلاثة جداول (users, drivers, driver_capabilities, driver_availability)
 *   فيُنفَّذ داخل معاملة واحدة: إمّا يُسجَّل السائق كاملاً أو لا يُسجَّل إطلاقاً.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/identity
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، لوحة الإدارة (2.4)
 * ملاحظات مستقبلية: التحقّق من السائق (verification_status) يصير من لوحة الإدارة لا يدوياً.
 */

import type {
  DriverDirectory,
  DriverProfile,
  LocationWriteOutcome,
  RegisterDriverInput,
  RegisterRiderInput,
  RiderDirectory,
  RiderProfile,
  StoredLocationQuality,
} from "../../application/bots/types.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { CityId, DriverId, RiderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface DriverRow {
  readonly driver_id: string;
  readonly city_id: string;
  readonly telegram_id: string;
  readonly full_name: string | null;
  readonly phone: string | null;
  readonly verification_status: string;
  readonly is_available: boolean | null;
  readonly has_location: boolean;
  readonly last_lat: number | null;
  readonly last_lng: number | null;
  readonly last_location_at_ms: string | null;
}

/**
 * المرحلة ٥ — الإصلاحة السابقة تُقرأ من المصدر القانوني نفسه (ADR-0015) لا من
 * ذاكرة داخل العملية. وهذا شرط أن يعمل تحقّق التتابع في المسار الحيّ: ذاكرةٌ
 * محلّية تضيع بإعادة التشغيل ولا تُشارَك بين نسخ، فيصير كل انتقالٍ لحظيّ بعد
 * إعادة نشرٍ غيرَ مكشوف. والقراءة هنا بلا كلفة: الصفّ مجلوب أصلاً.
 *
 * الثلاثة تُقرأ معاً أو لا تُقرأ: نقطةٌ بلا طابعٍ زمني لا تصلح أساساً لقياس
 * إزاحة، وحسابُ السرعة على طابعٍ مفقود يُنتج قسمةً على صفر أو `NaN` صامتاً.
 */
function toLastFix(row: DriverRow): DriverProfile["lastFix"] {
  if (row.last_lat === null || row.last_lng === null || row.last_location_at_ms === null) {
    return null;
  }
  const recordedAtMs = Number(row.last_location_at_ms);
  if (!Number.isFinite(recordedAtMs)) return null;
  return { latitude: row.last_lat, longitude: row.last_lng, recordedAtMs };
}

function toDriverProfile(row: DriverRow): DriverProfile {
  return {
    id: row.driver_id as DriverId,
    cityId: row.city_id as CityId,
    telegramUserId: String(row.telegram_id),
    fullName: row.full_name ?? "",
    phone: row.phone ?? "",
    isVerified: row.verification_status === "verified",
    isAvailable: row.is_available === true,
    hasLocation: row.has_location,
    lastFix: toLastFix(row),
  };
}

const DRIVER_SELECT = `
  select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone,
         d.verification_status, a.is_available,
         (d.last_location is not null) as has_location,
         st_y(d.last_location::geometry) as last_lat,
         st_x(d.last_location::geometry) as last_lng,
         (extract(epoch from d.last_location_recorded_at) * 1000)::bigint::text as last_location_at_ms
    from drivers d
    join users u on u.id = d.user_id
    left join driver_availability a on a.driver_id = d.id
`;

export function createDriverDirectory(sql: Sql): DriverDirectory {
  return {
    findByTelegramId: (telegramUserId: string) =>
      guard("drivers.findByTelegramId", async () => {
        const rows = await sql.unsafe<DriverRow[]>(`${DRIVER_SELECT} where u.telegram_id = $1`, [
          telegramUserId,
        ]);
        const row = rows[0];
        return row === undefined ? null : toDriverProfile(row);
      }),

    register: (input: RegisterDriverInput) =>
      guard("drivers.register", async () =>
        sql.begin(async (tx) => {
          const users = await tx<{ id: string }[]>`
            insert into users (city_id, telegram_id, full_name, phone, language_code, role)
            values (${input.cityId}, ${input.telegramUserId}, ${input.fullName},
                    ${input.phone}, ${input.language}, 'driver')
            on conflict (telegram_id) do update
              set full_name = excluded.full_name,
                  phone = excluded.phone,
                  city_id = excluded.city_id,
                  role = 'driver',
                  updated_at = now()
            returning id
          `;
          const userId = users[0]?.id;
          if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");

          /**
           * الملفّ التوثيقي يُكتب هنا في نفس المعاملة لا في تحديث لاحق: تحديثٌ
           * منفصل قد يفشل بعد نجاح الإدراج، فيبقى سائقٌ بلا مركبة ولا هوية —
           * وهو بالضبط ما كانت عليه الحال قبل هذه المرحلة.
           * ملاحظة: لا يُطبع national_id في أي سجل ولا رسالة خطأ.
           */
          const drivers = await tx<{ id: string }[]>`
            insert into drivers (city_id, user_id, vehicle_type, plate_number,
                                 national_id, vehicle_photo_file_id)
            values (${input.cityId}, ${userId}, ${input.vehicleType}, ${input.plateNumber},
                    ${input.nationalId}, ${input.vehiclePhotoFileId})
            on conflict (user_id) do update
              set city_id = excluded.city_id,
                  vehicle_type = excluded.vehicle_type,
                  plate_number = excluded.plate_number,
                  national_id = excluded.national_id,
                  vehicle_photo_file_id = excluded.vehicle_photo_file_id,
                  updated_at = now()
            returning id
          `;
          const driverId = drivers[0]?.id;
          if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");

          await tx`
            insert into driver_capabilities (city_id, driver_id, service, is_enabled)
            values (${input.cityId}, ${driverId}, ${input.service}, true)
            on conflict (driver_id, service) do update
              set is_enabled = true, updated_at = now()
          `;
          await tx`
            insert into driver_availability (city_id, driver_id, is_available)
            values (${input.cityId}, ${driverId}, false)
            on conflict (driver_id) do nothing
          `;

          const rows = await tx.unsafe<DriverRow[]>(`${DRIVER_SELECT} where d.id = $1`, [driverId]);
          const row = rows[0];
          if (row === undefined) throw new Error("تعذّرت قراءة السائق بعد التسجيل");
          return toDriverProfile(row);
        }),
      ) as Promise<Result<DriverProfile, PortFailureError>>,

    /**
     * ## `BUG-001` — ولماذا الشرطُ في `where` لا في `JS`
     *
     * كانت هذه الجملةُ **غيرَ مشروطةٍ**: من وصلَ أخيراً كتبَ، وإن كانت إصلاحتُه
     * أقدمَ. ورسائلُ الموقعِ الحيِّ تأتي تباعاً ولا شيءَ يضمنُ ترتيبَ وصولِها ولا
     * ترتيبَ معالجتِها، فنبضتانِ متزاحمتانِ تجعلانِ الموضعَ القانونيَّ يتراجعُ إلى
     * الوراءِ — فتقيس المطابقةُ مسافةً من نقطةٍ غادرَها السائقُ، ويرى الراكبُ
     * السيارةَ ترتدُّ على الخريطةِ.
     *
     * والقراءةُ ثمّ المقارنةُ في `JS` ثمّ الكتابةُ لا تُصلِح شيئاً: بينَ القراءةِ
     * والكتابةِ نافذةٌ تكفي لأن تقرأَ النبضتانِ نفسَ الطابعِ القديمِ فتكتبَا معاً.
     * فالشرطُ في `where` داخلَ جملةِ الكتابةِ نفسِها (`BUG-001` بحرفِه: «الرقابةُ
     * في القاعدةِ لا في `JS`») — و`PostgreSQL` في `READ COMMITTED` يُعيد تقويمَ
     * الشرطِ على **النسخةِ المُحدَّثةِ** من الصفِّ إذا انتظرت الجملةُ معاملةً
     * متزامنةً، فالخاسرُ يرى ما كتبَه الفائزُ ويُحكَم عليهِ به.
     *
     * ## ولماذا `<=` لا `<`، ولماذا `last_location_recorded_at`
     *
     * `ADR 0053` §٦ يُلزِم أن يكونَ مُسنَدُ هذا الحارسِ **مُسنَدَ حارسِ
     * `tracking_sessions` حرفاً**: قِدَمٌ صارمٌ على طابعِ الإصلاحةِ والتساوي
     * مقبولٌ (§٤-ج) — وإلّا صار للنظامِ حَكَمانِ على «الأحدثِ»، فيُعرَض موضعٌ لا
     * يطابقُ المصدرَ القانونيَّ. وطابعُ تلغرام بدقّةِ الثانيةِ، فإصلاحتانِ في
     * ثانيةٍ واحدةٍ حالةٌ عاديّةٌ، ورفضُ المتساوي كان سيُجمّد الخريطةَ عندَ أوّلِ
     * حركةٍ سريعةٍ.
     *
     * والمقارنةُ على `last_location_recorded_at` (طابعُ الجهازِ) لا
     * `last_location_at` (`now()` لحظةَ الكتابةِ): الأوّلُ هو ما يقرأُه المجالُ
     * إصلاحةً سابقةً (`toLastFix` أعلاه) وهو ما تحكمُ به الجلسةُ؛ والثاني يتقدّمُ
     * مع كلِّ كتابةٍ فلا يرفضُ شيئاً أبداً، والحكمُ به حكمٌ بساعةِ الخادمِ لا
     * بترتيبِ الإصلاحاتِ.
     *
     * ## ولماذا `current` مع `written`
     *
     * لأنّ «لا صفَّ مُحدَّثاً» جوابٌ ملتبسٌ: أقدَمٌ مرفوضٌ أم سائقٌ لا صفَّ له؟
     * وخلطُهما يجعلُ عطلاً حقيقيّاً (معرّفٌ لا وجودَ له) يُقرأُ «إصلاحةٌ أقدمُ»
     * فيمرُّ صامتاً. و`current` تُقرأُ من لقطةِ الجملةِ وليست مصدرَ الحكمِ:
     * الحكمُ وجودُ صفٍّ في `written` لا مقارنةٌ في التطبيقِ — وهي نفسُ صياغةِ
     * `session-repository.advance` عن قصدٍ لا توارُدٍ.
     *
     * والموضعُ وجودتُه وطابعُه يُكتبان في جملةٍ واحدةٍ كما كانا (ADR-0015):
     * جملتان متتاليتان تتركان نافذةً تُقرأ فيها إحداثيةٌ جديدة مع حكمِ إحداثيةٍ
     * قديمة — وهي أسوأ من غياب الحكم أصلاً، لأنّها تُلبِس إصلاحةً خشنةً شهادةَ
     * دقّةٍ لإصلاحةٍ أخرى. والكاتبُ واحدٌ لا غير — وهذا هو.
     */
    updateLocation: (driverId: DriverId, location: Coordinates, quality: StoredLocationQuality) =>
      guard("drivers.updateLocation", async (): Promise<LocationWriteOutcome> => {
        const at = new Date(quality.recordedAtMs);
        const rows = await sql<{ readonly accepted: boolean }[]>`
          with current as (
            select id from drivers where id = ${driverId}
          ),
          written as (
            update drivers as d
               set last_location = st_setsrid(
                     st_makepoint(${location.longitude}, ${location.latitude}), 4326)::geography,
                   last_location_at = now(),
                   last_location_recorded_at = ${at},
                   last_location_accuracy_m = ${quality.accuracyMeters},
                   last_location_quality = ${quality.verdict},
                   updated_at = now()
             where d.id = ${driverId}
               and (d.last_location_recorded_at is null or d.last_location_recorded_at <= ${at})
            returning d.id
          )
          select true as accepted from written
          union all
          select false as accepted from current where not exists (select 1 from written)
        `;
        const row = rows[0];
        if (row === undefined) return { kind: "no_driver" };
        return row.accepted ? { kind: "accepted" } : { kind: "stale" };
      }),

    /**
     * البند 2.4 — المنطقة المفضّلة. الحقلان يُكتبان في جملة واحدة لا جملتين:
     * جملتان متتاليتان تتركان نافذةً يكون فيها للسائق اسمُ منطقةٍ بلا إحداثية،
     * وهي الحال التي يرفضها قيد القاعدة أصلاً.
     */
    setPreferredArea: (
      driverId: DriverId,
      area: { readonly label: string; readonly location: Coordinates } | null,
    ) =>
      guard("drivers.setPreferredArea", async () => {
        await sql`
          update drivers
             set preferred_area_label = ${area === null ? null : area.label},
                 preferred_area_location = ${
                   area === null
                     ? null
                     : sql`st_setsrid(st_makepoint(${area.location.longitude}, ${area.location.latitude}), 4326)::geography`
},
                 updated_at = now()
           where id = ${driverId}
        `;
      }),

    setAvailability: (driverId: DriverId, isAvailable: boolean) =>
      guard("drivers.setAvailability", async () => {
        const result = await sql<{ ok: boolean }[]>`
          select (record_attendance(${driverId}::uuid, ${isAvailable}, 'driver_bot') ->> 'ok')::boolean as ok
        `;
        if (result[0]?.ok !== true) throw new Error("record_attendance رفض التغيير");
      }),

    changeCity: (driverId: DriverId, newCityId: CityId) =>
      guard("drivers.changeCity", async () => {
        const rows = await sql<{ ok: boolean; error: string | null }[]>`
          select * from update_driver_city(${driverId}::uuid, ${newCityId}::uuid)
        `;
        const row = rows[0];
        if (row === undefined) throw new Error("update_driver_city لم تُعِد نتيجة");
        return { ok: row.ok, error: row.error };
      }),
  };
}

interface RiderRow {
  readonly rider_id: string;
  readonly city_id: string;
  readonly telegram_id: string;
  readonly full_name: string | null;
}

const RIDER_SELECT = `
  select r.id as rider_id, r.city_id, u.telegram_id, u.full_name
    from riders r
    join users u on u.id = r.user_id
`;

function toRiderProfile(row: RiderRow): RiderProfile {
  return {
    id: row.rider_id as RiderId,
    cityId: row.city_id as CityId,
    telegramUserId: String(row.telegram_id),
    fullName: row.full_name ?? "",
  };
}

export function createRiderDirectory(sql: Sql): RiderDirectory {
  return {
    findByTelegramId: (telegramUserId: string) =>
      guard("riders.findByTelegramId", async () => {
        const rows = await sql.unsafe<RiderRow[]>(`${RIDER_SELECT} where u.telegram_id = $1`, [
          telegramUserId,
        ]);
        const row = rows[0];
        return row === undefined ? null : toRiderProfile(row);
      }),

    register: (input: RegisterRiderInput) =>
      guard("riders.register", async () =>
        sql.begin(async (tx) => {
          const users = await tx<{ id: string }[]>`
            insert into users (city_id, telegram_id, full_name, language_code, role)
            values (${input.cityId}, ${input.telegramUserId}, ${input.fullName},
                    ${input.language}, 'rider')
            on conflict (telegram_id) do update
              set full_name = excluded.full_name,
                  city_id = excluded.city_id,
                  updated_at = now()
            returning id
          `;
          const userId = users[0]?.id;
          if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");

          const riders = await tx<{ id: string }[]>`
            insert into riders (city_id, user_id)
            values (${input.cityId}, ${userId})
            on conflict (user_id) do update set city_id = excluded.city_id, updated_at = now()
            returning id
          `;
          const riderId = riders[0]?.id;
          if (riderId === undefined) throw new Error("تعذّر إنشاء العميل");

          const rows = await tx.unsafe<RiderRow[]>(`${RIDER_SELECT} where r.id = $1`, [riderId]);
          const row = rows[0];
          if (row === undefined) throw new Error("تعذّرت قراءة العميل بعد التسجيل");
          return toRiderProfile(row);
        }),
      ) as Promise<Result<RiderProfile, PortFailureError>>,

    changeCity: (riderId: RiderId, newCityId: CityId) =>
      guard("riders.changeCity", async () => {
        const rows = await sql<{ ok: boolean; error: string | null }[]>`
          select * from update_rider_city(${riderId}::uuid, ${newCityId}::uuid)
        `;
        const row = rows[0];
        if (row === undefined) throw new Error("update_rider_city لم تُعِد نتيجة");
        return { ok: row.ok, error: row.error };
      }),
  };
}
