/**
 * الغرض: `WR-32` — رسالةُ خصوصيّةِ الراكبِ وسمعتِه في سجلِّ الموافقاتِ: لمن تُطلَبُ،
 *   ومتى تظهرُ، ومتى تكفُّ، ومتى تعودُ — على خادمِ البوابةِ الحقيقيِّ (`/v1/consents`)
 *   وفي طبقةِ بوتِ الراكبِ (`/start`).
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها؛ والقاعدةُ في
 *   `tests/integration/wr-32-rider-privacy.test.ts`.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * والمُدخلاتُ مُصنَّعةٌ: **المُتحقَّقُ منه هو التشغيلُ لا مصداقيةُ المدخلِ**.
 */

import { describe, expect, it } from "bun:test";
import { createServer } from "../../apps/gateway/src/server.ts";
import {
  entryReplies,
  handleSurfaceUpdate,
  type MiniAppSurfaceConfig,
  type SurfacePorts,
} from "../../packages/application/bots/miniapp-surface.ts";
import { INITIAL_STATE, type IncomingUpdate } from "../../packages/application/bots/types.ts";
import type {
  ConsentRecordReader,
  ConsentRecordWriter,
} from "../../packages/application/consent/ports.ts";
import { createRiderPrivacyNoticeProbe } from "../../packages/application/consent/rider-privacy-notice.ts";
import type {
  ViewerAccount,
  ViewerAccountReader,
} from "../../packages/application/identity/ports.ts";
import {
  evaluateOnboardingConsent,
  type RecordedConsent,
  riderPrivacyNoticePending,
} from "../../packages/domain/consent/consent-decision.ts";
import {
  DECLARED_CONSENT_DOCUMENTS,
  documentsFor,
  findDeclaredDocument,
} from "../../packages/domain/consent/consent-documents.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const SESSION_SECRET = "test-only-session-signing-secret-0123456789";
const WEBHOOK_SECRET = "test-webhook-secret-value";
const NOW = new Date("2026-11-03T09:00:00.000Z");
const TELEGRAM_ID = "5550032";

const TERMS = findDeclaredDocument("terms_of_service");
const PRIVACY = findDeclaredDocument("privacy_policy");
const NOTICE = findDeclaredDocument("rider_privacy_notice");
if (TERMS === undefined || PRIVACY === undefined || NOTICE === undefined) {
  throw new Error("سجلُّ الوثائقِ ناقصٌ");
}

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

const at = (offsetMs: number) => NOW.getTime() - offsetMs;
/** راكبٌ سجّلَ قبلَ `WR-32`: وافقَ على الوثيقتينِ الجاريتينِ ولا إقرارَ برسالةٍ. */
const EXISTING_RIDER: readonly RecordedConsent[] = [
  { kind: TERMS.kind, version: TERMS.version, acceptedAtMs: at(86_400_000) },
  { kind: PRIVACY.kind, version: PRIVACY.version, acceptedAtMs: at(86_400_000) },
];

type AccountMode = ViewerAccount["role"] | "none" | "failure" | "absent";

function accountsFor(mode: AccountMode): ViewerAccountReader | undefined {
  if (mode === "absent") return undefined;
  return {
    findByTelegramUserId: async () => {
      if (mode === "failure") return err({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" });
      if (mode === "none") return ok(null);
      return ok({ role: mode, isBlocked: false, languageCode: "ar" });
    },
  };
}

function harness(mode: AccountMode, seed: readonly RecordedConsent[] = []) {
  const rows: RecordedConsent[] = [...seed];
  const reader: ConsentRecordReader = { listForTelegramUser: async () => ok(rows) };
  const writer: ConsentRecordWriter = {
    record: async (command) => {
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
  const accounts = accountsFor(mode);
  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    consents: {
      consent: {
        sessions: createMiniAppSessionReader(SESSION_SECRET),
        reader,
        writer,
        now: () => NOW,
        ...(accounts === undefined ? {} : { accounts }),
      },
    },
  });
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    {
      telegramUserId: TELEGRAM_ID,
      bot: "rider",
      authDateSeconds: Math.floor(NOW.getTime() / 1000),
    },
    NOW.getTime(),
  );
  if (!issued.ok) throw new Error("إصدار فاشل");
  const authorization = `Bearer ${issued.value.accessToken}`;

  const call = async (method: "GET" | "POST", body?: unknown) => {
    const response = await app.fetch(
      new Request("http://localhost/v1/consents", {
        method,
        headers: {
          accept: "application/json",
          authorization,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return {
      status: response.status,
      json: (await response.json()) as {
        documents: { kind: string; audience: string; presentation: string }[];
        onboarding: { satisfied: boolean; documents: { kind: string; state: string }[] };
      },
    };
  };
  return { rows, call };
}

const kinds = (docs: readonly { kind: string }[]) => docs.map((d) => d.kind).sort();
const stateOf = (
  onboarding: { documents: { kind: string; state: string }[] },
  kind: string,
): string | undefined => onboarding.documents.find((d) => d.kind === kind)?.state;

describe("WR-32 — سجلُّ الوثائقِ: الرسالةُ للراكبِ وحدَه", () => {
  it("١) الرسالةُ وثيقةٌ مُعلَنةٌ بإصدارٍ مؤرَّخٍ، جمهورُها الراكبُ، وتُعرَضُ مفتوحةً", () => {
    expect(NOTICE.audience).toBe("rider");
    expect(NOTICE.presentation).toBe("notice");
    expect(NOTICE.requiredForOnboarding).toBe(true);
    expect(NOTICE.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(NOTICE.textKey).toContain(NOTICE.version);
  });

  it("٢) الوثيقتانِ المشتركتانِ لم تتغيّرا: جمهورُهما الكلُّ، وإصدارُهما كما كان", () => {
    for (const document of [TERMS, PRIVACY]) {
      expect(document.audience).toBe("all");
      expect(document.presentation).toBe("document");
    }
    expect(TERMS.version).toBe("2026-09-12");
    expect(PRIVACY.version).toBe("2026-10-13");
  });

  it("٣) الراكبُ يرى الثلاثَ، ومن سواه الاثنتينِ — والافتراضُ «غيرُ راكبٍ»", () => {
    expect(kinds(documentsFor("rider"))).toEqual(kinds(DECLARED_CONSENT_DOCUMENTS));
    expect(kinds(documentsFor("other"))).toEqual(["privacy_policy", "terms_of_service"]);
    expect(kinds(documentsFor())).toEqual(kinds(documentsFor("other")));
  });

  it("٤) سائقٌ وافقَ على الوثيقتينِ تهيئتُه مكتملةٌ بلا رسالةِ الراكبِ", () => {
    expect(evaluateOnboardingConsent(EXISTING_RIDER).satisfied).toBe(true);
    expect(evaluateOnboardingConsent(EXISTING_RIDER, "other").satisfied).toBe(true);
  });

  it("٥) راكبٌ وافقَ على الوثيقتينِ قبلَ الرسالةِ: لم يبقَ عليه إلّا الإقرارُ بها", () => {
    const state = evaluateOnboardingConsent(EXISTING_RIDER, "rider");
    expect(state.satisfied).toBe(false);
    expect(state.documents.filter((d) => d.state !== "satisfied").map((d) => d.kind)).toEqual([
      "rider_privacy_notice",
    ]);
    expect(riderPrivacyNoticePending(EXISTING_RIDER)).toBe(true);
  });

  it("٦) إصدارٌ جديدٌ للرسالةِ يُعيدُها: إقرارٌ بإصدارٍ أقدمَ `superseded`", () => {
    const old: RecordedConsent[] = [
      ...EXISTING_RIDER,
      { kind: NOTICE.kind, version: "2026-01-01", acceptedAtMs: at(3_600_000) },
    ];
    const state = evaluateOnboardingConsent(old, "rider");
    expect(state.documents.find((d) => d.kind === NOTICE.kind)?.state).toBe("superseded");
    expect(riderPrivacyNoticePending(old)).toBe(true);
    const current: RecordedConsent[] = [
      ...old,
      { kind: NOTICE.kind, version: NOTICE.version, acceptedAtMs: at(60_000) },
    ];
    expect(riderPrivacyNoticePending(current)).toBe(false);
    expect(evaluateOnboardingConsent(current, "rider").satisfied).toBe(true);
  });
});

describe("WR-32 — `/v1/consents`: الجمهورُ من دورِ الحسابِ على الخادمِ", () => {
  it("٧) راكبٌ جديدٌ يرى الرسالةَ معلّقةً، ثمَّ يُقِرُّ مرّةً فلا تعودُ", async () => {
    const h = harness("rider");
    const first = await h.call("GET");
    expect(first.status).toBe(200);
    expect(kinds(first.json.documents)).toEqual(kinds(DECLARED_CONSENT_DOCUMENTS));
    const notice = first.json.documents.find((d) => d.kind === NOTICE.kind);
    expect(notice?.presentation).toBe("notice");
    expect(notice?.audience).toBe("rider");
    expect(stateOf(first.json.onboarding, NOTICE.kind)).toBe("missing");

    for (const document of [TERMS, PRIVACY, NOTICE]) {
      const posted = await h.call("POST", {
        kind: document.kind,
        version: document.version,
        accepted: true,
      });
      expect(posted.status).toBe(200);
    }
    // الإقرارُ مسجَّلٌ بإصدارِه ووقتِه من الخادمِ.
    const row = h.rows.find((r) => r.kind === NOTICE.kind);
    expect(row?.version).toBe(NOTICE.version);
    expect(row?.acceptedAtMs).toBe(NOW.getTime());

    const again = await h.call("GET");
    expect(again.json.onboarding.satisfied).toBe(true);
    expect(stateOf(again.json.onboarding, NOTICE.kind)).toBe("satisfied");
    // وإقرارٌ ثانٍ بالإصدارِ نفسِه لا يُضيفُ صفّاً.
    await h.call("POST", { kind: NOTICE.kind, version: NOTICE.version, accepted: true });
    expect(h.rows.filter((r) => r.kind === NOTICE.kind).length).toBe(1);
  });

  it("٨) راكبٌ مسجَّلٌ قبلَ الرسالةِ: الوثيقتانِ «مُستوفاةٌ» والرسالةُ وحدَها معلّقةٌ", async () => {
    const h = harness("rider", EXISTING_RIDER);
    const { json } = await h.call("GET");
    expect(json.onboarding.satisfied).toBe(false);
    expect(stateOf(json.onboarding, TERMS.kind)).toBe("satisfied");
    expect(stateOf(json.onboarding, PRIVACY.kind)).toBe("satisfied");
    expect(stateOf(json.onboarding, NOTICE.kind)).toBe("missing");
    await h.call("POST", { kind: NOTICE.kind, version: NOTICE.version, accepted: true });
    expect((await h.call("GET")).json.onboarding.satisfied).toBe(true);
    // ولا إعادةَ تسجيلٍ: صفّا الوثيقتينِ كما كانا بوقتِهما الأوّلِ.
    expect(h.rows.filter((r) => r.kind !== NOTICE.kind)).toEqual([...EXISTING_RIDER]);
  });

  it("٩) السائقُ لا تُطلَبُ منه رسالةُ الراكبِ — ولا تظهرُ في وثائقِه", async () => {
    const h = harness("driver", EXISTING_RIDER);
    const { json } = await h.call("GET");
    expect(kinds(json.documents)).toEqual(["privacy_policy", "terms_of_service"]);
    expect(json.onboarding.satisfied).toBe(true);
    expect(json.onboarding.documents.some((d) => d.kind === NOTICE.kind)).toBe(false);
  });

  it("١٠) تعذُّرُ قراءةِ الدورِ أو غيابُ الحسابِ أو المنفذِ ⇒ سلوكُ ما قبلَ `WR-32` حرفاً", async () => {
    for (const mode of ["failure", "none", "absent", "admin", "support"] as const) {
      const { json, status } = await harness(mode, EXISTING_RIDER).call("GET");
      expect(status).toBe(200);
      expect(kinds(json.documents)).toEqual(["privacy_policy", "terms_of_service"]);
      expect(json.onboarding.satisfied).toBe(true);
    }
  });
});

const SURFACE: MiniAppSurfaceConfig = {
  mode: "miniapp",
  miniAppUrl: "https://waslah-miniapp.onrender.com/",
};

function surfacePorts(pending: boolean | null | undefined): SurfacePorts {
  return {
    sessions: {
      load: async () => ok(null),
      save: async () => ok(undefined),
      clear: async () => ok(undefined),
    },
    initialState: INITIAL_STATE,
    isRegistered: async () => false,
    ...(pending === undefined ? {} : { riderPrivacyNoticePending: async () => pending }),
  };
}

const startUpdate = (text: string): IncomingUpdate => ({
  kind: "text",
  updateId: 1,
  text,
  from: { telegramUserId: "42", chatId: "42", languageHint: "ar" },
});

const NOTICE_TEXT = translate("ar", "rider.privacy_notice");

describe("WR-32 — بوتُ الراكبِ: الرسالةُ مع `/start` حتى يُقِرَّ بها", () => {
  it("١١) `entryReplies`: الرسالةُ بينَ الترحيبِ وزرِّ الفتحِ للراكبِ في `/start` وحدَه", () => {
    const base = { chatId: "42", language: "ar", registered: false } as const;
    const withNotice = entryReplies(
      SURFACE,
      { ...base, audience: "rider", privacyNotice: true },
      "/start",
    );
    expect(withNotice.length).toBe(3);
    expect(withNotice[1]?.text).toContain(NOTICE_TEXT);
    expect(withNotice[1]?.text).toContain(
      translate("ar", "miniapp.entry.rider_privacy_notice_hint"),
    );
    for (const [audience, command] of [
      ["rider", "/help"],
      ["driver", "/start"],
    ] as const) {
      const replies = entryReplies(SURFACE, { ...base, audience, privacyNotice: true }, command);
      expect(replies.some((r) => r.text.includes(NOTICE_TEXT))).toBe(false);
    }
    const without = entryReplies(SURFACE, { ...base, audience: "rider" }, "/start");
    expect(without.length).toBe(2);
  });

  it("١٢) المِسبارُ: جديدٌ ⇒ تُرسَلُ · أقرَّ ⇒ تكفُّ · تعذُّرٌ ⇒ `null`", async () => {
    const probe = (rows: readonly RecordedConsent[] | "fail") =>
      createRiderPrivacyNoticeProbe({
        listForTelegramUser: async () =>
          rows === "fail" ? err({ code: "CONSENT_STORE_FAILED", reason: "STORE_ERROR" }) : ok(rows),
      });
    expect(await probe([]).pending("42")).toBe(true);
    expect(await probe(EXISTING_RIDER).pending("42")).toBe(true);
    expect(
      await probe([
        ...EXISTING_RIDER,
        { kind: NOTICE.kind, version: NOTICE.version, acceptedAtMs: at(1) },
      ]).pending("42"),
    ).toBe(false);
    expect(await probe("fail").pending("42")).toBe(null);
  });

  it("١٣) `handleSurfaceUpdate`: `/start` يحملُ الرسالةَ ما دامت معلّقةً، ولا يحملُها بعدَ الإقرارِ", async () => {
    const legacy = async () => [];
    const texts = async (pending: boolean | null | undefined, command = "/start") =>
      (
        await handleSurfaceUpdate(
          "rider",
          startUpdate(command),
          SURFACE,
          surfacePorts(pending),
          legacy,
        )
      ).map((r) => r.text);
    expect((await texts(true)).some((t) => t.includes(NOTICE_TEXT))).toBe(true);
    expect((await texts(null)).some((t) => t.includes(NOTICE_TEXT))).toBe(true);
    expect((await texts(false)).some((t) => t.includes(NOTICE_TEXT))).toBe(false);
    expect((await texts(undefined)).some((t) => t.includes(NOTICE_TEXT))).toBe(false);
    expect((await texts(true, "/help")).some((t) => t.includes(NOTICE_TEXT))).toBe(false);
  });
});
