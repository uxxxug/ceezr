/**
 * الغرض: تصنيفُ فشلِ نداءٍ واحدٍ إلى **حالةِ نظامٍ واحدةٍ** من حالاتِ القسم 9.7
 *   (`SS-01` · `SS-02` · `SS-05`) — دالّةٌ نقيّةٌ لا تنادي شبكةً ولا تقرأ متصفّحاً.
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell` — «حدود الخطأ» في القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` و`routing/RoleRouter.tsx`، وكلُّ
 *   شاشةٍ تنادي واجهةَ المنتجِ في `F2`/`F3` — فالتصنيفُ واحدٌ لا يُكرَّر في شاشة.
 * ملاحظات مستقبلية: `SS-03` (إصدارٌ قديم) **غيرُ مصنَّفٍ ههنا بقرارِ مالكِ المنتجِ
 *   في `F1-07`**: لا هويةَ إصدارٍ للعميلِ ولا رمزَ توافقٍ في عقدِ القسم 10 ولا في
 *   البوابة، فتصنيفُ حالةٍ لا يبعثها خادمٌ فرعٌ ميتٌ يُقرأ لاحقاً تغطيةً وهو ليس
 *   تغطية. و`SS-04` (مدينةٌ غيرُ مدعومة) ليست فشلَ نداءٍ فليست ههنا.
 *
 * لماذا دالّةٌ نقيّةٌ لا شرطٌ داخلَ مكوّن؟ لأنّ «أيُّ فشلٍ يُعرَض بأيِّ شاشةٍ»
 * قاعدةٌ تُختبَر بلا DOM ولا شبكةٍ ولا متصفّح. ولأنّ الشرطَ الموزَّعَ على شاشاتٍ
 * يصير في كلِّ شاشةٍ تصنيفاً مختلفاً، فيرى المستخدمُ للسببِ الواحدِ رسالتين.
 */

import { ApiError, ApiNetworkError } from "../api/client.ts";

/** فئاتُ رموزِ الحالة: بروتوكولٌ لا سياسة. */
const STATUS_CLASS_DIVISOR = 100;
const SERVER_ERROR_CLASS = 5;
const UNAUTHORIZED_STATUS = 401;
const SERVICE_UNAVAILABLE_STATUS = 503;

/**
 * صنفُ الفشلِ كما يراه حدُّ API: ردٌّ وصل، أو لم يصل ردٌّ. ولا ثالثَ لهما.
 */
export type RequestFailure =
  /** لم يصل ردٌّ إطلاقاً — ولا يُزعَم سببٌ ههنا. */
  | { readonly transport: "failed" }
  | {
      readonly transport: "responded";
      readonly status: number;
      readonly code: string;
      readonly retryAfterSeconds: number | null;
    };

/**
 * نتيجةُ فحصِ الحياةِ `GET /health` — تُحقَن ولا تُقرأ ههنا.
 * `not_probed` = لم يُنادَ الفحصُ (بلا شبكةٍ في الجهازِ أصلاً، أو لم يُطلَب).
 */
export type ReachabilityProbe = "reachable" | "unreachable" | "not_probed";

/**
 * ما نعرفه عن سببِ انقطاعِ الاتصال — **معرفةٌ لا تخمين**. والقسم 9.7 يوجب
 * «تشخيصاً واضحاً: الشبكةُ أم خدمتُنا؟»، وأصدقُ تشخيصٍ أحياناً أن يُقال ما هو
 * معروفٌ وما ليس معروفاً.
 */
export type NoConnectionCause =
  /** الجهازُ يعلن أنه بلا شبكة — أوثقُ ما يمكن قولُه، ولا يحتاج فحصاً. */
  | "device_offline"
  /** شبكةُ الجهازِ تعمل ولم يصل ردٌّ من فحصِ الحياةِ أيضاً: خدمتُنا أو الطريقُ إليها. */
  | "service_unreachable"
  /** فحصُ الحياةِ وصل: الشبكةُ والخدمةُ قائمتان، وهذا النداءُ وحدَه أخفق. */
  | "service_fault"
  /** لم يُنادَ الفحصُ فلا تمييزَ — ولا يُخترَع سببٌ لأنّ الشاشةَ تحتاج جملة. */
  | "undetermined";

/**
 * حالاتُ النظامِ التي يقودها الخادمُ فعلاً اليوم. وكلُّ حالةٍ ههنا **لها مصدرُ
 * حقيقةٍ في ردٍّ حقيقيٍّ** — لا حالةَ أُضيفت لتكتمل قائمة.
 */
export type SystemState =
  /** `SS-01` — لا اتصال. */
  | { readonly kind: "no_connection"; readonly cause: NoConnectionCause }
  /** `SS-02` — صيانةٌ أو تعطّلٌ جزئيّ. */
  | { readonly kind: "service_unavailable"; readonly retryAfterSeconds: number | null }
  /** `SS-05` — انتهت الجلسةُ: علاجُها إعادةُ مصادقةٍ لا إعادةُ فتحٍ للتطبيق. */
  | { readonly kind: "session_expired" }
  /** لا جلسةَ أو رُفضت: علاجُها تحقّقٌ جديدٌ من تيليجرام. */
  | { readonly kind: "session_invalid" };

/**
 * ترجمةُ ما رماه حدُّ API إلى صنفِ فشلٍ. وما ليس من صنفَي الحدِّ يُعاد `null`:
 * خطأٌ مجهولُ المصدرِ **ليس انقطاعَ شبكةٍ** ولا تعطّلَ خدمةٍ، وعرضُه شاشةَ
 * انقطاعٍ كذبٌ مريح.
 */
export function failureFromThrown(thrown: unknown): RequestFailure | null {
  if (thrown instanceof ApiNetworkError) return { transport: "failed" };
  if (thrown instanceof ApiError) {
    return {
      transport: "responded",
      status: thrown.status,
      code: thrown.code,
      retryAfterSeconds: thrown.retryAfterSeconds,
    };
  }
  return null;
}

/**
 * هل يستحقُّ هذا الفشلُ نداءَ فحصِ الحياةِ؟ **مرّةً واحدةً عندَ الفشلِ وحدَه** —
 * لا استقصاءَ دوريّاً (ADR 0035 §4). ولا يُنادى إن كان الجهازُ يعلن أنه بلا
 * شبكة: الجوابُ معروفٌ سلفاً، ونداءٌ يُعلَم فشلُه تأخيرٌ بلا معرفة.
 */
export function shouldProbeReachability(failure: RequestFailure, deviceOnline: boolean): boolean {
  return failure.transport === "failed" && deviceOnline;
}

/**
 * قرارُ الشاشة. `null` = ليست حالةَ نظامٍ من الخمسِ، فالشاشةُ تعرض خطأً عامّاً
 * بزرِّ فعلٍ (UX-5) ولا تدّعي تشخيصاً لا تملكه.
 */
export function classifyFailure(
  failure: RequestFailure,
  probe: ReachabilityProbe = "not_probed",
  deviceOnline = true,
): SystemState | null {
  if (failure.transport === "failed") {
    return { kind: "no_connection", cause: causeOf(probe, deviceOnline) };
  }

  // انتهاءُ الجلسةِ يُعرَف بالرمزِ لا بالحالة: `401` تُقال لانتهاءٍ ولرفضٍ،
  // والعلاجُ يختلف — تجديدٌ صامتٌ في الأولى وتحقّقٌ جديدٌ في الثانية.
  if (failure.code === "SESSION_EXPIRED") return { kind: "session_expired" };
  if (failure.status === UNAUTHORIZED_STATUS) return { kind: "session_invalid" };

  if (failure.status === SERVICE_UNAVAILABLE_STATUS) {
    return { kind: "service_unavailable", retryAfterSeconds: failure.retryAfterSeconds };
  }
  if (Math.floor(failure.status / STATUS_CLASS_DIVISOR) === SERVER_ERROR_CLASS) {
    return { kind: "service_unavailable", retryAfterSeconds: failure.retryAfterSeconds };
  }

  // ٤xx غيرُ التفويضِ (طلبٌ سيّئٌ · محجوبٌ · غيرُ موجودٍ · تجاوزُ حدٍّ) ليست
  // حالةَ نظامٍ: قرارُ تفويضٍ أو خطأُ طالبٍ، ولكلٍّ موضعُه.
  return null;
}

function causeOf(probe: ReachabilityProbe, deviceOnline: boolean): NoConnectionCause {
  if (!deviceOnline) return "device_offline";
  if (probe === "unreachable") return "service_unreachable";
  if (probe === "reachable") return "service_fault";
  return "undetermined";
}
