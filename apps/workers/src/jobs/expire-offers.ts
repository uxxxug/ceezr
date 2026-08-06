/**
 * الغرض: مهمة دورية تُنهي مهلة العروض المعلَّقة وتعيد الطلبات إلى البحث.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. القرار هنا، والكتابة الذرّية عبر الدالة expire_stale_offers.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts (Cron كل دقيقة)
 * ملاحظات مستقبلية: لا تُلغِ العرض المقبول أبداً — القيد order_offers_single_accepted يحرس ذلك في القاعدة.
 */

import type {
  OfferRepository,
  PortFailureError,
  SettingsRepository,
} from "../../../../packages/application/ports/index.ts";
import { isOfferExpired, type Offer } from "../../../../packages/domain/dispatch/value-objects.ts";
import {
  parseCitySettings,
  type SettingsError,
} from "../../../../packages/domain/policy/entity.ts";
import type { CityId, Clock } from "../../../../packages/shared/kernel/index.ts";
import { ok, type Result } from "../../../../packages/shared/result/index.ts";

/** منفذ الكتابة الذرّية — يقابل الدالة expire_stale_offers في القاعدة. */
export interface ExpireOffersRpcPort {
  expireStaleOffers(
    cityId: CityId,
    offerIds: readonly string[],
  ): Promise<Result<number, PortFailureError>>;
}

export interface PendingOfferRepository extends OfferRepository {
  /** كل العروض المعلَّقة في المدينة مع معرّف كل عرض. */
  findPendingInCity(
    cityId: CityId,
  ): Promise<Result<readonly (Offer & { readonly id: string })[], PortFailureError>>;
}

export interface ExpireOffersDependencies {
  readonly offers: PendingOfferRepository;
  readonly settings: SettingsRepository;
  readonly rpc: ExpireOffersRpcPort;
  readonly clock: Clock;
}

export interface ExpireOffersReport {
  readonly cityId: CityId;
  readonly examined: number;
  readonly expiredIds: readonly string[];
  readonly appliedCount: number;
}

export type ExpireOffersError = SettingsError | PortFailureError;

/**
 * يفحص العروض المعلَّقة في مدينة واحدة، يحدّد المنتهية بحسب مهلة المدينة نفسها،
 * ثم يطلب إنهاءها ذرّياً. لا يمسّ عرضاً مقبولاً ولا مرفوضاً.
 */
export async function expireOffers(
  cityId: CityId,
  deps: ExpireOffersDependencies,
): Promise<Result<ExpireOffersReport, ExpireOffersError>> {
  const rawSettings = await deps.settings.findByCity(cityId);
  if (!rawSettings.ok) return rawSettings;

  const parsed = parseCitySettings(cityId, rawSettings.value);
  if (!parsed.ok) return parsed;
  const timeoutSeconds = parsed.value.offerTimeoutSeconds;

  const pending = await deps.offers.findPendingInCity(cityId);
  if (!pending.ok) return pending;

  const now = deps.clock.now();
  const expiredIds = pending.value
    .filter((offer) => isOfferExpired(offer, timeoutSeconds, now))
    .map((offer) => offer.id);

  if (expiredIds.length === 0) {
    return ok({ cityId, examined: pending.value.length, expiredIds: [], appliedCount: 0 });
  }

  const applied = await deps.rpc.expireStaleOffers(cityId, expiredIds);
  if (!applied.ok) return applied;

  return ok({
    cityId,
    examined: pending.value.length,
    expiredIds,
    appliedCount: applied.value,
  });
}
