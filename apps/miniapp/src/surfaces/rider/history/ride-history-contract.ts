/**
 * الغرض: شكلُ ردَّي `GET /v1/rides` و`GET /v1/rides/:id/detail` كما يقرأُهما
 *   العميلُ — أنواعٌ لا منطقٌ (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/history
 * يُستخدم من: `ride-history-api.ts` و`ride-history-view.ts` و
 *   `RideHistoryScreen.tsx` و`RideDetailScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يقرأُ الصفحاتِ نفسَها.
 *
 * ## لماذا `monthKey` نصٌّ `YYYY-MM` ولا يُحسَبُ في العميلِ
 *
 * لأنَّ تصنيفَ الشهرِ حكمٌ مقيدٌ بمنطقةٍ زمنيّةٍ، وساعةُ الهاتفِ **ليست** ساعةَ
 * المدينةِ: راكبٌ مسافرٌ يرى رحلتَه في شهرٍ آخرَ لو حُسِبَت محليّاً. فالقاعدةُ
 * تحسبُ بمنطقةٍ مُعلَنةٍ، والعميلُ يعرضُ ما حُسِبَ ويُظهِرُ المنطقةَ.
 *
 * ## ولماذا `monthTimezoneTrust` حقلٌ منشورٌ
 *
 * كي يُقالَ للراكبِ **صراحةً** أنَّ التصنيفَ جرى بساعةٍ بديلةٍ حينَ يغيبُ إعدادُ
 * مدينتِه — بدلَ عنوانِ شهرٍ يبدو يقيناً وهوَ ظنٌّ.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا مبلغَ ولا إيصالَ ولا وسيلةَ دفعٍ ولا خانةً لها** (`ADR 0039` §٤).
 *   ــ **لا مسارَ ولا صورةَ خريطةٍ** (`ADR 0007`) — لا مصدرَ لهما.
 *   ــ **لا مدّةَ ولا وترَ خطٍّ في التفاصيلِ**: حقولُ الملخَّصِ (القاعدة 0.6).
 *   ــ **لا عدَّ إجماليٍّ**: «أثمَّةَ مزيدٌ؟» يكفي.
 */

/** حالةُ الرحلةِ كما نشرَتها القاعدةُ — نصٌّ يُصنَّفُ في نموذجِ العرضِ. */
export type ApiRideStatus = string;

export interface ApiRideHistoryItem {
  readonly orderId: string;
  readonly status: ApiRideStatus;
  readonly service: string;
  /** لافتةُ المكانِ — `null` غيابٌ لا نصٌّ فارغٌ. */
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAt: string;
  /** `null` = لم تنتهِ. ولا يُستبدَلُ بلحظةِ الإنشاءِ. */
  readonly completedAt: string | null;
}

export interface ApiRideHistoryGroup {
  readonly monthKey: string;
  readonly rides: readonly ApiRideHistoryItem[];
}

export interface ApiRideHistoryCursor {
  readonly createdAt: string;
  readonly id: string;
}

export type RideHistoryResponse =
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly query: string | null;
      readonly monthTimezone: string;
      readonly monthTimezoneTrust: string;
      readonly groups: readonly ApiRideHistoryGroup[];
      readonly hasMore: boolean;
      readonly nextCursor: ApiRideHistoryCursor | null;
    }
  | { readonly ok: true; readonly accepted: false; readonly refusal: string };

export interface ApiRideDetailDriver {
  /** الاسمُ الأوّلُ وحدَه: يكفي للتعرُّفِ ولا يُفشي هويّةً كاملةً. */
  readonly firstName: string | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string | null;
  /** `null` = لا تقييمَ بعدُ — ولا يُستبدَلُ بصفرٍ ولا بخمسةٍ. */
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
}

export interface ApiRideEvent {
  /** مُصنَّفٌ يعرفُه النطاقُ، أو `UNKNOWN`. */
  readonly kind: string;
  /** الخامُّ كما وردَ — يُعرَضُ حينَ يكونُ المُصنَّفُ `UNKNOWN`. */
  readonly rawKind: string;
  /** `null` = حدثٌ بلا ختمٍ مكتوبٍ. **ولا يُستبدَلُ بلحظةٍ أخرى.** */
  readonly at: string | null;
  readonly source: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export type RideDetailResponse =
  | {
      readonly ok: true;
      readonly found: true;
      readonly orderId: string;
      readonly status: ApiRideStatus;
      /** تصنيفُ النتيجةِ من النطاقِ — يُترجَمُ نصّاً ولا يُشتَقُّ ههنا. */
      readonly outcome: string;
      readonly service: string;
      readonly pickupLabel: string | null;
      readonly dropoffLabel: string | null;
      readonly cancelledReason: string | null;
      readonly driver: ApiRideDetailDriver | null;
      readonly events: readonly ApiRideEvent[];
    }
  | { readonly ok: true; readonly found: false; readonly refusal: string };
