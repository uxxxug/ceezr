/**
 * الغرض: اختبارُ مسارَي `/v1/consents` على خادمِ البوابةِ الحقيقيِّ نفسِه
 *   (`F2-01`): القبولُ، وكلُّ رفضٍ برمزِه ورقمِه، وأنَّ الهويّةَ **لا تُقرأُ من
 *   الطلبِ** بأيِّ وجهٍ، وأنَّ الختمَ الزمنيَّ من الخادمِ لا من العميلِ، وأنَّ
 *   التعطيلَ معلَنٌ عندَ غيابِ التبعياتِ.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حدُّ المعدَّلِ (القسم 10) بلا أرقامٍ في العقدِ فلا يُختبَرُ ههنا.
 *
 * والمُدخلاتُ مُصنَّعةٌ: **المُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخلِ**.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  ConsentRecordReader,
  ConsentRecordWriter,
  RecordConsentCommand,
} from "../../packages/application/consent/ports.ts";
import type { RecordedConsent } from "../../packages/domain/consent/consent-decision.ts";
import { findDeclaredDocument } from "../../packages/domain/consent/consent-documents.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2027-03-01T09:00:00.000Z");
const TELEGRAM_ID = "5550001";

const TERMS = findDeclaredDocument("terms_of_service");
const PRIVACY = findDeclaredDocument("privacy_policy");
if (TERMS === undefined || PRIVACY === undefined) throw new Error("سجلُّ الوثائقِ ناقصٌ");

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
  readonly rows: RecordedConsent[];
  readonly writes: RecordConsentCommand[];
  readonly readIds: string[];
}

type StoreMode = "ok" | "user_not_found" | "store_error";

function buildHarness(
  options: {
    readonly seed?: readonly RecordedConsent[];
    readonly mode?: StoreMode;
    readonly mounted?: boolean;
    readonly configured?: boolean;
    readonly now?: Date;
  } = {},
): Harness {
  const rows: RecordedConsent[] = [...(options.seed ?? [])];
  const writes: RecordConsentCommand[] = [];
  const readIds: string[] = [];
  const mode = options.mode ?? "ok";
  const now = options.now ?? NOW;

  const reader: ConsentRecordReader = {
    listForTelegramUser: async (telegramUserId) => {
      readIds.push(telegramUserId);
      if (mode === "store_error") {
        return err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" });
      }
      if (mode === "user_not_found") {
        return err({ code: "CONSENT_STORE_FAILED", reason: "USER_NOT_FOUND" });
      }
      return ok(rows);
    },
  };

  const writer: ConsentRecordWriter = {
    record: async (command) => {
      writes.push(command);
      if (mode === "store_error") {
        return err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" });
      }
      if (mode === "user_not_found") {
        return err({ code: "CONSENT_STORE_FAILED", reason: "USER_NOT_FOUND" });
      }
      const existing = rows.find((r) => r.kind === command.kind && r.version === command.version);
      if (existing !== undefined) {
        return ok({ status: "already_recorded", acceptedAtMs: existing.acceptedAtMs });
      }
      rows.push({
        kind: command.kind,
        version: command.version,
        acceptedAtMs: command.acceptedAtMs,
      });
      return ok({ status: "recorded", acceptedAtMs: command.acceptedAtMs });
    },
  };

  const consent = {
    sessions: createMiniAppSessionReader(SESSION_SECRET),
    reader,
    writer,
    now: () => now,
  };
  const consents =
    options.mounted === false
      ? undefined
      : { ...(options.configured === false ? {} : { consent }) };

  const app = createServer({
    health: { now: () => now, startedAt: now, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    ...(consents === undefined ? {} : { consents }),
  });
  return { app, rows, writes, readIds };
}

function tokenFor(at: Date = NOW, telegramUserId: string = TELEGRAM_ID): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot: "rider", authDateSeconds: Math.floor(at.getTime() / 1000) },
    at.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  return issued.value.accessToken;
}

function authed(token: string = tokenFor()): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function call(
  harness: Harness,
  init: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly rawBody?: string;
  },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const hasBody = init.rawBody !== undefined || init.body !== undefined;
  const response = await harness.app.fetch(
    new Request("http://localhost/v1/consents", {
      method: init.method,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      ...(hasBody ? { body: init.rawBody ?? JSON.stringify(init.body) } : {}),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Record<string, unknown> };
}

describe("GET /v1/consents", () => {
  it("١) يعيدُ الوثائقَ الجاريةَ ومفاتيحَ نصِّها وحالةَ «ناقصٌ» لسجلٍّ فارغٍ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, { method: "GET", headers: authed() });

    expect(status).toBe(200);
    const documents = json.documents as {
      kind: string;
      titleKey: string;
      textKey: string;
      version: string;
    }[];
    expect(documents.map((d) => d.kind).sort()).toEqual(
      [TERMS.kind, PRIVACY.kind].sort() as string[],
    );
    for (const document of documents) {
      expect(document.titleKey.length).toBeGreaterThan(0);
      expect(document.textKey.length).toBeGreaterThan(0);
      expect(document.version.length).toBeGreaterThan(0);
    }
    const onboarding = json.onboarding as { satisfied: boolean; documents: { state: string }[] };
    expect(onboarding.satisfied).toBe(false);
    expect(onboarding.documents.every((d) => d.state === "missing")).toBe(true);
  });

  it("٢) يقرأُ السجلَّ بمعرّفِ الرمزِ الموقَّعِ لا بما في الطلبِ", async () => {
    const harness = buildHarness();
    await call(harness, {
      method: "GET",
      headers: { ...authed(tokenFor(NOW, "777000")), "x-telegram-user-id": "1" },
    });
    expect(harness.readIds).toEqual(["777000"]);
  });

  it("٣) بلا ترويسةِ تفويضٍ: 401 `SESSION_REQUIRED` ولا نداءَ للسجلِّ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, { method: "GET" });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
    expect(harness.readIds).toEqual([]);
  });

  it("٤) رمزٌ مشوَّهٌ: 401 `SESSION_INVALID`", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, {
      method: "GET",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_INVALID");
  });

  it("٥) عطلُ السجلِّ: 503 ولا يُعادُ جسمٌ يُقرأُ «لا شيءَ مطلوبٌ»", async () => {
    const harness = buildHarness({ mode: "store_error" });
    const { status, json } = await call(harness, { method: "GET", headers: authed() });
    expect(status).toBe(503);
    expect(json.error).toBe("CONSENT_STORE_NOT_AVAILABLE");
    expect(json.documents).toBeUndefined();
  });

  it("٦) لا صفَّ مستخدمٍ: 404 `ACCOUNT_NOT_FOUND` لا 401 ولا إنشاءَ حسابٍ", async () => {
    const harness = buildHarness({ mode: "user_not_found" });
    const { status, json } = await call(harness, { method: "GET", headers: authed() });
    expect(status).toBe(404);
    expect(json.error).toBe("ACCOUNT_NOT_FOUND");
    expect(harness.writes).toEqual([]);
  });

  it("٧) غيابُ التبعياتِ تعطيلٌ معلَنٌ 503، وغيابُ التركيبِ 404", async () => {
    const disabled = buildHarness({ configured: false });
    const off = await call(disabled, { method: "GET", headers: authed() });
    expect(off.status).toBe(503);
    expect(off.json.error).toBe("CONSENT_STORE_NOT_AVAILABLE");

    const unmounted = buildHarness({ mounted: false });
    const missing = await call(unmounted, { method: "GET", headers: authed() });
    expect(missing.status).toBe(404);
  });
});

describe("POST /v1/consents", () => {
  it("٨) يُسجِّلُ وثيقةً واحدةً ويعيدُ ختماً من الخادمِ لا من العميلِ", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, {
      method: "POST",
      headers: authed(),
      body: {
        kind: TERMS.kind,
        version: TERMS.version,
        accepted: true,
        acceptedAt: "1999-01-01T00:00:00.000Z",
        userId: "attacker",
        cityId: "attacker-city",
      },
    });

    expect(status).toBe(200);
    expect(json.status).toBe("recorded");
    expect(json.acceptedAt).toBe(NOW.toISOString());
    expect(harness.writes.length).toBe(1);
    expect(harness.writes[0]?.telegramUserId).toBe(TELEGRAM_ID);
    expect(harness.writes[0]?.acceptedAtMs).toBe(NOW.getTime());
    // لا حقلَ في أمرِ الكتابةِ يستقبلُ هويّةً أو مدينةً من الجسمِ أصلاً.
    expect(Object.keys(harness.writes[0] ?? {}).sort()).toEqual([
      "acceptedAtMs",
      "kind",
      "telegramUserId",
      "version",
    ]);
  });

  it("٩) وثيقةٌ واحدةٌ لا تُكمِلُ التهيئةَ، والثانيةُ تُكمِلُها", async () => {
    const harness = buildHarness();
    const first = await call(harness, {
      method: "POST",
      headers: authed(),
      body: { kind: TERMS.kind, version: TERMS.version, accepted: true },
    });
    expect((first.json.onboarding as { satisfied: boolean }).satisfied).toBe(false);

    const second = await call(harness, {
      method: "POST",
      headers: authed(),
      body: { kind: PRIVACY.kind, version: PRIVACY.version, accepted: true },
    });
    expect((second.json.onboarding as { satisfied: boolean }).satisfied).toBe(true);
  });

  it("١٠) إعادةُ الإرسالِ لا تُنشئُ صفّاً ثانياً ولا تُحرِّكُ الختمَ", async () => {
    const harness = buildHarness();
    const body = { kind: TERMS.kind, version: TERMS.version, accepted: true };
    const first = await call(harness, { method: "POST", headers: authed(), body });
    const again = await call(harness, { method: "POST", headers: authed(), body });

    expect(first.json.status).toBe("recorded");
    expect(again.json.status).toBe("already_recorded");
    expect(again.json.acceptedAt).toBe(first.json.acceptedAt);
    expect(harness.rows.filter((r) => r.kind === TERMS.kind).length).toBe(1);
  });

  it("١١) بلا `accepted: true` لا كتابةَ: 400 `NOT_ACCEPTED`", async () => {
    for (const accepted of [false, "true", 1, null]) {
      const harness = buildHarness();
      const { status, json } = await call(harness, {
        method: "POST",
        headers: authed(),
        body: { kind: TERMS.kind, version: TERMS.version, accepted },
      });
      expect(status).toBe(400);
      expect(json.error).toBe("NOT_ACCEPTED");
      expect(harness.writes).toEqual([]);
    }
  });

  it("١٢) إصدارٌ قديمٌ أو وثيقةٌ مجهولةٌ: 400 برمزٍ يفرِّقُ بينهما ولا كتابةَ", async () => {
    const stale = buildHarness();
    const staleResult = await call(stale, {
      method: "POST",
      headers: authed(),
      body: { kind: TERMS.kind, version: "1900-01-01", accepted: true },
    });
    expect(staleResult.status).toBe(400);
    expect(staleResult.json.error).toBe("VERSION_NOT_CURRENT");
    expect(stale.writes).toEqual([]);

    const unknown = buildHarness();
    const unknownResult = await call(unknown, {
      method: "POST",
      headers: authed(),
      body: { kind: "cookie_banner", version: TERMS.version, accepted: true },
    });
    expect(unknownResult.status).toBe(400);
    expect(unknownResult.json.error).toBe("UNKNOWN_DOCUMENT");
    expect(unknown.writes).toEqual([]);
  });

  it("١٣) حقولٌ ناقصةٌ أو غيرُ نصوصٍ: 400 `MALFORMED` ولا كتابةَ", async () => {
    for (const body of [{}, { kind: TERMS.kind }, { kind: 7, version: 8, accepted: true }]) {
      const harness = buildHarness();
      const { status, json } = await call(harness, { method: "POST", headers: authed(), body });
      expect(status).toBe(400);
      expect(json.error).toBe("MALFORMED");
      expect(harness.writes).toEqual([]);
    }
  });

  it("١٤) جسمٌ ليس JSON أو ليس كائناً: 400 ولا كتابةَ", async () => {
    const broken = buildHarness();
    const brokenResult = await call(broken, {
      method: "POST",
      headers: authed(),
      rawBody: "{ليس",
    });
    expect(brokenResult.status).toBe(400);
    expect(brokenResult.json.error).toBe("INVALID_JSON");

    const array = buildHarness();
    const arrayResult = await call(array, { method: "POST", headers: authed(), body: [1, 2] });
    expect(arrayResult.status).toBe(400);
    expect(arrayResult.json.error).toBe("INVALID_BODY");
    expect(array.writes).toEqual([]);
  });

  it("١٥) جسمٌ ضخمٌ يُرَدُّ 413 قبلَ قراءتِه كاملاً", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, {
      method: "POST",
      headers: authed(),
      rawBody: JSON.stringify({ kind: TERMS.kind, version: "x".repeat(4096), accepted: true }),
    });
    expect(status).toBe(413);
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
    expect(harness.writes).toEqual([]);
  });

  it("١٦) بلا جلسةٍ: 401 ولا كتابةَ ولو كانَ الجسمُ سليماً تماماً", async () => {
    const harness = buildHarness();
    const { status, json } = await call(harness, {
      method: "POST",
      body: { kind: TERMS.kind, version: TERMS.version, accepted: true },
    });
    expect(status).toBe(401);
    expect(json.error).toBe("SESSION_REQUIRED");
    expect(harness.writes).toEqual([]);
  });
});
