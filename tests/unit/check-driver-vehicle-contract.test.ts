/**
 * الغرض: برهانُ سقوطِ حاجزِ عقدِ مركبةِ السائقِ — **حالةٌ سلبيّةٌ مصنوعةٌ لكلِّ
 *   قاعدةٍ من الخمسِ**، وحالةٌ موجبةٌ واحدةٌ على المستودعِ الحقيقيِّ (`ح-7`).
 * الحالة: مبنيٌّ — البند `F3-07`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test`.
 * الحاكم: docs/adr/0094-project-independence.md
 */

import { describe, expect, test } from "bun:test";
import { readRepository } from "../../scripts/check-driver-vehicle-contract.ts";
import {
  type DriverVehicleContractInput,
  driverVehicleContractProblems,
  failClosedProblems,
  KEY_PREFIX,
  logoBarcodeDisplayProblems,
  PUBLIC_ERROR_CODES,
  SCREEN_FILE,
  separateTableProblems,
  textCoverageProblems,
  yearValidationProblems,
} from "../../scripts/lib/driver-vehicle-contract.ts";

const REAL: DriverVehicleContractInput = readRepository();

function spoil(patch: Partial<DriverVehicleContractInput>): DriverVehicleContractInput {
  return { ...REAL, ...patch };
}

function withRoute(mutate: (source: string) => string): DriverVehicleContractInput {
  return spoil({ route: mutate(REAL.route) });
}

function withApp(mutate: (source: string) => string): DriverVehicleContractInput {
  return spoil({ application: mutate(REAL.application) });
}

function withSurface(path: string, mutate: (source: string) => string): DriverVehicleContractInput {
  const source = REAL.surface[path];
  if (source === undefined) throw new Error(`${path}: غيرُ مقروءٍ في المستودعِ.`);
  return spoil({ surface: { ...REAL.surface, [path]: mutate(source) } });
}

function withStore(mutate: (source: string) => string): DriverVehicleContractInput {
  return spoil({ store: mutate(REAL.store) });
}

function withArabic(key: string, value: string): DriverVehicleContractInput {
  const ar = REAL.translations.ar ?? {};
  return spoil({ translations: { ...REAL.translations, ar: { ...ar, [key]: value } } });
}

describe("F3-07 driver vehicle contract — positive on real repository", () => {
  test("real repository passes all rules", () => {
    expect(driverVehicleContractProblems(REAL)).toEqual([]);
  });
});

describe("1) no separate vehicle table", () => {
  test("create table in store fails", () => {
    const spoiled = withStore((source) => `${source}\ncreate table driver_vehicles (id uuid);\n`);
    expect(separateTableProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("2) year validation present", () => {
  test("validateVehicleYear removed from application fails", () => {
    const spoiled = withApp((source) => source.replaceAll("validateVehicleYear", "validateVYear"));
    expect(yearValidationProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("VEHICLE_YEAR_MIN removed from domain fails", () => {
    const spoiled = spoil({
      domain: REAL.domain.replaceAll("VEHICLE_YEAR_MIN", "YEAR_MIN_VAL"),
    });
    expect(yearValidationProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("3) logo and barcode displayed", () => {
  test("logo removed from screen fails", () => {
    const spoiled = withSurface(SCREEN_FILE, (source) => source.replaceAll(/logo/gi, "lgo"));
    expect(logoBarcodeDisplayProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("barcode removed from screen fails", () => {
    const spoiled = withSurface(SCREEN_FILE, (source) => source.replaceAll(/barcode/gi, "brcd"));
    expect(logoBarcodeDisplayProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("4) fail-closed on missing store", () => {
  test("error code removed from route fails", () => {
    const spoiled = withRoute((source) =>
      source.replaceAll("VEHICLE_STORE_NOT_AVAILABLE", "VEHICLE_STORE_UNAVAILABLE"),
    );
    expect(failClosedProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("503 removed from route fails", () => {
    const spoiled = withRoute((source) => source.replaceAll("503", "500"));
    expect(failClosedProblems(spoiled).length).toBeGreaterThan(0);
  });
});

describe("5) every error code has text in three languages", () => {
  test("blank error text fails", () => {
    const first = PUBLIC_ERROR_CODES[0] as string;
    const key = `${KEY_PREFIX}error.${first}`;
    const spoiled = withArabic(key, "   ");
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });

  test("deleted error key fails", () => {
    const first = PUBLIC_ERROR_CODES[0] as string;
    const key = `${KEY_PREFIX}error.${first}`;
    const ar = REAL.translations.ar ?? {};
    const { [key]: _removed, ...rest } = ar;
    const spoiled = spoil({ translations: { ...REAL.translations, ar: rest } });
    expect(textCoverageProblems(spoiled).length).toBeGreaterThan(0);
  });
});
