/**
 * الغرض: اختبارُ مسارِ `POST /v1/session/refresh` على خادمِ البوابةِ الحقيقيِّ
 *   نفسِه (`F1-04`): القبولُ، وكلُّ صنفِ رفضٍ برمزِه ورقمِه، وحدُّ الحجم، والتعطيلُ
 *   المعلَنُ عندَ غيابِ السرّ، وألّا يظهر رمزٌ خامٌّ في سجلٍّ أو رسالةِ خطأ، وأنّ
 *   المسارَ **لا يلمس تيليجرامَ** ولا يقرأ من الجسمِ غيرَ رمزِ التجديد.
 * الحالة: اختبار فعلي — Hono يعالج الطلبَ في العملية نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدّلِ وترويسةُ `request-id` يأتيان مع حدِّ API، ولا
 *   يُدَّعى تنفيذُهما ههنا.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { TelegramIdentityProof } from "../../packages/application/identity/ports.ts";
import {
  createMiniAppRefreshTokens,
  MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
} from "../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  MINIAPP_SESSION_TTL_SECONDS,
  readMiniAppSession,
} from "../../packages/infrastructure/identity/miniapp-session.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-01-15T10:00:00.000Z");

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

const PROOF: TelegramIdentityProof = {
  telegramUserId: "5550001",
  bot: "rider",
  authDateSeconds: Math.floor(NOW.getTime() / 1000) - 1,
};

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly now: Date;
}

function buildHarness(
  options: { configured?: boolean; mounted?: boolean; now?: Date } = {},
): Harness {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const now = options.now ?? NOW;
  const log = (message: string, meta: Record<string, unknown>) => {
    logs.push({ message, meta });
  };
  const renew = {
    refresh: createMiniAppRefreshTokens({ secret: SESSION_SECRET }),
    issuer: createMiniAppSessionIssuer({ secret: SESSION_SECRET }),
    now: () => now,
    log,
  };
  const sessionRefresh =
    options.mounted === false
      ? undefined
      : { ...(options.configured === false ? {} : { renew }), log };

  const app = createServer({
    health: { now: () => now, startedAt: now, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(sessionRefresh === undefined ? {} : { sessionRefresh }),
  });
  return { app, logs, now };
}

async function post(
  harness: Harness,
  body: unknown,
  options: { rawBody?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(
    new Request("http://localhost/v1/session/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.headers ?? {}) },
      body: options.rawBody ?? JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

/** رمزُ تجديدٍ حقيقيٌّ أُصدِر باللحظةِ المطلوبة. */
function tokenIssuedAt(at: Date = NOW): string {
  const issued = createMiniAppRefreshTokens({ secret: SESSION_SECRET }).issueForNewSession(
    PROOF,
    at.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.refresh.refreshToken;
}

describe("POST /v1/session/refresh — القبول", () => {
  it("١) يُصدِر رمزَ وصولٍ ورمزَ تجديدٍ جديدَين بردٍّ محدودِ الحقول", async () => {
    const at = new Date(NOW.getTime() + 300_000);
    const harness = buildHarness({ now: at });
    const token = tokenIssuedAt();

    const { status, json } = await post(harness, { refreshToken: token });
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.tokenType).toBe("Bearer");
    expect(json.expiresInSeconds).toBe(MINIAPP_SESSION_TTL_SECONDS);
    expect(json.expiresAtMs).toBe(at.getTime() + MINIAPP_SESSION_TTL_SECONDS * 1000);
    expect(json.refreshToken).not.toBe(token);
    expect(json.absoluteExpiresAtMs).toBe(
      Math.floor(NOW.getTime() / 1000) * 1000 + MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS * 1000,
    );

    // الردُّ لا يحمل معرّفَ مستخدمٍ ولا معرّفَ جلسةٍ ولا دوراً ولا عدّادَ تجديد:
    // مسارُ الإنشاءِ يُعيد `telegramUserId` لأنّه أثبته؛ وهذا المسارُ لا يُثبِته.
    expect(Object.keys(json).sort()).toEqual([
      "absoluteExpiresAtMs",
      "accessToken",
      "expiresAtMs",
      "expiresInSeconds",
      "ok",
      "refreshExpiresAtMs",
      "refreshExpiresInSeconds",
      "refreshToken",
      "tokenType",
    ]);

    const read = readMiniAppSession(String(json.accessToken), SESSION_SECRET, at.getTime());
    expect(read.ok).toBe(true);
  });

  it("٢) التجديدُ بعدَ انتهاءِ رمزِ الوصولِ ينجح (٧٠٠ث > ٦٠٠ث)", async () => {
    const at = new Date(NOW.getTime() + 700_000);
    const { status, json } = await post(buildHarness({ now: at }), {
      refreshToken: tokenIssuedAt(),
    });
    expect(status).toBe(201);
    expect(json.ok).toBe(true);
  });

  it("يُهمِل كلَّ حقلٍ آخرَ في الجسم — لا `telegram_id` ولا دورَ ولا `initData`", async () => {
    const at = new Date(NOW.getTime() + 1000);
    const { status, json } = await post(buildHarness({ now: at }), {
      refreshToken: tokenIssuedAt(),
      telegram_id: "999",
      role: "admin",
      initData: "auth_date=1&hash=abc",
      expiresInSeconds: 999_999,
    });
    expect(status).toBe(201);
    // مدّةُ الوصولِ من الخادمِ لا من العميل: كلُّ انتهاءٍ يُحسَب ههنا.
    expect(json.expiresInSeconds).toBe(MINIAPP_SESSION_TTL_SECONDS);
    const read = readMiniAppSession(String(json.accessToken), SESSION_SECRET, at.getTime());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.telegramUserId).toBe("5550001");
  });
});

describe("POST /v1/session/refresh — الرفض", () => {
  it("٥) جسمٌ غيرُ صالحٍ أو رمزٌ ناقصٌ = ٤٠٠ برمزٍ محدود", async () => {
    const harness = buildHarness();
    const cases: readonly [unknown, string | undefined, string][] = [
      [undefined, "{ not json", "INVALID_JSON"],
      [undefined, "[]", "INVALID_BODY"],
      [undefined, '"token"', "INVALID_BODY"],
      [{}, undefined, "REFRESH_TOKEN_MISSING"],
      [{ refreshToken: "" }, undefined, "REFRESH_TOKEN_MISSING"],
      [{ refreshToken: 12 }, undefined, "REFRESH_TOKEN_MISSING"],
      [{ refreshToken: "not-a-token" }, undefined, "REFRESH_TOKEN_MALFORMED"],
    ];
    for (const [body, rawBody, expected] of cases) {
      const result = await post(harness, body, rawBody === undefined ? {} : { rawBody });
      expect(result.status, expected).toBe(400);
      expect(result.json.error, expected).toBe(expected);
      expect(result.json.ok).toBe(false);
    }
  });

  it("٦) توقيعٌ لا يطابق = ٤٠١ `REFRESH_TOKEN_REJECTED` بلا سببٍ مكشوف", async () => {
    const harness = buildHarness();
    const foreign = createMiniAppRefreshTokens({
      secret: "another-test-only-session-secret-9876543210",
    }).issueForNewSession(PROOF, NOW.getTime());
    if (!foreign.ok) throw new Error("إصدار فاشل");

    const { status, json, text } = await post(harness, {
      refreshToken: foreign.value.refresh.refreshToken,
    });
    expect(status).toBe(401);
    expect(json.error).toBe("REFRESH_TOKEN_REJECTED");
    // لا يُقال «توقيعٌ لا يطابق» ولا يُفرَّق عن «إصدارٌ لا نعرفه».
    expect(text).not.toContain("SIGNATURE");
    expect(text).not.toContain("signature");
  });

  it("٣) رمزُ تجديدٍ منتهٍ = ٤٠١ `SESSION_EXPIRED`", async () => {
    const at = new Date(NOW.getTime() + 3_601_000);
    const { status, json } = await post(buildHarness({ now: at }), {
      refreshToken: tokenIssuedAt(),
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_EXPIRED");
  });

  it("٤ و١٥) بعدَ السقفِ المطلق = ٤٠١ `SESSION_EXPIRED` ولا رمزَ وصولٍ في الردّ", async () => {
    const at = new Date(NOW.getTime() + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS + 1) * 1000);
    const harness = buildHarness({ now: at });
    const refresh = createMiniAppRefreshTokens({ secret: SESSION_SECRET });
    const first = refresh.issueForNewSession(PROOF, NOW.getTime());
    if (!first.ok) throw new Error("إصدار فاشل");
    // رمزٌ جُدِّد قبلَ عشرِ دقائقَ من السقف: مدّتُه قُصَّت عندَه فلا يُقبَل بعدَه.
    const last = refresh.issueForRenewal(
      first.value.grant,
      NOW.getTime() + (MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS - 600) * 1000,
    );
    if (!last.ok) throw new Error("تجديد فاشل");

    const { status, json } = await post(harness, {
      refreshToken: last.value.refresh.refreshToken,
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_EXPIRED");
    expect(json.accessToken).toBeUndefined();
    expect(json.refreshToken).toBeUndefined();
  });

  it("٧) رمزٌ معبوثٌ به = رفضٌ بلا إصدار", async () => {
    const harness = buildHarness();
    const token = tokenIssuedAt();
    const [prefix, payload, signature] = token.split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    claims.abs = (claims.abs as number) + 86_400;
    claims.exp = (claims.exp as number) + 86_400;
    const forgedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");

    // تغييرُ آخرِ حرفٍ من التوقيعِ يجب أن يكون **تغييراً حقاً**: استبدالُه بحرفٍ
    // ثابتٍ يُنتِج التوقيعَ نفسَه حين يكون الحرفُ الأخيرُ هو ذاك الحرف، فيمرُّ
    // الرمزُ صحيحاً ويسقط الاختبارُ عشوائياً بحسبِ معرّفِ الجلسةِ العشوائيّ.
    const flippedTail = signature.endsWith("A") ? "B" : "A";

    for (const candidate of [
      `${prefix}.${forgedPayload}.${signature}`,
      `${prefix}.${payload}.${signature.slice(0, -1)}${flippedTail}`,
      `wsl1.${payload}.${signature}`,
    ]) {
      const result = await post(harness, { refreshToken: candidate });
      expect(result.status).toBe(401);
      expect(result.json.accessToken).toBeUndefined();
    }
  });

  it("حجمٌ يتجاوز الحدَّ = ٤١٣ ولو كذبت الترويسة", async () => {
    const harness = buildHarness();
    const huge = "x".repeat(5000);
    const declared = await post(harness, { refreshToken: huge });
    expect(declared.status).toBe(413);

    // وترويسةٌ كاذبةٌ لا تُغيِّر النتيجة: القراءةُ نفسُها محدودةٌ بالبايت.
    const lying = await post(harness, undefined, {
      rawBody: JSON.stringify({ refreshToken: huge }),
      headers: { "content-length": "10" },
    });
    expect(lying.status).toBe(413);
  });

  it("غيابُ التبعيات = ٥٠٣ معلَن، وعدمُ التركيب = ٤٠٤", async () => {
    const disabled = await post(buildHarness({ configured: false }), { refreshToken: "x" });
    expect(disabled.status).toBe(503);
    expect(disabled.json.error).toBe("SESSION_NOT_CONFIGURED");

    const unmounted = await post(buildHarness({ mounted: false }), { refreshToken: "x" });
    expect(unmounted.status).toBe(404);
    expect(unmounted.json.error).toBe("NOT_FOUND");
  });

  it("١٣) لا رمزَ خامّاً في السجلّاتِ ولا في الردود", async () => {
    const at = new Date(NOW.getTime() + 1000);
    const harness = buildHarness({ now: at });
    const token = tokenIssuedAt();
    const forged = `${token.slice(0, -3)}zzz`;

    const accepted = await post(harness, { refreshToken: token });
    const rejected = await post(harness, { refreshToken: forged });
    expect(accepted.status).toBe(201);
    expect(rejected.status).toBe(401);

    const serializedLogs = JSON.stringify(harness.logs);
    for (const candidate of [token, forged]) {
      expect(serializedLogs).not.toContain(candidate);
      expect(serializedLogs).not.toContain(candidate.slice(0, 24));
    }
    // ولا الرمزُ الجديدُ الذي أصدره الخادمُ بنفسِه يُسجَّل.
    expect(serializedLogs).not.toContain(String(accepted.json.refreshToken));
    expect(rejected.text).not.toContain(forged);
    expect(harness.logs.length).toBeGreaterThan(0);
  });
});

describe("POST /v1/session/refresh — الحدود المعلَنة", () => {
  it("١٦) التجديدُ يُصدِر رمزاً جديداً، ولا يُبطِل القديمَ — تصميمٌ بلا حالة", async () => {
    // شهادةٌ على السلوكِ كما هو: نداءانِ بالرمزِ نفسِه ينجحانِ كلاهما. ولا يُقال
    // إنّ الأوّلَ أبطلَ شيئاً: لا مخزنَ جلساتٍ على الخادمِ (قرارُ `F1-04`)، فلا
    // إبطالَ فوريٌّ ولا كشفَ لإعادةِ الاستخدام. الحدُّ: ساعةٌ للرمزِ و١٢ للسقف.
    const at = new Date(NOW.getTime() + 60_000);
    const harness = buildHarness({ now: at });
    const token = tokenIssuedAt();

    const first = await post(harness, { refreshToken: token });
    const second = await post(harness, { refreshToken: token });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.json.absoluteExpiresAtMs).toBe(second.json.absoluteExpiresAtMs);
  });

  it("١٤) التجديدُ المتكرِّرُ عبرَ المسارِ لا يمدّ السقفَ المطلق", async () => {
    let token = tokenIssuedAt();
    let absolute: number | null = null;
    for (let step = 1; step <= 5; step += 1) {
      const at = new Date(NOW.getTime() + step * 3_000_000);
      const result = await post(buildHarness({ now: at }), { refreshToken: token });
      expect(result.status, `خطوة ${step}`).toBe(201);
      absolute ??= Number(result.json.absoluteExpiresAtMs);
      expect(Number(result.json.absoluteExpiresAtMs), `سقف ${step}`).toBe(absolute);
      token = String(result.json.refreshToken);
    }
  });
});
