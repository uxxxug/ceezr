/**
 * الغرض: اختبارُ حالةِ استخدامِ الإفراغِ المجمَّعِ (`F4-02`): أنَّ النداءَ **واحدٌ**
 *    للدفعةِ كما سُحِبَت لا مُنقّاةً (`D-38` · `ADR 0209`)، وأنَّ فشلَ الاستمرارِ
 *    **يُعيدُ** ما سُحِبَ كلَّه فلا تُفقَدُ نبضةٌ، وأنَّ حجمَ السحبِ يُقرأُ من الحدودِ
 *    لا من ثابتٍ.
 * الحالة: اختبار فعلي — منافذُ مُصطنَعةٌ بلا شبكةٍ ولا قاعدةٍ · حُرِّرَ لِـ`D-38` في 2026-09-28.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** السحبُ والإعادةُ ههنا **مُصطنَعانِ**، فأنَّ
 * `ZADD`/`ZREM` يفعلانِ ذلكَ ذرّيّاً على خدمةٍ حقيقيّةٍ في
 * `tests/real-redis/driver-location-hot-state-real.test.ts`، وأنَّ الدفعةَ تُطبَّقُ
 * في معاملةٍ واحدةٍ في `tests/integration/driver-location-batch-persist.test.ts`.
 * ولا يُدَّعى ههنا قياسُ حِمْلٍ ولا عددُ استعلاماتٍ مُوفَّرٍ.
 */

import { describe, expect, it } from "bun:test";
import type {
  DriverLocationBacklogReader,
  DriverLocationBatchPersistence,
  HotLocationFix,
  HotLocationLimits,
} from "../../packages/application/geo/driver-location-hot-state.ts";
import { flushDriverLocationBacklog } from "../../packages/application/geo/flush-driver-location-backlog.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER_A = "22222222-2222-4222-8222-222222222222" as DriverId;
const DRIVER_B = "33333333-3333-4333-8333-333333333333" as DriverId;
const NOW_MS = Date.UTC(2027, 2, 1, 9, 0, 0);

const LIMITS: HotLocationLimits = {
  hotTtlSeconds: 120,
  flushIntervalSeconds: 10,
  flushBatchSize: 200,
  backlogLimit: 5_000,
};

/**
 * فارقٌ مقصودٌ بينَ طابعِ الجهازِ ولحظةِ قبولِ الخادمِ (F4-05): لو ساوَينا
 * بينَهما لَمَرَّ خلطُ العمودَينِ في الشيفرةِ دونَ أن يسقطَ اختبارٌ.
 */
const ACCEPTANCE_LAG_MS = 1_500;

function fix(driverId: DriverId, recordedAtMs: number, latitude = 21.5): HotLocationFix {
  return {
    cityId: CITY,
    driverId,
    latitude,
    longitude: 39.17,
    recordedAtMs,
    observedAtMs: recordedAtMs + ACCEPTANCE_LAG_MS,
    accuracyMeters: 12,
    verdict: "ACCEPT",
  };
}

interface Seen {
  readonly drainLimits: number[];
  readonly batches: (readonly HotLocationFix[])[];
  readonly requeued: (readonly HotLocationFix[])[];
}

function harness(options: {
  readonly drained: readonly HotLocationFix[] | "fail";
  readonly persist?: "fail";
  readonly requeue?: "fail";
  readonly report?: { applied: number; stale: number; missing: number; appended: number };
}): {
  deps: {
    backlog: DriverLocationBacklogReader;
    persistence: DriverLocationBatchPersistence;
    limits: HotLocationLimits;
  };
  seen: Seen;
} {
  const seen: Seen = { drainLimits: [], batches: [], requeued: [] };
  const backlog: DriverLocationBacklogReader = {
    drain: async (_cityId, limit) => {
      seen.drainLimits.push(limit);
      if (options.drained === "fail") {
        return err(new PortFailureError("driver-location-backlog", "عطلُ سحبٍ مُصطنَعٌ"));
      }
      return ok(options.drained);
    },
    requeue: async (fixes) => {
      seen.requeued.push(fixes);
      if (options.requeue === "fail") {
        return err(new PortFailureError("driver-location-backlog", "عطلُ إعادةٍ مُصطنَعٌ"));
      }
      return ok(undefined);
    },
  };
  const persistence: DriverLocationBatchPersistence = {
    persistBatch: async (_cityId, fixes) => {
      seen.batches.push(fixes);
      if (options.persist === "fail") {
        return err(new PortFailureError("drivers", "عطلُ استمرارٍ مُصطنَعٌ"));
      }
      // `appended` يساوي `applied` في الحالِ السويِّ (`F7-03` / ADR-0074): الأثرُ
      // فرعٌ من فرعِ الكتابةِ نفسِه لا نداءٌ ثانٍ قد يتخلّفُ.
      return ok(
        options.report ?? { applied: fixes.length, stale: 0, missing: 0, appended: fixes.length },
      );
    },
  };
  return { seen, deps: { backlog, persistence, limits: LIMITS } };
}

describe("F4-02 — الإفراغُ المجمَّعُ: النداءُ الواحدُ", () => {
  it("١) قائمةٌ فارغةٌ حالةٌ سويّةٌ: لا نداءَ استمرارٍ ولا فشلٌ", async () => {
    const { deps, seen } = harness({ drained: [] });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      drained: 0,
      batched: 0,
      applied: 0,
      stale: 0,
      missing: 0,
      appended: 0,
    });
    // نداءُ دالّةٍ بدفعةٍ فارغةٍ كلَّ دورةٍ في كلِّ مدينةٍ حِمْلٌ بلا أثرٍ.
    expect(seen.batches).toHaveLength(0);
  });

  it("٢) عشرُ نبضاتٍ لسائقَينِ تُطبَّقُ بنداءٍ **واحدٍ** بالعشرِ كلِّها (`D-38`)", async () => {
    const drained: HotLocationFix[] = [];
    for (let index = 0; index < 5; index += 1) {
      drained.push(fix(DRIVER_A, NOW_MS - index * 1_000));
      drained.push(fix(DRIVER_B, NOW_MS - index * 1_000));
    }
    const { deps, seen } = harness({ drained });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // هذا هوَ ما يعنيهِ «مجمَّعٌ»: نداءٌ واحدٌ لا عشرةٌ — والقياسُ على العددِ لا على النيّةِ.
    expect(seen.batches).toHaveLength(1);
    // ولا تنقيةَ بعدَ اليومِ: الدفعةُ كما سُحِبَت — فنبضاتُ السائقِ تبلغُ الأثرَ
    // كلُّها لا الأحدثُ وحدَه، وصفُّ السائقِ تُطبِّقُه القاعدةُ على الأحدثِ.
    expect(seen.batches[0]).toHaveLength(10);
    expect(result.value.drained).toBe(10);
    expect(result.value.batched).toBe(10);
  });

  it("٣) الدفعةُ المُمرَّرةُ هيَ المسحوبةُ بحرفِها — التنقيةُ للقاعدةِ لا ههنا (`D-38`)", async () => {
    const drained = [fix(DRIVER_A, NOW_MS, 21.9), fix(DRIVER_A, NOW_MS - 60_000, 21.1)];
    const { deps, seen } = harness({ drained });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(true);
    // الأقدمُ يُمرَّرُ كما سُحِبَ: حارسُ التسلسلِ في الدالّةِ الذرّيّةِ هوَ الذي
    // يُطبِّقُ الأحدثَ في صفِّ السائقِ، لا تنقيةٌ في الشيفرةِ تُسقِطُ الأثرَ.
    expect(seen.batches[0]).toEqual(drained);
  });

  it("٤) حجمُ السحبِ هوَ حدُّ الدفعةِ من الإعداداتِ لا ثابتٌ في الشيفرةِ", async () => {
    const { deps, seen } = harness({ drained: [] });
    await flushDriverLocationBacklog(CITY, { ...deps, limits: { ...LIMITS, flushBatchSize: 7 } });

    expect(seen.drainLimits).toEqual([7]);
  });

  it("٥) تقريرُ القاعدةِ يُنقَلُ كما هوَ: المُطبَّقُ والقديمُ والمفقودُ", async () => {
    const { deps } = harness({
      drained: [fix(DRIVER_A, NOW_MS), fix(DRIVER_B, NOW_MS)],
      report: { applied: 1, stale: 1, missing: 0, appended: 1 },
    });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /**
     * `stale` ليسَ فشلاً: صفٌّ أحدثُ في القاعدةِ سبقَ الدفعةَ — وهوَ الحارسُ يعملُ.
     * وإخفاؤه كانَ سيجعلُ «مُطبَّقٌ أقلُّ من مُدفَعٍ» غموضاً في اللوحةِ.
     */
    /**
     * `D-38`/`ADR 0209`: `appended` يَعُدُّ صفوفَ الأثرِ (النبضاتِ) فيزيدُ على
     * `applied` (السائقينَ) في الدفعةِ المتراكمةِ — وهذا هوَ السويُّ الجديدُ،
     * والحصيلةُ تُنقَلُ كما ردَّتها القاعدةُ لا تُعادُ حسبتُها ههنا.
     */
    expect(result.value).toEqual({
      drained: 2,
      batched: 2,
      applied: 1,
      stale: 1,
      missing: 0,
      appended: 1,
    });
  });
});

describe("F4-02 — الإفراغُ المجمَّعُ: الفشلُ لا يُفقِدُ موضعاً", () => {
  it("٦) فشلُ الاستمرارِ يُعيدُ الدفعةَ كما سُحِبَت ويُسمّي السببَ", async () => {
    const { deps, seen } = harness({
      drained: [fix(DRIVER_A, NOW_MS), fix(DRIVER_A, NOW_MS - 5_000), fix(DRIVER_B, NOW_MS)],
      persist: "fail",
    });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("PERSIST_FAILED");
    // السحبُ أزالَ الأعضاءَ، فبلا إعادةٍ يُفقَدُ موضعُ سائقَينِ كاملاً — وبلا
    // إعادةِ **كلِّ** النبضاتِ يُفقَدُ أثرُ السائقِ الأوّلِ القديمُ (`D-38`).
    expect(seen.requeued).toHaveLength(1);
    expect(seen.requeued[0]).toHaveLength(3);
    expect(result.error.requeued).toBe(3);
  });

  it("٧) المُعادُ هوَ المسحوبُ كلُّه: النبضةُ الأقدمُ تعودُ لتُلحَقَ أثراً (`D-38`)", async () => {
    const { deps, seen } = harness({
      drained: [fix(DRIVER_A, NOW_MS - 60_000, 21.1), fix(DRIVER_A, NOW_MS, 21.9)],
      persist: "fail",
    });
    await flushDriverLocationBacklog(CITY, deps);

    // لا منتقى بعدَ اليومِ: الأقدمُ يعودُ — حارسُ صفِّ السائقِ في القاعدةِ يردُّه
    // عن الموضعِ، أمّا أثرُه فمقبولٌ منذُ الاستقبالِ ولا يُفقَدُ بعطلِ إفراغٍ.
    expect(seen.requeued[0]).toHaveLength(2);
    expect(seen.requeued[0]?.map((entry) => entry.recordedAtMs)).toEqual([NOW_MS - 60_000, NOW_MS]);
  });

  it("٨) فشلُ السحبِ لا يُعيدُ شيئاً ولا يُدَّعى فيه عددٌ", async () => {
    const { deps, seen } = harness({ drained: "fail" });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("DRAIN_FAILED");
    expect(seen.requeued).toHaveLength(0);
    // `null` تعني «لم يُسحَبْ فلا يُعادُ»، وصفرٌ كانَ سيُقرأُ «سُحِبَ ولم يُعَدْ».
    expect(result.error.requeued).toBeNull();
    expect(seen.batches).toHaveLength(0);
  });

  it("٩) فشلُ الإعادةِ بعدَ فشلِ الاستمرارِ خطأٌ مُسمّىً يجمعُ التفصيلَينِ", async () => {
    const { deps } = harness({
      drained: [fix(DRIVER_A, NOW_MS)],
      persist: "fail",
      requeue: "fail",
    });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("REQUEUE_FAILED");
    // صفرٌ ههنا دعوى صادقةٌ: سُحِبَ ولم يُعَدْ شيءٌ — وهذا هوَ الفقدُ الوحيدُ المُعلَنُ.
    expect(result.error.requeued).toBe(0);
    expect(result.error.detail).toContain("عطلُ استمرارٍ مُصطنَعٌ");
    expect(result.error.detail).toContain("عطلُ إعادةٍ مُصطنَعٌ");
  });
});
