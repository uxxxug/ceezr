/**
 * الغرض: اختبارُ مسارِ `POST /v1/session/telegram` على خادمِ البوابةِ الحقيقيِّ
 *   نفسِه: القبولُ، وكلُّ صنفِ رفضٍ، وترتيبُ «تحقّقٌ ثمّ إصدار»، وألّا يظهر
 *   `initData` الخامُّ ولا `hash` ولا الرمزُ في سجلٍّ أو ردٍّ أو رسالةِ خطأ.
 * الحالة: اختبار فعلي — Hono يعالج الطلبَ في العملية نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدّلِ على هذا المسارِ وترويسةُ `request-id` يأتيان مع
 *   حدِّ API في البند `F1-04` وما بعده، ولا يُدَّعى تنفيذُهما ههنا.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  IssuedMiniAppSession,
  MiniAppSessionIssuer,
  TelegramIdentityProof,
} from "../../packages/application/identity/ports.ts";
import {
  createMiniAppSessionIssuer,
  readMiniAppSession,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import {
  buildInitData,
  dropField,
  FAKE_DRIVER_BOT_TOKEN,
  FAKE_RIDER_BOT_TOKEN,
  SAMPLE_USER,
  tamperField,
} from "../support/telegram-init-data.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-01-15T10:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

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

interface Harness {
  readonly app: ReturnType<typeof createServer>;
  readonly logs: { message: string; meta: Record<string, unknown> }[];
  readonly issuedFor: TelegramIdentityProof[];
}

function buildHarness(
  options: { configured?: boolean; mounted?: boolean; issuer?: MiniAppSessionIssuer } = {},
): Harness {
  const logs: { message: string; meta: Record<string, unknown> }[] = [];
  const issuedFor: TelegramIdentityProof[] = [];
  const realIssuer = createMiniAppSessionIssuer({ secret: SESSION_SECRET });
  // مزدوجٌ يشهد على الترتيب: كلُّ نداءٍ للإصدارِ يُسجَّل، فإن سُجِّل نداءٌ في حالةِ
  // رفضٍ فقد أُصدرت جلسةٌ قبلَ التحقّق — وهو ما يمنعه البند نصّاً.
  const spyIssuer: MiniAppSessionIssuer = {
    issue(proof, nowMs) {
      issuedFor.push(proof);
      return (options.issuer ?? realIssuer).issue(proof, nowMs);
    },
  };
  const log = (message: string, meta: Record<string, unknown>) => {
    logs.push({ message, meta });
  };
  const exchange = {
    verifier: createTelegramInitDataVerifier({
      bots: [
        { name: "driver", token: FAKE_DRIVER_BOT_TOKEN },
        { name: "rider", token: FAKE_RIDER_BOT_TOKEN },
      ],
    }),
    issuer: spyIssuer,
    now: () => NOW,
    log,
  };
  const sessionTelegram =
    options.mounted === false
      ? undefined
      : { ...(options.configured === false ? {} : { exchange }), log };

  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: {
      webhookSecret: WEBHOOK_SECRET,
      handler: { handle: async () => true },
    },
    ...(sessionTelegram === undefined ? {} : { sessionTelegram }),
  });
  return { app, logs, issuedFor };
}

function sessionRequest(body: unknown, rawBody?: string): Request {
  return new Request("http://localhost/v1/session/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

function validInitData(extra: Partial<Parameters<typeof buildInitData>[0]> = {}): string {
  return buildInitData({
    botToken: FAKE_DRIVER_BOT_TOKEN,
    authDateSeconds: NOW_SECONDS - 10,
    user: SAMPLE_USER,
    queryId: "AAH-route-test",
    ...extra,
  });
}

async function post(
  harness: Harness,
  body: unknown,
  rawBody?: string,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const response = await harness.app.fetch(sessionRequest(body, rawBody));
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text), text };
}

describe("POST /v1/session/telegram — القبول", () => {
  it("يُصدِر جلسةً داخليةً قابلةً للقراءةِ بعد تحقّقٍ ناجح", async () => {
    const harness = buildHarness();
    const initData = validInitData();
    const { status, json } = await post(harness, { initData });

    expect(status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.tokenType).toBe("Bearer");
    expect(json.telegramUserId).toBe(String(SAMPLE_USER.id));
    expect(json.expiresAtMs).toBe(NOW.getTime() + Number(json.expiresInSeconds) * 1000);

    const read = readMiniAppSession(String(json.accessToken), SESSION_SECRET, NOW.getTime());
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("توقّعنا جلسةً مقروءة");
    expect(read.value.telegramUserId).toBe(String(SAMPLE_USER.id));
    expect(read.value.bot).toBe("driver");

    // الجلسةُ أُصدرت مرّةً واحدةً وعن الإثباتِ المتحقَّقِ منه لا عن جسمِ الطلب.
    expect(harness.issuedFor.length).toBe(1);
    expect(harness.issuedFor[0]?.telegramUserId).toBe(String(SAMPLE_USER.id));
  });

  it("يقبل الموقَّعَ ببوتِ الراكبِ كذلك", async () => {
    const harness = buildHarness();
    const { status } = await post(harness, {
      initData: validInitData({ botToken: FAKE_RIDER_BOT_TOKEN }),
    });
    expect(status).toBe(201);
  });

  it("يُهمل أيَّ حقلِ هويةٍ يرسله العميلُ ولا يقرأه", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, {
      initData: validInitData(),
      user: { id: 1, first_name: "منتحِل" },
      telegram_id: 1,
      role: "admin",
      accessToken: "ممنوح-من-العميل",
    });
    expect(status).toBe(201);
    expect(json.telegramUserId).toBe(String(SAMPLE_USER.id));
    expect(json.role).toBeUndefined();
    expect(harness.issuedFor[0]?.telegramUserId).toBe(String(SAMPLE_USER.id));
  });
});

describe("POST /v1/session/telegram — الرفض", () => {
  it("يرفض جسماً بلا initData بـ400 ولا يستدعي المُصدِر", async () => {
    const harness = buildHarness();
    for (const body of [{}, { initData: "" }, { initData: 5 }, { initData: null }]) {
      const { status, json } = await post(harness, body);
      expect(status).toBe(400);
      expect(json.error).toBe("INIT_DATA_MISSING");
    }
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض جسماً غيرَ JSON أو غيرَ كائن", async () => {
    const harness = buildHarness();
    const broken = await post(harness, undefined, "{ليس JSON");
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe("INVALID_JSON");

    for (const raw of ["[]", '"نص"', "7", "null"]) {
      const { status, json } = await post(harness, undefined, raw);
      expect(status).toBe(400);
      expect(json.error).toBe("INVALID_BODY");
    }
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض توقيعاً غيرَ صحيحٍ بـ401 برمزٍ عامٍّ لا يكشف موضعَ الخلل", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, {
      initData: validInitData({ overrideHash: "d".repeat(64) }),
    });
    expect(status).toBe(401);
    expect(json.error).toBe("INIT_DATA_REJECTED");
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض العبثَ ببياناتِ المستخدمِ وبـauth_date بنفسِ الرمزِ العام", async () => {
    const harness = buildHarness();
    const tamperedUser = tamperField(
      validInitData(),
      "user",
      JSON.stringify({ ...SAMPLE_USER, id: 42 }),
    );
    const tamperedDate = tamperField(validInitData(), "auth_date", String(NOW_SECONDS));
    for (const initData of [tamperedUser, tamperedDate]) {
      const { status, json } = await post(harness, { initData });
      expect(status).toBe(401);
      expect(json.error).toBe("INIT_DATA_REJECTED");
    }
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض إثباتاً قديماً برمزِ انتهاءٍ مُفرَدٍ يُفهِم العميلَ ما يفعل", async () => {
    const harness = buildHarness();
    const { status, json } = await post(harness, {
      initData: validInitData({ authDateSeconds: NOW_SECONDS - 3600 }),
    });
    expect(status).toBe(401);
    expect(json.error).toBe("INIT_DATA_EXPIRED");
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض الناقصَ والمشوَّهَ بـ400 ورمزِ تشويه", async () => {
    const harness = buildHarness();
    const cases = [
      validInitData({ omitHash: true }),
      dropField(validInitData(), "auth_date"),
      "%%%not-a-query%%%",
      "hash=short",
    ];
    for (const initData of cases) {
      const { status, json } = await post(harness, { initData });
      expect(status).toBe(400);
      expect(json.error).toBe("INIT_DATA_MALFORMED");
    }
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يرفض جسماً أكبرَ من الحدّ بلا قراءةِ محتواه", async () => {
    const harness = buildHarness();
    const huge = JSON.stringify({ initData: "x".repeat(20 * 1024) });
    const { status, json } = await post(harness, undefined, huge);
    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
    expect(harness.issuedFor.length).toBe(0);
  });

  it("يُعطَّل معلَناً بـ503 عند غيابِ تبعياتِ التحقّق، ولا يقبل تسامحاً", async () => {
    const harness = buildHarness({ configured: false });
    const { status, json } = await post(harness, { initData: validInitData() });
    expect(status).toBe(503);
    expect(json.error).toBe("SESSION_NOT_CONFIGURED");
    expect(harness.issuedFor.length).toBe(0);
  });

  it("لا وجودَ للمسارِ أصلاً حين لا يُركَّب (404 لا 500)", async () => {
    const harness = buildHarness({ mounted: false });
    const { status, json } = await post(harness, { initData: validInitData() });
    expect(status).toBe(404);
    expect(json.error).toBe("NOT_FOUND");
  });

  it("يردّ 503 برمزٍ عامٍّ إذا أخفق المُصدِرُ بعد تحقّقٍ صحيح", async () => {
    const failing: MiniAppSessionIssuer = {
      issue: () => ({
        ok: false,
        error: { code: "SESSION_ISSUE_FAILED", reason: "NOT_CONFIGURED" },
      }),
    };
    const harness = buildHarness({ issuer: failing });
    const { status, json } = await post(harness, { initData: validInitData() });
    expect(status).toBe(503);
    expect(json.error).toBe("SESSION_NOT_AVAILABLE");
    // التحقّقُ نجح فاستُدعي المُصدِر، والإخفاقُ إخفاقُ إصدارٍ لا رفضُ هوية.
    expect(harness.issuedFor.length).toBe(1);
  });
});

describe("POST /v1/session/telegram — عدم التسريب", () => {
  it("لا يظهر initData الخامُّ ولا hash ولا الرمزُ في السجلّ", async () => {
    const harness = buildHarness();
    const initData = validInitData();
    const hash = new URLSearchParams(initData).get("hash") ?? "";
    const okResponse = await post(harness, { initData });
    await post(harness, { initData: validInitData({ overrideHash: "e".repeat(64) }) });
    await post(harness, { initData: validInitData({ authDateSeconds: NOW_SECONDS - 3600 }) });

    const serialisedLogs = JSON.stringify(harness.logs);
    expect(serialisedLogs).not.toContain(initData);
    expect(serialisedLogs).not.toContain(hash);
    expect(serialisedLogs).not.toContain("e".repeat(64));
    expect(serialisedLogs).not.toContain(String(okResponse.json.accessToken));
    expect(serialisedLogs).not.toContain(SESSION_SECRET);
    expect(serialisedLogs).not.toContain(FAKE_DRIVER_BOT_TOKEN);
    expect(serialisedLogs).not.toContain("noura_test");
    // ومع ذلك السببُ الداخليُّ مسجَّلٌ مصنَّفاً كي يكون الفشلُ مقروءاً للمشغّل.
    expect(serialisedLogs).toContain("SIGNATURE_MISMATCH");
    expect(serialisedLogs).toContain("AUTH_DATE_STALE");
  });

  it("لا يعيد الردُّ شيئاً من initData ولا سببَ الرفضِ الدقيق", async () => {
    const harness = buildHarness();
    const initData = validInitData();
    const hash = new URLSearchParams(initData).get("hash") ?? "";
    const accepted = await post(harness, { initData });
    expect(accepted.text).not.toContain(hash);
    expect(accepted.text).not.toContain("noura_test");
    expect(accepted.text).not.toContain(SESSION_SECRET);
    expect(accepted.text).not.toContain("AAH-route-test");

    const rejected = await post(harness, {
      initData: tamperField(validInitData(), "user", JSON.stringify({ id: 7 })),
    });
    expect(rejected.text).not.toContain("SIGNATURE_MISMATCH");
    expect(rejected.text).not.toContain("hash");
    expect(Object.keys(rejected.json).sort()).toEqual(["error", "ok"]);
  });

  it("رمزُ جلسةٍ لا يُصدَر إلا موقَّعاً بسرِّ الخادمِ — لا يُقبَل رمزٌ مُلفَّق", () => {
    const forged: IssuedMiniAppSession = {
      accessToken: "wsl1.eyJ2IjoxLCJzdWIiOiI5OTkifQ.forged",
      expiresAtMs: NOW.getTime() + 600_000,
      expiresInSeconds: 600,
      tokenType: "Bearer",
    };
    const read = readMiniAppSession(forged.accessToken, SESSION_SECRET, NOW.getTime());
    expect(read.ok).toBe(false);
  });
});
