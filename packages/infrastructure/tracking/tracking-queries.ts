/**
 * الغرض: قراءات التتبّع من المصدر القانوني: الرحلة الجارية للسائق، وبرهان ملكيّتها،
 *   وقناة العميل التي يُدفع إليها الموقع.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة ٦.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: مُرحِّل الموقع إلى العميل (المرحلة ١١)، وخريطة العمليات (١٣)
 *
 * ## لماذا «البرهان» استعلامٌ خاصّ ولا يُعاد استخدام `OrderRepository`
 *
 * لأن `OrderRepository.findById` تعيد الطلب كما يفهمه المجال (موضع الانطلاق
 * والوصول والحالة والجولة)، ولا تعيد `rider_id` أصلاً — وهو **الحقل الوحيد**
 * الذي يُبنى عليه حكم «هذه رحلتك». فاستخدامها هنا كان يوجب توسيعها بحقلٍ لا
 * يحتاجه أيٌّ من مستخدميها العشرة، أو استنتاج الملكيّة من غير مصدرها.
 *
 * وهذا ليس مصدراً ثانياً للحقيقة: نفس الصفّ من `orders`، بأعمدةٍ أخرى، لسؤالٍ
 * آخر. المصدر واحد والقارئ اثنان — وذلك هو الفصل الصحيح بين نماذج القراءة.
 */

import type { ActiveTripReader } from "../../application/tracking/live-tracking.ts";
import type { TripAssignmentProof, WatchedTripStatus } from "../../domain/tracking/visibility.ts";
import type { Sql } from "../db/client.ts";

/** وجهة الدفع إلى العميل: من يُخاطَب، وعلى أيّ رحلة، وسائقها. */
export interface CustomerChannelTarget {
  readonly tripId: string;
  readonly riderId: string;
  readonly riderTelegramId: string;
  readonly driverId: string;
  readonly riderLanguage: string;
  /**
   * المرحلة ١١: حالة الطلب تُعاد مع الوجهة لا في قراءةٍ ثانية.
   *
   * والسبب ليس توفيرَ نداء: قراءتان منفصلتان قد تريان لحظتين، فيُفتح
   * بثٌّ لرحلةٍ قُرئت حيّةً ثم أُلغيت، أو يُرفض بثٌّ لرحلةٍ أُسندت بينهما. وهو
   * نفس التعليل المكتوب في `ActiveOrderSummary.assignedDriver`.
   *
   * ولماذا `WatchedTripStatus` لا `string`؟ لأن المُستهلِك يمرّرها إلى `isTripLive`؛
   * و`string` تجعل خطأً مطبعيّاً في حالةٍ يمرّ بلا صراخ، فيُقرأ «غير حيّ».
   */
  readonly status: WatchedTripStatus;
}

export interface TrackingProofReader {
  /** برهان ملكيّة الرحلة وإسنادها كما هو في القاعدة الآن. */
  proofOf(tripId: string): Promise<TripAssignmentProof | null>;
  /**
   * قناة عميل الرحلة. تُعاد للرحلات الحيّة وغيرها: الحكم على «الحياة» في المجال
   * (`isTripLive`) لا في `where` — فاستعلامٌ يُخفي الرحلة المنتهية يجعل الرفض
   * يبدو «رحلة غير موجودة»، وتشخيصُ ذلك في الإنتاج مستحيل.
   */
  customerOf(tripId: string): Promise<CustomerChannelTarget | null>;
}

/**
 * الرحلة الجارية للسائق. `matched` و`in_progress` وحدهما: الأولى أُسنِدت ولم
 * تبدأ (والعميل ينتظر السائق فيرى قدومه — وهي أهمّ لحظة في التتبّع كله)،
 * والثانية جارية. وما سواهما لا سائق فيه يُتابَع.
 *
 * `limit 1` بلا ترتيب مقصود: القاعدة تمنع أصلاً أن يكون لسائقٍ رحلتان حيّتان
 * (الإسناد الذرّي في `claim_ride`)، فترتيبُ صفٍّ واحد عبثٌ يُوهم بأن التعدّد
 * ممكن ومُعالَج.
 */
export function createActiveTripReader(sql: Sql): ActiveTripReader {
  return {
    activeTripOf: async (driverId) => {
      const rows = await sql<{ id: string }[]>`
        select id from orders
         where assigned_driver_id = ${driverId}::uuid
           and status in ('matched', 'in_progress')
         limit 1
      `;
      return rows[0]?.id ?? null;
    },
  };
}

export function createTrackingProofReader(sql: Sql): TrackingProofReader {
  return {
    proofOf: async (tripId) => {
      const rows = await sql<
        {
          id: string;
          rider_id: string;
          assigned_driver_id: string | null;
          status: string;
          city_id: string;
        }[]
      >`
        select id, rider_id, assigned_driver_id, status::text as status, city_id
          from orders
         where id = ${tripId}::uuid
         limit 1
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        tripId: row.id,
        riderId: row.rider_id,
        driverId: row.assigned_driver_id,
        status: row.status as WatchedTripStatus,
        cityId: row.city_id,
      };
    },

    customerOf: async (tripId) => {
      const rows = await sql<
        {
          id: string;
          rider_id: string;
          telegram_id: string;
          language_code: string | null;
          assigned_driver_id: string | null;
          status: string;
        }[]
      >`
        select o.id, o.rider_id, u.telegram_id::text as telegram_id,
               u.language_code, o.assigned_driver_id, o.status::text as status
          from orders o
          join riders r on r.id = o.rider_id
          join users u on u.id = r.user_id
         where o.id = ${tripId}::uuid
         limit 1
      `;
      const row = rows[0];
      if (row === undefined || row.assigned_driver_id === null) return null;
      return {
        tripId: row.id,
        riderId: row.rider_id,
        riderTelegramId: row.telegram_id,
        driverId: row.assigned_driver_id,
        riderLanguage: row.language_code ?? "ar",
        // نفس الإسقاط المستخدم في `proofOf` حرفيّاً: قيد `orders_status_check` في
        // القاعدة و`WatchedTripStatus` في المجال يسردان نفس القيم، فالإسقاط يقرّر
        // ما تضمنه القاعدة؛ وفحصٌ يدويٌّ هنا يكون سرداً ثالثاً ينحرف عنهما.
        status: row.status as WatchedTripStatus,
      };
    },
  };
}
