/**
 * الغرض: منافذ مهمّة إنهاء العروض المنتهية. أُخرجت من ملف الجوب إلى طبقة التطبيق
 *   لأن محوّلاتها تعيش في infrastructure، ولا يجوز لـ infrastructure أن تستورد من apps.
 * الحالة: منفّذ فعلياً — استُخرِج في المرحلة 2.6 الخطوة 02 بلا تغيير في التوقيعات.
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/expire-offers.ts، infrastructure/dispatch
 * ملاحظات مستقبلية: لو صارت المهلة موحّدة لكل المدن يُستبدَل هذا بدالّة قاعدة واحدة.
 */

import type { Offer } from "../../domain/dispatch/value-objects.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { OfferRepository, PortFailureError } from "../ports/index.ts";

/** منفذ الكتابة الذرّية — يُنهي عروضاً بعينها لا كل ما مضى وقته. */
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
