/**
 * الغرض: تنظيف ما يتعفّن بمرور الوقت: إعلانات التوفّر البائتة في القاعدة، وجلسات
 *   الحوار المهجورة في المخزن.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts (Cron كل نصف ساعة)
 * ملاحظات مستقبلية: عند الانتقال إلى Redis (القسم 5) تسقط حاجة تنظيف الجلسات هنا —
 *   Redis يُنهيها بـ TTL من نفسه — ويبقى تنظيف التوفّر لأنه حقيقة في القاعدة لا ذاكرة.
 */

import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type {
  StaleAvailabilityDependencies,
  StaleAvailabilityReport,
} from "../../../../packages/application/scheduling/deactivate-stale-availability.ts";
import { deactivateStaleAvailability } from "../../../../packages/application/scheduling/deactivate-stale-availability.ts";
import type { CityId } from "../../../../packages/shared/kernel/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

/**
 * مخزن الجلسات القابل للتنظيف. المخزن في الذاكرة يحتاج تنظيفاً صريحاً لأن لا شيء
 * يُنهي مُدخَلاته؛ مخزن Redis لا يحتاجه لأن TTL يقوم به. لذلك المنفذ اختياري.
 */
export interface PrunableSessionStore {
  /** يُسقط الجلسات المنتهية بمهلة المخزن نفسه، ويعيد عددها. */
  prune(): number;
}

export interface CleanupStaleDependencies extends StaleAvailabilityDependencies {
  readonly sessions?: readonly PrunableSessionStore[];
}

export interface CleanupStaleReport {
  readonly availability: StaleAvailabilityReport;
  readonly prunedSessions: number;
}

/**
 * سائقٌ أعلن توفّره ثم أغلق هاتفه يبقى is_available = true إلى الأبد، فتُهدر عليه
 * عروضٌ لا يراها — وكل عرض مهدور تأخيرٌ لعميل ينتظر في الشارع. هذه المهمّة تُغلق
 * الباب، والمهلة قيمة تجارية من إعدادات المدينة لا رقمٌ في الكود.
 *
 * تنظيف الجلسات يجري بعد نجاح تنظيف القاعدة لا قبله: الأول حقيقة مشتركة يراها
 * كل من في النظام، والثاني ذاكرة عملية واحدة — فإن فشل الأول لا معنى للثاني.
 */
export async function cleanupStaleSessions(
  input: { readonly cityId: CityId },
  deps: CleanupStaleDependencies,
): Promise<Result<CleanupStaleReport, PortFailureError>> {
  const availability = await deactivateStaleAvailability(
    { cityId: input.cityId },
    { settings: deps.settings, rpc: deps.rpc, fallbackMinutes: deps.fallbackMinutes },
  );
  if (!availability.ok) return availability;

  let prunedSessions = 0;
  for (const store of deps.sessions ?? []) {
    prunedSessions += store.prune();
  }

  return { ok: true, value: { availability: availability.value, prunedSessions } };
}
