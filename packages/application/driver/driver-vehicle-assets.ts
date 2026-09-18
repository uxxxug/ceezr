/**
 * الغرض: حالاتُ استخدامِ قراءةِ أصولِ المركبةِ — توقيعُ روابطِ قراءةٍ للشعارِ
 *   والباركودِ لعرضِهما في شاشةِ المركبةِ (`F12-06`).
 * الحالة: مبنيٌّ — البند `F12-06`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-vehicle.ts`
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا ترفعُ بايتاً ولا تقرأُ مِلفّاً**: تُوقِّعُ روابطَ فحسب.
 *   ــ **لا تُولِّدُ باركوداً**: توليدُهُ من الشعارِ عملُ عرضٍ في الشاشةِ.
 *   ــ **لا تُوقِّعُ روابطَ لغيابٍ**: مسارٌ `null` يُرجَعُ `null` لا رابطاً فارغاً.
 *   ــ **لا تُوقِّعُ روابطَ بلا جلسةٍ**: الهويّةُ في الرمزِ الموقَّعِ وحدَه.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import type { DriverVehicleStore } from "./driver-vehicle-ports.ts";
import type { VehicleAssetReader } from "./vehicle-asset-reader.ts";

export interface DriverVehicleAssetsDeps {
  readonly session: MiniAppSessionReader;
  readonly store: DriverVehicleStore;
  readonly assetReader: VehicleAssetReader;
  readonly now: () => Date;
}

/** مدّةُ صلاحيّةِ رابطِ القراءةِ بالثواني — ساعةٌ واحدةٌ. */
const READ_URL_TTL_SECONDS = 3600;

/** رموزُ العطبِ المنشورةُ. */
export const DRIVER_VEHICLE_ASSETS_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "VEHICLE_STORE_NOT_AVAILABLE",
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "ASSET_SIGNER_NOT_AVAILABLE",
] as const;

export type DriverVehicleAssetsPublicErrorCode =
  (typeof DRIVER_VEHICLE_ASSETS_PUBLIC_ERROR_CODES)[number];

interface AssetsRejection {
  readonly code: DriverVehicleAssetsPublicErrorCode;
}

function rejection(code: DriverVehicleAssetsPublicErrorCode): AssetsRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverVehicleAssetsPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function openSession(
  deps: DriverVehicleAssetsDeps,
  accessToken: string | undefined,
): Result<string, AssetsRejection> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = deps.session.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/** روابطُ قراءةٍ موقَّعةٌ للشعارِ والباركودِ — `null` إن لم تُرفَعْ. */
export interface VehicleAssetReadUrls {
  readonly logoReadUrl: string | null;
  readonly barcodeReadUrl: string | null;
}

/**
 * يُوقِّعُ روابطَ قراءةٍ للشعارِ والباركودِ المرفوعَيْنِ على المركبةِ.
 *
 * مسارٌ `null` يُرجَعُ `null` — لا رابطاً فارغاً ولا عطلاً. وغيابُ المُوقِّعِ
 * عطلٌ مُصنَّفٌ (`ASSET_SIGNER_NOT_AVAILABLE`) لا صمتٌ.
 */
export async function readDriverVehicleAssets(
  deps: DriverVehicleAssetsDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<VehicleAssetReadUrls | null, AssetsRejection>> {
  const session = openSession(deps, input.accessToken);
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

  const vehicle = storeResult.vehicle;
  if (vehicle === null) return ok(null);

  const logoPath = vehicle.logoObjectPath;
  const barcodePath = vehicle.barcodeObjectPath;

  if (logoPath === null && barcodePath === null) {
    return ok({ logoReadUrl: null, barcodeReadUrl: null });
  }

  const [logoResult, barcodeResult] = await Promise.all([
    logoPath !== null
      ? deps.assetReader.signReadUrl(logoPath, READ_URL_TTL_SECONDS)
      : Promise.resolve({ ok: true as const, readUrl: null, expiresAtEpochMs: 0 }),
    barcodePath !== null
      ? deps.assetReader.signReadUrl(barcodePath, READ_URL_TTL_SECONDS)
      : Promise.resolve({ ok: true as const, readUrl: null, expiresAtEpochMs: 0 }),
  ]);

  if (!logoResult.ok) {
    return err(rejection("ASSET_SIGNER_NOT_AVAILABLE"));
  }
  if (!barcodeResult.ok) {
    return err(rejection("ASSET_SIGNER_NOT_AVAILABLE"));
  }

  return ok({
    logoReadUrl: logoResult.readUrl,
    barcodeReadUrl: barcodeResult.readUrl,
  });
}
