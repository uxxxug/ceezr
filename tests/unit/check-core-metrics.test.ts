/**
 * الغرض: **سالبٌ مبذورٌ لكلِّ قاعدةٍ** في حاجزِ المقاييسِ الأساسيّةِ (`F8-02` · `ح-٧`):
 *   لا قاعدةَ تُعتَبرُ مُنفَذةً حتى تُرى ساقطةً على نصٍّ يخالفُها **وناجحةً** على
 *   النصِّ السليمِ.
 * الحالة: منفّذ فعلياً — اختبارُ وحدةٍ للحاجزِ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`
 * يُتوقع أن يستخدمه لاحقاً: كلُّ إضافةٍ لقاعدةٍ في `core-metrics-contract.ts` —
 *   تُضافُ معَها سالبتُها ههنا في الشوطِ نفسِه.
 * الحاكم: docs/adr/0131-a-published-metric-is-a-contract-not-a-comment.md
 *
 * والنصوصُ ههنا **مبذورةٌ في الذاكرةِ** لا مقروءةٌ من القرصِ: حاجزٌ يُقاسُ على
 * المستودَعِ الحقيقيِّ وحدَه يمرُّ أخضرَ ولو كانَ منطقُه معطوباً، لأنَّ المستودَعَ
 * سليمٌ أصلاً.
 */

import { describe, expect, it } from "bun:test";
import {
  coreMetricsViolations,
  GUARDED_FILES,
  type GuardedFileKey,
  parseMetricDefinitions,
  REQUIRED_CATEGORIES,
  unlabelledRouteTemplates,
} from "../../scripts/lib/core-metrics-contract.ts";

/** كلُّ عائلةٍ تطلبُها الفئاتُ التسعُ، مُعرَّفةً بشكلِ النداءِ الحقيقيِّ. */
function definitionsSource(extra = ""): string {
  const families = REQUIRED_CATEGORIES.flatMap((entry) => entry.families);
  const body = families
    .map((name) => `  registry.defineCounter({\n    name: "${name}",\n    help: "ح",\n  });`)
    .join("\n");
  return `${body}\n${extra}\n`;
}

const HEALTHY_MIDDLEWARE = `
  const label = c.req.routePath;
  try { await next(); } catch (cause) {
    metrics.recordHttpUnhandledError(method, c.req.routePath);
    throw cause;
  }
  metrics.recordHttpRequest(method, c.req.routePath, c.res.status, 1);
`;

const HEALTHY_PROCESS = `
export function readProcessMemory() { return process.memoryUsage(); }
`;

const HEALTHY_COLLECTOR = `
  select count(*) from pg_stat_activity where state = 'active';
  select current_setting('max_connections')::int;
  select percentile_cont(0.5) within group (order by 1) from orders
    where matched_at is not null and matched_at >= now() - make_interval(secs => 300);
  const value = { assignment: { windowSeconds: 300 } };
`;

const HEALTHY_ROUTE = `
  if (!metricsSecretsMatch(supplied, token)) return c.json({ error: "UNAUTHORIZED" }, 401);
  deps.metrics.setProcessGauges(readProcessMemory());
`;

function healthy(): Record<GuardedFileKey, string> {
  return {
    definitions: definitionsSource(),
    labels: 'export const ROUTE_LABEL_UNKNOWN = "other";',
    process: HEALTHY_PROCESS,
    collector: HEALTHY_COLLECTOR,
    middleware: HEALTHY_MIDDLEWARE,
    route: HEALTHY_ROUTE,
  };
}

function rulesFor(sources: Partial<Record<GuardedFileKey, string>>): readonly string[] {
  return coreMetricsViolations(sources).map((violation) => violation.rule);
}

describe("حاجزُ المقاييسِ الأساسيّةِ — النصُّ السليمُ", () => {
  it("لا يُنتِجُ مخالفةً على نصوصٍ سليمةٍ (وإلّا كانَ الحاجزُ يمنعُ الصوابَ)", () => {
    expect(coreMetricsViolations(healthy())).toEqual([]);
  });

  it("**تعليقٌ يذكرُ الممنوعَ لا يُسقِطُ الحاجزَ**: المحكومُ عليه ما يُنَفَّذُ لا ما يُشرَحُ", () => {
    const documented = `/**\n * لا يُقرأُ \`c.req.path\` ألبتّةَ — كلُّ معرِّفٍ فيه يصيرُ سلسلةً.\n */\n${HEALTHY_MIDDLEWARE}\n// وشرحٌ آخرُ: c.req.url ممنوعٌ كذلكَ.`;
    expect(coreMetricsViolations({ ...healthy(), middleware: documented })).toEqual([]);
  });

  it("يقرأُ اسمَ العائلةِ ووسومَها من نصِّ التعريفِ", () => {
    const parsed = parseMetricDefinitions(
      'registry.defineCounter({\n  name: "waslah_x_total",\n  help: "ح",\n  labelNames: ["route", "method"],\n});',
    );
    expect(parsed).toEqual([{ name: "waslah_x_total", labelNames: ["route", "method"] }]);
  });
});

describe("حاجزُ المقاييسِ الأساسيّةِ — سالبٌ لكلِّ قاعدةٍ", () => {
  it("`file.present`: ملفٌّ محروسٌ غائبٌ مخالفةٌ باسمِه، ولا يمضي الفحصُ صامتاً", () => {
    for (const key of Object.keys(GUARDED_FILES) as GuardedFileKey[]) {
      const sources = healthy();
      delete (sources as Partial<Record<GuardedFileKey, string>>)[key];
      const violations = coreMetricsViolations(sources);
      expect(violations.map((entry) => entry.rule)).toEqual(["file.present"]);
      expect(violations[0]?.detail).toContain(GUARDED_FILES[key]);
    }
  });

  it("`file.present`: ملفٌّ محروسٌ فارغٌ كالغائبِ — لا يُخدَعُ الحاجزُ بملفٍّ خاوٍ", () => {
    expect(rulesFor({ ...healthy(), collector: "" })).toEqual(["file.present"]);
  });

  it("`catalogue.category-published`: كلُّ فئةٍ من التسعِ تسقطُ وحدَها إن غابت عائلتُها", () => {
    for (const requirement of REQUIRED_CATEGORIES) {
      const dropped = requirement.families[0];
      const kept = REQUIRED_CATEGORIES.flatMap((entry) => entry.families).filter(
        (name) => name !== dropped,
      );
      const body = kept
        .map((name) => `registry.defineGauge({\n  name: "${name}",\n  help: "ح",\n});`)
        .join("\n");
      const violations = coreMetricsViolations({ ...healthy(), definitions: body });
      expect(violations.some((entry) => entry.rule === "catalogue.category-published")).toBe(true);
      expect(
        violations.some(
          (entry) =>
            entry.detail.includes(requirement.category) && entry.detail.includes(dropped ?? ""),
        ),
      ).toBe(true);
    }
  });

  it("`label.bounded-cardinality`: وسمُ معرِّفٍ يسقُطُ ولو كانَ اسمُ العائلةِ سليماً", () => {
    const extra =
      'registry.defineCounter({\n  name: "waslah_edge_total",\n  help: "ح",\n  labelNames: ["route", "order_id"],\n});';
    const violations = coreMetricsViolations({
      ...healthy(),
      definitions: definitionsSource(extra),
    });
    expect(violations.map((entry) => entry.rule)).toEqual(["label.bounded-cardinality"]);
    expect(violations[0]?.detail).toContain("order_id");
  });

  it("`label.bounded-cardinality`: `path` ممنوعٌ كذلكَ — أقصرُ طريقٍ إلى سلسلةٍ لكلِّ طلبٍ", () => {
    const extra =
      'registry.defineHistogram({\n  name: "waslah_edge_seconds",\n  help: "ح",\n  labelNames: ["path"],\n  buckets: [1],\n});';
    expect(rulesFor({ ...healthy(), definitions: definitionsSource(extra) })).toEqual([
      "label.bounded-cardinality",
    ]);
  });

  it("`derived.no-precomputed-ratio`: نسبةُ قبولٍ منشورةٌ رقماً تسقُطُ", () => {
    const extra =
      'registry.defineGauge({\n  name: "waslah_dispatch_offer_acceptance_rate",\n  help: "ح",\n});';
    expect(rulesFor({ ...healthy(), definitions: definitionsSource(extra) })).toEqual([
      "derived.no-precomputed-ratio",
    ]);
  });

  it("`http.route-template-label`: وسيطٌ لا يقرأُ القالبَ يسقُطُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        middleware: HEALTHY_MIDDLEWARE.replaceAll("c.req.routePath", '"/fixed"'),
      }),
    ).toEqual(["http.route-template-label"]);
  });

  it("`http.route-template-label`: قراءةُ `c.req.path` تسقُطُ ولو قُرِئَ القالبُ معَها", () => {
    expect(
      rulesFor({ ...healthy(), middleware: `${HEALTHY_MIDDLEWARE}\nconst raw = c.req.path;` }),
    ).toEqual(["http.route-template-label"]);
  });

  it("`http.error-counted-and-rethrown`: وسيطٌ يبتلعُ الاستثناءَ يسقُطُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        middleware: HEALTHY_MIDDLEWARE.replace("throw cause;", "/* مُبتلَعٌ */"),
      }),
    ).toEqual(["http.error-counted-and-rethrown"]);
  });

  it("`http.error-counted-and-rethrown`: استثناءٌ يُرفَعُ بلا عدٍّ يسقُطُ أيضاً", () => {
    expect(
      rulesFor({
        ...healthy(),
        middleware: HEALTHY_MIDDLEWARE.replace(
          "metrics.recordHttpUnhandledError(method, c.req.routePath);",
          "",
        ),
      }),
    ).toEqual(["http.error-counted-and-rethrown"]);
  });

  it("`process.read-at-scrape`: مؤقِّتٌ في قارئِ الذاكرةِ يسقُطُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        process: `${HEALTHY_PROCESS}\nsetInterval(() => readProcessMemory(), 1000);`,
      }),
    ).toEqual(["process.read-at-scrape"]);
  });

  it("`process.read-at-scrape`: مسارٌ لا يضبطُ مقاييسَ العمليّةِ يُنشَرُ صفراً أبداً", () => {
    expect(
      rulesFor({
        ...healthy(),
        route: HEALTHY_ROUTE.replace("deps.metrics.setProcessGauges(readProcessMemory());", ""),
      }),
    ).toEqual(["process.read-at-scrape"]);
  });

  it("`assignment.window-published`: نافذةٌ غيرُ منشورةٍ تسقُطُ", () => {
    expect(
      rulesFor({ ...healthy(), collector: HEALTHY_COLLECTOR.replace("windowSeconds: 300", "") }),
    ).toEqual(["assignment.window-published"]);
  });

  it("`assignment.measured-from-stamps`: قياسٌ بلا `percentile_cont` على الختمِ يسقُطُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        collector: HEALTHY_COLLECTOR.replace("percentile_cont(0.5)", "avg"),
      }),
    ).toEqual(["assignment.measured-from-stamps"]);
  });

  it("`assignment.measured-from-stamps`: شرطُ `matched_at` إن غابَ سقطَ القياسُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        collector: HEALTHY_COLLECTOR.replaceAll("matched_at is not null", "true"),
      }),
    ).toEqual(["assignment.measured-from-stamps"]);
  });

  it("`connections.engine-view-with-limit`: عدٌّ بلا رؤيةِ المحرِّكِ يسقُطُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        collector: HEALTHY_COLLECTOR.replace("pg_stat_activity", "my_pool_view"),
      }),
    ).toEqual(["connections.engine-view-with-limit"]);
  });

  it("`connections.engine-view-with-limit`: عدٌّ بلا سقفٍ يسقُطُ — الرقمُ بلا حدٍّ لا يُقرأُ", () => {
    expect(
      rulesFor({
        ...healthy(),
        collector: HEALTHY_COLLECTOR.replace("max_connections", "server_version"),
      }),
    ).toEqual(["connections.engine-view-with-limit"]);
  });

  it("`route.stays-protected`: مسارٌ فُتِحَ بلا سرٍّ يسقُطُ", () => {
    expect(
      rulesFor({ ...healthy(), route: HEALTHY_ROUTE.replace("metricsSecretsMatch", "always") }),
    ).toEqual(["route.stays-protected"]);
  });

  it("`route.stays-protected`: مسارٌ لا يفشلُ مغلقاً يسقُطُ", () => {
    expect(rulesFor({ ...healthy(), route: HEALTHY_ROUTE.replace("UNAUTHORIZED", "OK") })).toEqual([
      "route.stays-protected",
    ]);
  });
});

describe("حاجزُ الوسمِ من الجهةِ الأخرى — قالبٌ يُطمَرُ في `other`", () => {
  it("قالبٌ حرفيٌّ سليمٌ ووسيطٌ مُعلَنٌ يبقى وسمَ نفسِه", () => {
    expect(
      unlabelledRouteTemplates({
        "apps/gateway/src/routes/rides.ts": [
          'app.get("/v1/rides/:rideId/offers", handler);',
          'app.post("/v1/admin-metrics", handler);',
          'app.get("/health", handler);',
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("**قالبٌ لا يقبلُه التطبيعُ يسقُطُ**: مقياسٌ كلُّ مساراتِه `other` أخرسُ وهوَ أخضرُ", () => {
    const violations = unlabelledRouteTemplates({
      "apps/gateway/src/routes/legacy.ts": 'app.get("/v1/rides/8f2c1b90-0000", handler);',
    });
    expect(violations.map((violation) => violation.rule)).toEqual(["http.every-route-labelled"]);
    expect(violations[0]?.detail).toContain("/v1/rides/8f2c1b90-0000");
  });

  it("قالبٌ في تعليقٍ لا يُحاكَمُ — المحكومُ عليه ما يُنَفَّذُ", () => {
    expect(
      unlabelledRouteTemplates({
        "apps/gateway/src/routes/rides.ts": '// app.get("/v1/rides/8f2c1b90-0000", handler);',
      }),
    ).toEqual([]);
  });
});
