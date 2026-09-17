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
 * **`F12-04`**: حكمُ حياةِ مشاركةِ الرحلةِ — و**الحياةُ صفةُ الرحلةِ لا صفةُ
 * الرابطِ**. ولذلكَ العدُّ التنازليُّ نُقِلَ من الرابطِ إلى ههنا: رابطانِ لرحلةٍ
 * واحدةٍ يموتانِ في اللحظةِ نفسِها لأنَّ الذي يموتُ هوَ سببُهما.
 *
 * والأحكامُ الثلاثةُ **مفصولةٌ** بأسمائِها كما تنطِقُ بها القاعدةُ
 * (`tracking_link_lifetime`)، ولا يُشتَقُّ أحدُها من رقمٍ ههنا.
 */
export type ShareLifetimeVerdict = "LIVE_RIDE_ACTIVE" | "LIVE_GRACE" | "EXPIRED_RIDE_ENDED";

export const SHARE_LIFETIME_VERDICTS: readonly ShareLifetimeVerdict[] = [
  "LIVE_RIDE_ACTIVE",
  "LIVE_GRACE",
  "EXPIRED_RIDE_ENDED",
];

export function isShareLifetimeVerdict(value: unknown): value is ShareLifetimeVerdict {
  return (
    typeof value === "string" && SHARE_LIFETIME_VERDICTS.some((candidate) => candidate === value)
  );
}

/**
 * مهلةُ ما بعدَ الرحلةِ بالدقائقِ كما بذرَتها هجرةُ 2026-08-14 — **حكمٌ واحدٌ**
 * تُقاسُ به البذرةُ واحتياطُ الحَكَمِ في القاعدةِ بحاجزٍ ساكنٍ (القاعدة 0.3
 * و0.6)، فلا تصيرُ المهلةُ رقمَينِ يفترقانِ بلا أن يُخفِقَ شيءٌ.
 */
export const TRACKING_LINK_GRACE_MINUTES = 15;

/**
 * حالُ الحياةِ. **والعدُّ التنازليُّ موجودٌ في النوعِ متى كانَ له معنىً وحدَه**:
 * رحلةٌ جاريةٌ موعدُ نهايتِها غيرُ معلومٍ، فأيُّ رقمٍ يُعرَضُ لها كذبٌ — ولذلكَ
 * لا حقلَ اختياريًّا يُنسى فحصُه، بل اتّحادٌ يُجبِرُ المُصرِّفَ على قراءةِ الحكمِ
 * قبلَ الوصولِ إلى ثانيةٍ واحدةٍ.
 */
export type ShareLifetime =
  | {
      readonly verdict: "LIVE_RIDE_ACTIVE";
      /** مهلةُ ما بعدَ الرحلةِ **بقيمةِ المدينةِ** — تُعرَضُ وعداً معلوماً. */
      readonly graceMinutes: number;
      readonly graceSource: PositionMaxAgeSource;
    }
  | {
      readonly verdict: "LIVE_GRACE";
      /** ما بقيَ إلى **الموعدِ الحقيقيِّ** (نهايةُ الرحلةِ + المهلةُ). */
      readonly secondsRemaining: number;
      readonly graceMinutes: number;
      readonly graceSource: PositionMaxAgeSource;
    }
  | {
      readonly verdict: "EXPIRED_RIDE_ENDED";
      readonly graceMinutes: number;
      readonly graceSource: PositionMaxAgeSource;
    };

export function isShareLifetimeLive(lifetime: ShareLifetime): boolean {
  return lifetime.verdict !== "EXPIRED_RIDE_ENDED";
}

/**
 * رابطٌ سارٍ. **لا رمزَ فيه**: الرمزُ كلمةُ السرِّ، يُعطى مرّةً عندَ الإصدارِ
 * ولا يُعادُ في أيِّ قراءةٍ — فلا يُلتقَطُ من سجلٍّ ولا من لقطةِ شاشةٍ لاحقةٍ.
 *
 * **و`F12-04` نزعَ منه العدَّ التنازليَّ**: كانَ `secondsRemaining` يُطرَحُ من
 * **السقفِ** (`expires_at`) فيُعرَضُ موعداً وليسَ موعداً — «يبقى إحدى عشرةَ
 * ساعةً» في رابطٍ يموتُ بعدَ ربعِ ساعةٍ من نهايةِ الرحلةِ. فالسقفُ يبقى منشوراً
 * **باسمِه** (`ceilingSecondsRemaining`) والموعدُ في `ShareLifetime`.
 */
export interface ShareLink {
  readonly id: string;
  readonly createdAtMs: number;
  /**
   * ما بقيَ من **السقفِ المطلقِ** بحسابِ القاعدةِ — حمايةٌ من رحلةٍ لم تُغلَقْ
   * أبداً. **وليسَ موعدَ انتهاءِ المشاركةِ**: ذاكَ حكمُ `ShareLifetime`.
   */
  readonly ceilingSecondsRemaining: number;
}

/**
 * أهيَ مُشارَكةٌ الآنَ؟ سؤالٌ واحدٌ تُجيبُه الشاشةُ بعنوانٍ مختلفٍ كلّيّاً
 * («رحلتُكَ مُشارَكةٌ معَ ١» مقابلَ «شارِكْ رحلتَكَ»)، فيُحسَبُ مرّةً ههنا.
 *
 * **وشرطانِ لا شرطٌ** (`F12-04`): رابطٌ قائمٌ **وحياةٌ لم تنقضِ**. ورابطٌ حيٌّ
 * في رحلةٍ انقضَت مهلتُها لا يُعَدُّ مشاركةً — لأنَّه لا يُجيبُ حاملَه.
 */
export function isSharingNow(lifetime: ShareLifetime, links: readonly ShareLink[]): boolean {
  return isShareLifetimeLive(lifetime) && links.length > 0;
}

/**
 * ما بقيَ من المشاركةِ بالثواني — و`null` **حكمٌ لا نقصٌ**: رحلةٌ جاريةٌ لا موعدَ
 * لها يُعَدُّ إليه، ورحلةٌ انقضَت مهلتُها لا بقيّةَ لها.
 */
export function shareCountdownSeconds(lifetime: ShareLifetime): number | null {
  return lifetime.verdict === "LIVE_GRACE" ? lifetime.secondsRemaining : null;
}

/** أقربُ سقفٍ ينقضي من بينِ الروابطِ — و`null` متى لا رابطَ. */
export function soonestCeilingSeconds(links: readonly ShareLink[]): number | null {
  if (links.length === 0) return null;
  return links.reduce(
    (least, link) => Math.min(least, link.ceilingSecondsRemaining),
    Number.POSITIVE_INFINITY,
  );
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
  /** حكمُ حياةِ المشاركةِ (`F12-04`) — به تُقالُ الجملةُ الصادقةُ عن الموعدِ. */
  readonly lifetime: ShareLifetime;
  /** أقربُ سقفٍ ينقضي — **سقفٌ باسمِه** لا موعدُ المشاركةِ. */
  readonly soonestCeilingSeconds: number | null;
  /**
   * سقفُ عمرِ الرابطِ ومهلةُ ما بعدَ الرحلةِ **بقيمةِ المدينةِ** — و`null` متى
   * غابَ الإعدادُ: تُعرَضُ الجملةُ بلا رقمٍ، **ولا يُخترَعُ رقمٌ افتراضيٌّ**
   * يُقرأُ وعداً لم تقطعْه المنصّةُ.
   */
  readonly maxLifetimeMinutes: number | null;
  readonly graceMinutes: number | null;
  readonly preview: SharePreview;
}
