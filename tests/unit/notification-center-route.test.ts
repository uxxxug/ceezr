/**
 * الغرض: اختبارُ مركزِ الإشعاراتِ داخلَ التطبيقِ على خادمِ البوابةِ الحقيقيِّ
 *   نفسِه (البند `F6-05` / `SS-07`): القبولُ، وكلُّ صنفِ رفضٍ برمزِه ورقمِه،
 *   وقصرُ الحدِّ، ورفضُ المؤشِّرِ الفاسدِ، وأنَّ **الهويّةَ لا تُقبَلُ من الطلبِ**
 *   بأيِّ وجهٍ، وأنَّ التعطيلَ مُعلَنٌ عندَ غيابِ التبعياتِ، وأنَّ الردَّ لا يحملُ
 *   رمزاً ولا معرّفَ تيليجرام.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدّلِ لكلِّ مستخدمٍ بلا أرقامٍ في العقدِ، و`request-id`
 *   بندُ `F1-08` — فلا يُدَّعى شيءٌ منهما ههنا.
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** المركزُ ههنا **مُصطنَعٌ**، فما يُثبَتُ هوَ الترجمةُ
 * إلى HTTP وحدَها. أنَّ التصنيفَ يقعُ فعلاً، وأنَّ القراءةَ لا تعبرُ حدَّ المستخدمِ
 * في القاعدةِ — كلُّ ذلكَ في `tests/integration/notification-classification-center`
 * على قاعدةٍ حقيقيّةٍ، لأنَّ مُطلِقاً وقيداً لا يُثبتُهما mock إطلاقاً.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import {
  clampNotificationLimit,
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
} from "../../packages/application/notification/get-user-notifications.ts";
import { markNotificationRead } from "../../packages/application/notification/mark-notification-read.ts";
import type {
  UserNotificationCenter,
  UserNotificationFailureReason,
} from "../../packages/application/notification/user-notification-ports.ts";
import { userNotificationFailure } from "../../packages/application/notification/user-notification-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";
const NOTIFICATION_ID = "11111111-2222-4333-8444-555555555555";

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  DATABASE_URL: "postgres://user:pass@localhost:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "x",
  DRIVER_BOT_TOKEN: "x",
  RIDER_BOT_TOKEN: "x",
  TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
};

/** ما رآهُ المركزُ فعلاً — به يُثبَتُ أنَّ الهويّةَ من الرمزِ لا من الطلبِ. */
interface Seen {
  readonly telegramUserId: string;
  readonly limit?: number | undefined;
  readonly before?: string | undefined;
}

function center(
  seen: Seen[],
  outcome: UserNotificationFailureReason | "ok" = "ok",
): UserNotificationCenter {
  return {
    readFeed: async (query) => {
      seen.push({
        telegramUserId: query.telegramUserId,
        limit: query.limit,
        before: query.before?.toISOString(),
      });
      if (outcome !== "ok") return err(userNotificationFailure(outcome));
      return ok({
        items: [
          {
            id: NOTIFICATION_ID,
            kind: "order_cancelled",
            channel: "critical",
            payload: { order_id: "o-1" },
            createdAt: NOW,
            readAt: null,
          },
        ],
        unreadCount: 1,
      });
    },
    markRead: async (telegramUserId) => {
      seen.push({ telegramUserId });
      if (outcome !== "ok") return err(userNotificationFailure(outcome));
      return ok({ notificationId: NOTIFICATION_ID, readAt: NOW, alreadyRead: false });
    },
  };
}

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly seen: Seen[];
  readonly logs: { message: string; meta: Record<string, unknown> }[];
}

function buildHarness(
  options: {
    outcome?: UserNotificationFailureReason | "ok";
    mounted?: boolean;
    configured?: boolean;
    blocked?: boolean;
  } = {},
): Harness {
  const seen: Seen[] = [];
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const log = (message: string, meta: Record<string, unknown>) => {
    logs.push({ message, meta });
  };
  const viewer = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    accounts: {
      findByTelegramUserId: async () =>
        ok({ role: "rider" as const, isBlocked: options.blocked === true }),
    },
    now: () => NOW,
    log,
  };
  const notifications =
    options.mounted === false
      ? undefined
      : {
          ...(options.configured === false
            ? {}
            : { viewer, center: center(seen, options.outcome ?? "ok") }),
          log,
        };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(notifications === undefined ? {} : { notifications }),
  });
  return { app, seen, logs };
}

function tokenFor(): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    {
      telegramUserId: TELEGRAM_ID,
      bot: "rider",
      authDateSeconds: Math.floor(NOW.getTime() / 1000),
    },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

async function call(
  harness: Harness,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${path}`, {
      method: options.method ?? "GET",
      headers: { accept: "application/json", ...(options.headers ?? {}) },
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

function authed(): { authorization: string } {
  return { authorization: `Bearer ${tokenFor()}` };
}

describe("GET /v1/notifications — القبولُ وشكلُ الردِّ", () => {
  it("١) يعيدُ الموجَزَ وعددَ غيرِ المقروءِ بحقولٍ محدودةٍ", async () => {
    const harness = buildHarness();
    const { status, json, text } = await call(harness, "/v1/notifications", {
      headers: authed(),
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.unread).toBe(1);
    const items = json.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "channel",
      "created_at",
      "id",
      "kind",
      "payload",
      "read_at",
    ]);
    expect(items[0]?.read_at).toBeNull();

    // لا رمزَ ولا جزءَ منه ولا معرّفَ تيليجرام في الردِّ.
    expect(text).not.toContain(TELEGRAM_ID);
    expect(text).not.toContain(tokenFor().slice(0, 12));
  });

  it("٢) الهويّةُ تُقرأُ من الرمزِ لا من الطلبِ", async () => {
    const harness = buildHarness();
    // معرّفٌ مزروعٌ في `query` ينبغي أن يُهمَلَ تماماً: لو قُرِئَ لأمكنَ لحاملِ
    // جلسةٍ صالحةٍ أن يقرأَ صندوقَ غيرِه بتغييرِ معاملٍ في الرابط.
    await call(harness, "/v1/notifications?user_id=9999999&telegram_id=9999999", {
      headers: authed(),
    });
    expect(harness.seen).toHaveLength(1);
    expect(harness.seen[0]?.telegramUserId).toBe(TELEGRAM_ID);
  });

  it("٣) الحدُّ الافتراضيُّ يُطبَّقُ ولا يُترَكُ للقاعدةِ وحدَها", async () => {
    const harness = buildHarness();
    await call(harness, "/v1/notifications", { headers: authed() });
    expect(harness.seen[0]?.limit).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE);
  });

  it("٤) حدٌّ هائلٌ يُقصَرُ ولا يُخفِقُ — حجبُ الصندوقِ عقوبةٌ أثقلُ من الغرضِ", async () => {
    const harness = buildHarness();
    const { status } = await call(harness, "/v1/notifications?limit=100000", {
      headers: authed(),
    });
    expect(status).toBe(200);
    expect(harness.seen[0]?.limit).toBe(MAX_NOTIFICATION_PAGE_SIZE);
  });

  it("٥) المؤشِّرُ يُمرَّرُ كما هوَ بعدَ تحليلِه", async () => {
    const harness = buildHarness();
    await call(harness, "/v1/notifications?before=2027-02-01T00:00:00.000Z", {
      headers: authed(),
    });
    expect(harness.seen[0]?.before).toBe("2027-02-01T00:00:00.000Z");
  });
});

describe("GET /v1/notifications — الرفضُ", () => {
  it("٦) بلا ترويسةِ تفويضٍ: 401 و`SESSION_REQUIRED` ولا يُستدعى المركزُ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, "/v1/notifications");
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
    // القاعدةُ لا تُقرأُ لرمزٍ لم يُثبَت توقيعُه، وإلّا صارَ المسارُ مِرقاباً.
    expect(harness.seen).toHaveLength(0);
  });

  it("٧) رمزٌ فاسدٌ: 401 و`SESSION_INVALID` ولا يُستدعى المركزُ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, "/v1/notifications", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_INVALID");
    expect(harness.seen).toHaveLength(0);
  });

  it("٨) حسابٌ محجوبٌ: 403 — الحجبُ يُفحَصُ في كلِّ طلبٍ لا مرّةً عندَ الجلسةِ", async () => {
    const harness = buildHarness({ blocked: true });
    const { status, json } = await call(harness, "/v1/notifications", { headers: authed() });
    expect(status).toBe(403);
    expect(json.error).toBe("ACCOUNT_BLOCKED");
    expect(harness.seen).toHaveLength(0);
  });

  it("٩) حدٌّ غيرُ رقميٍّ: 400 — خطأُ عميلٍ يُصحَّحُ في الكودِ لا يُقصَرُ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, "/v1/notifications?limit=abc", {
      headers: authed(),
    });
    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_LIMIT");
    expect(harness.seen).toHaveLength(0);
  });

  it("١٠) مؤشِّرٌ فاسدٌ: 400 — إهمالُه يُعيدُ الصفحةَ الأولى مكانَ التاليةِ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, "/v1/notifications?before=يوم-ما", {
      headers: authed(),
    });
    expect(status).toBe(400);
    expect(json.error).toBe("INVALID_CURSOR");
  });

  it("١١) عطلُ المركزِ: 503 لا 500 — عطلُ اعتمادٍ خارجيٍّ يُعادُ محاولةً", async () => {
    const harness = buildHarness({ outcome: "READER_ERROR" });
    const { status, json } = await call(harness, "/v1/notifications", { headers: authed() });
    expect(status).toBe(503);
    expect(json.error).toBe("READER_ERROR");
  });

  it("١٢) صاحبُ جلسةٍ غيرُ مسجَّلٍ: موجَزٌ فارغٌ بـ200 لا خطأٌ", async () => {
    const harness = buildHarness({ outcome: "RECIPIENT_NOT_FOUND" });
    const { status, json } = await call(harness, "/v1/notifications", { headers: authed() });
    // لا صندوقَ له بعدُ، وهذا ليسَ عطلاً يُقلِقُ به العميلُ ولا حالةً تُنشأ.
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.items).toEqual([]);
    expect(json.unread).toBe(0);
  });

  it("١٣) غيابُ التبعياتِ يُعطِّلُ المسارَ بـ503 ولا يجعلُه يجيبُ بلا تحقّقٍ", async () => {
    const harness = buildHarness({ configured: false });
    const { status, json } = await call(harness, "/v1/notifications", { headers: authed() });
    expect(status).toBe(503);
    expect(json.error).toBe("SESSION_NOT_AVAILABLE");
    expect(harness.logs.some((entry) => entry.message.includes("معطّلٌ"))).toBe(true);
  });

  it("١٤) غيرُ مركَّبٍ إطلاقاً: 404 لا 401 — لا سطحَ يُستدَلُّ على وجودِه", async () => {
    const harness = buildHarness({ mounted: false });
    const { status, json } = await call(harness, "/v1/notifications", { headers: authed() });
    expect(status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
  });
});

describe("POST /v1/notifications/:id/read", () => {
  it("١٥) الوسمُ يعيدُ الوقتَ وعلامةَ «كانَ موسوماً»", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, `/v1/notifications/${NOTIFICATION_ID}/read`, {
      method: "POST",
      headers: authed(),
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.id).toBe(NOTIFICATION_ID);
    expect(json.already_read).toBe(false);
    expect(json.read_at).toBe(NOW.toISOString());
  });

  it("١٦) معرّفٌ غيرُ صالحِ الشكلِ: 404 ولا يُرسَلُ إلى القاعدةِ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, "/v1/notifications/not-a-uuid/read", {
      method: "POST",
      headers: authed(),
    });
    // إرسالُه كانَ سيورِّثُ خطأَ تحويلٍ يُقرأُ عطلَ خادمٍ فيصيرُ إنذاراً كاذباً.
    expect(status).toBe(404);
    expect(json.error).toBe("NOTIFICATION_NOT_FOUND");
    expect(harness.seen).toHaveLength(0);
  });

  it("١٧) إشعارٌ لا وجودَ له: 404 بنفسِ الرمزِ الذي يُعادُ عن إشعارِ غيرِك", async () => {
    const harness = buildHarness({ outcome: "NOTIFICATION_NOT_FOUND" });
    const { status, json } = await call(harness, `/v1/notifications/${NOTIFICATION_ID}/read`, {
      method: "POST",
      headers: authed(),
    });
    expect(status).toBe(404);
    expect(json.error).toBe("NOTIFICATION_NOT_FOUND");
  });

  it("١٨) الوسمُ لا يُقبَلُ بلا مصادقةٍ", async () => {
    const harness = buildHarness();
    const { status } = await call(harness, `/v1/notifications/${NOTIFICATION_ID}/read`, {
      method: "POST",
    });
    expect(status).toBe(401);
    expect(harness.seen).toHaveLength(0);
  });
});

describe("قصرُ الحدِّ وحرسُ المعرّفِ في طبقةِ التطبيقِ", () => {
  it("١٩) جدولُ القصرِ كاملٌ: الغيابُ والصفرُ والسالبُ والكسرُ والهائلُ", () => {
    expect(clampNotificationLimit(undefined)).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE);
    expect(clampNotificationLimit(Number.NaN)).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE);
    expect(clampNotificationLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE);
    expect(clampNotificationLimit(0)).toBe(1);
    expect(clampNotificationLimit(-5)).toBe(1);
    expect(clampNotificationLimit(7.9)).toBe(7);
    expect(clampNotificationLimit(MAX_NOTIFICATION_PAGE_SIZE)).toBe(MAX_NOTIFICATION_PAGE_SIZE);
    expect(clampNotificationLimit(MAX_NOTIFICATION_PAGE_SIZE + 1)).toBe(MAX_NOTIFICATION_PAGE_SIZE);
  });

  it("٢٠) حرسُ المعرّفِ يمنعُ الاستدعاءَ، وشاهدٌ موجَبٌ أنَّ الصالحَ يعبرُ", async () => {
    const seen: Seen[] = [];
    const deps = { center: center(seen) };

    const rejected = await markNotificationRead(
      { telegramUserId: TELEGRAM_ID, notificationId: "12345" },
      deps,
    );
    expect(rejected.ok).toBe(false);
    expect(seen).toHaveLength(0);

    // الشاهدُ الموجَبُ: بلا هذا كانَ اختبارُ الحرسِ يمرُّ ولو كانَ المركزُ معطوباً.
    const accepted = await markNotificationRead(
      { telegramUserId: TELEGRAM_ID, notificationId: NOTIFICATION_ID },
      deps,
    );
    expect(accepted.ok).toBe(true);
    expect(seen).toHaveLength(1);
  });
});
