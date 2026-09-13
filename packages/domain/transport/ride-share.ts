/**
 * الغرض: نطاقُ مشاركةِ الرحلةِ برابطٍ مؤقّتٍ (`F2-09` · `SR-13`) — حكمُ ما يراهُ
 *   المستلمُ، وحالُ الروابطِ الساريةِ، **وإفصاحٌ مُرقَّمٌ عمّا يُكشَفُ وما لا
 *   يُكشَفُ**. بلا نصٍّ معروضٍ وبلا نداءِ شبكةٍ: رموزٌ وأرقامٌ وحدَها.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. وحكمُ CI **غيرُ مقروءٍ** يومَ الكتابةِ
 *   (`B-CI-001`).
 * ينتمي إلى: packages/domain/transport
 * يُستخدم من: `application/transport/read-ride-share.ts` ·
 *   `infrastructure/transport/ride-share-store.ts` · سطحُ المشاركةِ في التطبيقِ
 *   المصغَّرِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` (الطوارئُ) — بلاغُ الطوارئِ يُشارِكُ الموقعَ
 *   نفسَه، فيقرأُ حكمَ النقطةِ من ههنا ولا يكتبُ تصنيفاً ثالثاً.
 *
 * ## لماذا حكمُ النقطةِ **يُقرأُ** من القاعدةِ ولا يُعادُ حسابُه ههنا
 *
 * في `active-ride.ts` دالّةٌ `driverPositionVerdict` تحكمُ على نقطةٍ بعُمرِها —
 * وهيَ حكمُ **شاشةِ المالكِ**. ولو كُتِبَ ههنا حكمٌ ثانٍ للمشاركةِ، لَصارَ في
 * المستودَعِ مصدرانِ لسؤالٍ واحدٍ: «أتُعرَضُ هذه النقطةُ؟». والفرقُ بينهما لن
 * يظهرَ في مُصرِّفٍ ولا في مراجعةٍ، بل في شاشتَينِ تقولانِ شيئَينِ مختلفَينِ عن
 * السائقِ نفسِه في اللحظةِ نفسِها.
 *
 * فالحكمُ **واحدٌ في القاعدةِ** (`tracking_link_view`)، وما ههنا **قراءتُه
 * وتصنيفُه نوعاً** لا إعادةُ إصدارِه. ولذلكَ لا دالّةَ ههنا تأخذُ عُمراً وحدّاً
 * وتُقرِّرُ — بل دالّةٌ تأخذُ ما قالَته القاعدةُ وترفضُ ما لا تفهمُه.
 *
 * ## ولماذا الإفصاحُ رموزٌ في النطاقِ لا نصٌّ في الشاشةِ
 *
 * «ماذا سيرى مَن أُعطيهِ الرابطَ؟» سؤالُ **خصوصيّةٍ** لا سؤالُ تنسيقٍ. ولو كُتِبَ
 * جوابُه نصّاً في الشاشةِ لَأمكنَ أن يُضافَ حقلٌ إلى الردِّ يوماً ولا يُحدَّثَ
 * النصُّ — فيصيرُ الوعدُ كاذباً بلا سطرٍ واحدٍ يتغيَّرُ في مكانِ الوعدِ. فالقائمتانِ
 * ههنا **رموزٌ**، ويُترجَمُ كلُّ رمزٍ في القواميسِ الثلاثةِ، ويُحرَسُ تطابقُهما
 * معَ ما يُنشَرُ فعلاً بحاجزٍ ساكنٍ.
 */

/**
 * حكمُ النقطةِ كما **تُسمّيهِ القاعدةُ**. وأسماؤُه أسماءُ `driverPositionVerdict`
 * نفسُها عن قصدٍ: مَن قرأَ `TOO_OLD` في سطحٍ يقرؤُها بالمعنى نفسِه في الآخرِ.
 */
export type SharedPositionVerdict = "LOCATED" | "NEVER_REPORTED" | "NO_TIMESTAMP" | "TOO_OLD";

export const SHARED_POSITION_VERDICTS: readonly SharedPositionVerdict[] = [
  "LOCATED",
  "NEVER_REPORTED",
  "NO_TIMESTAMP",
  "TOO_OLD",
];

export function isSharedPositionVerdict(value: unknown): value is SharedPositionVerdict {
  return (
    typeof value === "string" && SHARED_POSITION_VERDICTS.some((candidate) => candidate === value)
  );
}

/** مصدرُ الحدِّ — يُنشَرُ كي يُقرأَ «من إعدادِ المدينةِ» من «من الافتراضِ». */
export type PositionMaxAgeSource = "SETTING" | "FALLBACK_DEFAULT";

export function isPositionMaxAgeSource(value: unknown): value is PositionMaxAgeSource {
  return value === "SETTING" || value === "FALLBACK_DEFAULT";
}

export interface SharedPosition {
  readonly lat: number;
  readonly lng: number;
  /** عُمرُ النقطةِ بالثواني كما قاسَته القاعدةُ — لا يُشتَقُّ بساعةِ جهازٍ. */
  readonly ageSeconds: number;
}

/**
 * ما سيراهُ المستلمُ. **والإحداثيّةُ موجودةٌ في النوعِ متى كانَ الحكمُ `LOCATED`
 * وحدَه** — لا حقلٌ اختياريٌّ يُنسى فحصُه، بل اتّحادٌ يُجبِرُ المُصرِّفَ على
 * الفحصِ قبلَ الوصولِ إلى `lat`.
 */
export type SharePreview =
  | {
      readonly verdict: "LOCATED";
      readonly active: boolean;
      readonly position: SharedPosition;
      readonly maxAgeSeconds: number;
      readonly maxAgeSource: PositionMaxAgeSource;
    }
  | {
      readonly verdict: Exclude<SharedPositionVerdict, "LOCATED">;
      readonly active: boolean;
      /** `null` متى لا ختمَ أصلاً. و`TOO_OLD` يحملُ عُمرَه دائماً. */
      readonly ageSeconds: number | null;
      readonly maxAgeSeconds: number;
      readonly maxAgeSource: PositionMaxAgeSource;
    };

/**
 * رابطٌ سارٍ. **لا رمزَ فيه**: الرمزُ كلمةُ السرِّ، يُعطى مرّةً عندَ الإصدارِ
 * ولا يُعادُ في أيِّ قراءةٍ — فلا يُلتقَطُ من سجلٍّ ولا من لقطةِ شاشةٍ لاحقةٍ.
 */
export interface ShareLink {
  readonly id: string;
  readonly createdAtMs: number;
  /** ما بقيَ من عمرِه **بحسابِ القاعدةِ**. صفرٌ يعني منتهياً فلا يُعرَضُ. */
  readonly secondsRemaining: number;
}

export function isLiveLink(link: ShareLink): boolean {
  return link.secondsRemaining > 0;
}

export function liveLinks(links: readonly ShareLink[]): readonly ShareLink[] {
  return links.filter(isLiveLink);
}

/**
 * أهيَ مُشارَكةٌ الآنَ؟ سؤالٌ واحدٌ تُجيبُه الشاشةُ بعنوانٍ مختلفٍ كلّيّاً
 * («رحلتُكَ مُشارَكةٌ معَ ١» مقابلَ «شارِكْ رحلتَكَ»)، فيُحسَبُ مرّةً ههنا.
 */
export function isSharingNow(links: readonly ShareLink[]): boolean {
  return liveLinks(links).length > 0;
}

/** أطولُ ما بقيَ من بينِ الروابطِ — و`null` متى لا رابطَ حيّاً. */
export function longestRemainingSeconds(links: readonly ShareLink[]): number | null {
  const live = liveLinks(links);
  if (live.length === 0) return null;
  return live.reduce((most, link) => Math.max(most, link.secondsRemaining), 0);
}

/**
 * أيجوزُ إصدارُ رابطٍ جديدٍ؟ **والشرطُ ليسَ مكتوباً ههنا**: القاعدةُ تقولُه
 * (`can_share` من `is_active_order_status`)، وهذا النوعُ تصنيفُ جوابِها كي
 * تعرضَ الشاشةُ **سببَ** المنعِ لا زرّاً رمادِيّاً بلا تفسيرٍ.
 */
export type ShareAvailability = "CAN_SHARE" | "RIDE_NOT_ACTIVE";

export function shareAvailabilityOf(canShare: boolean): ShareAvailability {
  return canShare ? "CAN_SHARE" : "RIDE_NOT_ACTIVE";
}

/**
 * ما **يُكشَفُ** لحاملِ الرابطِ — مُرقَّماً لا موصوفاً. وكلُّ رمزٍ ههنا يجبُ أن
 * يُقابِلَه حقلٌ يُنشَرُ فعلاً في حمولةِ الصفحةِ العامّةِ.
 */
export const SHARE_DISCLOSED: readonly string[] = [
  /** نقطةُ السائقِ متى كانَ حكمُها `LOCATED`. */
  "DRIVER_POSITION",
  /** عُمرُ تلكَ النقطةِ بالثواني. */
  "POSITION_AGE",
  /** هل الرحلةُ جاريةٌ أم انتهَت. */
  "RIDE_ACTIVE_FLAG",
];

/**
 * ما **لا يُكشَفُ** — والقائمةُ ليست تطميناً إنشائيّاً: كلُّ رمزٍ فيها يُقابِلُه
 * حقلٌ **غيرُ موجودٍ** في حمولةِ الصفحةِ العامّةِ، ويُقاسُ غيابُه بحاجزٍ ساكنٍ.
 */
export const SHARE_WITHHELD: readonly string[] = [
  "RIDER_NAME",
  "RIDER_PHONE",
  "DRIVER_NAME",
  "DRIVER_PHONE",
  "PLATE_NUMBER",
  "PICKUP_AND_DROPOFF",
  "ORDER_ID",
];

/**
 * حالُ المشاركةِ كما تُعرَضُ. **والمعاينةُ حقلٌ واحدٌ يُمرَّرُ كما وصلَ** — لا
 * تُفكَّكُ ولا يُعادُ تركيبُها، فهيَ جوابُ المستلمِ نفسُه.
 */
export interface RideShareState {
  readonly orderId: string;
  readonly availability: ShareAvailability;
  readonly links: readonly ShareLink[];
  readonly sharingNow: boolean;
  readonly longestRemainingSeconds: number | null;
  /**
   * سقفُ عمرِ الرابطِ ومهلةُ ما بعدَ الرحلةِ **بقيمةِ المدينةِ** — و`null` متى
   * غابَ الإعدادُ: تُعرَضُ الجملةُ بلا رقمٍ، **ولا يُخترَعُ رقمٌ افتراضيٌّ**
   * يُقرأُ وعداً لم تقطعْه المنصّةُ.
   */
  readonly maxLifetimeMinutes: number | null;
  readonly graceMinutes: number | null;
  readonly preview: SharePreview;
}
