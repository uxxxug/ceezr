/**
 * الغرض: **وصلُ مسارِ الإقلاعِ كاملاً** — من فتحِ التطبيقِ إلى جلسةٍ صالحةٍ في
 *   الذاكرة: تجديدٌ من التخزينِ الآمنِ إن أمكن، وإلّا مبادلةُ `initData` الخامِ
 *   بجلسةٍ عبرَ `POST /v1/session/telegram` (القسم 9.8 · ADR 0035: بوت ← تطبيق
 *   مصغَّر ← تحقّق ← جلسة ← API).
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/identity (حزمة `identity` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` عندَ الإقلاعِ، و`RoleRouter` عندَ
 *   ردِّ `401` لإعادةِ المصادقةِ بلا فقدانِ مسارِ العمل (`SS-05`).
 * ملاحظات مستقبلية: **ربطُ المستخدمِ أو إنشاؤه عندَ أوّلِ جلسةٍ** (القسم 9.8
 *   الخطوة 4) غيرُ منفَّذٍ على الخادمِ ولا يُنفَّذ ههنا: العميلُ لا يخلق حالةَ عملٍ
 *   (ADR 0035). فمستخدمٌ لا صفَّ له يبقى `unregistered` في `/v1/me` وهذا صحيحٌ لا
 *   عطل. وإعادةُ المحاولةِ التلقائيةُ داخلَ `apiFetch` بعدَ `401` ما زالت خارجَ
 *   حدِّ النقلِ عن قصد (`F1-04`): الفعلُ ههنا صريحٌ يناديه المنادي.
 *
 * ما لا يفعله هذا الملفُّ عن قصد:
 *   ــ لا يقرأ دوراً ولا يكتبه: الدورُ من `GET /v1/me` وحدَه (`F1-05`).
 *   ــ لا يسجّل `initData` ولا رمزاً ولا جزءاً منهما، ولا في رسالةِ خطأ.
 *   ــ لا يمسّ `SecureStorage` مباشرةً: عبرَ `session-storage.ts` وحدَه (`F1-04`).
 *   ــ لا يعيد المحاولةَ تلقائياً ولا يستقصي دوريّاً (ADR 0035 §4): يُنادى مرّةً
 *      عندَ الإقلاعِ، ومرّةً حين يطلب المستخدمُ إعادةَ المصادقة.
 */

import { ApiError, ApiNetworkError, apiFetch } from "../api/client.ts";
import { getRawInitData, isInsideTelegram } from "../tg/index.ts";
import { renewSessionFromStorage } from "./renew.ts";
import { hasValidSession, setSession } from "./session.ts";
import { type DeviceSecureStore, persistRefreshToken } from "./session-storage.ts";

/** ردُّ مبادلةِ الجلسةِ كما يعلنه المسارُ — رمزُ التجديدِ اختياريٌّ في العقد. */
interface ExchangeResponse {
  readonly ok: true;
  readonly accessToken: string;
  readonly expiresAtMs: number;
  readonly refreshToken?: string;
}

export type BootFailureReason =
  /** المضيفُ ليس تيليجرام — لا مصادقةَ بديلةَ اليومَ (ARCH-014). */
  | "OUTSIDE_TELEGRAM"
  /** داخلَ تيليجرامَ ولا بيانَ فتحٍ: لا شيءَ يُبادَل به. */
  | "MISSING_INIT_DATA"
  /** الخادمُ لم يقبل إثباتَ الهويةِ (`401`) — إعادةُ فتحٍ من البوتِ هي العلاج. */
  | "REJECTED"
  /** لم يصل ردٌّ، أو تعطّلت الخدمةُ: يُصنَّف لاحقاً بـ`classifyFailure`. */
  | "UNAVAILABLE";

export type BootResult =
  | { readonly established: true; readonly via: "existing" | "renewed" | "exchanged" }
  | {
      readonly established: false;
      readonly reason: BootFailureReason;
      /** ما رماه الحدُّ — يُمرَّر ليُصنَّف شاشةً، ولا يُصنَّف ههنا. */
      readonly thrown?: unknown;
    };

/**
 * تُحقَن كي يُختبَر ترتيبُ المحاولاتِ بلا شبكةٍ ولا تيليجرام. والحقنُ ههنا
 * ضرورةُ اختبارٍ لا مرونةُ تصميمٍ: للإنتاجِ مسارٌ واحدٌ لا يُبدَّل.
 */
export interface BootDeps {
  readonly insideTelegram?: () => boolean;
  readonly rawInitData?: () => string | null;
  readonly renew?: (store?: DeviceSecureStore) => ReturnType<typeof renewSessionFromStorage>;
  readonly exchange?: (initData: string) => Promise<ExchangeResponse>;
  readonly persist?: typeof persistRefreshToken;
  readonly sessionValid?: () => boolean;
}

const defaultExchange = (initData: string): Promise<ExchangeResponse> =>
  apiFetch<ExchangeResponse>("/v1/session/telegram", {
    method: "POST",
    body: { initData },
    // مسارٌ عامٌّ: إثباتُ الهويةِ فيه `initData` الموقَّعُ لا رمزُ وصول.
    public: true,
  });

/**
 * ترتيبُ المحاولاتِ مقصودٌ: **الأرخصُ فالأغلى**.
 *   1. جلسةٌ صالحةٌ في الذاكرة — لا نداءَ إطلاقاً.
 *   2. تجديدٌ من رمزٍ محفوظ — نداءٌ واحدٌ بلا اعتمادٍ على تيليجرام، ويعمل حين
 *      يُعاد فتحُ التطبيقِ وقد ماتت الذاكرة.
 *   3. مبادلةُ `initData` — الطريقُ الوحيدُ حين لا رمزَ محفوظاً أو رُفِض.
 * وهو أيضاً ترتيبُ الاحتمالِ: أكثرُ الإقلاعاتِ يجدها في الأولى أو الثانية.
 */
export async function establishSession(deps: BootDeps = {}): Promise<BootResult> {
  const sessionValid = deps.sessionValid ?? hasValidSession;
  if (sessionValid()) return { established: true, via: "existing" };

  const renew = deps.renew ?? renewSessionFromStorage;
  const renewal = await renew();
  if (renewal.renewed) return { established: true, via: "renewed" };
  // تعطّلُ الشبكةِ في التجديدِ لا يُتبَع بمبادلةٍ: الرمزُ المحفوظُ قد يكون صالحاً،
  // ومبادلةٌ الآنَ تُصدِر جلسةً ثانيةً بلا حاجة. الشاشةُ تعرض تعطّلاً والفعلُ للمستخدم.
  if (renewal.reason === "UNAVAILABLE") {
    return { established: false, reason: "UNAVAILABLE" };
  }

  const inside = (deps.insideTelegram ?? isInsideTelegram)();
  if (!inside) return { established: false, reason: "OUTSIDE_TELEGRAM" };

  const initData = (deps.rawInitData ?? getRawInitData)();
  if (initData === null || initData.length === 0) {
    return { established: false, reason: "MISSING_INIT_DATA" };
  }

  let response: ExchangeResponse;
  try {
    response = await (deps.exchange ?? defaultExchange)(initData);
  } catch (thrown) {
    return { established: false, reason: exchangeFailureReason(thrown), thrown };
  }

  setSession({ accessToken: response.accessToken, expiresAt: response.expiresAtMs });
  // ردٌّ بلا رمزِ تجديدٍ ردٌّ صحيحٌ في العقد: الجلسةُ تعيش في الذاكرةِ حتى
  // تنتهي، ولا يُختلَق رمزٌ ولا يُعَدُّ ذلك فشلاً.
  if (typeof response.refreshToken === "string" && response.refreshToken.length > 0) {
    await (deps.persist ?? persistRefreshToken)(response.refreshToken);
  }
  return { established: true, via: "exchanged" };
}

/** فئاتُ رموزِ الحالة: بروتوكولٌ لا سياسة. */
const UNAUTHORIZED_STATUS = 401;
const STATUS_CLASS_DIVISOR = 100;
const CLIENT_ERROR_CLASS = 4;

function exchangeFailureReason(thrown: unknown): BootFailureReason {
  if (thrown instanceof ApiNetworkError) return "UNAVAILABLE";
  if (thrown instanceof ApiError) {
    if (thrown.status === UNAUTHORIZED_STATUS) return "REJECTED";
    // `400 INIT_DATA_MALFORMED` وأخواتُه: بيانُ الفتحِ نفسُه لا يصلح، وإعادةُ
    // المحاولةِ بالبيانِ ذاتِه لن تنجح. فيُقال «أعد فتحَ التطبيقِ من البوت».
    if (Math.floor(thrown.status / STATUS_CLASS_DIVISOR) === CLIENT_ERROR_CLASS) {
      return "MISSING_INIT_DATA";
    }
    return "UNAVAILABLE";
  }
  return "UNAVAILABLE";
}
