/**
 * الغرض: المنافذ (Ports) — العقود الوحيدة التي تُخاطب بها طبقة التطبيق العالم الخارجي.
 *   لا تنفيذ هنا إطلاقاً: التنفيذ الحقيقي في packages/infrastructure، والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (عقود/أنواع فقط، بلا منطق).
 * ينتمي إلى: application/ports
 * يُتوقع أن يستخدمه لاحقاً: كل حالات الاستخدام في packages/application، وكل محوّل في packages/infrastructure
 * ملاحظات مستقبلية: كل منفذ يعيد Result، ولا يرمي استثناءً لخطأ متوقَّع (القسم 2.5).
 */

import type { CityId, DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { DriverCandidate } from "../../domain/dispatch/entity.ts";
import type { Offer } from "../../domain/dispatch/value-objects.ts";
import type { RawSetting } from "../../domain/policy/entity.ts";
import type { Order } from "../../domain/transport/entity.ts";

/** خطأ منفذ: عطل تقني (شبكة/قاعدة)، لا خطأ أعمال. */
export class PortFailureError {
  readonly code = "PORT_FAILURE" as const;
  constructor(
    readonly port: string,
    readonly detail: string,
  ) {}
}

export interface SettingsRepository {
  /** كل صفوف platform_settings لمدينة واحدة، خاماً بلا تفسير. */
  findByCity(cityId: CityId): Promise<Result<readonly RawSetting[], PortFailureError>>;
}

export interface OrderRepository {
  findById(orderId: OrderId): Promise<Result<Order | null, PortFailureError>>;
}

export interface OfferRepository {
  /** عروض الطلب كلها، بكل الدورات، لحساب من يُستبعد من الدورة القادمة. */
  findByOrder(orderId: OrderId): Promise<Result<readonly Offer[], PortFailureError>>;
}

export interface DriverCandidateRepository {
  /**
   * السائقون المرشَّحون مبدئياً في المدينة: متاحون وموثَّقون ومواقعهم حديثة.
   * الفلترة النهائية والترتيب مسؤولية الدومين لا المستودع.
   */
  findAvailableInCity(cityId: CityId): Promise<Result<readonly DriverCandidate[], PortFailureError>>;
}

/** إسناد العرض ذرّياً — يقابل الدالة claim_ride في القاعدة. */
export interface DispatchRpcPort {
  claimRide(
    orderId: OrderId,
    driverId: DriverId,
  ): Promise<Result<{ readonly claimed: boolean; readonly reason: string | null }, PortFailureError>>;
}
