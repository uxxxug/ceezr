/**
 * الغرض: تجديدُ الجلسةِ من جانبِ العميل (`F1-04`) — يقرأ رمزَ التجديدِ من التخزينِ
 *   الآمن، ينادي `POST /v1/session/refresh`، ثم يضع الرمزَ الجديدَ في الذاكرةِ
 *   ورمزَ التجديدِ الجديدَ في التخزينِ الآمنِ وحدَه.
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: شاشاتُ `F1-05` عندَ الإقلاعِ وعندَ ردِّ `401`.
 * ملاحظات مستقبلية: **الوصلُ التلقائيُّ داخلَ `apiFetch`** (إعادةُ المحاولةِ بعدَ
 *   `401`) ليس ههنا عن قصد: ذاك سلوكُ حدِّ API وموضعُه `F1-05` وما بعده. ما ههنا
 *   دالّةٌ صريحةٌ يناديها النداءُ حين يقرّر، فلا تُخفى إعادةُ محاولةٍ في طبقةِ نقل.
 *
 * ولا يُسجَّل رمزٌ ولا جزءٌ منه في هذا الملفِّ ولا في رسائلِ أخطائِه.
 */

import { ApiError, type ApiObserver, apiFetch } from "../api/client.ts";
import { setSession } from "./session.ts";
import {
  type DeviceSecureStore,
  forgetRefreshToken,
  loadRefreshToken,
  persistRefreshToken,
  telegramSecureStore,
} from "./session-storage.ts";

/** ردُّ مسارِ التجديدِ كما يعلنه الخادم — لا يُقرأ منه غيرُ هذه الحقول. */
interface RefreshResponse {
  readonly ok: true;
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresAtMs: number;
  readonly expiresInSeconds: number;
  readonly refreshToken: string;
  readonly refreshExpiresAtMs: number;
  readonly refreshExpiresInSeconds: number;
  readonly absoluteExpiresAtMs: number;
}

/** فئةُ رموزِ الحالة: بروتوكولٌ لا سياسة. */
const STATUS_CLASS_DIVISOR = 100;
const CLIENT_ERROR_CLASS = 4;
const ROUTE_ABSENT_STATUS = 404;

export type RenewFailureReason =
  /** لا رمزَ تجديدٍ على الجهاز — أو لا تخزينَ آمنَ فيه أصلاً. */
  | "NO_STORED_TOKEN"
  /**
   * الخادمُ لم يقبل الرمزَ: انتهى، أو بلغت الجلسةُ سقفَها المطلق، أو لم يُقبَل
   * تفويضُه. والعلاجُ واحدٌ في الحالاتِ كلِّها: **جلسةٌ جديدةٌ بتحقّقٍ جديدٍ من
   * تيليجرام**، ولذلك يُمسَح ما على الجهازِ ههنا.
   */
  | "REJECTED"
  /** لم يصل ردٌّ (شبكةٌ أو خادمٌ معطَّل) — الرمزُ المحفوظُ يبقى كما هو. */
  | "UNAVAILABLE";

export type RenewSessionResult =
  | {
      readonly renewed: true;
      readonly expiresAtMs: number;
      readonly absoluteExpiresAtMs: number;
      /** هل حُفِظ رمزُ التجديدِ الجديدُ على الجهاز؟ `false` = الجلسةُ في الذاكرةِ وحدَها. */
      readonly persisted: boolean;
    }
  | { readonly renewed: false; readonly reason: RenewFailureReason };

/**
 * يجدّد الجلسةَ إن كان على الجهازِ رمزُ تجديدٍ. لا يفترض أنّ في الذاكرةِ جلسةً:
 * الحالةُ الشائعةُ هي إقلاعُ التطبيقِ من جديدٍ والذاكرةُ فارغة.
 */
export async function renewSessionFromStorage(
  store: DeviceSecureStore = telegramSecureStore,
  /**
   * `F1-08`: مُراقِبٌ اختياريٌّ يُمرَّر إلى حدِّ API، فيصير لحدثِ التجديدِ معرّفُ
   * الطلبِ نفسُه الذي يراه الخادمُ. وغيابُه لا يغيّر شيئاً من السلوك.
   */
  observe?: ApiObserver,
): Promise<RenewSessionResult> {
  const stored = await loadRefreshToken(store);
  if (stored === null) return { renewed: false, reason: "NO_STORED_TOKEN" };

  let response: RefreshResponse;
  try {
    response = await apiFetch<RefreshResponse>("/v1/session/refresh", {
      method: "POST",
      body: { refreshToken: stored },
      // مسارٌ عامٌّ: التفويضُ فيه رمزُ التجديدِ نفسُه لا رمزُ وصولٍ صالح.
      public: true,
      ...(observe === undefined ? {} : { observe }),
    });
  } catch (thrown) {
    // خطأُ طالبٍ (فئةُ ٤xx) = الخادمُ حكم على الرمزِ فلم يقبله، فيُمسَح كي
    // لا يُعاد استعمالُ ما لا يعمل. ويُستثنى `404`: مسارٌ غيرُ مركَّبٍ
    // على هذا الخادمِ حكمٌ على الخادمِ لا على الرمز، فلا يُمحى به رمزٌ قد
    // يكون صالحاً. (والفئةُ تُحسَب قسمةً لا مقارنةً برقمٍ حرفيٍ ثلاثي.)
    const clientError =
      thrown instanceof ApiError &&
      thrown.status !== ROUTE_ABSENT_STATUS &&
      Math.floor(thrown.status / STATUS_CLASS_DIVISOR) === CLIENT_ERROR_CLASS;
    if (clientError) {
      await forgetRefreshToken(store);
      setSession(null);
      return { renewed: false, reason: "REJECTED" };
    }
    return { renewed: false, reason: "UNAVAILABLE" };
  }

  // الدورُ لا يأتي من هذا المسارِ ولا يُحمَل في الحاملِ إطلاقاً (`F1-05`):
  // مصدرُه `GET /v1/me` عندَ الإقلاعِ وبعدَ كلِّ تجديد. ورمزُ التجديدِ لا يُوضَع
  // في الحاملِ أيضاً: موضعُه التخزينُ الآمنُ وحدَه (`F1-04`).
  setSession({
    accessToken: response.accessToken,
    expiresAt: response.expiresAtMs,
  });

  const persisted = await persistRefreshToken(response.refreshToken, store);
  return {
    renewed: true,
    expiresAtMs: response.expiresAtMs,
    absoluteExpiresAtMs: response.absoluteExpiresAtMs,
    persisted: persisted.stored,
  };
}
