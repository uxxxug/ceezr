/**
 * الغرض: مساراتُ مركزِ الإشعاراتِ داخلَ التطبيقِ —
 *   `GET /v1/notifications` و`POST /v1/notifications/:id/read` (البند `F6-05` / `SS-07`).
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * ملاحظات مستقبلية: شاشاتُ العرضِ في التطبيقِ المصغَّرِ بنودُ `F2`/`F3` ولا
 *   تُبنى ههنا؛ و`request-id` في كلِّ ردٍّ بندُ `F1-08`؛ وحدُّ المعدّلِ لكلِّ
 *   مستخدمٍ بلا أرقامٍ في العقدِ فلا يُخترَعُ ههنا — وكلُّها حدودٌ مُعلَنةٌ.
 *
 * ## ما لا تفعلُه هذه المساراتُ عن قصدٍ
 *
 * - **لا تقرأُ هويّةً من الطلبِ.** لا `user_id` في مسارٍ ولا في جسمٍ ولا في
 *   `query`. الهويّةُ تُستخرَجُ من رمزٍ **موقَّعٍ منّا**، ثمّ يُحوَّلُ معرّفُ
 *   تيليجرام إلى `users.id` **داخلَ دالّةِ القاعدةِ**. فحتّى لو أخفقَ فحصٌ في
 *   هذا الملفِّ لم يستطعْ حاملُ جلسةٍ أن يختارَ صندوقاً غيرَ صندوقِه.
 * - **لا تَسِمُ القراءةُ مقروءاً.** «فُتِحَ الموجَزُ» ليسَ «قُرِئَ الإشعارُ»؛
 *   الوسمُ فعلٌ صريحٌ في مسارٍ آخرَ بطريقةٍ أخرى.
 * - **لا تُعيدُ رمزاً ولا جزءاً منه ولا معرّفَ تيليجرام** في ردٍّ ولا في خطأٍ
 *   ولا في سجلٍّ.
 * - **لا تقرأُ جسمَ طلبِ الوسمِ إطلاقاً**: المعرّفُ في المسارِ، فلا جسمَ يُقرأُ
 *   ولا حدَّ حجمٍ يُحتاجُ ولا سطحَ تحليلٍ يُفتَح.
 */

import { type Context, Hono } from "hono";
import {
  type AuthorizedViewer,
  authorizeViewer,
  type ResolveViewerDeps,
  type ViewerPublicErrorCode,
} from "../../../../packages/application/identity/resolve-viewer.ts";
import { getUserNotifications } from "../../../../packages/application/notification/get-user-notifications.ts";
import { markNotificationRead } from "../../../../packages/application/notification/mark-notification-read.ts";
import type {
  UserNotificationCenter,
  UserNotificationFailureReason,
} from "../../../../packages/application/notification/user-notification-ports.ts";
import { bearerTokenFrom } from "./me.ts";

export interface NotificationsDependencies {
  /** غيابُها **يعطّلُ المسارَ بـ503** ولا يجعلُه يجيبُ بلا تحقّقٍ. */
  readonly viewer?: ResolveViewerDeps;
  readonly center?: UserNotificationCenter;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * رمزُ الحالةِ **بروتوكولٌ لا سياسةٌ تجاريّةٌ**، ولذلكَ يُكتَبُ حرفيّاً في موضعِ
 * الاستجابةِ كما في `payment-webhook.ts` و`session-refresh.ts` — لا في ثابتٍ
 * مُسمّىً يقرؤه `check-business-constants` سعرَ اشتراكٍ مرمَّزاً فيُسقِطُ CI على
 * كودٍ لا علاقةَ له بالتسعيرِ. والاتّحادُ ههنا يُبقي جدولَي الخرائطِ محروسَينِ
 * بالنوعِ، فرمزٌ خارجَ القائمةِ يكسرُ `typecheck` لا يمرُّ صامتاً.
 */
type ErrorStatus = { readonly status: 400 | 401 | 403 | 404 | 503 }["status"];

/** جدولٌ واحدٌ حتميٌّ — لا شروطٌ مبثوثةٌ تختلفُ بينَ فرعٍ وفرعٍ. */
const VIEWER_ERROR_STATUS: Readonly<Record<ViewerPublicErrorCode, ErrorStatus>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  ACCOUNT_BLOCKED: 403,
  PROFILE_NOT_AVAILABLE: 503,
};

/**
 * `RECIPIENT_NOT_FOUND` **ليسَ خطأً في مسارِ القراءةِ**: صاحبُ جلسةٍ غيرُ مسجَّلٍ
 * صندوقُه فارغٌ لا معطوبٌ. أمّا في الوسمِ فهوَ ٤٠٤ لأنَّ الصفَّ المطلوبَ لا
 * وجودَ له. و`READER_ERROR` ٥٠٣ لا ٥٠٠: عطلٌ في اعتمادٍ خارجيٍّ يُعادُ محاولةً.
 */
const CENTER_ERROR_STATUS: Readonly<Record<UserNotificationFailureReason, ErrorStatus>> = {
  READER_ERROR: 503,
  RECIPIENT_NOT_FOUND: 404,
  NOTIFICATION_NOT_FOUND: 404,
};

function rejectedViewer(c: Context, error: ViewerPublicErrorCode) {
  return c.json({ ok: false, error }, VIEWER_ERROR_STATUS[error]);
}

/**
 * حدٌّ غيرُ رقميٍّ يُخفِقُ الطلبَ بـ٤٠٠، وحدٌّ رقميٌّ خارجَ النطاقِ **يُقصَرُ**
 * ولا يُخفِق. والفرقُ مقصودٌ: `limit=abc` خطأُ عميلٍ يُصحَّحُ في الكودِ، أمّا
 * `limit=1000` فنيّةٌ مفهومةٌ يجابُ عنها بأكثرِ ما يُسمَحُ — وحجبُ الصندوقِ
 * كلِّه بسببِها عقوبةٌ أثقلُ من الغرض.
 */
function readLimit(raw: string | undefined): number | undefined | "invalid" {
  if (raw === undefined || raw.length === 0) return undefined;
  if (!/^[0-9]{1,6}$/.test(raw)) return "invalid";
  return Number.parseInt(raw, 10);
}

/** مؤشِّرٌ غيرُ صالحٍ يُخفِقُ ولا يُهمَل: إهمالُه يُعيدُ الصفحةَ الأولى مكانَ التالية. */
function readBefore(raw: string | undefined): Date | undefined | "invalid" {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

async function authenticate(
  c: Context,
  deps: NotificationsDependencies,
): Promise<{ readonly viewer: AuthorizedViewer } | { readonly response: Response }> {
  if (deps.viewer === undefined || deps.center === undefined) {
    deps.log?.("مسارُ مركزِ الإشعاراتِ معطّلٌ لغيابِ تبعياته", {});
    return { response: rejectedViewer(c, "SESSION_NOT_AVAILABLE") };
  }
  const accessToken = bearerTokenFrom(c.req.header("authorization"));
  const authorized = await authorizeViewer({ accessToken }, deps.viewer);
  if (!authorized.ok) return { response: rejectedViewer(c, authorized.error.publicCode) };
  return { viewer: authorized.value };
}

export function createNotificationRoutes(deps: NotificationsDependencies): Hono {
  const app = new Hono();

  app.get("/v1/notifications", async (c) => {
    const auth = await authenticate(c, deps);
    if ("response" in auth) return auth.response;
    const center = deps.center;
    if (center === undefined) return rejectedViewer(c, "SESSION_NOT_AVAILABLE");

    const limit = readLimit(c.req.query("limit"));
    if (limit === "invalid") return c.json({ ok: false, error: "INVALID_LIMIT" }, 400);
    const before = readBefore(c.req.query("before"));
    if (before === "invalid") return c.json({ ok: false, error: "INVALID_CURSOR" }, 400);

    const feed = await getUserNotifications(
      {
        telegramUserId: auth.viewer.telegramUserId,
        ...(limit === undefined ? {} : { limit }),
        ...(before === undefined ? {} : { before }),
      },
      { center, ...(deps.log === undefined ? {} : { log: deps.log }) },
    );

    if (!feed.ok) {
      // صاحبُ جلسةٍ غيرُ مسجَّلٍ: موجَزٌ فارغٌ لا خطأ. لا صندوقَ له بعدُ، وهذا
      // ليسَ عطلاً يُقلِقُ به العميلُ ولا حالةً تُنشأ من التطبيقِ (ADR 0035 §2).
      if (feed.error.reason === "RECIPIENT_NOT_FOUND") {
        return c.json({ ok: true, items: [], unread: 0 }, 200);
      }
      return c.json(
        { ok: false, error: feed.error.reason },
        CENTER_ERROR_STATUS[feed.error.reason],
      );
    }

    return c.json({
      ok: true,
      unread: feed.value.unreadCount,
      items: feed.value.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        channel: item.channel,
        payload: item.payload,
        created_at: item.createdAt.toISOString(),
        read_at: item.readAt?.toISOString() ?? null,
      })),
    });
  });

  app.post("/v1/notifications/:id/read", async (c) => {
    const auth = await authenticate(c, deps);
    if ("response" in auth) return auth.response;
    const center = deps.center;
    if (center === undefined) return rejectedViewer(c, "SESSION_NOT_AVAILABLE");

    const outcome = await markNotificationRead(
      { telegramUserId: auth.viewer.telegramUserId, notificationId: c.req.param("id") },
      { center, ...(deps.log === undefined ? {} : { log: deps.log }) },
    );

    if (!outcome.ok) {
      return c.json(
        { ok: false, error: outcome.error.reason },
        CENTER_ERROR_STATUS[outcome.error.reason],
      );
    }

    return c.json({
      ok: true,
      id: outcome.value.notificationId,
      read_at: outcome.value.readAt.toISOString(),
      already_read: outcome.value.alreadyRead,
    });
  });

  return app;
}
