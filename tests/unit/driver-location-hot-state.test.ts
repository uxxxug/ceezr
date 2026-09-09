/**
 * الغرض: اختبارُ الدالَّتَينِ الخالصتَينِ في نواةِ الحالةِ الساخنةِ (`F4-02`):
 *    تفسيرُ الأرقامِ الأربعةِ من `platform_settings` بلا افتراضٍ، واختيارُ أحدثِ
 *    إصلاحةٍ لكلِّ سائقٍ من دفعةٍ مختلطةٍ.
 * الحالة: اختبار فعلي — دالّتانِ خالصتانِ بلا منفذٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** لا يُثبَتُ ههنا أنَّ المفاتيحَ مبذورةٌ في هجرةٍ —
 * ذاكَ عملُ `scripts/check-hot-location-state.ts` — ولا أنَّ القاعدةَ تُطبِّقُ
 * الأحدثَ فعلاً؛ ذاكَ في `tests/integration/driver-location-batch-persist.test.ts`.
 * وما يُثبَتُ ههنا: أنَّ المدخلَ المعطوبَ يُقرأُ خرقاً لا رقماً مُخترَعاً، وأنَّ
 * التنقيةَ لا تعتمدُ على ترتيبِ الورودِ.
 */

import { describe, expect, it } from "bun:test";
import {
  type HotLocationFix,
  newestPerDriver,
  resolveHotLocationLimits,
} from "../../packages/application/geo/driver-location-hot-state.ts";
import { HOT_LOCATION_SETTING_KEYS } from "../../packages/shared/config/driver-location-hot-state.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER_A = "22222222-2222-4222-8222-222222222222" as DriverId;
const DRIVER_B = "33333333-3333-4333-8333-333333333333" as DriverId;
const NOW_MS = Date.UTC(2027, 2, 1, 9, 0, 0);

function completeRows(): { key: string; value: unknown }[] {
  return [
    { key: "driver_location_hot_ttl_seconds", value: 120 },
    { key: "driver_location_flush_interval_seconds", value: 10 },
    { key: "driver_location_flush_batch_size", value: 200 },
    { key: "driver_location_backlog_limit", value: 5_000 },
  ];
}

function fix(driverId: DriverId, recordedAtMs: number, latitude = 21.5): HotLocationFix {
  return {
    cityId: CITY,
    driverId,
    latitude,
    longitude: 39.17,
    recordedAtMs,
    accuracyMeters: 12,
    verdict: "ACCEPT",
  };
}

describe("F4-02 — تفسيرُ حدودِ المسارِ الساخنِ", () => {
  it("١) الصفوفُ الكاملةُ تُفسَّرُ أرقاماً كما هيَ", () => {
    const result = resolveHotLocationLimits(completeRows());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      hotTtlSeconds: 120,
      flushIntervalSeconds: 10,
      flushBatchSize: 200,
      backlogLimit: 5_000,
    });
  });

  it("٢) كلُّ مفتاحٍ غائبٍ وحدَه يُوقِعُ خرقاً باسمِه — لا رقمَ احتياطيّاً", () => {
    /**
     * الحلقةُ على المفاتيحِ المُصدَّرةِ لا على قائمةٍ مكتوبةٍ ههنا: مفتاحٌ خامسٌ
     * يُضافُ غداً بلا تفسيرٍ في `resolveHotLocationLimits` كانَ سيمرُّ صامتاً لو
     * كانت القائمةُ منسوخةً في الاختبارِ.
     */
    for (const key of HOT_LOCATION_SETTING_KEYS) {
      const rows = completeRows().filter((row) => row.key !== key);
      const result = resolveHotLocationLimits(rows);

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("HOT_LOCATION_SETTINGS_INCOMPLETE");
      expect(result.error.keys).toEqual([key]);
    }
  });

  it("٣) الصفرُ والسالبُ والكسرُ ليسَت حدوداً", () => {
    for (const value of [0, -1, 0.4]) {
      const rows = completeRows().map((row) =>
        row.key === "driver_location_flush_batch_size" ? { ...row, value } : row,
      );
      const result = resolveHotLocationLimits(rows);

      // دفعةٌ حجمُها صفرٌ تُفرِغُ إلى الأبدِ بلا تقدُّمٍ، وسالبٌ يُقرأُ سحباً عكسيّاً.
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.keys).toEqual(["driver_location_flush_batch_size"]);
    }
  });

  it("٤) رقمٌ خُزِّنَ نصّاً يُقرأُ خرقاً لا يُحوَّلُ", () => {
    const rows = completeRows().map((row) =>
      row.key === "driver_location_hot_ttl_seconds" ? { ...row, value: "120" } : row,
    );
    const result = resolveHotLocationLimits(rows);

    // القبولُ بالنصِّ يجعلُ نوعَ القيمةِ في `platform_settings` زينةً.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.keys).toEqual(["driver_location_hot_ttl_seconds"]);
  });

  it("٥) الخرقُ يجمعُ كلَّ المفاتيحِ المعطوبةِ لا أوّلَها", () => {
    const result = resolveHotLocationLimits([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // إصلاحُ مفتاحٍ ثمَّ إعادةُ النشرِ لكشفِ الثاني دورةٌ لا تُحتاجُ.
    expect([...result.error.keys].sort()).toEqual([...HOT_LOCATION_SETTING_KEYS].sort());
  });

  it("٦) صفٌّ زائدٌ لا يُغيِّرُ حكماً", () => {
    const rows = [...completeRows(), { key: "dispatch_radius_m", value: 4_000 }];
    const result = resolveHotLocationLimits(rows);

    expect(result.ok).toBe(true);
  });
});

describe("F4-02 — تنقيةُ الدفعةِ إلى أحدثِ إصلاحةٍ لكلِّ سائقٍ", () => {
  it("٧) الأحدثُ يُختارُ ولو وردَ أوّلاً — والعكسُ يُسقِطُ الاختبارَ", () => {
    /**
     * حالتانِ متعاكستانِ ترتيباً بنفسِ المحتوى: لو صارَ الاختيارُ «آخِرُ ورودٍ»
     * أو «أوّلُ ورودٍ» بدلَ «أحدثُ طابعاً» أخفقَت إحداهما قطعاً. وهذا هوَ
     * الاختبارُ الذي لا يُمكِنُ اجتيازُه بنسخِ ثابتٍ من الشيفرةِ.
     */
    const older = fix(DRIVER_A, NOW_MS - 30_000, 21.4);
    const newer = fix(DRIVER_A, NOW_MS, 21.6);

    for (const input of [
      [older, newer],
      [newer, older],
    ]) {
      const batch = newestPerDriver(input);

      expect(batch).toHaveLength(1);
      expect(batch[0]?.recordedAtMs).toBe(NOW_MS);
      expect(batch[0]?.latitude).toBe(21.6);
    }
  });

  it("٨) سائقانِ يبقيانِ سائقَينِ — التنقيةُ لكلِّ سائقٍ لا للدفعةِ", () => {
    const batch = newestPerDriver([
      fix(DRIVER_A, NOW_MS - 10_000),
      fix(DRIVER_B, NOW_MS - 90_000),
      fix(DRIVER_A, NOW_MS),
    ]);

    expect(batch).toHaveLength(2);
    const byDriver = new Map(batch.map((entry) => [entry.driverId, entry.recordedAtMs]));
    expect(byDriver.get(DRIVER_A)).toBe(NOW_MS);
    // الأقدمُ طابعاً ليسَ أقدمَ **لسائقِه**: إسقاطُه كانَ سيُجمِّدَ سائقاً كاملاً.
    expect(byDriver.get(DRIVER_B)).toBe(NOW_MS - 90_000);
  });

  it("٩) المتساويانِ يُبقيانِ واحداً، والدفعةُ الفارغةُ فارغةٌ", () => {
    const same = newestPerDriver([fix(DRIVER_A, NOW_MS, 21.1), fix(DRIVER_A, NOW_MS, 21.2)]);

    expect(same).toHaveLength(1);
    // الطابعُ واحدٌ فالقاعدةُ تقبلُ أيَّهما بمُسنَدِ `<=` — والأثرُ واحدٌ.
    expect(same[0]?.recordedAtMs).toBe(NOW_MS);
    expect(newestPerDriver([])).toHaveLength(0);
  });

  it("١٠) لا يُغيَّرُ المدخلُ ولا يُنسَخُ حكمٌ", () => {
    const input = [fix(DRIVER_A, NOW_MS - 1_000), fix(DRIVER_A, NOW_MS)];
    const before = input.map((entry) => entry.recordedAtMs);
    const batch = newestPerDriver(input);

    expect(input.map((entry) => entry.recordedAtMs)).toEqual(before);
    expect(batch[0]?.verdict).toBe("ACCEPT");
  });
});
