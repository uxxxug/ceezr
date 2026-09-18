#!/usr/bin/env bun
/**
 * الغرض: إثباتُ أنَّ مسارَ قراءةِ أصولِ المركبةِ موقَّعٌ ومُسجَّلٌ في كلِّ
 *   ملفٍّ يمسُّه (`F12-06`).
 * الحالة: منفَّذٌ — البند `F12-06`.
 * ينتمي إلى: scripts
 * يُستخدم من: `bun run check:vehicle-logo-barcode` وسلسلةُ `ci` وخطوةٌ مُسمّاةٌ في CI.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * القاعدةُ: وجودُ `GET /v1/driver/vehicle/assets` في المساراتِ، ووجودُ
 * `ReadUrlSigner` في البنيةِ التحتيّةِ، ووجودُ `VehicleAssetReader` في
 * طبقةِ التطبيقِ. والكشفُ الفارغُ لا يُقرأُ نجاحاً (`ح-7`).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const CHECKS: { file: string; pattern: RegExp; label: string }[] = [
  {
    file: "packages/infrastructure/storage/signed-read.ts",
    pattern: /export class HttpReadSigner/,
    label: "HttpReadSigner",
  },
  {
    file: "packages/infrastructure/storage/signed-read.ts",
    pattern: /export interface ReadUrlSigner/,
    label: "ReadUrlSigner interface",
  },
  {
    file: "packages/application/driver/vehicle-asset-reader.ts",
    pattern: /export interface VehicleAssetReader/,
    label: "VehicleAssetReader interface",
  },
  {
    file: "packages/application/driver/driver-vehicle-assets.ts",
    pattern: /export async function readDriverVehicleAssets/,
    label: "readDriverVehicleAssets use case",
  },
  {
    file: "apps/gateway/src/routes/driver-vehicle.ts",
    pattern: /vehicle\.get\(VEHICLE_ASSETS_PATH/,
    label: "GET /v1/driver/vehicle/assets route",
  },
  {
    file: "apps/miniapp/src/surfaces/driver/vehicle/vehicle-api.ts",
    pattern: /export function readDriverVehicleAssets/,
    label: "readDriverVehicleAssets miniapp API",
  },
  {
    file: "apps/miniapp/src/surfaces/driver/vehicle/VehicleScreen.tsx",
    pattern: /dveh__logo-image/,
    label: "logo image display in VehicleScreen",
  },
];

const problems: string[] = [];

for (const check of CHECKS) {
  const path = join(ROOT, check.file);
  if (!existsSync(path)) {
    problems.push(`الملفُّ غيرُ موجودٍ: ${check.file}`);
    continue;
  }
  const content = readFileSync(path, "utf8");
  if (!check.pattern.test(content)) {
    problems.push(`${check.label} غيرُ موجودٍ في ${check.file}`);
  }
}

if (problems.length === 0) {
  console.log(
    `حاجزُ الشعارِ والباركودِ: نجحَ — ${CHECKS.length} عناصرَ موقَّعةٌ ومُسجَّلةٌ في مسارِ قراءةِ أصولِ المركبةِ.`,
  );
} else {
  console.error("حاجزُ الشعارِ والباركودِ: سقطَ.");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
