/**
 * الغرض: منافذُ مركبةِ السائقِ — عقدُ ما تحتاجُه حالاتُ الاستخدامِ من **مخزنِ
 *   قاعدةٍ** (`F3-07` · `SD-11`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-vehicle.ts`
 *   · `packages/infrastructure/driver/driver-vehicle-store.ts`
 * الحاكم: docs/adr/0094-project-independence.md
 */

import type { DriverVehicle, VehicleUpdateInput } from "../../domain/driver/driver-vehicle.ts";

export interface DriverVehicleStore {
  /** قراءةُ بياناتِ المركبةِ ووثائقِها الثلاثِ في نداءٍ واحدٍ. */
  readVehicle(
    telegramUserId: string,
  ): Promise<
    | { ok: true; vehicle: DriverVehicle | null }
    | { ok: false; reason: "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR" }
  >;

  /** تحديثُ بياناتِ المركبةِ الأساسيّةِ (النوعُ، اللوحةُ، السنةُ). */
  updateVehicle(
    telegramUserId: string,
    input: VehicleUpdateInput,
  ): Promise<
    { ok: true } | { ok: false; reason: "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR" }
  >;

  /** تحديثُ مسارَيْ مِلفَّيْ الشعارِ والباركودِ بعدَ رفعِهما. */
  updateAssets(
    telegramUserId: string,
    logoPath: string | null,
    barcodePath: string | null,
  ): Promise<
    { ok: true } | { ok: false; reason: "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR" }
  >;
}

export type DriverVehicleStoreError = "USER_NOT_FOUND" | "NOT_A_DRIVER" | "STORE_ERROR";
