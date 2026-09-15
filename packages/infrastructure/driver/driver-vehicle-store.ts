/**
 * الغرض: محوّلُ مركبةِ السائقِ على PostgreSQL — نداءُ دالّاتِ القراءةِ والتحديثِ
 *   وقراءةُ حمولتِها **بلا افتراضٍ** (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: packages/infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F12-06` — عرضُ الشعارِ والباركودِ في المركبةِ
 *   يقرأُ من هنا، ولا محوِّلَ ثانياً.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ وحدَها.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يعرفُ دلواً ولا يُوقِّعُ**: التوقيعُ في `storage/signed-upload.ts`.
 */

import type { DriverVehicleStore } from "../../application/driver/driver-vehicle-ports.ts";
import type { DriverVehicle, VehicleUpdateInput } from "../../domain/driver/driver-vehicle.ts";
import type { Sql } from "../db/client.ts";

type StoreResult =
  | { ok: true; vehicle: DriverVehicle | null }
  | { ok: false; reason: "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR" };

type UpdateResult =
  | { ok: true }
  | { ok: false; reason: "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR" };

function failed(reason: "STORE_ERROR"): { ok: false; reason: "STORE_ERROR" } {
  return { ok: false, reason };
}

function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInt(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function rowToVehicle(row: unknown): DriverVehicle | null {
  if (!isRecord(row)) return null;
  return {
    vehicleType: readText(row.vehicle_type),
    plateNumber: readText(row.plate_number),
    vehicleYear: readInt(row.vehicle_year),
    logoObjectPath: readText(row.logo_object_path),
    barcodeObjectPath: readText(row.barcode_object_path),
    registration:
      row.registration_status || row.registration_expires_at
        ? {
            status: readText(row.registration_status),
            expiresAt: readDate(row.registration_expires_at),
          }
        : null,
    insurance:
      row.insurance_status || row.insurance_expires_at
        ? {
            status: readText(row.insurance_status),
            expiresAt: readDate(row.insurance_expires_at),
          }
        : null,
    inspection:
      row.inspection_status || row.inspection_expires_at
        ? {
            status: readText(row.inspection_status),
            expiresAt: readDate(row.inspection_expires_at),
          }
        : null,
  };
}

export class PostgresDriverVehicleStore implements DriverVehicleStore {
  constructor(private readonly sql: Sql) {}

  async readVehicle(telegramUserId: string): Promise<StoreResult> {
    const telegramId = asTelegramId(telegramUserId);
    if (telegramId === null) return { ok: false, reason: "STORE_ERROR" };
    try {
      const rows = await this.sql`
        select * from driver_vehicle(${telegramId}::bigint)
      `;
      const list = Array.isArray(rows) ? rows : [];
      if (list.length === 0) return { ok: false, reason: "USER_NOT_FOUND" };
      const vehicle = rowToVehicle(list[0]);
      if (vehicle === null) return { ok: false, reason: "STORE_ERROR" };
      return { ok: true, vehicle };
    } catch {
      return failed("STORE_ERROR");
    }
  }

  async updateVehicle(telegramUserId: string, input: VehicleUpdateInput): Promise<UpdateResult> {
    const telegramId = asTelegramId(telegramUserId);
    if (telegramId === null) return { ok: false, reason: "STORE_ERROR" };
    try {
      await this.sql`
        select update_driver_vehicle(
          ${telegramId}::bigint,
          ${input.vehicleType ?? null}::text,
          ${input.plateNumber ?? null}::text,
          ${input.vehicleYear ?? null}::int
        )
      `;
      return { ok: true };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("USER_NOT_FOUND")) return { ok: false, reason: "USER_NOT_FOUND" };
      if (msg.includes("NOT_A_DRIVER")) return { ok: false, reason: "NOT_A_DRIVER" };
      return failed("STORE_ERROR");
    }
  }

  async updateAssets(
    telegramUserId: string,
    logoPath: string | null,
    barcodePath: string | null,
  ): Promise<UpdateResult> {
    const telegramId = asTelegramId(telegramUserId);
    if (telegramId === null) return { ok: false, reason: "STORE_ERROR" };
    try {
      await this.sql`
        select update_driver_vehicle_assets(
          ${telegramId}::bigint,
          ${logoPath}::text,
          ${barcodePath}::text
        )
      `;
      return { ok: true };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("USER_NOT_FOUND")) return { ok: false, reason: "USER_NOT_FOUND" };
      if (msg.includes("NOT_A_DRIVER")) return { ok: false, reason: "NOT_A_DRIVER" };
      return failed("STORE_ERROR");
    }
  }
}
