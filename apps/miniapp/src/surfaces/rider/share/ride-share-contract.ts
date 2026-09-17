/**
 * الغرض: شكلُ ردودِ `/v1/rides/:id/share` كما يقرؤُها العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F2-09` · `SR-13`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`. حكمُ CI **غيرُ مقروءٍ** (`B-CI-001`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/share
 * يُستخدم من: `ride-share-api.ts` و`ride-share-view.ts` و`RideShareCard.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` — زرُّ الطوارئِ سيقرأُ `sharingNow` كي لا
 *   يُصدِرَ رابطاً ثانياً لمن يُشارِكُ أصلاً.
 *
 * ## لماذا المعاينةُ اتّحادٌ بحكمٍ لا حقلٌ اختياريٌّ
 *
 * `{verdict:"LOCATED", lat, lng}` مقابلَ `{verdict:"TOO_OLD", ageSeconds}`:
 * المُصرِّفُ نفسُه يمنعُ رسمَ نقطةٍ لم تُنشَرْ. ولو كانَ `lat?: number` لَكتبَ
 * أحدُهم `preview.lat ?? 0` يوماً — وصفرٌ **نقطةٌ في خليجِ غينيا** تُرسَمُ
 * وتُصدَّقُ.
 *
 * ## ولماذا الإفصاحُ رموزٌ تصلُ من الخادمِ
 *
 * «ماذا سيرى مَن أُعطيهِ الرابطَ؟» جوابُه يجبُ أن يتغيَّرَ **معَ الحمولةِ
 * نفسِها** لا معَ نصٍّ في الواجهةِ. فالخادمُ يُرسِلُ القائمتَينِ رموزاً،
 * والواجهةُ تترجمُ ما وصلَ — فإن زيدَ حقلٌ يوماً ولم يُزَدْ رمزُه، كشفَه
 * الحاجزُ الساكنُ ولم يُكشَفْ بعدَ أن يُقرأَ وعدٌ كاذبٌ.
 *
 * ## وما لا يصفُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا رمزَ تتبُّعٍ في ردِّ القراءةِ**: الرمزُ يُنشَرُ مرّةً عندَ الإصدارِ.
 *   ــ **لا سعرَ ولا إيصالَ**: `ADR 0039` §٤.
 */

export type ApiShareAvailability = "CAN_SHARE" | "RIDE_NOT_ACTIVE";

export type ApiSharePositionMaxAgeSource = "SETTING" | "FALLBACK_DEFAULT";

export interface ApiSharePreviewLocated {
  readonly verdict: "LOCATED";
  readonly active: boolean;
  readonly lat: number;
  readonly lng: number;
  readonly ageSeconds: number;
  readonly maxAgeSeconds: number;
  readonly maxAgeSource: ApiSharePositionMaxAgeSource;
}

export type ApiSharePreview =
  | {
      readonly verdict: "LOCATED";
      readonly active: boolean;
      readonly lat: number;
      readonly lng: number;
      readonly ageSeconds: number;
      readonly maxAgeSeconds: number;
      readonly maxAgeSource: ApiSharePositionMaxAgeSource;
    }
  | {
      /** نصٌّ لا اتّحادٌ مُغلَقٌ: حكمٌ جديدٌ في القاعدةِ لا يجبُ أن يُبيِّضَ شاشةً. */
      readonly verdict: string;
      readonly active: boolean;
      readonly ageSeconds: number | null;
      readonly maxAgeSeconds: number;
      readonly maxAgeSource: string;
    };

export interface ApiShareLink {
  readonly id: string;
  readonly createdAt: string;
  /** السقفُ المطلقُ **باسمِه** — وليسَ موعدَ انتهاءِ المشاركةِ (`F12-04`). */
  readonly ceilingSecondsRemaining: number;
}

/**
 * حكمُ حياةِ المشاركةِ (`F12-04`). **والحكمُ نصٌّ لا اتّحادٌ مُغلَقٌ** كما في
 * `verdict` أعلاه: حكمٌ جديدٌ في القاعدةِ لا يجبُ أن يُبيِّضَ شاشةً.
 * و`secondsRemaining` **`null` حكمٌ لا نقصٌ**: رحلةٌ جاريةٌ لا موعدَ لها يُعَدُّ
 * إليه، وأيُّ رقمٍ يُعرَضُ لها كذبٌ.
 */
export interface ApiShareLifetime {
  readonly verdict: string;
  readonly secondsRemaining: number | null;
  readonly graceMinutes: number;
  readonly graceSource: string;
}

export interface ApiShareDisclosure {
  readonly shown: readonly string[];
  readonly hidden: readonly string[];
}

export type ShareStateResponse =
  | { readonly ok: true; readonly found: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly found: true;
      readonly orderId: string;
      readonly availability: ApiShareAvailability;
      readonly sharingNow: boolean;
      readonly lifetime: ApiShareLifetime;
      readonly soonestCeilingSeconds: number | null;
      /** `null` = الإعدادُ غائبٌ — **وتُعرَضُ الجملةُ بلا رقمٍ** لا برقمٍ مُخترَعٍ. */
      readonly maxLifetimeMinutes: number | null;
      readonly graceMinutes: number | null;
      readonly links: readonly ApiShareLink[];
      readonly preview: ApiSharePreview;
      readonly disclosure: ApiShareDisclosure;
    };

export type StartShareResponse =
  | { readonly ok: true; readonly issued: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly issued: true;
      /** الرابطُ كاملاً — **يُبنى في الخادمِ مرّةً** ولا يُركَّبُ ههنا. */
      readonly url: string;
      readonly expiresAt: string;
    };

export interface StopShareResponse {
  readonly ok: true;
  readonly revoked: number;
}
