/**
 * الغرض: المنافذ (Ports) — العقود الوحيدة التي تُخاطب بها طبقة التطبيق العالم الخارجي.
 *   لا تنفيذ هنا إطلاقاً: التنفيذ الحقيقي في packages/infrastructure، والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (عقود/أنواع فقط، بلا منطق).
 * ينتمي إلى: application/ports
 * يُتوقع أن يستخدمه لاحقاً: كل حالات الاستخدام في packages/application، وكل محوّل في packages/infrastructure
 * ملاحظات مستقبلية: كل منفذ يعيد Result، ولا يرمي استثناءً لخطأ متوقَّع (القسم 2.5).
 */

import type { DriverCandidate } from "../../domain/dispatch/entity.ts";
import type { Offer } from "../../domain/dispatch/value-objects.ts";
import type { RawSetting } from "../../domain/policy/entity.ts";
import type { Order } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";

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
  findAvailableInCity(
    cityId: CityId,
  ): Promise<Result<readonly DriverCandidate[], PortFailureError>>;
}

/**
 * هويّةُ الراكب كما تقرؤها `claim_ride` داخل معاملة الإسناد نفسها (§4.2).
 *
 * ولماذا تُحمَل في ردّ الإسناد لا تُقرأ باستعلامٍ ثانٍ بعده؟ لأنّ بين الإسناد
 * والاستعلام الثاني نافذةً يتغيّر فيها الحال — يُلغى الطلب أو تُغيَّر اللغة —
 * فيُخطَر الراكبُ بلغةٍ ليست لغته أو عن طلبٍ لم يبقَ. والقراءةُ في المعاملة
 * تُغلق النافذة بلا قفلٍ إضافي.
 */
export interface ClaimedRider {
  readonly riderId: string;
  /** معرّفُ تلغرام نصّاً: منافذُ الإرسال كلّها تأخذ نصّاً، والتحويل هنا مرّةً واحدة. */
  readonly telegramId: string;
  readonly languageCode: string;
  readonly fullName: string;
}

/**
 * ردُّ الإسناد. الحقول المضافة كلُّها قابلةٌ للغياب (`null`) لأنّ الإخطار تحسينٌ
 * لا شرطٌ: راكبٌ بصفٍّ ناقص لا يُبطِل إسناداً وقع فعلاً في القاعدة.
 */
export interface ClaimRideResult {
  readonly claimed: boolean;
  /**
   * `BUG-008` — هذا النداءُ إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه لا إسنادٌ جديد.
   * الإسنادُ قائمٌ لهذا السائقِ من قبل، فالجوابُ نجاحٌ، والآثارُ الجانبيّةُ
   * (إخطارُ الراكب، عدّادُ القبول) لا تُعاد. ويُقرَأُ من القاعدةِ لا من ذاكرةِ
   * العمليّة: `orders.assigned_driver_id` هو الحَكَم.
   */
  readonly duplicate: boolean;
  readonly reason: string | null;
  readonly cityId: CityId | null;
  readonly rider: ClaimedRider | null;
  readonly driverName: string | null;
  readonly driverPlate: string | null;
  readonly driverVehicle: string | null;
}

/** إسناد العرض ذرّياً — يقابل الدالة claim_ride في القاعدة. */
export interface DispatchRpcPort {
  claimRide(
    orderId: OrderId,
    driverId: DriverId,
  ): Promise<Result<ClaimRideResult, PortFailureError>>;
}
