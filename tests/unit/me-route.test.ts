/**
 * الغرض: اختبارُ مسارِ `GET /v1/me` على خادمِ البوابةِ الحقيقيِّ نفسِه (`F1-05`):
 *   القبولُ، وكلُّ صنفِ رفضٍ برمزِه ورقمِه، وقراءةُ ترويسةِ التفويضِ، وأنّ الدورَ
 *   **لا يُقبَل من الطلبِ** بأيِّ وجهٍ، وأنّ التعطيلَ معلَنٌ عندَ غيابِ التبعياتِ،
 *   وأنّ الردَّ لا يحمل رمزاً ولا معرّفَ مستخدمٍ ولا `initData`.
 * الحالة: اختبار فعلي — Hono يعالج الطلبَ في العملية نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدّلِ (القسم 10) بلا أرقامٍ في العقدِ، و`request-id`
 *   بندُ `F1-08`، و`ETag` لصنفِ القراءةِ النشِطة — فلا يُدَّعى شيءٌ منها ههنا.
 *
 * والمُدخلاتُ مُصنَّعةٌ: **المُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخل**.
 */

import { describe, expect, it } from "bun:test";
import { bearerTokenFrom } from "../../apps/gateway/src/routes/me.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  ViewerAccount,
  ViewerAccountReader,
} from "../../packages/application/identity/ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
  MINIAPP_SESSION_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";

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

type Outcome = ViewerAccount | null | { readonly failure: true };

function reader(outcome: Outcome, seen: string[]): ViewerAccountReader {
  return {
    findByTelegramUserId: async (id) => {
      seen.push(id);
      if (outcome !== null && "failure" in outcome) {
        return err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" });
      }
      return ok(outcome);
    },
  };
}

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly reads: string[];
}

function buildHarness(
  options: { account?: Outcome; now?: Date; mounted?: boolean; configured?: boolean } = {},
): Harness {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  const now = options.now ?? NOW;
  const log = (message: string, meta: Record<string, unknown>) => {
    logs.push({ message, meta });
  };
  const viewer = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    revocation: createTestRevocationStore(),
    // `null` قيمةٌ ذاتُ معنىً ههنا («لا صفَّ») فلا تُبدَّل بافتراضٍ عندَ الغياب.
    accounts: reader(
      "account" in options ? (options.account as Outcome) : { role: "rider", isBlocked: false },
      reads,
    ),
    now: () => now,
    log,
  };
  const me =
    options.mounted === false
      ? undefined
      : { ...(options.configured === false ? {} : { viewer }), log };

  const app = createServer({
    health: { now: () => now, startedAt: now, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(me === undefined ? {} : { me }),
  });
  return { app, logs, reads };
}

async function get(
  harness: Harness,
  options: { headers?: Record<string, string>; path?: string } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(
    new Request(`http://localhost${options.path ?? "/v1/me"}`, {
      method: "GET",
      headers: { accept: "application/json", ...(options.headers ?? {}) },
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

function tokenFor(at: Date = NOW): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId: TELEGRAM_ID, bot: "rider", authDateSeconds: Math.floor(at.getTime() / 1000) },
    at.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

function authed(token: string = tokenFor()): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe("GET /v1/me — القبول", () => {
  it("١) يعيد الدورَ والحالةَ فقط بردٍّ محدودِ الحقول", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.role).toBe("rider");
    expect(json.status).toBe("active");
    expect(Object.keys(json).sort()).toEqual(["ok", "role", "status"]);
  });

  it("٢) دورُ السائقِ يصل كما هو من القاعدة", async () => {
    const harness = buildHarness({ account: { role: "driver", isBlocked: false } });
    const { status, json } = await get(harness, { headers: authed() });
    expect(status).toBe(200);
    expect(json.role).toBe("driver");
  });

  it("٣) لا صفَّ = «غير مسجَّل» بحالةٍ ٢٠٠ لا بخطأ", async () => {
    const harness = buildHarness({ account: null });
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(200);
    expect(json.role).toBe("unknown");
    expect(json.status).toBe("unregistered");
  });

  it("٤) الردُّ لا يحمل الرمزَ ولا معرّفَ تيليجرام", async () => {
    const harness = buildHarness();
    const token = tokenFor();
    const { text } = await get(harness, { headers: authed(token) });

    expect(text).not.toContain(token);
    expect(text).not.toContain(TELEGRAM_ID);
  });
});

describe("GET /v1/me — الرفض", () => {
  it("٥) بلا ترويسةِ تفويضٍ: ٤٠١ `SESSION_REQUIRED` ولا تُقرأ القاعدة", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness);

    expect(status).toBe(401);
    expect(json).toEqual({ ok: false, error: "SESSION_REQUIRED" });
    expect(harness.reads).toEqual([]);
  });

  it("٦) نمطٌ غيرُ `Bearer`: ٤٠١ `SESSION_REQUIRED`", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, {
      headers: { authorization: `Basic ${tokenFor()}` },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
    expect(harness.reads).toEqual([]);
  });

  it("٧) رمزٌ عارٍ بلا نمطٍ لا يُقبَل", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, { headers: { authorization: tokenFor() } });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
  });

  it("٨) رمزٌ مشوَّهٌ: ٤٠١ `SESSION_INVALID` ولا تُقرأ القاعدة", async () => {
    const harness = buildHarness();
    const { status, json } = await get(harness, { headers: authed("not-a-token") });

    expect(status).toBe(401);
    expect(json).toEqual({ ok: false, error: "SESSION_INVALID" });
    expect(harness.reads).toEqual([]);
  });

  it("٩) رمزٌ منتهٍ: ٤٠١ `SESSION_EXPIRED` — يُفرَّق عن الباطل", async () => {
    const later = new Date(NOW.getTime() + (MINIAPP_SESSION_TTL_SECONDS + 1) * 1000);
    const harness = buildHarness({ now: later });
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_EXPIRED");
  });

  it("١٠) حسابٌ محجوبٌ برمزٍ صالح: ٤٠٣ `ACCOUNT_BLOCKED`", async () => {
    const harness = buildHarness({ account: { role: "driver", isBlocked: true } });
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(403);
    expect(json).toEqual({ ok: false, error: "ACCOUNT_BLOCKED" });
  });

  it("١١) فشلُ قراءةِ الحساب: ٥٠٣ `PROFILE_NOT_AVAILABLE` ولا دورَ يُخترَع", async () => {
    const harness = buildHarness({ account: { failure: true } });
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(503);
    expect(json.error).toBe("PROFILE_NOT_AVAILABLE");
    expect(json.role).toBeUndefined();
  });

  it("١٢) تبعياتٌ غائبةٌ: ٥٠٣ `SESSION_NOT_AVAILABLE` لا ٢٠٠ بلا تحقّق", async () => {
    const harness = buildHarness({ configured: false });
    const { status, json } = await get(harness, { headers: authed() });

    expect(status).toBe(503);
    expect(json).toEqual({ ok: false, error: "SESSION_NOT_AVAILABLE" });
  });

  it("١٣) المسارُ غيرُ مركَّبٍ: ٤٠٤ — لا مسارَ يُخترَع", async () => {
    const harness = buildHarness({ mounted: false });
    const response = await harness.app.fetch(
      new Request("http://localhost/v1/me", { headers: authed() }),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /v1/me — الدورُ لا يأتي من الطلب", () => {
  it("١٤) دورٌ في ترويسةٍ مخصَّصةٍ يُتجاهَل تماماً", async () => {
    const harness = buildHarness({ account: { role: "rider", isBlocked: false } });
    const { status, json } = await get(harness, {
      headers: { ...authed(), "x-role": "admin", "x-user-role": "admin" },
    });

    expect(status).toBe(200);
    expect(json.role).toBe("rider");
  });

  it("١٥) دورٌ في سلسلةِ الاستعلامِ يُتجاهَل تماماً", async () => {
    const harness = buildHarness({ account: { role: "rider", isBlocked: false } });
    const { status, json } = await get(harness, {
      headers: authed(),
      path: "/v1/me?role=admin&status=active",
    });

    expect(status).toBe(200);
    expect(json.role).toBe("rider");
    expect(json.status).toBe("active");
  });

  it("١٦) محجوبٌ يرسل دوراً في ترويسةٍ لا يمرّ", async () => {
    const harness = buildHarness({ account: { role: "rider", isBlocked: true } });
    const { status } = await get(harness, { headers: { ...authed(), "x-role": "admin" } });
    expect(status).toBe(403);
  });
});

describe("GET /v1/me — الأسرارُ والسجل", () => {
  it("١٧) لا رمزَ ولا جزءٌ منه في السجل", async () => {
    const harness = buildHarness();
    const token = tokenFor();
    await get(harness, { headers: authed(`${token}x`) });

    const serialised = JSON.stringify(harness.logs);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(token.slice(0, 24));
  });

  it("١٨) الخطأُ حتميٌّ: نداءان متماثلان يعطيان الردَّ نفسَه حرفاً بحرف", async () => {
    const first = await get(buildHarness(), { headers: authed("bad") });
    const second = await get(buildHarness(), { headers: authed("bad") });

    expect(first.status).toBe(second.status);
    expect(first.text).toBe(second.text);
  });

  it("١٩) شكلُ الخطأِ لا يحمل تفصيلاً يشرح موضعَ الخلل", async () => {
    const { json } = await get(buildHarness(), { headers: authed("bad.token.parts") });
    expect(Object.keys(json).sort()).toEqual(["error", "ok"]);
  });
});

describe("قراءةُ ترويسةِ التفويض", () => {
  it("٢٠) تقرأ الرمزَ من `Bearer` وحدَه وتردُّ ما سواه", () => {
    expect(bearerTokenFrom("Bearer abc")).toBe("abc");
    expect(bearerTokenFrom("Bearer   abc")).toBe("abc");
    expect(bearerTokenFrom("  Bearer abc  ")).toBe("abc");
    expect(bearerTokenFrom("bearer abc")).toBeUndefined();
    expect(bearerTokenFrom("Bearer")).toBeUndefined();
    expect(bearerTokenFrom("Bearer ")).toBeUndefined();
    expect(bearerTokenFrom("Bearer a b")).toBeUndefined();
    expect(bearerTokenFrom("Basic abc")).toBeUndefined();
    expect(bearerTokenFrom(undefined)).toBeUndefined();
  });
});
