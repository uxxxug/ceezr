/**
 * الغرض: مسارُ `POST /v1/session/refresh` — تجديدُ جلسةِ التطبيقِ المصغَّرِ برمزِ
 *   تجديدٍ موقَّعٍ من الخادمِ نفسِه، بلا لمسِ تيليجرامَ إطلاقاً (القسم 10: «تجديدُ
 *   الجلسة»، صنفُه «أمر»).
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبر تركيبٍ اختياري.
 * ملاحظات مستقبلية: حدُّ المعدّلِ لكلِّ عنوانٍ ومستخدمٍ على هذا المسارِ يتبع سياسةَ
 *   القسم 10 عندَ بناءِ حدِّ API، ولا يُدَّعى تنفيذُه ههنا.
 *
 * ما لا يفعله هذا المسارُ عن قصد:
 *   ــ لا يقرأ من الجسمِ حقلاً غيرَ `refreshToken`: لا `telegram_id` ولا `role`
 *      ولا `initData`. وما أرسله العميلُ عنها يُهمَل إهمالاً تاماً.
 *   ــ لا يقبل رمزَ التجديدِ في مسارٍ ولا في `query`: جسمُ الطلبِ وحدَه — فالمسارُ
 *      و`query` يُكتَبان في سجلّاتِ الوسائطِ والوكلاءِ عادةً، والجسمُ لا يُكتَب.
 *   ــ لا يُنشئ ولا يعدّل كياناً من كياناتِ العمل (ADR 0035).
 *   ــ لا يُسجِّل رمزاً ولا جزءاً منه، ولا يكشف سببَ الرفضِ الدقيقَ في الردّ.
 *   ــ **لا يزعم إبطالاً**: الردُّ يُصدِر رمزاً جديداً، ولا يقول ولا يعني أنّ
 *      القديمَ بطل — لا مخزنَ على الخادمِ يُبطِل به (قرارُ `F1-04`).
 */

import { type Context, Hono } from "hono";
import {
  type RenewMiniAppSessionDeps,
  renewMiniAppSession,
} from "../../../../packages/application/identity/renew-miniapp-session.ts";
import { readBounded } from "./telegram-webhook.ts";

/**
 * حدُّ الجسم: رمزُ تجديدٍ نصٌّ صغيرٌ (بادئةٌ وحِمْلٌ وتوقيعٌ)؛ وما تجاوز 4KB ليس
 * رمزَ تجديدٍ أصدرناه. وأضيقُ من حدِّ مسارِ `initData` عن قصد: الحدُّ يُقاس بأكبرِ
 * مدخلٍ مشروعٍ لا بعرفٍ عامّ.
 */
export const SESSION_REFRESH_MAX_BYTES = 4 * 1024;

export interface SessionRefreshDependencies {
  /**
   * تبعياتُ حالةِ الاستخدام — غيابُها **يعطّل المسارَ بـ503** ولا يجعله يقبل بلا
   * تحقّق (سابقةُ مسارِ `F1-03`: غيابُ السرِّ تعطيلٌ لا تسامح).
   */
  readonly renew?: RenewMiniAppSessionDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

function rejected(c: Context, error: string, status: 400 | 401 | 413 | 503) {
  return c.json({ ok: false, error }, status);
}

export function createSessionRefreshRoutes(deps: SessionRefreshDependencies): Hono {
  const app = new Hono();

  app.post("/v1/session/refresh", async (c) => {
    if (deps.renew === undefined) {
      deps.log?.("مسار تجديد الجلسة معطّل لغياب سرّ التوقيع", {});
      return rejected(c, "SESSION_NOT_CONFIGURED", 503);
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > SESSION_REFRESH_MAX_BYTES) {
      return rejected(c, "PAYLOAD_TOO_LARGE", 413);
    }
    const raw = await readBounded(c.req.raw.body, SESSION_REFRESH_MAX_BYTES);
    if (raw === null) return rejected(c, "PAYLOAD_TOO_LARGE", 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return rejected(c, "INVALID_JSON", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return rejected(c, "INVALID_BODY", 400);
    }

    const refreshToken = (body as Record<string, unknown>).refreshToken;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      return rejected(c, "REFRESH_TOKEN_MISSING", 400);
    }

    const result = await renewMiniAppSession({ refreshToken }, deps.renew);
    if (!result.ok) {
      if (result.error.code === "SESSION_ISSUE_FAILED") {
        return rejected(c, result.error.publicCode, 503);
      }
      // 400 للمدخلِ المشوَّهِ شكلاً، و401 لمدخلٍ سليمِ الشكلِ لم يُقبَل تفويضُه —
      // ومنه انتهاءُ الجلسةِ: علاجُه تحقّقٌ جديدٌ من تيليجرامَ لا إعادةُ محاولة.
      if (result.error.publicCode === "REFRESH_TOKEN_MALFORMED") {
        return rejected(c, "REFRESH_TOKEN_MALFORMED", 400);
      }
      if (result.error.publicCode === "REFRESH_TOKEN_MISSING") {
        return rejected(c, "REFRESH_TOKEN_MISSING", 400);
      }
      return rejected(c, result.error.publicCode, 401);
    }

    // الردُّ: رمزانِ ومواعيدُهما فقط. لا معرّفَ جلسةٍ ولا عدّادَ تجديدٍ ولا اسمَ
    // ولا لغةَ ولا دورَ — ومعرّفُ الجلسةِ للسجلِّ الداخليِّ لا للعميل.
    return c.json(
      {
        ok: true,
        accessToken: result.value.session.accessToken,
        tokenType: result.value.session.tokenType,
        expiresAtMs: result.value.session.expiresAtMs,
        expiresInSeconds: result.value.session.expiresInSeconds,
        refreshToken: result.value.refresh.refreshToken,
        refreshExpiresAtMs: result.value.refresh.refreshExpiresAtMs,
        refreshExpiresInSeconds: result.value.refresh.refreshExpiresInSeconds,
        absoluteExpiresAtMs: result.value.refresh.absoluteExpiresAtMs,
      },
      201,
    );
  });

  return app;
}
