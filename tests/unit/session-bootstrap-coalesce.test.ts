/**
 * الغرض: `LOAD-01` — قراءتا الإقلاعِ المُضمَّنتانِ في `POST /v1/session/telegram` تُقرآنِ
 *   **بنداءٍ واحدٍ** لمنفذِ اللقطةِ، وردُّ المبادلةِ **حرفاً** كما كانَ بالمنفذَينِ المنفردَين.
 *   والسوالبُ: فشلُ اللقطةِ أو رميُها = غيابُ الحقلَينِ لا فشلُ المبادلةِ؛ وفشلُ نصفِها =
 *   غيابُ ذلك النصفِ وحدَه؛ والذاكرةُ لا تعيشُ بعدَ النداءِ (لا تخزينَ لحجبٍ ولا دور).
 * الحالة: اختبار فعلي — الخادمُ الحقيقيُّ في العمليّةِ نفسِها بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: التكافؤُ على PostgreSQL الحقيقيِّ في
 *   `tests/integration/session-bootstrap-snapshot.test.ts`.
 */

import { describe, expect, it } from "bun:test";
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
  coalescedBootstrapPorts,
  type SessionBootstrapSnapshot,
  type SessionBootstrapSnapshotReader,
} from "../../packages/application/identity/session-bootstrap.ts";
import type { RecordedConsent } from "../../packages/domain/consent/consent-decision.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../packages/infrastructure/identity/telegram-init-data.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
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

const RIDER: ViewerAccount = { role: "rider", isBlocked: false, languageCode: "ar" };
const RECORDED: readonly RecordedConsent[] = [
  { kind: "terms", version: "2026-09-01", acceptedAtMs: NOW.getTime() - 60_000 },
  { kind: "privacy", version: "2026-09-01", acceptedAtMs: NOW.getTime() - 30_000 },
];

/** المنفذانِ المنفردانِ — يعدّانِ نداءاتِهما كي يُثبَتَ أنَّ الإقلاعَ لم يلمسْهما. */
function separatePorts(account: ViewerAccount, recorded: readonly RecordedConsent[]) {
  const calls = { accounts: 0, consents: 0 };
  const accounts: ViewerAccountReader = {
    findByTelegramUserId: async () => {
      calls.accounts += 1;
      return ok(account);
    },
  };
  const reader: ConsentRecordReader = {
    listForTelegramUser: async () => {
      calls.consents += 1;
      return ok(recorded);
    },
  };
  return { calls, accounts, reader };
}

function countingSnapshot(
  outcome: SessionBootstrapSnapshot | "throws",
): SessionBootstrapSnapshotReader & { readonly ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    read: async (telegramUserId) => {
      ids.push(telegramUserId);
      if (outcome === "throws") throw new Error("boom");
      return outcome;
    },
  };
}

function buildApp(options: {
  readonly account?: ViewerAccount;
  readonly snapshot?: SessionBootstrapSnapshotReader;
  readonly mountConsents?: boolean;
}) {
  const ports = separatePorts(options.account ?? RIDER, RECORDED);
  const writer: ConsentRecordWriter = {
    record: async () => err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
  };
  const sessions = () => createMiniAppSessionReader(SESSION_SECRET);
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
  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    sessionTelegram: {
      exchange,
      ...(options.snapshot === undefined ? {} : { bootstrap: { snapshot: options.snapshot } }),
    },
    me: {
      viewer: {
        sessions: sessions(),
        accounts: ports.accounts,
        now: () => NOW,
      },
    },
    ...(options.mountConsents === false
      ? {}
      : {
          consents: {
            consent: {
              sessions: sessions(),
              reader: ports.reader,
              writer,
              now: () => NOW,
            },
          },
        }),
  });
  return { app, calls: ports.calls };
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
    queryId: "AAH-coalesce-test",
  });
  return call(app, "/v1/session/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

const GOOD: SessionBootstrapSnapshot = { account: ok(RIDER), consents: ok(RECORDED) };

describe("LOAD-01 — قراءتا الإقلاعِ بنداءٍ واحدٍ لمنفذِ اللقطة", () => {
  it("نداءٌ واحدٌ للّقطةِ، صفرٌ للمنفذَينِ المنفردَينِ، والردُّ حرفاً كردِّ المسارَينِ المستقلَّين", async () => {
    const snapshot = countingSnapshot(GOOD);
    const { app, calls } = buildApp({ snapshot });
    const exchanged = await exchangeOnce(app);
    expect(exchanged.status).toBe(201);
    expect(snapshot.ids).toEqual([String(SAMPLE_USER.id)]);
    expect(calls).toEqual({ accounts: 0, consents: 0 });

    const headers = { authorization: `Bearer ${String(exchanged.json.accessToken)}` };
    const me = await call(app, "/v1/me", { headers });
    const consents = await call(app, "/v1/consents", { headers });
    expect(me.status).toBe(200);
    expect(consents.status).toBe(200);
    expect(exchanged.json.viewer).toEqual(me.json);
    expect(exchanged.json.consents).toEqual(consents.json);
    // المسارانِ المستقلّانِ ما زالا على منفذَيهما — اللقطةُ للإقلاعِ وحدَه.
    expect(calls).toEqual({ accounts: 1, consents: 1 });
    expect(snapshot.ids.length).toBe(1);
  });

  it("سالبٌ: فشلُ اللقطةِ أو رميُها يُغيِّبُ الحقلَينِ ولا يُسقِطُ المبادلةَ", async () => {
    const failed: SessionBootstrapSnapshot = {
      account: err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" }),
      consents: err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
    };
    for (const outcome of [failed, "throws"] as const) {
      const { app, calls } = buildApp({ snapshot: countingSnapshot(outcome) });
      const exchanged = await exchangeOnce(app);
      expect(exchanged.status).toBe(201);
      expect(typeof exchanged.json.accessToken).toBe("string");
      expect("viewer" in exchanged.json).toBe(false);
      expect("consents" in exchanged.json).toBe(false);
      expect(calls).toEqual({ accounts: 0, consents: 0 });
    }
  });

  it("سالبٌ: فشلُ نصفِ اللقطةِ يُغيِّبُ ذلك النصفَ وحدَه", async () => {
    const roleUnknown = countingSnapshot({
      account: err({ code: "VIEWER_LOOKUP_FAILED", reason: "UNSUPPORTED_ROLE" }),
      consents: ok(RECORDED),
    });
    const a = await exchangeOnce(buildApp({ snapshot: roleUnknown }).app);
    expect(a.status).toBe(201);
    expect("viewer" in a.json).toBe(false);
    expect("consents" in a.json).toBe(true);

    const storeDown = countingSnapshot({
      account: ok(RIDER),
      consents: err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }),
    });
    const b = await exchangeOnce(buildApp({ snapshot: storeDown }).app);
    expect(b.status).toBe(201);
    expect("viewer" in b.json).toBe(true);
    expect("consents" in b.json).toBe(false);
  });

  it("سالبٌ: حسابٌ محظورٌ في اللقطةِ لا يُضمَّنُ له عارضٌ — كما بالمنفذِ المنفرد", async () => {
    const blocked = countingSnapshot({
      account: ok({ role: "rider", isBlocked: true, languageCode: "ar" }),
      consents: ok([]),
    });
    const exchanged = await exchangeOnce(buildApp({ snapshot: blocked }).app);
    expect(exchanged.status).toBe(201);
    expect("viewer" in exchanged.json).toBe(false);
  });

  it("قراءةٌ واحدةٌ مُركَّبةٌ وحدَها = لا لقطةَ: المنفذُ المنفردُ كما كانَ", async () => {
    const snapshot = countingSnapshot(GOOD);
    const { app, calls } = buildApp({ snapshot, mountConsents: false });
    const exchanged = await exchangeOnce(app);
    expect(exchanged.status).toBe(201);
    expect(snapshot.ids).toEqual([]);
    expect(calls.accounts).toBe(1);
    expect("viewer" in exchanged.json).toBe(true);
    expect("consents" in exchanged.json).toBe(false);
  });

  it("الذاكرةُ لكلِّ زوجٍ وحدَه: نداءانِ بالمعرّفِ نفسِه = قراءةٌ، وزوجٌ جديدٌ = قراءةٌ جديدة", async () => {
    const snapshot = countingSnapshot(GOOD);
    const first = coalescedBootstrapPorts(snapshot);
    await Promise.all([
      first.accounts.findByTelegramUserId("42"),
      first.consents.listForTelegramUser("42"),
    ]);
    expect(snapshot.ids).toEqual(["42"]);
    await first.accounts.findByTelegramUserId("43");
    expect(snapshot.ids).toEqual(["42", "43"]);
    const second = coalescedBootstrapPorts(snapshot);
    await second.consents.listForTelegramUser("42");
    expect(snapshot.ids).toEqual(["42", "43", "42"]);
  });
});
