/**
 * ADR 0250 — حرّاسُ قراراتِ PRD-004/005/006/007: كلُّ قرارٍ مكتوبٌ في مصدرِه ويُقاسُ هنا،
 * فلا يعودُ إلى «إعدادٍ في لوحةٍ» أو «سياسةِ منصّة» بسهو.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createServer,
  GATEWAY_HSTS_HEADER,
  GATEWAY_HSTS_VALUE,
} from "../../apps/gateway/src/server.ts";

const RENDER = readFileSync("render.yaml", "utf8");

describe("PRD-004 — إعادةُ كتابةِ البوّابةِ في render.yaml", () => {
  test("/v1/* و/socket.io/* و/health تسبقُ احتياطَ /* إلى index.html", () => {
    const at = (needle: string) => RENDER.indexOf(needle);
    const spa = at("        source: /*\n        destination: /index.html");
    expect(spa).toBeGreaterThan(0);
    for (const [source, dest] of [
      ["/v1/*", "https://waslah-gateway.onrender.com/v1/*"],
      ["/socket.io/*", "https://waslah-gateway.onrender.com/socket.io/*"],
      ["/health", "https://waslah-gateway.onrender.com/health"],
    ] as const) {
      const rule = at(`        source: ${source}\n        destination: ${dest}`);
      expect(rule).toBeGreaterThan(0);
      expect(rule).toBeLessThan(spa);
    }
  });
});

describe("PRD-005 — لا خرائطَ مصدرٍ في البناءِ العامّ", () => {
  test("vite.config.ts: sourcemap: false", () => {
    const vite = readFileSync("apps/miniapp/vite.config.ts", "utf8");
    expect(vite).toMatch(/\n\s+sourcemap: false,/);
    expect(vite).not.toMatch(/\n\s+sourcemap: (true|"hidden"|'hidden'),/);
  });
});

describe("PRD-006 — HSTS مملوكٌ للبوّابة", () => {
  test("القيمةُ سنةٌ بلا includeSubDomains ولا preload (onrender.com مشترك)", () => {
    expect(GATEWAY_HSTS_HEADER).toBe("Strict-Transport-Security");
    expect(GATEWAY_HSTS_VALUE).toBe("max-age=31536000");
  });

  test("الرأسُ على ردِّ 200 و404 من البوّابةِ الحقيقيّة (يُركَّبُ قبلَ كلِّ مسار)", async () => {
    const app = createServer({
      health: {
        now: () => new Date("2026-10-09T00:01:00.000Z"),
        startedAt: new Date("2026-10-09T00:00:00.000Z"),
        env: {},
      },
      webhook: {
        webhookSecret: "test-webhook-secret-value",
        handler: { handle: async () => true },
      },
    });
    for (const path of ["/health", "/لا-وجود-له"]) {
      const res = await app.request(`http://localhost${path}`);
      expect(res.headers.get(GATEWAY_HSTS_HEADER)).toBe(GATEWAY_HSTS_VALUE);
    }
  });
});
