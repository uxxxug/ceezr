/**
 * الغرض: **قياسُ الإنفاذِ لا الإعلانِ** — موجِّهاتٌ حقيقيّةٌ تُنادى عبرَ `fetch`
 *   بحاصرٍ حقيقيٍّ في الذاكرةِ، فيُقاسُ `429` ورأسُ `Retry-After` فوقَ الحدِّ
 *   والنجاحُ دونَه (`SEC-07`).
 * الحالة: منفّذ فعلياً — 2026-09-17.
 * ينتمي إلى: tests/unit
 * يُستخدَمُ من: `bun test tests/unit` في `verify`.
 * يحرسُه: نفسُه.
 * الحاكم: `docs/adr/0139-an-unlisted-exposed-route-is-an-unlimited-route.md`
 *
 * ## لِمَ هذا الملفُّ شرطٌ لِـ`SEC-07` ولا يكفي الحاجزُ الساكنُ
 *
 * `scripts/check-rate-limit-coverage.ts` يُطابِقُ سِجلّاً بشيفرةٍ — **وذاكَ إعلانٌ**.
 * ولو كانَ `rateLimitRejection` يُرجِعُ `null` دائماً لَبقيَ الحاجزُ أخضرَ والأبوابُ
 * مفتوحةً. فههنا يُقاسُ الجوابُ من موجِّهٍ حقيقيٍّ: رقمُ الحالةِ والرأسُ.
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ
 *
 * - **لا يقيسُ نافذةً مشتركةً بينَ مثيلَينِ**: حاصرُ الذاكرةِ يَحُدُّ عمليّةً واحدةً،
 *   وذاكَ يُقاسُ بِـRedis حقيقيٍّ في
 *   `tests/integration/rate-limit-shared-window.test.ts`.
 * - **لا يقيسُ انتهاءَ النافذةِ بالزمنِ**: انتظارُ ستّينَ ثانيةً في `verify` ثمنٌ بلا
 *   مقابلٍ، وانتهاءُ النافذةِ مقيسٌ في `tests/unit/rate-limit.test.ts` بحاصرٍ
 *   مباشرةً.
 * - **لا يُهيِّئُ التبعيّاتَ الحقيقيّةَ**: الأبوابُ ههنا غيرُ مُهيَّأةٍ فتُجيبُ `503`
 *   دونَ الحدِّ — **وهذا هوَ الفرقُ المقيسُ**: `503` تعني «مرَّ الحاصرُ» و`429` تعني
 *   «رُدَّ». ولو كانَ الحدُّ بعدَ فحصِ التهيئةِ لَما ظهرَ `429` أصلاً.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createPublicSecurityHeaders } from "../../apps/gateway/src/public/security-headers.ts";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { ROUTE_POLICIES } from "../../apps/gateway/src/rate-limit/policy.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createCoreEventIntakeRoutes } from "../../apps/gateway/src/routes/core-event-intake.ts";
import { createPaymentWebhookRoutes } from "../../apps/gateway/src/routes/payment-webhook.ts";
import { createPolicyRoutes } from "../../apps/gateway/src/routes/policy.ts";
import { createPublicTrackingRoutes } from "../../apps/gateway/src/routes/public-tracking.ts";
import { createSessionRefreshRoutes } from "../../apps/gateway/src/routes/session-refresh.ts";
import { createSessionTelegramRoutes } from "../../apps/gateway/src/routes/session-telegram.ts";

const LIMIT = { limit: 2, windowSeconds: 60 } as const;
const TOKEN = "a".repeat(32);

interface Probe {
  readonly name: string;
  readonly app: { fetch: (request: Request) => Response | Promise<Response> };
  readonly request: () => Request;
}

function post(path: string): Request {
  return new Request(`http://gate.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ probe: true }),
  });
}

function get(path: string): Request {
  return new Request(`http://gate.test${path}`, {
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

const PROBES: readonly Probe[] = [
  {
    name: "POST /v1/session/telegram",
    app: createSessionTelegramRoutes({ limits: { perAddress: createMemoryRateLimiter(LIMIT) } }),
    request: () => post("/v1/session/telegram"),
  },
  {
    name: "POST /v1/session/refresh",
    app: createSessionRefreshRoutes({ limits: { perAddress: createMemoryRateLimiter(LIMIT) } }),
    request: () => post("/v1/session/refresh"),
  },
  {
    name: "POST /webhook/payment",
    app: createPaymentWebhookRoutes({
      confirmDeps: {} as never,
      limits: { perAddress: createMemoryRateLimiter(LIMIT) },
    }),
    request: () => post("/webhook/payment"),
  },
  {
    name: "POST /webhook/core-events",
    app: createCoreEventIntakeRoutes({
      lifecycle: {} as never,
      limits: { perAddress: createMemoryRateLimiter(LIMIT) },
    }),
    request: () => post("/webhook/core-events"),
  },
  {
    name: "GET /track/:token",
    app: trackingApp(),
    request: () => get(`/track/${TOKEN}`),
  },
  {
    name: "GET /api/track/:token/position",
    app: trackingApp(),
    request: () => get(`/api/track/${TOKEN}/position`),
  },
  {
    name: "GET /v1/policy",
    app: createPolicyRoutes({ perAddress: createMemoryRateLimiter(LIMIT) }),
    request: () => get("/v1/policy?city_id=00000000-0000-0000-0000-000000000000"),
  },
  {
    // `SEC-21` · ADR 0176: البابُ الموازيُّ يُطرَقُ بلا جلسةٍ — والاسمُ المجهولُ
    // لا صفَّ لهُ في القاعدةِ فلا يلمسُهُ إقفالُها: العدّادُ في الذاكرةِ هوَ ما
    // يُقاسُ ههنا. الموجِّهُ يُبنى بتبعيّاتٍ فارغةٍ كسائرِ القياساتِ: الحاصرُ
    // **قبلَ** كلِّ عملٍ، فالردُّ فوقَ الحدِّ يأتي قبلَ أن يُفتَحَ اتصالُ قاعدةٍ.
    name: "POST /admin/login/break-glass",
    app: adminGate({ limits: { breakGlassLoginPerAddress: createMemoryRateLimiter(LIMIT) } }),
    request: () =>
      new Request("http://gate.test/admin/login/break-glass", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7" },
        body: new FormData(),
      }),
  },
];

/**
 * الموجِّهُ يُبنى مركَّبًا تحت `/admin` كما في `mount.ts` — قياسُ المسارِ الحقيقيِّ
 * لا المسارِ المجرَّدِ: قاعدةُ «الأخصُّ أوّلًا» في التركيبِ جزءٌ من السلوكِ.
 */
function adminGate(limits: {
  readonly limits?: { readonly breakGlassLoginPerAddress: RateLimiter };
}): Hono {
  const app = new Hono();
  app.route(
    "/admin",
    createAdminUiRoutes({
      sql: {} as never,
      auth: {} as never,
      codeSender: { send: async () => true },
      ...limits,
    }),
  );
  return app;
}

function trackingApp(): ReturnType<typeof createPublicTrackingRoutes> {
  return createPublicTrackingRoutes({
    tokens: {
      // رمزٌ «غيرُ صالحٍ» في القياسِ: يُصيَّرُ «غيرُ موجودٍ» دونَ الحدِّ، فيُقاسُ
      // الفرقُ بينَ مرورٍ (404) وردٍّ (429) لا بينَ نجاحٍ وعطلٍ.
      read: async () => ({ ok: true as const, value: { kind: "invalid" as const } }),
    } as never,
    mapStyle: { configured: false, reason: "بلا خريطةٍ في القياسِ" },
    scriptUrl: "https://cdn.test/maplibre.js",
    stylesheetUrl: "https://cdn.test/maplibre.css",
    integrity: "sha384-test",
    securityHeaders: createPublicSecurityHeaders({
      mapOrigins: [],
      scriptOrigin: "https://cdn.test",
    }),
    limits: {
      perTokenPage: createMemoryRateLimiter(LIMIT),
      perTokenPosition: createMemoryRateLimiter(LIMIT),
    },
  });
}

describe("تحديدُ المعدَّلِ مقيسٌ على الردِّ لا مُعلَنٌ في سِجلٍّ (SEC-07)", () => {
  for (const probe of PROBES) {
    test(`${probe.name}: يمرُّ دونَ الحدِّ ثمَّ يُرَدُّ 429 معَ Retry-After فوقَه`, async () => {
      const first = await probe.app.fetch(probe.request());
      const second = await probe.app.fetch(probe.request());
      expect(first.status).not.toBe(429);
      expect(second.status).not.toBe(429);

      const third = await probe.app.fetch(probe.request());
      expect(third.status).toBe(429);
      // **الرأسُ ليسَ تجميلاً**: بدونَه يُعيدُ العميلُ فوراً فيصيرُ الحدُّ مُضاعِفاً للحِمْلِ.
      const retryAfter = third.headers.get("retry-after");
      expect(retryAfter).not.toBeNull();
      expect(Number(retryAfter)).toBeGreaterThan(0);
      expect(await third.json()).toEqual({ ok: false, error: "RATE_LIMITED" });
    });

    test(`${probe.name}: بلا حاصرٍ مُركَّبٍ لا يُرَدُّ أحدٌ — والتدهورُ مُعلَنٌ لا مُخفىً`, async () => {
      // إيجابيّةُ ضبطٍ معكوسةٌ: لو كانَ `429` يأتي من غيرِ الحاصرِ لَظهرَ ههنا أيضاً.
      const unlimited = unlimitedFor(probe.name);
      if (unlimited === null) return;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await unlimited.fetch(probe.request());
        expect(response.status).not.toBe(429);
      }
    });
  }

  test("كلُّ مسارٍ محدودٍ في السِجلِّ مقيسٌ ههنا — لا يُعلَنُ حدٌّ لا يُقاسُ", () => {
    const limited = ROUTE_POLICIES.filter((policy) => policy.limits.length > 0).map(
      (policy) => `${policy.method} ${policy.path}`,
    );
    const measured = new Set(PROBES.map((probe) => probe.name));
    // الويبهوكُ التلغرامي ومسارُ الموقعِ مقيسانِ في ملفَّيهما القائمَينِ
    // (`tests/unit/rate-limit.test.ts` و`tests/unit/driver-location-route.test.ts`)،
    // فيُستثنيانِ **بالتسميةِ لا بالسكوتِ**.
    const measuredElsewhere = new Set(["POST /webhook/telegram/:bot", "POST /v1/driver/location"]);
    const unmeasured = limited.filter(
      (name) => !measured.has(name) && !measuredElsewhere.has(name),
    );
    expect(unmeasured).toEqual([]);
  });
});

function unlimitedFor(
  name: string,
): { fetch: (request: Request) => Response | Promise<Response> } | null {
  switch (name) {
    case "POST /v1/session/telegram":
      return createSessionTelegramRoutes({});
    case "POST /v1/session/refresh":
      return createSessionRefreshRoutes({});
    case "POST /webhook/payment":
      return createPaymentWebhookRoutes({ confirmDeps: {} as never });
    case "POST /webhook/core-events":
      return createCoreEventIntakeRoutes({ lifecycle: {} as never });
    case "GET /v1/policy":
      return createPolicyRoutes({});
    case "POST /admin/login/break-glass":
      return adminGate({});
    default:
      return null;
  }
}
