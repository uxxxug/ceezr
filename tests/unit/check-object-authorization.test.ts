/**
 * الغرض: قياسُ عقدِ **التفويضِ على مستوى الكائنِ** (`F8-08` — الضابطُ الأوّلُ)
 *   بسالبةٍ مبذورةٍ **لكلِّ قاعدةٍ** (`ح-7`): حاجزٌ لم يُرَ وهوَ يُسقِطُ العطبَ
 *   الذي بُنيَ لهُ ليسَ حاجزاً بل زينةٌ خضراءُ.
 * الحالة: منفّذ فعلياً — اختبارُ وحدةٍ بلا قرصٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` · سلسلةُ CI (وظيفةُ `verify`)
 * الحاكم: ADR 0132 · البند `F8-08`
 *
 * وكلُّ حالةٍ ههنا تُقاسُ **مرّتَينِ**: الشكلُ السليمُ يمرُّ، والمزروعُ يسقُطُ
 * بالقاعدةِ **المُسمّاةِ** لا بأيِّ قاعدةٍ — إذ حاجزٌ يسقُطُ بالقاعدةِ الخطأِ
 * يُخفي أنَّ المقصودةَ ميّتةٌ.
 */

import { describe, expect, it } from "bun:test";
import {
  MIN_EXEMPTION_REASON_LENGTH,
  OBJECT_ROUTE_EXEMPTIONS,
  objectAuthorizationViolations,
  parseRouteHandlers,
  type RouteSource,
  stripComments,
  VIEWER_DERIVATIONS,
} from "../../scripts/lib/object-authorization-contract.ts";

const SOUND_VIEWER_ROUTE = `
export function createRidesRoutes(deps: Deps) {
  const app = new Hono();
  app.get("/v1/rides/:id", async (c) => {
    const result = await readActiveRide(deps.active, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);
    return c.json({ ok: true });
  });
  return app;
}
`;

function rulesOf(sources: readonly RouteSource[]): string[] {
  return objectAuthorizationViolations(sources).map((violation) => violation.rule);
}

function file(path: string, source: string): RouteSource {
  return { path, source };
}

describe("عقدُ التفويضِ على مستوى الكائنِ — F8-08 الضابطُ الأوّلُ", () => {
  it("الشكلُ السليمُ يمرُّ: معرِّفُ الكائنِ وهويّةُ الناظرِ في حُجَّةٍ واحدةٍ", () => {
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", SOUND_VIEWER_ROUTE)])).toEqual([]);
  });

  it("سالبةٌ — `route.viewer-scoped`: مسارٌ بمعرِّفِ كائنٍ بلا اشتقاقِ ناظرٍ", () => {
    const planted = `
      app.get("/v1/rides/:id", async (c) => {
        const ride = await deps.rides.read({ orderId: c.req.param("id") });
        return c.json({ ok: true, ride });
      });
    `;
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", planted)])).toEqual([
      "route.viewer-scoped",
    ]);
  });

  it("سالبةٌ — `route.viewer-travels-with-object`: مُصادَقةٌ عندَ البابِ ثمَّ قراءةٌ بالمعرِّفِ وحدَه", () => {
    const planted = `
      app.get("/v1/rides/:id", async (c) => {
        const auth = await authenticate(c, deps);
        if ("response" in auth) return auth.response;
        const ride = await deps.rides.read({ orderId: c.req.param("id") });
        return c.json({ ok: true, ride });
      });
    `;
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", planted)])).toEqual([
      "route.viewer-travels-with-object",
    ]);
  });

  it("سالبةٌ — `param.not-identity`: هويّةٌ في العنوانِ تُفوِّضُ مَن يكتُبُها", () => {
    const planted = `
      app.get("/v1/riders/:riderId/rides", async (c) => {
        const result = await deps.rides.list({
          accessToken: bearerTokenFrom(c.req.header("authorization")),
          riderId: c.req.param("riderId"),
        });
        return c.json({ ok: true, result });
      });
    `;
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", planted)])).toEqual([
      "param.not-identity",
    ]);
  });

  it("سالبةٌ — `catalogue.non-empty`: جردٌ فارغٌ خرقٌ لا نجاحٌ", () => {
    expect(rulesOf([file("apps/gateway/src/routes/health.ts", "export const x = 1;\n")])).toEqual([
      "catalogue.non-empty",
    ]);
  });

  it("سالبةٌ — `exemption.route-exists`: استثناءٌ مسجَّلٌ لمسارٍ زالَ من ملفِّه", () => {
    const rules = rulesOf([
      file("apps/gateway/src/routes/telegram-webhook.ts", SOUND_VIEWER_ROUTE),
    ]);
    expect(rules).toContain("exemption.route-exists");
  });

  it("سالبةٌ — `exemption.file-read`: ملفُّ موجّهٍ مستثنىً زالَ من الشجرةِ كلِّها", () => {
    const complete = objectAuthorizationViolations(
      [file("apps/gateway/src/routes/rides.ts", SOUND_VIEWER_ROUTE)],
      { completeTree: true },
    ).map((violation) => violation.rule);
    expect(complete).toContain("exemption.file-read");
    // وعلى مصادرَ جزئيّةٍ لا يُسألُ السؤالُ أصلاً — وإلّا صارَ كلُّ اختبارِ وحدةٍ خرقاً.
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", SOUND_VIEWER_ROUTE)])).toEqual([]);
  });

  it("سالبةٌ — `exemption.evidence-present`: استثناءُ الخُطّافِ بلا مقارنةِ سرٍّ", () => {
    const planted = `
      app.post("/webhook/telegram/:bot", async (c) => {
        const bot = c.req.param("bot");
        return c.json({ ok: true, bot });
      });
    `;
    const rules = rulesOf([file("apps/gateway/src/routes/telegram-webhook.ts", planted)]);
    expect(rules).toContain("exemption.evidence-present");
  });

  it("سالبةٌ — `exemption.evidence-present`: استثناءُ لوحةِ الإدارةِ بلا وسيطِ حراسةٍ", () => {
    const planted = `
      app.get("/drivers/:id", async (c) => {
        return c.json({ ok: true, id: c.req.param("id") });
      });
    `;
    const rules = rulesOf([file("apps/gateway/src/routes/admin-ui.ts", planted)]);
    expect(rules).toContain("exemption.evidence-present");
  });

  it("سالبةٌ — `exemption.evidence-present`: استثناءُ الرمزِ غيرِ القابلِ للتخمينِ بلا فحصِ شكلٍ", () => {
    const planted = `
      app.get("/api/track/:token/position", async (c) => {
        const result = await getLivePosition(c.req.param("token"), deps);
        return c.json({ ok: true, result });
      });
      app.get("/track/:token", async (c) => {
        const token = c.req.param("token");
        if (token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
          return c.html("", 404);
        }
        return c.html("");
      });
    `;
    const rules = rulesOf([file("apps/gateway/src/routes/public-tracking.ts", planted)]);
    expect(rules).toContain("exemption.evidence-present");
  });

  it("سالبةٌ — `exemption.reason-written`: كلُّ سببٍ مسجَّلٍ أطولُ من الحدِّ", () => {
    for (const exemption of OBJECT_ROUTE_EXEMPTIONS) {
      expect(exemption.reason.trim().length).toBeGreaterThanOrEqual(MIN_EXEMPTION_REASON_LENGTH);
    }
    // والحدُّ نفسُه يُقاسُ: سببٌ بكلمةٍ يسقُطُ.
    const short = { ...OBJECT_ROUTE_EXEMPTIONS[0], reason: "لأنّه كذلك" };
    expect(short.reason.trim().length).toBeLessThan(MIN_EXEMPTION_REASON_LENGTH);
  });

  it("التعليقُ لا يُنجّي ولا يُدين: المحكومُ عليهِ ما يُنَفَّذُ", () => {
    const commentedSound = `
      app.get("/v1/rides/:id", async (c) => {
        /* accessToken — مذكورٌ في تعليقٍ لا في شيفرةٍ */
        // bearerTokenFrom(c.req.header("authorization"))
        const ride = await deps.rides.read({ orderId: c.req.param("id") });
        return c.json({ ok: true, ride });
      });
    `;
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", commentedSound)])).toEqual([
      "route.viewer-scoped",
    ]);

    const commentedBug = `
      app.get("/v1/rides/:id", async (c) => {
        // كانَ ههنا عطبٌ: deps.rides.read({ orderId: c.req.param("id") }) بلا ناظرٍ
        const result = await readActiveRide(deps.active, {
          accessToken: bearerTokenFrom(c.req.header("authorization")),
          orderId: c.req.param("id"),
        });
        return c.json({ ok: true, result });
      });
    `;
    expect(rulesOf([file("apps/gateway/src/routes/rides.ts", commentedBug)])).toEqual([]);
  });

  it("`stripComments` يُبقي النصوصَ الحرفيّةَ ويمحو التعليقاتِ وحدَها", () => {
    const stripped = stripComments('const a = "// ليسَ تعليقاً"; // تعليقٌ\nconst b = 1;');
    expect(stripped).toContain('"// ليسَ تعليقاً"');
    expect(stripped).not.toContain("تعليقٌ");
    expect(stripped).toContain("const b = 1;");
  });

  it("الاستخراجُ يقتصرُ على القوالبِ ذاتِ المعامِلِ ولا يبتلعُ ما بعدَها", () => {
    const source = `
      app.get("/v1/rides", async (c) => c.json({ ok: true }));
      app.get("/v1/rides/:id", async (c) => {
        const result = await readActiveRide(deps.active, {
          accessToken: bearerTokenFrom(c.req.header("authorization")),
          orderId: c.req.param("id"),
        });
        return c.json({ ok: true, result });
      });
      app.post("/v1/quote", async (c) => c.json({ ok: true }));
    `;
    const handlers = parseRouteHandlers([file("apps/gateway/src/routes/rides.ts", source)]);
    expect(handlers.length).toBe(1);
    expect(handlers[0]?.template).toBe("/v1/rides/:id");
    expect(handlers[0]?.body).not.toContain("/v1/quote");
  });

  it("قائمةُ اشتقاقاتِ الناظرِ مغلقةٌ ومذكورةٌ بالاسمِ", () => {
    expect([...VIEWER_DERIVATIONS]).toEqual([
      "accessToken",
      "bearerTokenFrom(",
      "authenticate(",
      "auth.viewer",
    ]);
  });
});
