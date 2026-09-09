/**
 * الغرض: اختبارُ نواةِ استقبالِ الموقعِ (`F4-01`) — أنَّ الترتيبَ الذي كُلِّفَ
 *   ثمنَه في `BUG-001` و`BUG-009` محفوظٌ: المرفوضُ لا يُكتَبُ، والأقدمُ الذي
 *   رفضَته القاعدةُ **لا يُبَثُّ ولا يُعيدُ عرضاً**، والبثُّ بعدَ الكتابةِ لا
 *   قبلَها، وإعادةُ العرضِ على الانتقالِ وحدَه لا على كلِّ نبضةٍ.
 * الحالة: اختبار فعلي — دالّةٌ خالصةٌ من الإطارِ بمنافذَ مُصطنَعةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** الكاتبُ ههنا **مُصطنَعٌ**، فما يُثبَتُ هوَ قرارُ
 * الطبقةِ على حكمِ الكاتبِ لا صحّةُ الحارسِ نفسِه. أنَّ الحارسَ في القاعدةِ يرفضُ
 * الأقدمَ فعلاً — على اتّصالَينِ متزاحمَينِ — في
 * `tests/integration/driver-location-cas.test.ts` و`driver-location-intake.test.ts`
 * على قاعدةٍ حقيقيّةٍ، لأنَّ سباقاً لا يُثبتُه mock إطلاقاً.
 */

import { describe, expect, it } from "bun:test";
import type {
  DriverProfile,
  StoredLocationQuality,
} from "../../packages/application/bots/types.ts";
import {
  type DriverLocationWriter,
  type UpdateDriverLocationDeps,
  updateDriverLocation,
} from "../../packages/application/geo/update-driver-location.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { StoredFix } from "../../packages/application/tracking/live-tracking.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const NOW_MS = Date.UTC(2027, 2, 1, 9, 0, 0);
const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;

const AT = { latitude: 21.5471, longitude: 39.1751 } as const;

function driverProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: DRIVER,
    cityId: CITY,
    telegramUserId: "5550001",
    fullName: "سائقٌ مُختبَرٌ",
    phone: "+966500000000",
    isVerified: true,
    isAvailable: true,
    hasLocation: true,
    // سابقةٌ **قريبةٌ**: بعيدةٌ كانت ستجعلَ كلَّ حالةٍ اختبارَ سرعةٍ محالةٍ لا
    // اختبارَ ما تدّعيه. وفحصُ القفزةِ له حالتُه في `gps-fix.test.ts`.
    lastFix: { latitude: 21.547, longitude: 39.175, recordedAtMs: NOW_MS - 60_000 },
    ...overrides,
  };
}

interface Recorder {
  readonly writes: { quality: StoredLocationQuality }[];
  readonly published: StoredFix[];
  readonly redispatched: CityId[];
}

function harness(outcome: "accepted" | "stale" | "no_driver" | "failure" = "accepted"): {
  deps: UpdateDriverLocationDeps;
  seen: Recorder;
} {
  const seen: Recorder = { writes: [], published: [], redispatched: [] };
  const drivers: DriverLocationWriter = {
    updateLocation: async (_driverId, _location, quality) => {
      seen.writes.push({ quality });
      if (outcome === "failure") return err(new PortFailureError("drivers", "عطلُ كتابةٍ مُصطنَعٌ"));
      return ok({ kind: outcome });
    },
  };
  return {
    seen,
    deps: {
      drivers,
      clock: { now: () => new Date(NOW_MS) },
      tracking: {
        onFix: async (fix) => {
          // البثُّ **بعدَ** الكتابةِ: لو نُشِرَ قبلَها لكانَ هذا فارغاً ههنا.
          expect(seen.writes.length).toBe(1);
          seen.published.push(fix);
        },
      },
      redispatch: {
        onDriverBecameDispatchable: async (cityId) => {
          seen.redispatched.push(cityId);
        },
      },
    },
  };
}

describe("F4-01 — استقبالُ الموقعِ: القبولُ", () => {
  it("١) يكتبُ الحكمَ معَ الموضعِ ويبثُّ ويعيدُ الطابعَ المقبولَ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      { driver: driverProfile(), ...AT, quality: { accuracyMeters: 8, recordedAtMs: NOW_MS } },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      kind: "accepted",
      recordedAtMs: NOW_MS,
      verdict: "ACCEPT",
      becameLive: false,
    });
    expect(seen.writes[0]?.quality).toEqual({
      recordedAtMs: NOW_MS,
      accuracyMeters: 8,
      verdict: "ACCEPT",
    });
    expect(seen.published).toHaveLength(1);
    expect(seen.published[0]?.driverId).toBe(DRIVER);
    expect(seen.published[0]?.verdict).toBe("ACCEPT");
  });

  it("٢) غيابُ الطابعِ يعني «الآنَ» لا صفراً ولا رفضاً", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation({ driver: driverProfile(), ...AT }, deps);

    expect(result.ok).toBe(true);
    expect(seen.writes[0]?.quality.recordedAtMs).toBe(NOW_MS);
  });

  it("٣) إصلاحةٌ متدهوِّرةٌ تُخزَّنُ **موسومةً** لا تُطرَحُ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      {
        driver: driverProfile(),
        ...AT,
        // دقّةٌ فوقَ العتبةِ: موقعٌ صحيحٌ متدهوِّرٌ. رفضُه كانَ سيُخفي السائقَ.
        quality: { accuracyMeters: 400, recordedAtMs: NOW_MS },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("accepted");
    expect(seen.writes[0]?.quality.verdict).not.toBe("ACCEPT");
    expect(seen.published).toHaveLength(1);
  });
});

describe("F4-01 — استقبالُ الموقعِ: الرفضُ والقِدَمُ", () => {
  it("٤) الإحداثيةُ خارجَ الحدِّ تُرفَضُ **قبلَ** أيِّ كتابةٍ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      { driver: driverProfile(), latitude: 121, longitude: 39.1 },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("FIX_REJECTED");
    expect(result.error.findings.length).toBeGreaterThan(0);
    expect(seen.writes).toHaveLength(0);
    expect(seen.published).toHaveLength(0);
  });

  it("٥) الإصلاحةُ الفاحشةُ القِدَمِ تُرفَضُ في المجالِ ولا تصلُ القاعدةَ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      {
        driver: driverProfile(),
        ...AT,
        quality: { recordedAtMs: NOW_MS - 3_600_000 },
      },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("FIX_REJECTED");
    expect(seen.writes).toHaveLength(0);
  });

  it("٦) `stale` من القاعدةِ: لا بثَّ ولا إعادةَ عرضٍ — وهوَ ليسَ خطأً", async () => {
    const { deps, seen } = harness("stale");
    const result = await updateDriverLocation(
      {
        driver: driverProfile({ hasLocation: false, isAvailable: true }),
        ...AT,
        quality: { recordedAtMs: NOW_MS },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ kind: "stale" });
    expect(seen.writes).toHaveLength(1);
    // الجوهرُ: الأقدمُ المرفوضُ لا يُخرَجُ إلى الخريطةِ ولا يُطلِقُ إسناداً.
    expect(seen.published).toHaveLength(0);
    expect(seen.redispatched).toHaveLength(0);
  });

  it("٧) اختفاءُ الصفِّ عندَ الكتابةِ خطأٌ مُسمّىً لا نجاحٌ صامتٌ", async () => {
    const { deps, seen } = harness("no_driver");
    const result = await updateDriverLocation(
      { driver: driverProfile(), ...AT, quality: { recordedAtMs: NOW_MS } },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("DRIVER_NOT_FOUND");
    expect(seen.published).toHaveLength(0);
  });

  it("٨) عطلُ المنفذِ `WRITE_FAILED` ولا يُبَثُّ شيءٌ", async () => {
    const { deps, seen } = harness("failure");
    const result = await updateDriverLocation(
      { driver: driverProfile(), ...AT, quality: { recordedAtMs: NOW_MS } },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("WRITE_FAILED");
    expect(seen.published).toHaveLength(0);
    expect(seen.redispatched).toHaveLength(0);
  });
});

describe("F4-01 — استقبالُ الموقعِ: الانتقالُ وإعادةُ العرضِ", () => {
  it("٩) مَن كانَ متاحاً ينقصُه موقعٌ: انتقالٌ واحدٌ يُطلِقُ إعادةَ العرضِ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      {
        driver: driverProfile({ hasLocation: false, isAvailable: true, lastFix: null }),
        ...AT,
        quality: { recordedAtMs: NOW_MS },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind === "accepted" && result.value.becameLive).toBe(true);
    expect(seen.redispatched).toEqual([CITY]);
  });

  it("١٠) نبضةُ سائقٍ ظاهرٍ أصلاً لا تُطلِقُ مسحَ مدينةٍ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      { driver: driverProfile({ hasLocation: true }), ...AT, quality: { recordedAtMs: NOW_MS } },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(seen.redispatched).toHaveLength(0);
  });

  it("١١) غيرُ المتاحِ لا يصيرُ ظاهراً بمجرّدِ موقعٍ", async () => {
    const { deps, seen } = harness("accepted");
    const result = await updateDriverLocation(
      {
        driver: driverProfile({ hasLocation: false, isAvailable: false, lastFix: null }),
        ...AT,
        quality: { recordedAtMs: NOW_MS },
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind === "accepted" && result.value.becameLive).toBe(false);
    expect(seen.redispatched).toHaveLength(0);
  });

  it("١٢) غيابُ البثِّ وإعادةِ العرضِ لا يُخفِقُ الكتابةَ القانونيّةَ", async () => {
    const seen: { writes: number } = { writes: 0 };
    const result = await updateDriverLocation(
      { driver: driverProfile({ hasLocation: false }), ...AT, quality: { recordedAtMs: NOW_MS } },
      {
        drivers: {
          updateLocation: async () => {
            seen.writes += 1;
            return ok({ kind: "accepted" });
          },
        },
        clock: { now: () => new Date(NOW_MS) },
      },
    );

    expect(result.ok).toBe(true);
    expect(seen.writes).toBe(1);
  });
});
