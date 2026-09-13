/**
 * الغرض: منافذُ رموز التتبّع المؤقّتة — إصدارٌ وإلغاءٌ وقراءةُ موقعٍ وانقضاءٌ دوري.
 *   أُخرجت إلى ملفٍّ واحد لأنّ محوّلاتها تعيش في `infrastructure`، ولا يجوز لها أن
 *   تستورد من `apps` (نفس سبب `expire-offers-ports.ts`).
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: application/tracking
 * يُتوقع أن يستخدمه: infrastructure/tracking/tracking-token-adapters.ts،
 *   apps/gateway/src/routes/public-tracking.ts، حوارا البوتَين، apps/workers.
 * ملاحظات مستقبلية: يوم يُطلب «شارك رحلتي مع رقم جوّال» يُضاف منفذُ إرسالٍ ثالث
 *   ولا تتغيّر هذه المنافذ — الرابطُ هو الرابط، وطريقةُ توصيله شأنُ الطبقة الأعلى.
 */

import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** نتيجةُ إصدارٍ ناجح كما تُعيدها الدالّة الذرّية. */
export interface IssuedTokenRow {
  readonly token: string;
  readonly cityId: CityId;
  readonly expiresAt: Date;
}

/**
 * موقعٌ يُعرض في متصفّحٍ مجهول. لا حقلَ هويّةٍ فيه بقصد: لا اسمَ سائق، ولا لوحة،
 * ولا معرّفَ طلبٍ — من عنده الرابط يرى نقطةً وعُمرَها، وهذا كلُّ ما وُعِد به.
 *
 * ## إضافةُ البند F2-09 (2026-09-14): عُمرٌ بالثواني بدلَ ختمٍ مطلقٍ
 *
 * كانَ الحقلُ `updatedAt: Date` — ختماً مطلقاً يُطرَحُ من ساعةِ **المتصفّحِ**
 * ليُقرأَ «منذُ كم». وساعةُ المتصفّحِ ليست ساعةَ القاعدةِ: جهازٌ متأخّرٌ دقيقتَينِ
 * كانَ يُري الغريبَ نقطةً «طازجةً» وهيَ متقادمةٌ، أو العكسَ. فصارَ العُمرُ
 * **مقيساً في القاعدةِ** ويُنقَلُ رقماً — والصفحةُ تعرضُه ولا تحسبُه.
 */
export interface TrackedPosition {
  readonly lat: number;
  readonly lng: number;
  /** عُمرُ النقطةِ بالثواني بحسابِ ساعةِ القاعدةِ. */
  readonly ageSeconds: number;
}

/**
 * قراءةُ الرمز: إمّا رمزٌ غيرُ صالح (لا وجود/مُلغى/منتهٍ — بلا تمييز)، أو صالحٌ
 * بلا موقعٍ **يجوزُ عرضُه**، أو صالحٌ بموقع. و`active` من حالة الطلب لا من
 * الانقضاء.
 *
 * ## إضافةُ البند F2-09 (2026-09-14): `awaiting` صارَ يحملُ **سببَه**
 *
 * كانَ «لا موقعَ» حالةً واحدةً صمّاءَ تجمعُ «لم يُبلِّغْ بعدُ» و«تقادمَ إشارتُه».
 * والفرقُ **يُغيّرُ سلوكَ الناظرِ**: الأولى تعني «انتظرْ»، والثانيةُ تعني
 * «اتّصلْ به، انقطعَت إشارتُه». وجمعُهما كانَ يُخفي انقطاعاً حقيقيّاً خلفَ
 * جملةٍ تفاؤليّةٍ.
 *
 * **والحكمُ يُقرأُ من القاعدةِ ولا يُعادُ حسابُه هنا**: `tracking_link_view` هيَ
 * القاضي الوحيدُ لعُمرِ النقطةِ — للمالكِ ولحاملِ الرابطِ سواءً (القاعدة 0.5).
 */
export type TrackingReadState =
  | { readonly kind: "invalid" }
  | {
      readonly kind: "awaiting";
      readonly active: boolean;
      readonly reason: "NEVER_REPORTED" | "NO_TIMESTAMP" | "TOO_OLD";
      /** `null` متى لا ختمَ أصلاً؛ ورقمٌ دائماً معَ `TOO_OLD`. */
      readonly ageSeconds: number | null;
    }
  | { readonly kind: "located"; readonly active: boolean; readonly position: TrackedPosition };

/** سببُ فشل الإصدار كما تُسمّيه القاعدة — يُترجَم للمستخدم في طبقة الحوار. */
export type IssueTokenRejection =
  | "UNAUTHORIZED"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_ACTIVE"
  | "TOKEN_COLLISION"
  | "TOKEN_TOO_SHORT";

export type IssueTokenOutcome =
  | { readonly ok: true; readonly row: IssuedTokenRow }
  | { readonly ok: false; readonly rejection: IssueTokenRejection };

export interface TrackingTokenRpcPort {
  /** يُصدر رمزاً لطلبٍ يملكه صاحبُ معرّف تلغرام المُمرَّر — ذرّياً في القاعدة. */
  issue(
    orderId: OrderId,
    telegramId: number,
    token: string,
  ): Promise<Result<IssueTokenOutcome, PortFailureError>>;

  /** يُلغي رمزاً بطلب مُصدِره. `false` تعني «غير قابلٍ للإلغاء» بلا تمييز سبب. */
  revoke(token: string, telegramId: number): Promise<Result<boolean, PortFailureError>>;

  /**
   * يُلغي كلّ روابط طلبٍ سارية بمعرّف الطلب لا بالرمز — يُعيد عددَ ما أُلغي.
   * والراكب لا يحمل الرمز أبداً: زرُّ الإلغاء بيانُه معرّفُ الطلب، فلا يُكتب الرمز
   * في تحديثٍ يبقى في تاريخ المحادثة.
   */
  revokeForOrder(orderId: OrderId, telegramId: number): Promise<Result<number, PortFailureError>>;

  /** يقرأ حالةَ الرمز وموقعَه — يُنادى من مسارٍ عامّ بلا مصادقة. */
  read(token: string): Promise<Result<TrackingReadState, PortFailureError>>;

  /** يسحب انقضاءَ رموزِ الرحلات المنتهية في مدينة. يُعيد عدد ما سُحِب. */
  expireEnded(cityId: CityId, limit: number): Promise<Result<number, PortFailureError>>;
}

/**
 * مُولّدُ الرمز منفذٌ لا نداءٌ مباشر لـ`node:crypto` هنا: الاختبارُ يحتاج رمزاً
 * معلوماً ليتأكّد أنّ ما وصل القاعدة هو ما وُلِّد، والتنفيذُ الحقيقيّ الوحيد
 * (`crypto.randomBytes(32)`) في `infrastructure` — فلا تحمل طبقةُ التطبيق أثراً
 * لبيئة التشغيل.
 */
export interface TrackingTokenMintPort {
  mint(): string;
}
