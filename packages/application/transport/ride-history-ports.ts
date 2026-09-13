/**
 * الغرض: عقدُ سجلِّ الرحلاتِ وتفاصيلِ الرحلةِ بينَ طبقةِ التطبيقِ والقاعدةِ —
 *   صفحةٌ بمفتاحٍ ومنطقةُ تصنيفِ الشهرِ وسجلُّ الأحداثِ بمصادرِه، **بلا حكمٍ
 *   وبلا نصٍّ معروضٍ** (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `read-ride-history.ts` · `read-ride-detail.ts` ·
 *   `infrastructure/transport/ride-history-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يقرأُ الصفحاتِ نفسَها
 *   بالمفتاحِ نفسِه ولا يكتبُ قارئاً ثانياً.
 * ملاحظات مستقبلية: **لا حقلَ أجرةٍ ولا مبلغٍ ولا وسيلةِ دفعٍ ولا خانةً لها**
 *   قبلَ `DEC-11` (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا المؤشِّرُ **قيمتانِ** لا نصٌّ مُعمّىً
 *
 * نصٌّ مُعمّىً (`base64` من حمولةٍ) يُغري بحشوِ حالةٍ فيه، ثمَّ يصيرُ عقداً
 * خفيّاً لا يُقرأُ في سجلٍّ ولا يُفحَصُ في اختبارٍ. والقيمتانِ **مرئيّتانِ**:
 * لحظةٌ ومعرِّفٌ، تُقرآنِ في أثرِ طلبٍ وتُقاسانِ في توكيدٍ. وصحّتُهما تُفحَصُ
 * في القاعدةِ (`INVALID_CURSOR`) لا في العميلِ وحدَه.
 *
 * ## ولماذا `monthTimezone` **يُنشَرُ** في العقدِ ولا يبقى في القاعدةِ
 *
 * لأنَّ عنوانَ الشهرِ حكمٌ، ولا يُقرأُ حكمٌ بلا سندِه. فمَن رأى «سبتمبر ٢٠٢٦»
 * يجبُ أن يستطيعَ أن يعرفَ **بأيِّ ساعةٍ** صُنِّفَ، ومصدرُ تلكَ الساعةِ إعدادٌ
 * أم بديلٌ مُصرَّحٌ. وإخفاؤُهما يجعلُ خطأً في إعدادِ مدينةٍ عطباً صامتاً يظهرُ
 * شكوى راكبٍ بعدَ شهرٍ.
 *
 * ## وما لا يفعلُه هذا العقدُ عن قصدٍ
 *
 *   ــ **لا مبلغَ ولا إيصالَ ولا وسيلةَ دفعٍ** (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا مسارَ ولا سلسلةَ نقاطٍ ولا حقلَ خريطةٍ** — لا مصدرَ لها في المخطَّطِ
 *      ولا مزوّدَ في الحزمةِ (`ADR 0007`).
 *   ــ **لا مدّةَ ولا وترَ خطٍّ في التفاصيلِ**: تلكَ حقولُ
 *      `completed_ride_summary` (`F2-07`)، وتكرارُها مصدرُ حقيقةٍ ثانٍ يفترقُ
 *      عن الأوّلِ عندَ أوّلِ تصحيحٍ (القاعدة 0.6).
 *   ــ **لا تذكرةَ دعمٍ** — `F2-12`، غيابٌ مُصرَّحٌ بلا زرٍّ.
 *   ــ **لا عدَّ إجماليٍّ للرحلاتِ**: عدٌّ كاملٌ في كلِّ صفحةٍ مسحٌ للجدولِ بلا
 *      طالبٍ، و«أثمَّةَ مزيدٌ؟» يكفي للتصفُّحِ.
 */

import type { RideEvent, RideHistoryRow } from "../../domain/transport/ride-history.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RideStoreFailure } from "./ride-request-ports.ts";

/** مؤشِّرُ الصفحةِ — لحظةٌ ومعرِّفٌ معاً، ونصفُه ليسَ مؤشِّراً. */
export interface RideHistoryCursor {
  /** لحظةُ الإنشاءِ بصيغةِ ISO كما نشرَتها القاعدةُ — تُعادُ كما وردَت. */
  readonly createdAt: string;
  readonly id: string;
}

export interface RideHistoryPage {
  readonly rides: readonly RideHistoryRow[];
  readonly hasMore: boolean;
  /** `null` = لا مزيدَ. ولا يُنشَرُ مؤشِّرٌ يُعيدُ صفحةً فارغةً. */
  readonly nextCursor: RideHistoryCursor | null;
  /** اسمُ المنطقةِ التي صُنِّفَ بها الشهرُ — يُنشَرُ ولا يُخمَّنُ. */
  readonly monthTimezone: string;
  /** `CITY_SETTING` أو بديلٌ مُصرَّحٌ — تصنيفُه في النطاقِ لا ههنا. */
  readonly monthTimezoneSource: string;
}

export type RideHistoryRefusal = "INVALID_PAGE_SIZE" | "INVALID_CURSOR";

export type RideHistoryVerdict =
  | { readonly ok: true; readonly page: RideHistoryPage }
  | { readonly ok: false; readonly refusal: RideHistoryRefusal };

export interface RideHistoryReader {
  read(input: {
    /** نصٌّ لا عددٌ — `bigint` تلغرامَ لا يُمرُّ في `number` جاواسكربت. */
    readonly telegramUserId: string;
    readonly query: string | null;
    readonly cursor: RideHistoryCursor | null;
    readonly limit: number;
  }): Promise<Result<RideHistoryVerdict, RideStoreFailure>>;
}

/** بطاقةُ السائقِ في التفاصيلِ — **بلا موقعٍ**: الرحلةُ ليست تُتابَعُ ههنا. */
export interface RideDetailDriver {
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ. **ولا يُستبدَلُ برقمٍ افتراضيٍّ.** */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export interface RideDetailState {
  readonly orderId: string;
  /** نصٌّ لا اتّحادٌ مُغلَقٌ: حالةٌ جديدةٌ في القاعدةِ لا تُسقِطُ قارئاً. */
  readonly status: string;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly cancelledReason: string | null;
  readonly driver: RideDetailDriver | null;
  /** بترتيبِ القاعدةِ — **ولا يُعادُ ترتيبُه** في أيِّ طبقةٍ فوقَها. */
  readonly events: readonly RideEvent[];
}

export type RideDetailRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";

export type RideDetailVerdict =
  | { readonly found: true; readonly state: RideDetailState }
  | { readonly found: false; readonly refusal: RideDetailRefusal };

export interface RideDetailReader {
  read(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideDetailVerdict, RideStoreFailure>>;
}
