/**
 * الغرض: حالاتُ استخدامِ مركبةِ السائقِ — قراءةُ البياناتِ والوثائقِ وتحديثُ
 *   البياناتِ الأساسيّةِ ومسارَيْ الشعارِ والباركودِ (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-vehicle.ts`
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## ولِمَ التحقُّقُ من سنةِ الصنعِ ههنا لا في القاعدةِ
 *
 * لأنَّه **شكلٌ لا سياسةٌ**: سنةٌ ليست رقماً عطُبُ صياغةٍ لا يُنفَقُ له ذَهابٌ.
 * والقاعدةُ تُخزِّنُها `integer` فتقبلُ أيَّ عددٍ، والتحققُ من مجالِها (١٩٠٠…٢١٠٠)
 * في الطبقةِ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا ترفعُ بايتاً**: رفعُ الشعارِ والباركودِ يمرُّ عبرَ `F3-01`.
 *   ــ **لا تُوقِّعُ روابطَ قراءةٍ**: عرضُ الشعارِ والباركودِ دَينٌ مُعلَنٌ.
 *   ــ **لا تُولِّدُ باركوداً**: توليدُهُ من الشعارِ عملُ عرضٍ.
 *   ــ **لا تقرأُ صورةَ المركبةِ**: `vehicle_photo_file_id` عمودٌ قائمٌ.
 */

import {
  type DriverVehicle,
  type VehicleUpdateInput,
  validateVehicleYear,
} from "../../domain/driver/driver-vehicle.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { DriverVehicleStore } from "./driver-vehicle-ports.ts";

export interface DriverVehicleDeps {
  readonly session: MiniAppSessionReader;
  readonly store: DriverVehicleStore;
  readonly now: () => Date;
}

/**
 * رموزُ العطبِ المنشورةُ — **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ وحدَه.
 */
export const DRIVER_VEHICLE_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "VEHICLE_STORE_NOT_AVAILABLE",
  "YEAR_INVALID",
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "CITY_NOT_READY",
] as const;

export type DriverVehiclePublicErrorCode = (typeof DRIVER_VEHICLE_PUBLIC_ERROR_CODES)[number];

interface VehicleRejection {
  readonly code: DriverVehiclePublicErrorCode;
}

function rejection(code: DriverVehiclePublicErrorCode): VehicleRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverVehiclePublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession(
  deps: DriverVehicleDeps,
  accessToken: string | undefined,
): Promise<Result<string, VehicleRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.session.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}
export async function readDriverVehicle(
  deps: DriverVehicleDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<DriverVehicle | null, VehicleRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const storeResult = await deps.store.readVehicle(session.value);
  if (!storeResult.ok) {
    switch (storeResult.reason) {
      case "USER_NOT_FOUND":
        return err(rejection("USER_NOT_FOUND"));
      case "NOT_A_DRIVER":
        return err(rejection("NOT_A_DRIVER"));
      default:
        return err(rejection("VEHICLE_STORE_NOT_AVAILABLE"));
    }
  }

  return ok(storeResult.vehicle);
}

/** تحديثُ بياناتِ المركبةِ الأساسيّةِ (النوعُ، اللوحةُ، السنةُ). */
export async function updateDriverVehicle(
  deps: DriverVehicleDeps,
  input: { readonly accessToken: string | undefined; readonly body: VehicleUpdateInput },
): Promise<Result<{ ok: true }, VehicleRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const yearCheck = validateVehicleYear(input.body.vehicleYear);
  if (!yearCheck.ok) return err(rejection("YEAR_INVALID"));

  const storeResult = await deps.store.updateVehicle(session.value, input.body);
  if (!storeResult.ok) {
    switch (storeResult.reason) {
      case "USER_NOT_FOUND":
        return err(rejection("USER_NOT_FOUND"));
      case "NOT_A_DRIVER":
        return err(rejection("NOT_A_DRIVER"));
      default:
        return err(rejection("VEHICLE_STORE_NOT_AVAILABLE"));
    }
  }

  return ok({ ok: true });
}

/** تحديثُ مسارَيْ مِلفَّيْ الشعارِ والباركودِ بعدَ رفعِهما عبرَ `F3-01`. */
export async function updateDriverVehicleAssets(
  deps: DriverVehicleDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly logoPath: string | null;
    readonly barcodePath: string | null;
  },
): Promise<Result<{ ok: true }, VehicleRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const storeResult = await deps.store.updateAssets(
    session.value,
    input.logoPath,
    input.barcodePath,
  );
  if (!storeResult.ok) {
    switch (storeResult.reason) {
      case "USER_NOT_FOUND":
        return err(rejection("USER_NOT_FOUND"));
      case "NOT_A_DRIVER":
        return err(rejection("NOT_A_DRIVER"));
      default:
        return err(rejection("VEHICLE_STORE_NOT_AVAILABLE"));
    }
  }

  return ok({ ok: true });
}
