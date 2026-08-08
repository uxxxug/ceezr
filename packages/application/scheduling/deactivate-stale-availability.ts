/**
 * الغرض: إطفاء إعلانات التوفّر البائتة في مدينة واحدة — القرار هنا والمهلة من إعدادات
 *   المدينة، والكتابة الذرّية في القاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: application/scheduling
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/cleanup-stale-sessions.ts، لوحة الإدارة
 * ملاحظات مستقبلية: عند وجود نبضة موقع دورية تُقاس البياتة بها لا بوقت تغيير الحالة.
 */

import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError, SettingsRepository } from "../ports/index.ts";

/** يقابل الدالّة deactivate_stale_availability. */
export interface StaleAvailabilityRpcPort {
  deactivate(cityId: CityId, staleMinutes: number): Promise<Result<number, PortFailureError>>;
}

export interface StaleAvailabilityReport {
  readonly cityId: CityId;
  readonly staleMinutes: number;
  readonly deactivated: number;
}

export interface StaleAvailabilityDependencies {
  readonly settings: SettingsRepository;
  readonly rpc: StaleAvailabilityRpcPort;
  /** المهلة الافتراضية حين لا يوجد الإعداد في المدينة — تُستعمل ولا تُسقِط المهمّة. */
  readonly fallbackMinutes: number;
}

/**
 * المهلة قيمة تجارية تُقرأ من platform_settings لكل مدينة: مدينةٌ سائقوها يعملون
 * بالساعة تختلف عن مدينة سائقوها يعملون بالدوام. لذلك لا رقم مرمَّزاً هنا.
 *
 * غياب الإعداد لا يُسقط المهمّة: تشغيلٌ بمهلة افتراضية معقولة أفضل من ترك سائقين
 * غائبين يستقبلون عروضاً لأن صفّ إعداد لم يُبذَر بعد.
 */
export async function deactivateStaleAvailability(
  input: { readonly cityId: CityId },
  deps: StaleAvailabilityDependencies,
): Promise<Result<StaleAvailabilityReport, PortFailureError>> {
  const raw = await deps.settings.findByCity(input.cityId);
  if (!raw.ok) return raw;

  const setting = raw.value.find((row) => row.key === "availability_stale_minutes");
  const parsed = setting === undefined ? Number.NaN : Number(setting.value);
  const staleMinutes =
    Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : deps.fallbackMinutes;

  const applied = await deps.rpc.deactivate(input.cityId, staleMinutes);
  if (!applied.ok) return applied;

  return ok({ cityId: input.cityId, staleMinutes, deactivated: applied.value });
}
