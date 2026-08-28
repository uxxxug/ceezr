/**
 * الغرض: مسارُ `GET /v1/me` — يعيد **دورَ** صاحبِ الجلسةِ و**حالتَه** كما
 *   يقرأهما الخادمُ (القسم 10: «الملف والدور والحالة» · صنفُه «قراءة نشِطة»)،
 *   وهو حدُّ الـAPI الذي يبني عليه التطبيقُ المصغَّرُ توجيهَه في البند `F1-05`.
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبر تركيبٍ اختياري.
 * ملاحظات مستقبلية: `request-id` في كلِّ ردٍّ (القسم 10) بندُ `F1-08`، وحدُّ
 *   المعدّلِ لكلِّ مستخدمٍ ومسارٍ بلا أرقامٍ في العقدِ فلا يُخترَع ههنا؛ وكلاهما
 *   مذكورٌ حدّاً في دليلِ البندِ لا مسكوتٌ عنه.
 *
 * ما لا يفعله هذا المسارُ عن قصد:
 *   ــ **لا يقرأ دوراً من الطلبِ**: لا من جسمٍ ولا `query` ولا ترويسةٍ. الدورُ
 *      يُقرأ من `users` بمعرّفِ تيليجرام المستخرَجِ من رمزٍ **موقَّعٍ منّا**،
 *      ورمزُ الجلسةِ لا يحمل دوراً في حِمْلِه أصلاً (`F1-03`).
 *   ــ لا يقرّر التفويضَ ههنا: القرارُ في حالةِ الاستخدام، وهذا يترجم إلى HTTP.
 *   ــ لا يُنشئ ولا يعدّل صفّاً (ADR 0035): المحوّلُ `select` وحدَه.
 *   ــ لا يُسجِّل رمزاً ولا جزءاً منه، ولا يُعيده في الردِّ ولا في الخطأ.
 *   ــ لا يقرأ جسمَ الطلبِ إطلاقاً: قراءةٌ بلا جسمٍ فلا حدَّ حجمٍ يُحتاج.
 */

import { type Context, Hono } from "hono";
import {
  type ResolveViewerDeps,
  resolveViewer,
  type ViewerPublicErrorCode,
} from "../../../../packages/application/identity/resolve-viewer.ts";

export interface MeDependencies {
  /**
   * تبعياتُ حالةِ الاستخدام — غيابُها **يعطّل المسارَ بـ503** ولا يجعله يجيب بلا
   * تحقّق (سابقةُ مسارَي `F1-03` و`F1-04`: غيابُ السرِّ تعطيلٌ لا تسامح).
   */
  readonly viewer?: ResolveViewerDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

const UNAUTHENTICATED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const UNAVAILABLE_STATUS = 503;

type ErrorStatus =
  | typeof UNAUTHENTICATED_STATUS
  | typeof FORBIDDEN_STATUS
  | typeof UNAVAILABLE_STATUS;

/**
 * ترجمةٌ حتميةٌ واحدةٌ من الرمزِ الظاهرِ إلى حالةِ HTTP: جدولٌ واحدٌ لا شروطٌ
 * مبثوثةٌ في المسار، فلا يختلف رمزٌ عن حالتِه بين فرعٍ وفرع.
 */
const ERROR_STATUS: Readonly<Record<ViewerPublicErrorCode, ErrorStatus>> = {
  SESSION_REQUIRED: UNAUTHENTICATED_STATUS,
  SESSION_INVALID: UNAUTHENTICATED_STATUS,
  SESSION_EXPIRED: UNAUTHENTICATED_STATUS,
  SESSION_NOT_AVAILABLE: UNAVAILABLE_STATUS,
  ACCOUNT_BLOCKED: FORBIDDEN_STATUS,
  PROFILE_NOT_AVAILABLE: UNAVAILABLE_STATUS,
};

function rejected(c: Context, error: ViewerPublicErrorCode) {
  return c.json({ ok: false, error }, ERROR_STATUS[error]);
}

/**
 * استخراجُ الرمزِ من ترويسةِ التفويض. النمطُ `Bearer <token>` وحدَه: لا `Basic`
 * ولا رمزٌ عارٍ بلا نمطٍ ولا رمزٌ في `query`. و`undefined` تعني «لا رمزَ» فتُقرأ
 * `SESSION_REQUIRED` لا `SESSION_INVALID` — فالفرقُ بين «لم تُصادِق» و«صادقتَ
 * بما لا يُقبَل» فرقٌ يحتاجه العميلُ ولا يُفيد مهاجماً.
 */
export function bearerTokenFrom(header: string | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer[ ]+(?<token>[^ ]+)$/.exec(header.trim());
  const token = match?.groups?.token;
  return token === undefined || token.length === 0 ? undefined : token;
}

export function createMeRoutes(deps: MeDependencies): Hono {
  const app = new Hono();

  app.get("/v1/me", async (c) => {
    if (deps.viewer === undefined) {
      deps.log?.("مسار قراءة الدور معطّل لغياب تبعياته", {});
      return rejected(c, "SESSION_NOT_AVAILABLE");
    }

    const accessToken = bearerTokenFrom(c.req.header("authorization"));
    const result = await resolveViewer({ accessToken }, deps.viewer);
    if (!result.ok) return rejected(c, result.error.publicCode);

    // الردُّ: دورٌ وحالةٌ فقط — قرارُ المالكِ في `F1-05`. لا اسمَ ولا هاتفَ ولا
    // مدينةَ ولا لغةَ ولا معرّفَ جلسةٍ ولا معرّفَ تيليجرام.
    return c.json({ ok: true, role: result.value.role, status: result.value.status });
  });

  return app;
}
