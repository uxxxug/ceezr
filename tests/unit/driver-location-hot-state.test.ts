/**
 * الغرض: اختبارُ الدالَّةِ الخالصةِ في نواةِ الحالةِ الساخنةِ (`F4-02`): تفسيرُ
 *    الأرقامِ الأربعةِ من `platform_settings` بلا افتراضٍ. وكانت ههنا دالَّةُ تنقيةٍ
 *    إلى الأحدثِ لكلِّ سائقٍ من دفعةٍ مختلطةٍ فأُزيحَت معَ `D-38` (`ADR 0209`):
 *    قائمةُ الانتظارِ تَعُدُّ النبضاتِ لا السائقينَ، والتنقيةُ لصفِّ السائقِ استقرّت
 *    في `distinct on` داخلَ الدالّةِ الذرّيّةِ وحدَها.
 * الحالة: اختبار فعلي — دالّةٌ خالصةٌ بلا منفذٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** لا يُثبَتُ ههنا أنَّ المفاتيحَ مبذورةٌ في هجرةٍ —
 * ذاكَ عملُ `scripts/check-hot-location-state.ts` — ولا أنَّ القاعدةَ تُطبِّقُ
 * الأحدثَ فعلاً؛ ذاكَ في `tests/integration/driver-location-batch-persist.test.ts`.
 * وما يُثبَتُ ههنا: أنَّ المدخلَ المعطوبَ يُقرأُ خرقاً لا رقماً مُخترَعاً.
 */

import { describe, expect, it } from "bun:test";
import { resolveHotLocationLimits } from "../../packages/application/geo/driver-location-hot-state.ts";
import { HOT_LOCATION_SETTING_KEYS } from "../../packages/shared/config/driver-location-hot-state.ts";

function completeRows(): { key: string; value: unknown }[] {
  return [
    { key: "driver_location_hot_ttl_seconds", value: 120 },
    { key: "driver_location_flush_interval_seconds", value: 10 },
    { key: "driver_location_flush_batch_size", value: 200 },
    { key: "driver_location_backlog_limit", value: 5_000 },
  ];
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
