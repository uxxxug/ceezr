/**
 * الغرض: اختبارُ سجلِّ النجاحِ لمسارَي «إلى أين؟» والاقتباسِ (PRD-008) على خادمِ
 *   البوابةِ الحقيقيِّ نفسِه: يُكتَبُ سطرٌ واحدٌ عندَ جوابِ `200` وحدَه، ويحملُ
 *   رمزَ النتيجةِ وحدَه، ولا يحملُ استفهاماً ولا اسماً ولا إحداثيّةً ولا مسافةً
 *   ولا مدينةً ولا مُعرِّفَ Telegram — والحمولةُ نفسُها لا تتغيّرُ بوجودِ السجلّ.
 * الحالة: اختبار فعلي — Hono يعالجُ الطلبَ في العمليةِ نفسِها بلا شبكةٍ ولا قاعدةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * وما لا يفعلُه: لا يزعمُ أنَّ السطرَ ظهرَ في الإنتاجِ — ذاك دليلُ PRD-008 الحيّ.
 */

import { describe, expect, it } from "bun:test";
import {
  resolveAnsweredMeta,
  searchAnsweredMeta,
} from "../../apps/gateway/src/routes/destinations.ts";
import { quoteAnsweredMeta } from "../../apps/gateway/src/routes/quote.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type {
  DestinationResolver,
  DestinationSearcher,
  DestinationSuggestion,
  DestinationVerdict,
} from "../../packages/application/destinations/ports.ts";
import type { QuoteJudge, QuoteVerdict } from "../../packages/application/quote/ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { ok } from "../../packages/shared/result/index.ts";

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

const CITY = { code: "MED", nameAr: "المدينة المنورة", nameEn: "Madinah" } as const;
const DEST_LAT = 24.4672;
const DEST_LNG = 39.6112;
const LABEL_AR = "المسجد النبوي";

const SUGGESTION: DestinationSuggestion = {
  source: "landmark",
  refId: "lm-1",
  kind: "mosque",
  labelAr: LABEL_AR,
  labelEn: "Prophet's Mosque",
  lat: DEST_LAT,
  lng: DEST_LNG,
  matchRank: 1,
} as DestinationSuggestion;

const ACCEPTED_DESTINATION: DestinationVerdict = {
  accepted: true,
  destination: {
    lat: DEST_LAT,
    lng: DEST_LNG,
    city: { ...CITY, areaVersion: "med-envelope-v1" },
    nearest: {
      kind: "mosque",
      nameAr: LABEL_AR,
      nameEn: "Prophet's Mosque",
      straightDistanceM: 12,
    },
  },
};

const ACCEPTED_QUOTE: QuoteVerdict = {
  accepted: true,
  quote: {
    city: CITY,
    areaVersion: "med-envelope-v1",
    distance: { kind: "STRAIGHT_LINE", meters: 4321.5 },
    servedServices: ["transport"],
  },
};

interface LogLine {
  readonly event: string;
  readonly meta: Record<string, unknown>;
}

function build(
  options: {
    readonly suggestions?: readonly DestinationSuggestion[];
    readonly verdict?: DestinationVerdict;
    readonly quote?: QuoteVerdict;
    readonly withLog?: boolean;
  } = {},
) {
  const lines: LogLine[] = [];
  const log =
    options.withLog === false
      ? undefined
      : (event: string, meta: Record<string, unknown>) => {
          lines.push({ event, meta });
        };

  const searcher: DestinationSearcher = {
    searchForTelegramUser: async () => ok(options.suggestions ?? [SUGGESTION]),
  } as unknown as DestinationSearcher;
  const resolver: DestinationResolver = {
    resolveForTelegramUser: async () => ok(options.verdict ?? ACCEPTED_DESTINATION),
  };
  const judge: QuoteJudge = { judge: async () => ok(options.quote ?? ACCEPTED_QUOTE) };

  const sessions = createMiniAppSessionReader(SESSION_SECRET);
  const app = createServer({
    health: { now: () => NOW, startedAt: NOW, env: FULL_ENV },
    webhook: { webhookSecret: WEBHOOK_SECRET, handler: { handle: async () => true } },
    destinations: {
      destinations: { sessions, searcher, resolver, now: () => NOW },
      ...(log === undefined ? {} : { log }),
    },
    quote: {
      quote: {
        sessions,
        judge,
        routing: null,
        now: () => NOW,
      },
      ...(log === undefined ? {} : { log }),
    },
  });
  return { app, lines };
}

function token(): string {
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

async function search(app: ReturnType<typeof build>["app"], auth = true) {
  const res = await app.fetch(
    new Request(`http://localhost/v1/destinations/search?q=${encodeURIComponent("المسجد")}`, {
      headers: auth ? { authorization: `Bearer ${token()}` } : {},
    }),
  );
  return { status: res.status, text: await res.text() };
}

async function post(
  app: ReturnType<typeof build>["app"],
  path: string,
  body: unknown,
  auth = true,
) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${token()}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, text: await res.text() };
}

const RESOLVE_BODY = { lat: DEST_LAT, lng: DEST_LNG };
const QUOTE_BODY = {
  originLat: 24.47,
  originLng: 39.6,
  destinationLat: DEST_LAT,
  destinationLng: DEST_LNG,
};

/** ما لا يجوزُ أن يظهرَ في أيِّ سطرٍ: هويّةٌ، استفهامٌ، اسمٌ، إحداثيّةٌ، مسافةٌ، مدينة. */
const FORBIDDEN = [
  TELEGRAM_ID,
  "المسجد",
  LABEL_AR,
  "Prophet",
  String(DEST_LAT),
  String(DEST_LNG),
  "24.47",
  "39.6",
  "4321",
  "Madinah",
  "MED",
  "lm-1",
];

function expectNoPersonalData(lines: readonly LogLine[]) {
  const serialized = JSON.stringify(lines);
  for (const needle of FORBIDDEN) expect(serialized).not.toContain(needle);
}

describe("سجلُّ النجاح — البحثُ عن الوجهة", () => {
  it("جوابُ 200 باقتراحاتٍ يكتبُ `destinations.search_answered` برمزِ النتيجةِ وحدَه", async () => {
    const { app, lines } = build();
    const res = await search(app);
    expect(res.status).toBe(200);
    expect(lines).toEqual([
      { event: "destinations.search_answered", meta: { outcome: "SUGGESTIONS" } },
    ]);
    expectNoPersonalData(lines);
  });

  it("جوابُ 200 بلا اقتراحاتٍ يكتبُ `NO_MATCH`", async () => {
    const { app, lines } = build({ suggestions: [] });
    expect((await search(app)).status).toBe(200);
    expect(lines).toEqual([
      { event: "destinations.search_answered", meta: { outcome: "NO_MATCH" } },
    ]);
  });

  it("الرفضُ (401) لا يكتبُ سطرَ نجاح", async () => {
    const { app, lines } = build();
    expect((await search(app, false)).status).toBe(401);
    expect(lines).toEqual([]);
  });
});

describe("سجلُّ النجاح — مصادقةُ الوجهة", () => {
  it("القبولُ يكتبُ `destinations.resolve_answered` بلا إحداثيّةٍ ولا اسم", async () => {
    const { app, lines } = build();
    expect((await post(app, "/v1/destinations/resolve", RESOLVE_BODY)).status).toBe(200);
    expect(lines).toEqual([
      { event: "destinations.resolve_answered", meta: { accepted: true, refusal: null } },
    ]);
    expectNoPersonalData(lines);
  });

  it("الرفضُ المقيسُ (200) يكتبُ رمزَ الرفضِ وحدَه", async () => {
    const { app, lines } = build({
      verdict: { accepted: false, refusal: "OUTSIDE_SERVICE_AREA", city: null },
    });
    expect((await post(app, "/v1/destinations/resolve", RESOLVE_BODY)).status).toBe(200);
    expect(lines).toEqual([
      {
        event: "destinations.resolve_answered",
        meta: { accepted: false, refusal: "OUTSIDE_SERVICE_AREA" },
      },
    ]);
  });
});

describe("سجلُّ النجاح — الاقتباس", () => {
  it("القبولُ يكتبُ `quote.answered` بالرموزِ وحدَها: لا أمتارَ ولا مدينةَ ولا إحداثيّة", async () => {
    const { app, lines } = build();
    expect((await post(app, "/v1/quote/ride", QUOTE_BODY)).status).toBe(200);
    expect(lines).toEqual([
      {
        event: "quote.answered",
        meta: {
          accepted: true,
          refusal: null,
          distanceKind: "STRAIGHT_LINE",
          eta: "UNAVAILABLE:NOT_CONFIGURED",
        },
      },
    ]);
    expectNoPersonalData(lines);
  });

  it("الرفضُ المقيسُ يكتبُ رمزَه وحدَه", async () => {
    const { app, lines } = build({
      quote: { accepted: false, refusal: "DESTINATION_OUTSIDE_SERVICE_AREA", city: CITY },
    });
    expect((await post(app, "/v1/quote/ride", QUOTE_BODY)).status).toBe(200);
    expect(lines).toEqual([
      {
        event: "quote.answered",
        meta: {
          accepted: false,
          refusal: "DESTINATION_OUTSIDE_SERVICE_AREA",
          distanceKind: null,
          eta: null,
        },
      },
    ]);
    expectNoPersonalData(lines);
  });

  it("الرفضُ (401) لا يكتبُ سطرَ نجاح", async () => {
    const { app, lines } = build();
    expect((await post(app, "/v1/quote/ride", QUOTE_BODY, false)).status).toBe(401);
    expect(lines).toEqual([]);
  });
});

describe("السجلُّ لا يُغيِّرُ السلوك", () => {
  it("الحمولاتُ الثلاثُ متطابقةٌ بايتاً بوجودِ السجلِّ وغيابِه", async () => {
    const withLog = build();
    const without = build({ withLog: false });
    expect((await search(withLog.app)).text).toBe((await search(without.app)).text);
    expect((await post(withLog.app, "/v1/destinations/resolve", RESOLVE_BODY)).text).toBe(
      (await post(without.app, "/v1/destinations/resolve", RESOLVE_BODY)).text,
    );
    expect((await post(withLog.app, "/v1/quote/ride", QUOTE_BODY)).text).toBe(
      (await post(without.app, "/v1/quote/ride", QUOTE_BODY)).text,
    );
  });

  it("مُشتقّاتُ السجلِّ دوالُّ نقيّةٌ بمفاتيحَ ثابتة", () => {
    expect(Object.keys(searchAnsweredMeta(3))).toEqual(["outcome"]);
    expect(Object.keys(resolveAnsweredMeta(ACCEPTED_DESTINATION))).toEqual(["accepted", "refusal"]);
    expect(
      Object.keys(
        quoteAnsweredMeta({
          accepted: true,
          quote: {
            city: CITY,
            areaVersion: "v",
            distance: { kind: "STRAIGHT_LINE", meters: 1 },
            eta: { kind: "ROUTED", seconds: 60, minutes: 1, distanceMeters: 1, source: "ROUTING" },
            services: [],
          },
        } as unknown as Parameters<typeof quoteAnsweredMeta>[0]),
      ),
    ).toEqual(["accepted", "refusal", "distanceKind", "eta"]);
  });
});
