/**
 * الغرض: مسارا الدعمِ من داخلِ التطبيقِ — `POST /v1/support/tickets` و
 *   `GET /v1/support/tickets` (`F2-12` · `SR-11` · §9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — المساران لا يذكرانِ دوراً في عنوانِهما،
 *   وشكوى السائقِ تدخلُ منهما بأصنافِها لا من مسارٍ ثالثٍ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا `409` للتهدئةِ ورأسُ `Retry-After` معَها
 *
 * التهدئةُ **ليسَت عطبَ صياغةٍ** (`400`) ولا منعَ صلاحيةٍ (`403`) ولا حدَّ
 * معدّلٍ عامّاً (`429` لكلِّ عنوانٍ) — بل **تعارضٌ مع حالةِ المَورِدِ**: لكَ
 * تذكرةٌ فُتِحَت قبلَ قليلٍ. و`Retry-After` رأسٌ قياسيٌّ يقرؤه العميلُ فلا
 * يُخمِّنُ، والرقمُ من القاعدةِ لا من ساعةِ البوابةِ.
 *
 * ## ولماذا لا `404` على «لا تذاكرَ لكَ»
 *
 * صفحةٌ فارغةٌ **جوابٌ صحيحٌ** لا مَورِدٌ غائبٌ. و`404` يجعلُ الشاشةَ تُظهِرُ
 * عطلاً حيثُ الصوابُ سطرٌ يقولُ «لا تذاكرَ» — والفرقُ بينَهما ثقةُ المستخدمِ.
 *
 * ## وما لا يفعلُه هذانِ المساران عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرآنِ معرّفَ راكبٍ من الطلبِ**: من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا يُسجِّلانِ نصَّ الشكوى في سجلٍّ**: نصُّ الإنسانِ في جدولِه وحدَه،
 *      وسجلُّ التطبيقِ لا يُحكَمُ عليه بحكمِ محوٍ (`ADR 0078`).
 *   ــ **لا يقبلانِ مُرفَقاً**: رفعُ ملفٍّ **دَينٌ مُعلَنٌ** لا مُنفَّذٌ.
 *   ــ **لا يعرضانِ أسئلةً شائعةً ولا صفحةَ مفقوداتٍ**: محتوىً تحريريٌّ
 *      مُصرَّحٌ به دَيناً في `ROADMAP` — والبندُ يبقى `[~]` لأجلِه.
 */

import { type Context, Hono } from "hono";
import {
  listRiderSupportTickets,
  openRiderSupportTicket,
  type RiderSupportDeps,
  type RiderSupportPublicErrorCode,
  type RiderSupportRejection,
} from "../../../../packages/application/support/rider-support.ts";

export interface SupportRouteDependencies {
  /** غيابُها **يعطّلُ المسارَينِ بـ503** ولا يجعلهما يجيبانِ بلا كتابةٍ. */
  readonly support?: RiderSupportDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<Record<RiderSupportPublicErrorCode, 401 | 403 | 409 | 422 | 503>> =
  {
    SESSION_REQUIRED: 401,
    SESSION_EXPIRED: 401,
    SESSION_INVALID: 401,
    SESSION_NOT_AVAILABLE: 503,
    SUPPORT_STORE_NOT_AVAILABLE: 503,
    // طلبٌ مفهومٌ وقيمتُه خارجَ المجالِ — لا عطبُ صياغةٍ ولا منعُ صلاحيةٍ.
    CATEGORY_UNKNOWN: 422,
    MESSAGE_EMPTY: 422,
    MESSAGE_TOO_LONG: 422,
    ORDER_REQUIRED: 422,
    ORDER_INVALID: 422,
    LIMIT_OUT_OF_RANGE: 422,
    CURSOR_INVALID: 422,
    // طلبُ رحلةٍ ليسَت لكَ: **منعُ صلاحيةٍ** لا عطبُ قيمةٍ — ولا يُفرَّقُ في
    // الجوابِ بينَ «رحلةٌ لا وجودَ لها» و«رحلةُ غيرِكَ»، فذاكَ بابُ تلصُّصٍ.
    ORDER_NOT_YOURS: 403,
    ACCOUNT_BLOCKED: 403,
    NOT_REGISTERED: 403,
    // مدينةٌ بلا قروبِ دعمٍ: تهيئةٌ ناقصةٌ عندَنا لا خطأُ المستخدمِ.
    CITY_NOT_READY: 503,
    COOLDOWN_ACTIVE: 409,
  };

function rejected(c: Context, rejection: RiderSupportRejection) {
  const status = STATUS_BY_ERROR[rejection.code];
  const body: Record<string, unknown> = { ok: false, error: rejection.code };
  if (rejection.retryAfterSeconds !== null) {
    body.retry_after_seconds = rejection.retryAfterSeconds;
    c.header("Retry-After", String(rejection.retryAfterSeconds));
  }
  return c.json(body, status);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * حدُّ حجمِ جسمِ الشكوى بالبايتاتِ. **حدُّ سلامةٍ لا حدُّ نصٍّ**: النصُّ
 * يُقاسُ بالمحارفِ في طبقةِ التطبيقِ، وهذا يمنعُ قراءةَ ميغابايتٍ من الشبكةِ
 * أصلاً. والمجالُ ثلاثةُ أضعافِ حدِّ المحارفِ لأنَّ العربيَّةَ في UTF-8
 * بايتانِ للحرفِ، والزائدُ للحقولِ الأخرى وأقواسِ JSON.
 */
const MAX_BODY_BYTES = 4096;

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createSupportRoutes(deps: SupportRouteDependencies): Hono {
  const app = new Hono();

  /** «أبلِغْ عن مشكلةٍ» — تذكرةٌ واحدةٌ ومرجعٌ يُنطَقُ. */
  app.post("/v1/support/tickets", async (c) => {
    if (deps.support === undefined) {
      deps.log?.("support.open_disabled", {});
      return rejected(c, { code: "SUPPORT_STORE_NOT_AVAILABLE", retryAfterSeconds: null });
    }

    const body = await readJsonBody(c);
    // جسمٌ لا يُفهَمُ = **لا صنفَ ولا نصَّ**، وتُقالُ عِلَّتُه بأدقِّ رمزٍ
    // تُمكِنُ قراءتُه: `CATEGORY_UNKNOWN` (فالصنفُ أوّلُ ما يُفحَصُ).
    const result = await openRiderSupportTicket(deps.support, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      category: body?.category,
      message: body?.message,
      orderId: body?.order_id,
    });
    if (!result.ok) return rejected(c, result.error);

    const opened = result.value;
    deps.log?.("support.ticket_opened", { reference: opened.reference, category: opened.category });
    // `201` لأنَّ مَورِداً أُنشئَ، ومرجعُه في الجسمِ لا في رأسِ `Location`:
    // لا مسارَ لقراءةِ تذكرةٍ واحدةٍ اليومَ، ورأسٌ يشيرُ إلى `404` كذبةٌ.
    return c.json(
      {
        ok: true,
        reference: opened.reference,
        ticket_id: opened.ticketId,
        category: opened.category,
      },
      201,
    );
  });

  /** «تذاكري» — صفحةٌ بترقيمِ مفتاحٍ، وحالةُ كلِّ تذكرةٍ ومرجعُها. */
  app.get("/v1/support/tickets", async (c) => {
    if (deps.support === undefined) {
      deps.log?.("support.list_disabled", {});
      return rejected(c, { code: "SUPPORT_STORE_NOT_AVAILABLE", retryAfterSeconds: null });
    }

    const result = await listRiderSupportTickets(deps.support, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      limit: c.req.query("limit"),
      cursorCreatedAt: c.req.query("before_created_at"),
      cursorId: c.req.query("before_id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const page = result.value;
    return c.json({
      ok: true,
      tickets: page.tickets,
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
      expected_response_minutes: page.expectedResponseMinutes,
    });
  });

  return app;
}
