/**
 * الغرض: حارس جلسة اللوحة: يقرأ الكعكة، ويُمدّد الجلسة ويتحقّق من بقاء الصفة
 *   إدارية في نفس النداء (touch_admin_session)، فمن نُزعت عنه الصفة أو حُظر
 *   يسقط في الطلب التالي مباشرة لا بعد ثماني ساعات.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: routes/admin-ui.ts، routes/admin-api.ts
 * ملاحظات مستقبلية: عند إضافة أدوار لوحة أدنى من «مسؤول» يصير الحارس مُعامَلاً
 *   بالصلاحية المطلوبة.
 */

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  type AdminAuthPort,
  classifyAuth,
  csrfTokenFor,
  type SessionIdentity,
  safeEqual,
  sha256Hex,
} from "./auth.ts";

export interface AdminVariables {
  readonly admin: SessionIdentity;
  readonly csrfToken: string;
  /**
   * nonce سياسة أمن المحتوى، يضعه وسيطُ الترويسات (المرحلة ١٠). مُعرَّف هنا لا في
   * وحدة الترويسات لأن `AdminEnv` هو عقدُ السياق الواحد لهذا الموجّه؛ وتعريفُ
   * بيئةٍ ثانية كان سيجعل الوسيط والحارس يعملان على سياقين لا يعرف أحدهما الآخر.
   */
  readonly cspNonce: string;
}

export type AdminEnv = { Variables: AdminVariables };

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const SEE_OTHER = 303;

export function isSecureRequest(c: Context): boolean {
  if (c.req.header("x-forwarded-proto") === "https") return true;
  return new URL(c.req.url).protocol === "https:";
}

export function writeSessionCookie(c: Context, token: string): void {
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: isSecureRequest(c),
    path: "/admin",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/admin" });
}

export function readSessionToken(c: Context): string | null {
  const raw = getCookie(c, ADMIN_SESSION_COOKIE);
  return raw === undefined || raw === "" ? null : raw;
}

/**
 * mode يحدّد شكل الرفض فقط: صفحة تُحوَّل إلى الدخول، وواجهة JSON تُجيب 401 —
 * أما التحقّق فواحد لا نسختان تفترقان يوماً.
 */
export function createAdminGuard(
  auth: AdminAuthPort,
  mode: "page" | "api",
  log: (message: string, meta: Record<string, unknown>) => void = () => undefined,
): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const reject = (): Response =>
      mode === "page"
        ? c.redirect("/admin/login", SEE_OTHER)
        : c.json({ ok: false, error: "UNAUTHORIZED" }, UNAUTHORIZED);

    const token = readSessionToken(c);
    if (token === null) return reject();

    const tokenHash = sha256Hex(token);
    const result = await auth.touchSession(tokenHash);
    const outcome = classifyAuth(result);
    if (outcome.kind !== "ok") {
      // بلا هذا التفريق يبدو انقطاع القاعدة مطابقاً تماماً لمن نُزعت عنه الصفة:
      // كلاهما تحويل صامت إلى صفحة الدخول.
      if (outcome.kind === "db") {
        log("admin.session_verify_db_error", { detail: outcome.reason, mode });
      } else {
        log("admin.session_rejected", { reason: outcome.reason, mode });
      }
      clearSessionCookie(c);
      return reject();
    }

    c.set("admin", outcome.value);
    c.set("csrfToken", csrfTokenFor(tokenHash));
    // تمديد صامت: الكعكة تُجدَّد مع كل طلب فلا تنتهي على مشغّل يعمل بلا توقّف
    writeSessionCookie(c, token);
    await next();
    return;
  };
}

/**
 * كل فعل كتابي يمرّ بهذا: نموذج على موقع آخر قد يُرسل إلى مسارنا ومعه كعكة
 * المتصفّح، لكنه لا يعرف رمزاً مشتقّاً من بصمة الجلسة.
 */
export async function requireCsrf(
  c: Context<AdminEnv>,
): Promise<{ ok: true; form: FormData } | { ok: false; response: Response }> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    // جسم خبيث أو Content-Type غير صالح لا ينبغي أن يتحول إلى 500 أو يتجاوز الحارس.
    return { ok: false, response: c.text("CSRF_MISMATCH", FORBIDDEN) };
  }
  const submitted = form.get("csrf");
  const expected = c.get("csrfToken");
  if (typeof submitted !== "string" || !safeEqual(submitted, expected)) {
    return { ok: false, response: c.text("CSRF_MISMATCH", FORBIDDEN) };
  }
  return { ok: true, form };
}

export function formText(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value !== "" ? value : null;
}
