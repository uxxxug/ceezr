/**
 * الغرض: قراءةُ دورِ المستخدمِ وحالتِه **من الخادمِ وحدَه** عبرَ `GET /v1/me`
 *   (القسم 10)، وهي المصدرُ الوحيدُ للدورِ في التطبيقِ المصغَّرِ في البند `F1-05`.
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: apps/miniapp/src/identity (حزمة `identity` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `routing/role-route.ts` و`shell/Shell.tsx`، وكلُّ سطحٍ
 *   يحتاج معرفةَ الدورِ في `F2`/`F3`.
 * ملاحظات مستقبلية: بقيةُ «الملف» (الاسمُ واللغةُ والمدينة) ليست في هذا الردِّ
 *   بقرارِ مالكِ المنتجِ في `F1-05`: «الدورُ والحالةُ فقط». وتوسيعُه يحتاج شاشةً
 *   تستهلكه لا حقلاً يُضاف احتياطاً.
 *
 * ما لا يفعله هذا الملفُّ عن قصد:
 *   ــ لا يستنتج دوراً ولا يفترض دوراً افتراضياً: قيمةٌ لا يعرفها = `unavailable`.
 *      فترقيةُ دورٍ بالسهوِ أخطرُ من شاشةِ خطأٍ صريحة.
 *   ــ لا يخزّن الدورَ في `SecureStorage` ولا `localStorage` ولا في حاملِ الجلسة:
 *      يُقرأ عندَ الإقلاعِ وبعدَ التجديدِ، ولا يُكتَب مكاناً (`F1-04` · `F1-05`).
 *   ــ لا يقرأ الدورَ من تيليجرامَ ولا من `initData`: ذاك مدخلُ عميلٍ لا تفويض.
 *   ــ لا يقرّر صلاحيةً: يترجم ردَّ الخادمِ إلى حالةٍ صريحةٍ ويسلّمها للموجّه.
 */

import {
  isMiniAppLanguage,
  type MiniAppLanguage,
} from "../../../../packages/shared/i18n/miniapp/index.ts";
import { ApiError, apiFetch } from "../api/client.ts";
import { consumePrebootViewer } from "./preboot.ts";
import { getSession } from "./session.ts";
import { failureFromThrown, type RequestFailure } from "../system/failure.ts";

/** الأدوارُ كما يعيدها الخادمُ من `users.role` — لا قائمةٌ يخترعها العميل. */
export const SERVER_ROLES = ["rider", "driver", "support", "admin"] as const;

export type ServerRole = (typeof SERVER_ROLES)[number];

/** `unknown` = لا صفَّ لهذا المستخدمِ في القاعدة، لا «دورٌ رابع». */
export type ViewerRole = ServerRole | "unknown";

export type ViewerStatus = "active" | "unregistered";

export type ViewerView =
  | {
      readonly kind: "viewer";
      readonly role: ViewerRole;
      readonly status: ViewerStatus;
      readonly languageCode: MiniAppLanguage;
    }
  /** حسابٌ محجوبٌ — قرارُ تفويضٍ من الخادمِ (`403`) لا استنتاجٌ محلي. */
  | { readonly kind: "blocked" }
  /** انتهى رمزُ الوصولِ: علاجُه تجديدٌ (`F1-04`) ثم إعادةُ قراءةٍ. */
  | { readonly kind: "session_expired" }
  /** لا جلسةَ أو رُفضت: علاجُه تحقّقٌ جديدٌ من تيليجرام (`F1-03`). */
  | { readonly kind: "session_invalid" }
  /**
   * تعطيلٌ معلَنٌ أو ردٌّ لا يُفهَم — ولا سطحَ يُفتَح على شكٍّ.
   *
   * `F1-07`: `failure` **حقلٌ اختياريٌّ مضاف** يحمل صنفَ الفشلِ كما رآه حدُّ API
   * (ردٌّ وصل بحالةٍ ما، أو لم يصل ردٌّ). ولولاه لصار على الشاشةِ أن تخمّن:
   * «تعذّر تحديدُ دورِك» جملةٌ واحدةٌ لانقطاعِ شبكةٍ ولصيانةٍ معلَنةٍ ولردٍّ مشوَّه،
   * والقسم 9.7 يوجب التمييزَ بينها. **ولا يُصنَّف ههنا**: يُمرَّر خاماً إلى
   * `system/failure.ts` فيبقى للتصنيفِ موضعٌ واحد.
   */
  | { readonly kind: "unavailable"; readonly failure?: RequestFailure };

interface MePayload {
  readonly role?: unknown;
  readonly status?: unknown;
  readonly languageCode?: unknown;
}

function readLanguage(value: unknown): MiniAppLanguage | null {
  return typeof value === "string" && isMiniAppLanguage(value) ? value : null;
}

function readRole(value: unknown): ViewerRole | null {
  if (value === "unknown") return "unknown";
  return SERVER_ROLES.find((role) => role === value) ?? null;
}

function readStatus(value: unknown): ViewerStatus | null {
  if (value === "active" || value === "unregistered") return value;
  return null;
}

/**
 * ترجمةُ رمزِ الخطأِ الظاهرِ إلى حالةٍ للموجّه. الرموزُ من عقدِ المسارِ نفسِه،
 * وما سواها `unavailable`: العميلُ لا يخمّن معنىً لرمزٍ لا يعرفه.
 */
function viewFromErrorCode(code: string, failure: RequestFailure | null): ViewerView {
  if (code === "ACCOUNT_BLOCKED") return { kind: "blocked" };
  if (code === "SESSION_EXPIRED") return { kind: "session_expired" };
  if (code === "SESSION_REQUIRED" || code === "SESSION_INVALID") {
    return { kind: "session_invalid" };
  }
  return failure === null ? { kind: "unavailable" } : { kind: "unavailable", failure };
}

/**
 * ترجمةُ حمولةِ الخادمِ الخامِّ إلى `ViewerView`. مُستخرَجةٌ من `fetchViewer` كي
 * يُعادَ استخدامُها من المسارَين: الاستهلاكُ المُقدَّمُ والنداءُ المباشرُ.
 */
function viewFromPayload(payload: MePayload): ViewerView {
  const role = readRole(payload.role);
  const status = readStatus(payload.status);
  const languageCode = readLanguage(payload.languageCode);
  // ردٌّ ناقصٌ أو بقيمةٍ لا تُعرَف = `unavailable`، لا افتراضَ راكبٍ ولا مشرف.
  if (role === null || status === null || languageCode === null) return { kind: "unavailable" };
  return { kind: "viewer", role, status, languageCode };
}

export async function fetchViewer(): Promise<ViewerView> {
  // `F1-09` / `DEC-19`: إن قدّمَ السكربتُ الساكنُ قراءةَ الدورِ ورمزُ الوصولِ
  // نفسُه، استُهلِكَتْ. والاستهلاكُ لا يتجاوزُ `apiFetch` — إن غابَ أو خالفَ الرمزُ،
  // مضى في المسارِ التقليديِّ.
  const session = getSession();
  if (session !== null) {
    const preboot = consumePrebootViewer(session.accessToken);
    if (preboot !== null) {
      const payload = await preboot;
      // `null` = فشلَ التقديمُ (شبكةٌ أو ردٌّ غير ناجحٍ) — يُعاوَدُ عبرَ `apiFetch`.
      if (payload !== null) {
        return viewFromPayload(payload as MePayload);
      }
    }
  }

  let payload: MePayload;
  try {
    payload = await apiFetch<MePayload>("/v1/me");
  } catch (thrown) {
    const failure = failureFromThrown(thrown);
    if (thrown instanceof ApiError) return viewFromErrorCode(thrown.code, failure);
    return failure === null ? { kind: "unavailable" } : { kind: "unavailable", failure };
  }

  return viewFromPayload(payload);
}
