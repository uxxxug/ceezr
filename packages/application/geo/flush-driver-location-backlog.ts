/**
 * الغرض: حالةُ استخدامِ **الإفراغِ المجمَّعِ** لقائمةِ انتظارِ مواقعِ السائقينَ في
 *    مدينةٍ واحدةٍ: تسحبُ حتّى حجمِ الدفعةِ، تُنقّيها إلى أحدثِ إصلاحةٍ لكلِّ سائقٍ،
 *    ثمَّ تُطبِّقُها **بنداءٍ ذرّيٍّ واحدٍ**. البند `F4-02` والعائقُ `CAP-009`.
 * الحالة: منفّذ فعلياً — 2026-09-09 · البند `F4-02`.
 * ينتمي إلى: application/geo
 * يُستخدم من: `apps/workers/src/jobs/flush-driver-locations.ts`
 * ملاحظات مستقبلية: جدولُ تاريخِ المواقعِ المقسَّمُ (`CAP-009` شطرُه الثالثُ) يُكتَبُ
 *    من داخلِ الدالّةِ الذرّيّةِ نفسِها لا بشوطٍ ثانٍ ههنا، وهوَ بندٌ لاحقٌ.
 *
 * ## لماذا نداءٌ واحدٌ لا حلقةُ تحديثٍ
 *
 * القاعدةُ ٠.٥: الذرّيّةُ في الدالّةِ لا في الشيفرةِ. ولو كانَ الإفراغُ حلقةً
 * تُحدِّثُ صفّاً صفّاً لكانَ الحملُ الذي وُجِدَ البندُ لتخفيفِه باقياً كما هوَ:
 * مئتا نبضةٍ = مئتا رحلةِ شبكةٍ ومئتا معاملةٍ. والدفعةُ الواحدةُ رحلةٌ واحدةٌ
 * ومعاملةٌ واحدةٌ، فإن سقطَت سقطَت كلُّها — وسقوطُ الكلِّ آمنٌ ههنا: الإصلاحاتُ
 * تُعادُ إلى قائمةِ الانتظارِ فتُطبَّقُ في الشوطِ التالي، ولا يُفقَدُ موضعٌ.
 *
 * ## ما لا تفعلُه عن قصدٍ
 *
 * - **لا تُقيِّمُ إصلاحةً ولا تُصدِرُ حكماً.** التقييمُ وقعَ في `updateDriverLocation`
 *   عندَ الاستقبالِ، وإعادتُه ههنا حَكَمٌ ثانٍ على الإصلاحةِ الواحدةِ — نهيُ
 *   `ADR 0053 §٦`. وحارسُ التسلسلِ في القاعدةِ ليسَ حَكَماً ثانياً بل هوَ الحارسُ
 *   نفسُه في المخزنِ الثاني: قاعدتُه واحدةٌ (`الأقدمُ لا يُزيحُ الأحدثَ`).
 * - **لا تبثُّ ولا تُعيدُ عرضاً.** البثُّ وقعَ لحظةَ الاستقبالِ لا لحظةَ الاستمرارِ؛
 *   وبثٌّ ههنا يُخرِجُ الموضعَ مرّتَينِ ويُؤخِّرُ الخريطةَ بمقدارِ دورةِ الإفراغِ.
 * - **لا تقرأُ إعداداً.** الأرقامُ تُمرَّرُ إليها مُفسَّرةً؛ ومصدرُها
 *   `platform_settings` عبرَ `resolveHotLocationLimits`.
 */

import type { CityId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  type DriverLocationBacklogReader,
  type DriverLocationBatchPersistence,
  type HotLocationLimits,
  newestPerDriver,
} from "./driver-location-hot-state.ts";

export interface FlushDriverLocationBacklogDeps {
  readonly backlog: DriverLocationBacklogReader;
  readonly persistence: DriverLocationBatchPersistence;
  /** الأرقامُ الأربعةُ؛ يُقرأُ منها حجمُ الدفعةِ وحدَه ههنا. */
  readonly limits: HotLocationLimits;
}

export interface FlushDriverLocationBacklogReport {
  /** ما سُحِبَ من قائمةِ الانتظارِ قبلَ التنقيةِ. */
  readonly drained: number;
  /** ما بقيَ بعدَ اختيارِ أحدثِ إصلاحةٍ لكلِّ سائقٍ — هوَ حجمُ الدفعةِ المُطبَّقةِ. */
  readonly batched: number;
  readonly applied: number;
  readonly stale: number;
  readonly missing: number;
}

export interface FlushDriverLocationBacklogError {
  readonly code: "DRIVER_LOCATION_FLUSH_FAILED";
  readonly reason: "DRAIN_FAILED" | "PERSIST_FAILED" | "REQUEUE_FAILED";
  /** كم إصلاحةً أُعيدَت إلى قائمةِ الانتظارِ بعدَ الفشلِ — `null` إن لم يُسحَبْ شيءٌ. */
  readonly requeued: number | null;
  readonly detail: string;
}

function fail(
  reason: FlushDriverLocationBacklogError["reason"],
  detail: string,
  requeued: number | null = null,
): FlushDriverLocationBacklogError {
  return { code: "DRIVER_LOCATION_FLUSH_FAILED", reason, requeued, detail };
}

export async function flushDriverLocationBacklog(
  cityId: CityId,
  deps: FlushDriverLocationBacklogDeps,
): Promise<Result<FlushDriverLocationBacklogReport, FlushDriverLocationBacklogError>> {
  const drained = await deps.backlog.drain(cityId, deps.limits.flushBatchSize);
  if (!drained.ok) return err(fail("DRAIN_FAILED", drained.error.detail));

  const fixes = drained.value;
  // قائمةٌ فارغةٌ حالةٌ سويّةٌ لا فشلٌ: لا سائقَ بثَّ في هذه الدورةِ.
  if (fixes.length === 0) {
    return ok({ drained: 0, batched: 0, applied: 0, stale: 0, missing: 0 });
  }

  const batch = newestPerDriver(fixes);
  const persisted = await deps.persistence.persistBatch(cityId, batch);
  if (!persisted.ok) {
    /**
     * السحبُ أزالَ الأعضاءَ من قائمةِ الانتظارِ، فالفشلُ بعدَه فقدٌ إن لم يُعَدْ
     * ما سُحِبَ. والإعادةُ **للدفعةِ المُنقّاةِ** لا للخامِ: الأقدمُ الذي أُسقِطَ في
     * التنقيةِ لا معنى لإعادتِه إذ أحدثُ منه عائدٌ. و`ZADD` يُبقي الأحدثَ درجةً
     * فلا يُرجِعُ عضواً إلى الوراءِ لو سبقَته نبضةٌ جديدةٌ في الأثناءِ.
     */
    const requeued = await deps.backlog.requeue(batch);
    if (!requeued.ok) {
      return err(
        fail(
          "REQUEUE_FAILED",
          `${persisted.error.detail} · ثمَّ فشلَت الإعادةُ: ${requeued.error.detail}`,
          0,
        ),
      );
    }
    return err(fail("PERSIST_FAILED", persisted.error.detail, batch.length));
  }

  return ok({
    drained: fixes.length,
    batched: batch.length,
    applied: persisted.value.applied,
    stale: persisted.value.stale,
    missing: persisted.value.missing,
  });
}
