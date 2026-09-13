/**
 * الغرض: نموذجُ عرضِ المشاركةِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ نصٍّ
 *   وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-09` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/share
 * يُستخدم من: `RideShareCard.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` يُعيدُ استعمالَ `remainingText` ولا يكتبُ
 *   صياغةَ مدّةٍ ثانيةً.
 *
 * ## لماذا المدّةُ المتبقّيةُ **تُقرأُ من الخادمِ** ولا تُعَدُّ في المتصفّحِ
 *
 * عقربٌ يدقُّ في الشاشةِ يحتاجُ ساعةً محلّيّةً، وساعةُ الجهازِ ليست شاهداً:
 * جهازٌ متأخّرٌ ثلاثَ دقائقَ كانَ سيقولُ «بقيَت ١٣ دقيقةً» وقد انتهى الرابطُ.
 * فـ`secondsRemaining` **رقمٌ قاسَته القاعدةُ**، ويُعرَضُ كما وصلَ، ويُعادُ
 * سؤالُه بضغطةٍ — **ولا يدقُّ وحدَه**: رقمٌ ساكنٌ صادقٌ خيرٌ من عقربٍ كاذبٍ.
 *
 * ## ولماذا صفرٌ متبقٍّ **لا يُعرَضُ رابطاً حيّاً**
 *
 * «بقيَت ٠ دقيقةٍ» تُقرأُ «ما زالَ يعملُ». والحقيقةُ أنَّه ماتَ — والفرقُ عندَ
 * مَن يظنُّ أنَّ أهلَه يرَونه.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يُصيغُ نصّاً**: النصُّ في `packages/shared/i18n` وحدَه.
 *   ــ **لا يخترعُ حكماً**: ما لا يُعرَفُ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً.
 *   ــ **لا يحسبُ عُمرَ نقطةٍ**: الحكمُ والعُمرُ يصلانِ مقيسَينِ من القاعدةِ.
 */

import type { ApiSharePreview, ApiSharePreviewLocated } from "./ride-share-contract.ts";

/** أهوَ رابطٌ حيٌّ؟ صفرٌ ودونَه **ميتٌ** ولا يُعرَضُ (انظرْ رأسَ المِلفِّ). */
export function isLiveRemaining(secondsRemaining: number): boolean {
  return Number.isFinite(secondsRemaining) && secondsRemaining > 0;
}

export interface RemainingText {
  readonly key: string;
  readonly minutes: number;
  readonly seconds: number;
}

/** المتبقّي ⇒ مفتاحٌ وأعدادٌ. ودونَ الدقيقةِ يُقالُ بالثواني كي لا يُقرأَ «٠». */
export function remainingText(secondsRemaining: number): RemainingText {
  const safe =
    Number.isFinite(secondsRemaining) && secondsRemaining > 0 ? Math.trunc(secondsRemaining) : 0;
  const minutes = Math.trunc(safe / 60);
  return {
    key: minutes === 0 ? "rider.share.remainingSeconds" : "rider.share.remainingMinutes",
    minutes,
    seconds: safe % 60,
  };
}

/**
 * سطرُ المعاينةِ — **ما سيراهُ المستلمُ الآنَ**. اتّحادٌ بحكمٍ: إمّا نقطةٌ معَ
 * عُمرِها، وإمّا حجبٌ بسببِه. ولا ثالثَ.
 */
export type PreviewLine =
  | {
      readonly show: true;
      readonly lat: number;
      readonly lng: number;
      readonly ageKey: string;
      readonly ageMinutes: number;
      readonly ageSeconds: number;
    }
  | { readonly show: false; readonly key: string };

const PREVIEW_HIDDEN_KEYS: Readonly<Record<string, string>> = {
  NEVER_REPORTED: "rider.share.preview.neverReported",
  NO_TIMESTAMP: "rider.share.preview.noTimestamp",
  TOO_OLD: "rider.share.preview.tooOld",
};

/**
 * حكمٌ `LOCATED` **معَ إحداثيّتِه وعُمرِه** أو لا شيءَ. وخرقُ العقدِ (حكمٌ يقولُ
 * «موجودٌ» بلا نقطةٍ) **يُحجَبُ ولا يُرقَّعُ**: نقطةٌ مُخترَعةٌ في شاشةِ مشاركةٍ
 * تُري صاحبَها موضعاً ليسَ موضعَ سائقِه.
 */
function locatedOf(preview: ApiSharePreview): ApiSharePreviewLocated | null {
  if (preview.verdict !== "LOCATED") return null;
  const candidate = preview as Partial<ApiSharePreviewLocated>;
  if (
    typeof candidate.lat !== "number" ||
    typeof candidate.lng !== "number" ||
    typeof candidate.ageSeconds !== "number"
  ) {
    return null;
  }
  return candidate as ApiSharePreviewLocated;
}

export function previewLine(preview: ApiSharePreview): PreviewLine {
  const located = locatedOf(preview);
  if (located === null) {
    return {
      show: false,
      key: PREVIEW_HIDDEN_KEYS[preview.verdict] ?? "rider.share.preview.unknown",
    };
  }
  const safe =
    Number.isFinite(located.ageSeconds) && located.ageSeconds > 0
      ? Math.trunc(located.ageSeconds)
      : 0;
  const minutes = Math.trunc(safe / 60);
  return {
    show: true,
    lat: located.lat,
    lng: located.lng,
    ageKey: minutes === 0 ? "rider.share.preview.ageSeconds" : "rider.share.preview.ageMinutes",
    ageMinutes: minutes,
    ageSeconds: safe % 60,
  };
}

/**
 * مفتاحُ عنصرِ الإفصاحِ. **ورمزٌ لا نعرفُه يُقالُ صراحةً «حقلٌ جديدٌ»** ولا
 * يُطوى: قائمةٌ تُسقِطُ ما لا تفهمُه كانت ستُخفي حقلاً يُنشَرُ فعلاً.
 */
export function disclosureKey(code: string): string {
  return `rider.share.disclosure.${code}`;
}

/** رفضُ الإصدارِ ⇒ مفتاحُ نصٍّ. */
export function startRefusalKey(refusal: string): string {
  if (refusal === "ORDER_NOT_FOUND") return "rider.share.refusal.notFound";
  if (refusal === "RIDE_NOT_ACTIVE") return "rider.share.refusal.notActive";
  if (refusal === "LINK_COLLISION") return "rider.share.refusal.collision";
  return "rider.share.refusal.unknown";
}

/** رفضُ القراءةِ ⇒ مفتاحُ نصٍّ (كما في `F2-06`: لا تمييزَ بينَ «ليست لكَ» و«لا وجودَ»). */
export function readRefusalKey(refusal: string): string {
  return refusal === "INVALID_ORDER_ID"
    ? "rider.share.refusal.invalidId"
    : "rider.share.refusal.notFound";
}

/**
 * رمزُ خطأٍ من الخادمِ ⇒ مفتاحُ نصٍّ. و`SHARING_NOT_CONFIGURED` **لهُ نصُّه
 * الخاصُّ**: «الميزةُ غيرُ مُفعَّلةٍ» صدقٌ، و«حدثَ خطأٌ» كذبٌ يُرسِلُ صاحبَه
 * يُعيدُ المحاولةَ أبداً.
 */
export function shareErrorKey(code: string): string {
  if (code === "SHARING_NOT_CONFIGURED") return "rider.share.error.notConfigured";
  if (code === "SESSION_REQUIRED" || code === "SESSION_EXPIRED" || code === "SESSION_INVALID") {
    return "rider.share.error.session";
  }
  if (code === "RIDE_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE") {
    return "rider.share.error.unavailable";
  }
  return "rider.share.error.unknown";
}

/** أيُعادُ السؤالُ بزرٍّ؟ عطلُ خدمةٍ نعم، وجلسةٌ منتهيةٌ لا. */
export function isRetryableShareError(code: string): boolean {
  return code === "RIDE_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE";
}
