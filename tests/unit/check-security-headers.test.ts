/**
 * الغرض: سالبةٌ مزروعةٌ **لكلِّ قاعدةٍ** في حاجزِ ترويساتِ الصفحاتِ (`ح-7`)،
 *   ومعَها الطرفُ الموجَبُ: المستودَعُ كما هوَ لا يُخرِقُ شيئاً.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-06`).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0135 · `ح-7`
 *
 * حاجزٌ بلا سالبةٍ مزروعةٍ دعوى: يمرُّ أخضرَ وهوَ لا يقرأُ شيئاً. فكلُّ قاعدةٍ
 * ههنا تُزرَعُ لها حالةٌ تُخرِقُها **وحدَها**، ويُشتَرَطُ أن يُمسَكَ الخرقُ باسمِ
 * قاعدتِه لا بعددٍ.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PAGE_SURFACES,
  REQUIRED_PAGE_HEADERS,
  type RouteModuleFacts,
  securityHeaderViolations,
} from "../../scripts/lib/security-headers-registry.ts";

const repoRoot = resolve(import.meta.dir, "../..");

/** نصٌّ سليمٌ لوحدةِ توجيهٍ: يُصيِّرُ HTML ويُركِّبُ وسيطَهُ بلا شرطٍ. */
function healthyModule(middleware: string): string {
  return `const app = new Hono();\napp.use("*", ${middleware});\napp.get("/x", (c) => c.html("<p></p>"));\n`;
}

/** وسيطٌ سليمٌ: يكتبُ الواجبَ كلَّهُ والزيادتَينِ. */
const healthyMiddleware = [...REQUIRED_PAGE_HEADERS, "Cache-Control", "X-Robots-Tag"]
  .map((header) => `c.header("${header}", "v");`)
  .join("\n");

function healthyInput(): {
  routeModules: RouteModuleFacts[];
  middlewareSources: string[];
} {
  return {
    routeModules: PAGE_SURFACES.map((surface) => ({
      path: surface.module,
      source: healthyModule(surface.middleware),
    })),
    middlewareSources: [healthyMiddleware],
  };
}

const rulesOf = (input: Parameters<typeof securityHeaderViolations>[0]): string[] =>
  securityHeaderViolations(input).map((violation) => violation.rule);

describe("حاجزُ ترويساتِ أمنِ الصفحاتِ — سالبةٌ لكلِّ قاعدةٍ (SEC-06)", () => {
  test("الطرفُ الموجَبُ: حقائقُ سليمةٌ لا تُخرِقُ قاعدةً — وإلّا كانَ الحاجزُ يرفضُ كلَّ شيءٍ", () => {
    expect(securityHeaderViolations(healthyInput())).toEqual([]);
  });

  test("المستودَعُ كما هوَ سليمٌ: الأسطحُ المُسجَّلةُ موجودةٌ فعلاً على القرصِ", () => {
    for (const surface of PAGE_SURFACES) {
      expect(existsSync(resolve(repoRoot, surface.module))).toBe(true);
    }
  });

  test("سالبةٌ: وحدةٌ تُصيِّرُ HTML وليسَت في السِجلِّ — وهذا العطبُ الذي لا يكشفُه فحصُ الموجودِ", () => {
    const input = healthyInput();
    input.routeModules.push({
      path: "apps/gateway/src/routes/receipt-page.ts",
      source: 'app.get("/receipt/:id", (c) => c.html("<p></p>"));',
    });
    expect(rulesOf(input)).toContain("surface.discovered-but-unregistered");
  });

  test("والوحدةُ التي لا تُصيِّرُ HTML لا تُطالَبُ بشيءٍ — فالحاجزُ لا يُوسَّعُ على غيرِ بابِه", () => {
    const input = healthyInput();
    input.routeModules.push({
      path: "apps/gateway/src/routes/orders-api.ts",
      source: 'app.get("/api/orders", (c) => c.json({ ok: true }));',
    });
    expect(securityHeaderViolations(input)).toEqual([]);
  });

  test("سالبةٌ: سطحٌ مُسجَّلٌ لا وجودَ لهُ — فالسِجلُّ حرفٌ ميّتٌ يُقرأُ تغطيةً", () => {
    const input = healthyInput();
    input.routeModules = input.routeModules.slice(1);
    expect(rulesOf(input)).toContain("surface.registered-but-missing");
  });

  test("سالبةٌ: الوسيطُ غيرُ مُركَّبٍ على `*` — فصفحةٌ تُصيَّرُ بلا سياسةِ محتوىً", () => {
    const input = healthyInput();
    const first = PAGE_SURFACES[0];
    if (first === undefined) throw new Error("السِجلُّ فارغٌ — والحاجزُ بلا سطحٍ لا معنى لهُ.");
    input.routeModules = [
      { path: first.module, source: 'app.get("/x", (c) => c.html("<p></p>"));' },
      ...input.routeModules.slice(1),
    ];
    expect(rulesOf(input)).toContain("middleware.not-mounted");
  });

  test("سالبةٌ: مُركَّبٌ **بشرطٍ** — وهيَ الحالةُ التي كانَت في المستودَعِ فعلاً قبلَ ADR 0135", () => {
    const input = healthyInput();
    const first = PAGE_SURFACES[0];
    if (first === undefined) throw new Error("السِجلُّ فارغٌ — والحاجزُ بلا سطحٍ لا معنى لهُ.");
    input.routeModules = [
      {
        path: first.module,
        source:
          `if (deps.securityHeaders !== undefined) app.use("*", ${first.middleware});\n` +
          'app.get("/x", (c) => c.html("<p></p>"));',
      },
      ...input.routeModules.slice(1),
    ];
    const rules = rulesOf(input);
    expect(rules).toContain("middleware.mounted-conditionally");
  });

  test("سالبةٌ: ترويسةٌ واجبةٌ لا يكتبُها الوسيطُ — والقائمةُ مصدرُ حقيقةٍ واحدٌ", () => {
    for (const header of REQUIRED_PAGE_HEADERS) {
      const input = healthyInput();
      input.middlewareSources = [healthyMiddleware.replace(`c.header("${header}", "v");`, "")];
      const violations = securityHeaderViolations(input);
      expect(violations.map((v) => v.rule)).toContain("headers.required-set-written");
      expect(violations.some((v) => v.detail.includes(header))).toBe(true);
    }
  });

  test("سالبةٌ: زيادةُ سطحٍ مذكورةٌ وغيرُ مكتوبةٍ — والزيادةُ غيرُ المكتوبةِ دعوى", () => {
    const input = healthyInput();
    input.middlewareSources = [
      REQUIRED_PAGE_HEADERS.map((header) => `c.header("${header}", "v");`).join("\n"),
    ];
    expect(rulesOf(input)).toContain("headers.extra-written");
  });

  test("الوسيطانِ على القرصِ يكتبانِ الواجبَ كلَّهُ فعلاً — قياسٌ على المستودَعِ لا على مُختَلَقٍ", () => {
    for (const path of [
      "apps/gateway/src/public/security-headers.ts",
      "apps/gateway/src/admin/security-headers.ts",
    ]) {
      const source = readFileSync(resolve(repoRoot, path), "utf8");
      for (const header of REQUIRED_PAGE_HEADERS) {
        expect(source).toContain(`"${header}"`);
      }
    }
  });
});
