/**
 * الغرض: حارسُ الخادمِ لـ«تنبيهِ التحويلاتِ الماليّةِ المسبقة» (WR-33) — يلفُّ منفذَ الكتابةِ
 * `RideRequestCommand` فلا يُنشَأُ طلبٌ جديدٌ (مشوارٌ أو توصيلٌ) إلّا بإقرارٍ بالإصدارِ الحاليّ.
 *
 * ## لماذا ههنا لا في المسارِ ولا في الواجهة
 * كلُّ مساراتِ الإنشاءِ في النظامِ تنتهي إلى هذا المنفذِ نفسِه، ولا شيءَ غيرُه يكتبُ طلبًا:
 *   - `POST /v1/rides` (النقلُ والتوصيلُ) ← `requestRide` ← `rides.create`.
 *   - `POST /v1/deliveries` ← `requestRide` نفسُها ← `rides.create`.
 *   - بوتُ الراكبِ: `createOrderAndMatch` (نقلٌ) و`requestDelivery` (توصيلٌ) ← `rides.create`.
 *   - ودالّةُ القاعدةِ `request_ride_with_offer` ممنوحةٌ لـ `service_role` وحدَه، فلا يناديها عميلٌ.
 * فحارسٌ على المنفذِ في جذرِ التركيبِ يُغلقُ كلَّ بابٍ بمرّةٍ واحدة: واجهةٌ جديدةٌ أو عميلٌ يتجاوزُ
 * شاشةَ التأكيدِ ويطرقُ الـ API مباشرةً يُرفَضُ قبلَ أن يُلمَسَ المحوّلُ. والحارسُ لا يُعدِّلُ
 * سياسةَ الطلباتِ القائمة (منعُ التكرارِ، النطاقُ، الحظرُ) — يسبقُها فحسب.
 *
 * ## لماذا الإقرارُ على كلِّ طلبٍ لا على أوّلِ طلبٍ
 * المالكُ طلبَ التنبيهَ **عندَ كلِّ طلبٍ جديد**. فإقرارٌ واحدٌ مسجَّلٌ على الحسابِ يسمحُ لطلبٍ
 * ثانٍ بلا عرضٍ — وهذا عكسُ المطلوب. والإقرارُ في جسمِ الطلبِ مرتبطٌ بمفتاحِ اللاتكرارِ نفسِه:
 * إعادةُ المحاولةِ لنفسِ الطلبِ تحملُه ولا يُعادُ عرضُه، وطلبٌ جديدٌ يحتاجُ إقرارًا جديدًا.
 *
 * الحدود: لا كتابةَ ولا قراءةَ؛ لفافةٌ نقيّةٌ حولَ منفذٍ.
 */

import { isCurrentPrepayWarningAck } from "../../shared/prepay-warning/index.ts";
import { err } from "../../shared/result/index.ts";
import type { RideRequestCommand } from "./ride-request-ports.ts";

/** يلفُّ منفذَ الإنشاءِ فيرفضُ كلَّ أمرٍ بلا إقرارٍ بالإصدارِ الحاليِّ — بلا نداءٍ للمنفذِ الداخليّ. */
export function requirePrepayWarningAck(inner: RideRequestCommand): RideRequestCommand {
  return {
    create: async (input) => {
      if (!isCurrentPrepayWarningAck(input.prepayWarningAck)) {
        return err({ reason: "PREPAY_WARNING_NOT_ACKNOWLEDGED" });
      }
      return inner.create(input);
    },
  };
}
