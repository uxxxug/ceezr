/**
 * الغرض: قياسُ ترويساتِ الأمنِ **على الردِّ الفعليِّ** الخارجِ من موجِّهِ الصفحةِ
 *   العامّةِ — لا قراءةَ نصٍّ ولا فحصَ شكلٍ. وقياسُ أنَّ كلَّ ترويسةٍ واجبةٍ حاضرةٌ
 *   في كلِّ حالاتِ الردِّ لا في الحالةِ السعيدةِ وحدَها.
 * الحالة: منفَّذٌ فعليّاً — أُضيفَ في 2026-09-16 (`SEC-06`).
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0135
 *
 * ## لِمَ قياسٌ وقد وُجِدَ حاجزٌ ساكنٌ
 *
 * الحاجزُ الساكنُ يُثبِتُ أنَّ الوسيطَ **مُركَّبٌ** وأنَّ الترويساتَ **مكتوبةٌ**.
 * ولا يُثبِتُ أنَّها **تخرُجُ**: وسيطٌ يكتبُ ترويسةً بعدَ ردٍّ سابقٍ لأوانِه، أو
 * مسارٌ يُعيدُ ردَّهُ قبلَ الوسيطِ، أو استثناءٌ يُختصَرُ بهِ الطريقُ — كلُّها تُبقي
 * النصَّ سليماً والرأسَ عارياً. والفرقُ بينَ البرهانَينِ فرقُ جنسٍ لا درجةٍ، فلا
 * يُغني أحدُهما عن الآخرِ.
 *
 * وحالُ «غيرِ موجودٍ» مقصودةٌ: هيَ **أكثرُ** ما يُطلَبُ من هذهِ الصفحةِ في الواقعِ
 * (رمزٌ منقضٍ أو مُلغى أو مُخمَّنٌ)، وهيَ أشيعُ ما يُغفَلُ في تركيبِ الترويساتِ.
 */

import { describe, expect, test } from "bun:test";

import { createPublicSecurityHeaders } from "../../apps/gateway/src/public/security-headers.ts";
import { createPublicTrackingRoutes } from "../../apps/gateway/src/routes/public-tracking.ts";
import { REQUIRED_PAGE_HEADERS } from "../../scripts/lib/security-headers-registry.ts";

const NOT_FOUND = 404;
const TILE_ORIGIN = "https://tiles.test";

/**
 * الموجِّهُ الحقيقيُّ لا مُختَلَقاً. والرمزُ المُخالِفُ للشكلِ يُرَدُّ **قبلَ أيِّ
 * نداءِ قاعدةٍ**، فلا حاجةَ إلى محرِّكٍ ههنا — والمقيسُ ترويساتٌ لا استفسارٌ.
 */
function buildApp(mapOrigins: readonly string[]): ReturnType<typeof createPublicTrackingRoutes> {
  return createPublicTrackingRoutes({
    tokens: {
      read: async () => {
        throw new Error("لا يُنادى: الرمزُ يُرَدُّ بشكلِه قبلَ القاعدةِ.");
      },
    } as never,
    mapStyle:
      mapOrigins.length > 0
        ? ({ configured: true, origins: mapOrigins } as never)
        : { configured: false, reason: "بلا خريطةٍ في القياسِ" },
    scriptUrl: "https://cdn.test/maplibre.js",
    stylesheetUrl: "https://cdn.test/maplibre.css",
    integrity: "sha384-test",
    securityHeaders: createPublicSecurityHeaders({
      mapOrigins,
      scriptOrigin: "https://cdn.test",
    }),
  });
}

describe("ترويساتُ أمنِ الصفحةِ العامّةِ مقيسةٌ على الردِّ (SEC-06)", () => {
  test("كلُّ ترويسةٍ واجبةٍ حاضرةٌ فعلاً على ردِّ «غيرِ موجودٍ» — وهوَ أشيعُ ردٍّ لا أندرُه", async () => {
    const response = await buildApp([]).request("/track/!!!not-a-token!!!");
    expect(response.status).toBe(NOT_FOUND);
    for (const header of REQUIRED_PAGE_HEADERS) {
      expect(response.headers.get(header)).not.toBeNull();
    }
  });

  test("الزيادتانِ الخاصّتانِ بهذا السطحِ حاضرتانِ: لا تخزينَ ولا فهرسةَ لموقعِ إنسانٍ", async () => {
    const response = await buildApp([]).request("/track/!!!not-a-token!!!");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  test("السياسةُ تُغلِقُ الأصلَ بحرفِه: `default-src 'none'` و`frame-ancestors 'none'` و`base-uri 'none'`", async () => {
    const csp = (await buildApp([]).request("/track/!!!not-a-token!!!")).headers.get(
      "Content-Security-Policy",
    );
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    // نموذجٌ لا وجودَ لهُ في الصفحةِ، فلا وجهةَ إرسالٍ مسموحةٌ أصلاً.
    expect(csp).toContain("form-action 'none'");
  });

  test("لا `'unsafe-inline'` في `script-src` بحالٍ — وإلّا كانَت السياسةُ حرفاً بلا أثرٍ", async () => {
    const csp =
      (await buildApp([TILE_ORIGIN]).request("/track/!!!not-a-token!!!")).headers.get(
        "Content-Security-Policy",
      ) ?? "";
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toContain("nonce-");
  });

  test("`nonce` يتغيَّرُ لكلِّ طلبٍ — وقيمةٌ ثابتةٌ تُبطِلُ السياسةَ وهيَ تبدو قائمةً", async () => {
    const app = buildApp([]);
    const first =
      (await app.request("/track/!!!x!!!")).headers.get("Content-Security-Policy") ?? "";
    const second =
      (await app.request("/track/!!!x!!!")).headers.get("Content-Security-Policy") ?? "";
    const nonceOf = (csp: string): string => csp.match(/'nonce-([^']+)'/)?.[1] ?? "";
    expect(nonceOf(first)).not.toBe("");
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  test("بلا خريطةٍ لا أصلَ خارجيَّ في السياسةِ أصلاً — والسياسةُ مُشتَقّةٌ من الضبطِ لا مكتوبةٌ", async () => {
    const csp =
      (await buildApp([]).request("/track/!!!x!!!")).headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain(TILE_ORIGIN);
    expect(csp).toContain("worker-src 'none'");
  });

  test("وبخريطةٍ يُسمَحُ لأصلِ البلاطاتِ في `img-src` و`connect-src` وحدَهما لا في كلِّ شيءٍ", async () => {
    const csp =
      (await buildApp([TILE_ORIGIN]).request("/track/!!!x!!!")).headers.get(
        "Content-Security-Policy",
      ) ?? "";
    const directive = (name: string): string =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("img-src")).toContain(TILE_ORIGIN);
    expect(directive("connect-src")).toContain(TILE_ORIGIN);
    // ولا يُسمَحُ لهُ بأن يكونَ مصدرَ كائنٍ ولا وسيطٍ ولا بيانٍ مسموعٍ.
    expect(directive("object-src")).toContain("'none'");
    expect(directive("media-src")).toContain("'none'");
  });
});
