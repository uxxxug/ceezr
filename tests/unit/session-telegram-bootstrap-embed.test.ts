/**
 * الغرض: `ADR 0210` — ردُّ `POST /v1/session/telegram` يُضمِّنُ قراءتَي الإقلاعِ
 *   (`viewer` بشكلِ `GET /v1/me` و`consents` بشكلِ `GET /v1/consents`) **حرفاً**،
 *   فيسقطُ ذهابٌ وإيابٌ من مسارِ الإقلاعِ. والسوالبُ: فشلُ قراءةٍ = غيابُها لا فشلُ
 *   المبادلةِ، وغيابُ تركيبِ مسارٍ = غيابُ حقلِه، وحسابٌ محظورٌ لا يُضمَّنُ له عارضٌ.
 * الحالة: اختبار فعلي — الخادمُ الحقيقيُّ في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: لا شيء.
 */

import { describe, expect, it } from "bun:test";
import { bootstrapReads } from "../../apps/gateway/src/routes/session-telegram.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  ConsentRecordReader,
  ConsentRecordWriter,
} from "../../packages/application/consent/ports.ts";
import type {
  ViewerAccount,
  ViewerAccountReader,
} from "../../packages/application/identity/ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { createTestRevocationStore } from "../helpers/revocation-store.ts";
import {
  buildInitData,
  FAKE_DRIVER_BOT_TOKEN,
  FAKE_RIDER_BOT_TOKEN,
  SAMPLE_USER,
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

type AccountOutcome = ViewerAccount | "failure" | "throws";
type ConsentOutcome = "ok" | "failure" | "throws";

function viewerDeps(outcome: AccountOutcome) {
  const accounts: ViewerAccountReader = {
    findByTelegramUserId: async () => {
      if (outcome === "throws") throw new Error("boom");
      if (outcome === "failure")
        return err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" });
      return ok(outcome);
    },
  };
  return {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    revocation: createTestRevocationStore(),
    accounts,
    now: () => NOW,
  };
}

function consentDeps(outcome: ConsentOutcome) {
  const reader: ConsentRecordReader = {
    listForTelegramUser: async () => {
      if (outcome === "throws") throw new Error("boom");
      if (outcome === "failure")
        return err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" });
      return ok([]);
    },
  };
  const writer: ConsentRecordWriter = {
    record: async () => err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
  };
  return {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    revocation: createTestRevocationStore(),
    reader,
    writer,
    now: () => NOW,
  };
}

const RIDER: ViewerAccount = { role: "rider", isBlocked: false, languageCode: "ar" };

function buildApp(
  options: { account?: AccountOutcome; consent?: ConsentOutcome; mountReads?: boolean } = {},
) {
  const exchange = {
    verifier: createTelegramInitDataVerifier({
      bots: [
        { name: "driver", token: FAKE_DRIVER_BOT_TOKEN },
        { name: "rider", token: FAKE_RIDER_BOT_TOKEN },
      ],
    }),
    issuer: createMiniAppSessionIssuer({ secret: SESSION_SECRET }),
    now: () => NOW,
  };
  const mount = options.mountReads !== false;
  return createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    sessionTelegram: { exchange },
    ...(mount ? { me: { viewer: viewerDeps(options.account ?? RIDER) } } : {}),
    ...(mount ? { consents: { consent: consentDeps(options.consent ?? "ok") } } : {}),
  });
}

async function call(app: ReturnType<typeof createServer>, path: string, init: RequestInit) {
  const response = await app.fetch(new Request(`http://localhost${path}`, init));
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function exchangeOnce(app: ReturnType<typeof createServer>) {
  const initData = buildInitData({
    botToken: FAKE_RIDER_BOT_TOKEN,
    authDateSeconds: NOW_SECONDS - 10,
    user: SAMPLE_USER,
    queryId: "AAH-embed-test",
  });
  return call(app, "/v1/session/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

describe("ADR 0210 — تضمينُ قراءتَي الإقلاعِ في ردِّ المبادلةِ", () => {
  it("يُضمِّنُ العارضَ والإقراراتِ بشكلِ ردِّ مسارَيهما المستقلَّينِ حرفاً وبالرمزِ نفسِه", async () => {
    const app = buildApp();
    const exchanged = await exchangeOnce(app);
    expect(exchanged.status).toBe(201);
    const headers = { authorization: `Bearer ${String(exchanged.json.accessToken)}` };
    const me = await call(app, "/v1/me", { headers });
    const consents = await call(app, "/v1/consents", { headers });
    expect(me.status).toBe(200);
    expect(consents.status).toBe(200);
    expect(exchanged.json.viewer).toEqual(me.json);
    expect(exchanged.json.consents).toEqual(consents.json);
  });

  it("غيابُ تركيبِ المسارَينِ = ردٌّ بلا الحقلَينِ (كما كانَ حرفاً)", async () => {
    const exchanged = await exchangeOnce(buildApp({ mountReads: false }));
    expect(exchanged.status).toBe(201);
    expect("viewer" in exchanged.json).toBe(false);
    expect("consents" in exchanged.json).toBe(false);
  });

  it("سالبٌ: فشلُ قراءةٍ أو رميُها يُغيِّبُ حقلَها وحدَه ولا يُسقِطُ المبادلةَ", async () => {
    for (const [account, consent] of [
      ["failure", "ok"],
      ["throws", "ok"],
      [RIDER, "failure"],
      [RIDER, "throws"],
    ] as const) {
      const exchanged = await exchangeOnce(buildApp({ account, consent }));
      expect(exchanged.status).toBe(201);
      expect(typeof exchanged.json.accessToken).toBe("string");
      expect("viewer" in exchanged.json).toBe(account === RIDER);
      expect("consents" in exchanged.json).toBe(consent === "ok");
    }
  });

  it("سالبٌ: حسابٌ محظورٌ لا يُضمَّنُ له عارضٌ — فيقرأُ العميلُ `403` من مسارِه المستقلِّ", async () => {
    const app = buildApp({ account: { role: "rider", isBlocked: true, languageCode: "ar" } });
    const exchanged = await exchangeOnce(app);
    expect(exchanged.status).toBe(201);
    expect("viewer" in exchanged.json).toBe(false);
    const me = await call(app, "/v1/me", {
      headers: { authorization: `Bearer ${String(exchanged.json.accessToken)}` },
    });
    expect(me.status).toBe(403);
  });

  it("بلا تبعيّاتٍ = كائنٌ فارغٌ، ورمزٌ غيرُ صالحٍ = لا تضمينَ", async () => {
    expect(await bootstrapReads(undefined, "x")).toEqual({});
    expect(
      await bootstrapReads(
        { viewer: viewerDeps(RIDER), consent: consentDeps("ok") },
        "not-a-token",
      ),
    ).toEqual({});
  });
});
