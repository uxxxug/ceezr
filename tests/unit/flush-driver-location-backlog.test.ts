/**
 * الغرض: اختبارُ حالةِ استخدامِ الإفراغِ المجمَّعِ (`F4-02`): أنَّ النداءَ **واحدٌ**
 *    لدفعةٍ واحدةٍ مُنقّاةٍ، وأنَّ فشلَ الاستمرارِ **يُعيدُ** ما سُحِبَ فلا يُفقَدُ
 *    موضعٌ، وأنَّ حجمَ الدفعةِ يُقرأُ من الحدودِ لا من ثابتٍ.
 * الحالة: اختبار فعلي — منافذُ مُصطنَعةٌ بلا شبكةٍ ولا قاعدةٍ.
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

  it("٢) عشرُ نبضاتٍ لسائقَينِ تُطبَّقُ بنداءٍ **واحدٍ** بصفَّينِ", async () => {
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
    expect(seen.batches[0]).toHaveLength(2);
    expect(result.value.drained).toBe(10);
    expect(result.value.batched).toBe(2);
  });

  it("٣) الدفعةُ المُمرَّرةُ هيَ الأحدثُ لكلِّ سائقٍ ولو وردَ الأقدمُ آخِراً", async () => {
    const { deps, seen } = harness({
      drained: [fix(DRIVER_A, NOW_MS, 21.9), fix(DRIVER_A, NOW_MS - 60_000, 21.1)],
    });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(true);
    // لو مُرِّرَ الأقدمُ لتراجعَ موضعُ السائقِ في القاعدةِ — `BUG-001` من بابِ الإفراغِ.
    expect(seen.batches[0]?.[0]?.recordedAtMs).toBe(NOW_MS);
    expect(seen.batches[0]?.[0]?.latitude).toBe(21.9);
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
     * `F7-03`: و`appended` يساوي `applied` لا `batched` — ما ردَّه الحارسُ لا
     * يُلحَقُ أثرُه، وإلاّ لحملَ التاريخُ موضعاً لم يصرْ قطُّ موضعَ السائقِ.
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
  it("٦) فشلُ الاستمرارِ يُعيدُ الدفعةَ المُنقّاةَ إلى القائمةِ ويُسمّي السببَ", async () => {
    const { deps, seen } = harness({
      drained: [fix(DRIVER_A, NOW_MS), fix(DRIVER_A, NOW_MS - 5_000), fix(DRIVER_B, NOW_MS)],
      persist: "fail",
    });
    const result = await flushDriverLocationBacklog(CITY, deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("PERSIST_FAILED");
    // السحبُ أزالَ الأعضاءَ، فبلا إعادةٍ يُفقَدُ موضعُ سائقَينِ كاملاً.
    expect(seen.requeued).toHaveLength(1);
    expect(seen.requeued[0]).toHaveLength(2);
    expect(result.error.requeued).toBe(2);
  });

  it("٧) المُعادُ هوَ المُنقّى لا الخامُ: الأقدمُ الذي أُسقِطَ لا يعودُ", async () => {
    const { deps, seen } = harness({
      drained: [fix(DRIVER_A, NOW_MS - 60_000, 21.1), fix(DRIVER_A, NOW_MS, 21.9)],
      persist: "fail",
    });
    await flushDriverLocationBacklog(CITY, deps);

    expect(seen.requeued[0]).toHaveLength(1);
    // إعادةُ الأقدمِ كانت ستُدخِلَ موضعاً متراجعاً إلى قائمةِ الانتظارِ بعدَ كلِّ عطلٍ.
    expect(seen.requeued[0]?.[0]?.recordedAtMs).toBe(NOW_MS);
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
