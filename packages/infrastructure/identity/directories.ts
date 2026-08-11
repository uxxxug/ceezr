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
  RegisterDriverInput,
  RegisterRiderInput,
  RiderDirectory,
  RiderProfile,
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
  };
}

const DRIVER_SELECT = `
  select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone,
         d.verification_status, a.is_available,
         (d.last_location is not null) as has_location
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

    updateLocation: (driverId: DriverId, location: Coordinates) =>
      guard("drivers.updateLocation", async () => {
        await sql`
          update drivers
             set last_location = st_setsrid(
                   st_makepoint(${location.longitude}, ${location.latitude}), 4326)::geography,
                 last_location_at = now(),
                 updated_at = now()
           where id = ${driverId}
        `;
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
  };
}
