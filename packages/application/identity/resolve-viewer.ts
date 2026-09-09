/**
 * الغرض: حالةُ استخدامِ `GET /v1/me` — تحديدُ دورِ صاحبِ الجلسةِ وحالتِه على
 *   الخادمِ وحدَه (القسم 10: «الملف والدور والحالة» · صنفُه «قراءة نشِطة»)، وهي
 *   شقُّ «تحديدِ الدور» من البند `F1-05`.
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: application/identity
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/me.ts`، وكلُّ مسارِ منتَجٍ
 *   يحتاج تفويضاً على مستوى الكائنِ لاحقاً (القسم 9.8).
 * ملاحظات مستقبلية: التفويضُ على مستوى الكائنِ («هل هذه الرحلةُ لهذا المستخدم؟»)
 *   ليس ههنا ولا يُدَّعى: هذه الحالةُ تُجيب «مَن هذا ودورُه» لا «أيَملِك هذا
 *   الكائنَ». وحدُّ المعدّلِ (القسم 10) بلا أرقامٍ في العقدِ فلا يُخترَع ههنا.
 *
 * لماذا القرارُ ههنا لا في المسار؟ لأنّ «الدورُ والحجبُ يحسمان السطحَ» قاعدةُ
 * عملٍ لا نقلٌ. فالمسارُ يترجم إلى HTTP فقط، وهذه الحالةُ تقرّر.
 *
 * وما لا تفعله عن قصد:
 *   ــ لا تقبل دوراً ولا حالةً من المدخلِ: مدخلُها رمزُ وصولٍ وحدَه.
 *   ــ لا تُنشئ ولا تعدّل صفّاً (ADR 0035): غيابُ الصفِّ يُعاد `unregistered`.
 *   ــ لا تُخرِج اسماً ولا هاتفاً ولا مدينةً ولا لغةً — قرارُ المالكِ: الدورُ
 *      والحالةُ فقط.
 *   ــ لا تكشف سببَ رفضِ الرمزِ الدقيقَ: تُخشِّنه إلى رموزٍ ظاهرةٍ أقلَّ دلالةً.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  MiniAppSessionReader,
  ViewerAccountReader,
  ViewerRole,
  ViewerSessionRejectionReason,
  ViewerStatus,
} from "./ports.ts";

export interface ResolveViewerDeps {
  readonly sessions: MiniAppSessionReader;
  readonly accounts: ViewerAccountReader;
  readonly now: () => Date;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface ResolveViewerInput {
  /** رمزُ الوصولِ كما استُخرِج من ترويسةِ التفويض — لا الترويسةُ نفسُها. */
  readonly accessToken: string | undefined;
}

/**
 * `unknown` ليست دوراً في القاعدة: هي غيابُ صفٍّ. وتُعاد صريحةً لا مطويّةً على
 * `rider` — فاستنتاجُ دورٍ لمن لا صفَّ له اختراعُ حالةِ أعمالٍ لا تحديدُ دور.
 */
export type ResolvedViewerRole = ViewerRole | "unknown";

export interface ResolveViewerOutput {
  readonly role: ResolvedViewerRole;
  readonly status: ViewerStatus;
}

/**
 * رموزٌ ظاهرةٌ حتميةٌ. و`SESSION_EXPIRED` منفصلٌ عن `SESSION_INVALID` عن قصدٍ
 * **لا تسريباً**: العميلُ يحتاج أن يعرف «جدِّد» من «أعِد التحقّق»، وانتهاءُ رمزٍ
 * أصدرناه بانتهاءٍ معلَنٍ سلفاً في جسمِ ردِّ `F1-03`/`F1-04` ليس سرّاً يُكشَف.
 * أمّا **موضعُ** الخللِ في رمزٍ مرفوضٍ (شكلٌ؟ توقيعٌ؟ إصدارٌ؟) فمطويٌّ كلُّه في
 * `SESSION_INVALID` كي لا يصير الردُّ عرّافاً.
 */
export type ViewerPublicErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "ACCOUNT_BLOCKED"
  | "PROFILE_NOT_AVAILABLE";

export interface ResolveViewerError {
  readonly code: "VIEWER_NOT_RESOLVED";
  readonly publicCode: ViewerPublicErrorCode;
}

function fail(publicCode: ViewerPublicErrorCode): ResolveViewerError {
  return { code: "VIEWER_NOT_RESOLVED", publicCode };
}

/** خشونةُ الترجمة: خمسةُ أسبابٍ داخليةٍ في ثلاثةِ رموزَ ظاهرة. */
export function publicViewerCodeFor(reason: ViewerSessionRejectionReason): ViewerPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

/**
 * ما تُخرِجُه المصادقةُ الكاملةُ: هويّةُ الجلسةِ **مع** الدورِ والحالةِ. وهيَ
 * أوسعُ ممّا يُعيدُه `GET /v1/me` عمداً — المسارُ يُضيّقُ ما يُظهِرُه، والحالاتُ
 * التي تقرأُ بيانات المستخدمِ (مركزُ الإشعاراتِ `SS-07` مثلاً) تحتاجُ **مَن هوَ**
 * لا دورَه وحدَه.
 *
 * ولماذا موضعٌ واحدٌ؟ لأنَّ ثانيَ موضعٍ للمصادقةِ هوَ أوّلُ موضعٍ يتخلّفُ عن
 * الأوّلِ: يُضافُ فحصُ حجبٍ ههنا ويُنسى هناك، فيصيرُ لمحجوبٍ سطحٌ مفتوحٌ في
 * مسارٍ واحدٍ دونَ سائرِها — وهوَ عطلٌ لا يظهرُ إلّا بمن يبحثُ عنه.
 */
export interface AuthorizedViewer {
  readonly telegramUserId: string;
  readonly sessionId: string;
  readonly role: ResolvedViewerRole;
  readonly status: ViewerStatus;
}

/**
 * المصادقةُ الواحدةُ: تحقّقُ التوقيعِ ثمّ قراءةُ الحسابِ ثمّ فحصُ الحجبِ — بهذا
 * الترتيبِ بالذات. ولا تُقرأُ القاعدةُ لرمزٍ لم يُثبَت توقيعُه، وإلّا صارَ المسارُ
 * مِرقاباً يُستنزَف بأيِّ نصٍّ عشوائي.
 */
export async function authorizeViewer(
  input: ResolveViewerInput,
  deps: ResolveViewerDeps,
): Promise<Result<AuthorizedViewer, ResolveViewerError>> {
  const accessToken = input.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return err(fail("SESSION_REQUIRED"));
  }

  // التحقّقُ أوّلاً: لا تُقرأ القاعدةُ لرمزٍ لم يُثبَت توقيعُه — وإلا صار المسارُ
  // مِرقاباً يُستنزَف به الاستعلامُ بأيِّ نصٍّ عشوائي.
  const session = deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) {
    const publicCode = publicViewerCodeFor(session.error.reason);
    // السجلُّ يحمل السببَ المصنَّفَ ولا يحمل رمزاً ولا جزءاً منه (`F1-03`).
    deps.log?.("رُفض رمزُ الوصولِ في قراءةِ الدور", {
      reason: session.error.reason,
      publicCode,
    });
    return err(fail(publicCode));
  }

  const account = await deps.accounts.findByTelegramUserId(session.value.telegramUserId);
  if (!account.ok) {
    deps.log?.("تعذّرت قراءةُ حسابِ صاحبِ الجلسة", {
      reason: account.error.reason,
      sessionId: session.value.sessionId,
    });
    return err(fail("PROFILE_NOT_AVAILABLE"));
  }

  // لا صفَّ = «غير مسجَّل»، بلا كتابةٍ وبلا افتراضِ دور. والربطُ/الإنشاءُ
  // (القسم 9.8 خطوة 4) بندٌ لاحقٌ بقرارِ المالكِ لا صمتٌ عن نقص.
  if (account.value === null) {
    return ok({
      telegramUserId: session.value.telegramUserId,
      sessionId: session.value.sessionId,
      role: "unknown",
      status: "unregistered",
    });
  }

  // الحجبُ قرارُ تفويضٍ على الخادمِ: يُفحَص في **كلِّ** طلبٍ لا مرّةً عندَ
  // إنشاءِ الجلسة — فرمزُ وصولٍ صالحٌ لمحجوبٍ لا يفتح سطحاً. وحدُّ التصميمِ
  // بلا حالةٍ باقٍ: الحجبُ يُنفَذ عندَ أوّلِ طلبٍ تالٍ لا لحظةَ الحجب.
  if (account.value.isBlocked) {
    deps.log?.("حسابٌ محجوبٌ طلب دورَه", { sessionId: session.value.sessionId });
    return err(fail("ACCOUNT_BLOCKED"));
  }

  return ok({
    telegramUserId: session.value.telegramUserId,
    sessionId: session.value.sessionId,
    role: account.value.role,
    status: "active",
  });
}

/**
 * `GET /v1/me` — غلافٌ **ضيِّقٌ** على المصادقةِ الواحدةِ: يُسقِطُ معرّفَ تيليجرام
 * ومعرّفَ الجلسةِ فلا يخرجانِ إلى العميلِ. والتضييقُ ههنا لا في المصادقةِ، لأنَّ
 * إخفاءَ الحقلِ عن **كلِّ** المستهلكينَ كانَ سيدفعُ مَن يحتاجُه إلى مصادقةٍ ثانيةٍ
 * يكتبُها بنفسِه — وذلكَ عينُ ما تمنعُه هذه البنية.
 */
export async function resolveViewer(
  input: ResolveViewerInput,
  deps: ResolveViewerDeps,
): Promise<Result<ResolveViewerOutput, ResolveViewerError>> {
  const authorized = await authorizeViewer(input, deps);
  if (!authorized.ok) return err(authorized.error);
  return ok({ role: authorized.value.role, status: authorized.value.status });
}
