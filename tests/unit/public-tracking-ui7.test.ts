/**
 * الغرض: حراسةُ عقدِ UI-7 / PR 10 (ADR 0241) على صفحةِ التتبّعِ العامّة بلا قاعدةٍ
 *   ولا متصفّح: الحالاتُ السبعُ مشتقّةٌ من حقولِ الحمولةِ وحدها، لا استقصاءَ ولا مؤقّت،
 *   لا رقمَ لما لم يُقَس (لا عمرَ صفريّاً ولا تقديرَ وصولٍ مختلَق)، CSP صارمةٌ بلا
 *   أنماطٍ مضمَّنةٍ ولا سماتِ أحداث، ولا هويّةَ لحاملِ الرابط.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على apps/gateway/src/public/tracking-page.ts
 */

import { describe, expect, it } from "bun:test";
import { createPublicSecurityHeaders } from "../../apps/gateway/src/public/security-headers.ts";
import {
  formatAge,
  renderTrackingPage,
  STYLES,
  type TrackingPagePosition,
  type TrackingViewKind,
  trackingView,
} from "../../apps/gateway/src/public/tracking-page.ts";
import {
  createPublicTrackingRoutes,
  PAGE_STALE_SECONDS,
} from "../../apps/gateway/src/routes/public-tracking.ts";
import type { TrackingReadState } from "../../packages/application/tracking/tracking-token-ports.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import { IDENTITY_TOKENS } from "../../scripts/lib/ride-share-contract.ts";

const TOKEN = "a".repeat(64);
const NONCE = "nonce-ui7";
const NOW = new Date("2026-10-06T16:00:00.000Z");
const TILE = "https://tiles.test";

const LOCATED: TrackingPagePosition = {
  lat: 21.54321,
  lng: 39.17283,
  age_seconds: 12,
  stale_reason: null,
  active: true,
};

function live(initial: TrackingPagePosition | null, map: "none" | "configured" = "none"): string {
  return renderTrackingPage({
    kind: "live",
    nonce: NONCE,
    token: TOKEN,
    observedAt: NOW,
    pageStaleAfterSeconds: PAGE_STALE_SECONDS,
    initial,
    mapStyle:
      map === "configured"
        ? ({ configured: true, styleUrl: `${TILE}/style.json`, origins: [TILE] } as never)
        : { configured: false, reason: "بلا خريطة" },
    scriptUrl: "https://cdn.test/maplibre.js",
    stylesheetUrl: "https://cdn.test/maplibre.css",
    integrity: "sha384-abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  });
}

function app(
  read: () => Promise<unknown>,
  mapOrigins: readonly string[] = [],
): ReturnType<typeof createPublicTrackingRoutes> {
  return createPublicTrackingRoutes({
    tokens: { read } as never,
    mapStyle: { configured: false, reason: "بلا خريطة" },
    scriptUrl: "https://cdn.test/maplibre.js",
    stylesheetUrl: "https://cdn.test/maplibre.css",
    integrity: "sha384-test",
    securityHeaders: createPublicSecurityHeaders({ mapOrigins, scriptOrigin: "https://cdn.test" }),
  });
}

const reading = (state: TrackingReadState) => async () => ok(state);

describe("UI-7 · الحالاتُ مشتقّةٌ من الحمولةِ وحدها", () => {
  const cases: readonly [string, TrackingPagePosition | null, TrackingViewKind][] = [
    ["إحداثيّةٌ وعمرُها", LOCATED, "located"],
    ["الرحلةُ انتهت بآخرِ موقع", { ...LOCATED, active: false }, "ended"],
    [
      "لم يُبلَّغ موقعٌ قطّ",
      { lat: null, lng: null, age_seconds: null, stale_reason: "NEVER_REPORTED", active: true },
      "empty",
    ],
    [
      "انقطعت الإشارة",
      { lat: null, lng: null, age_seconds: 400, stale_reason: "TOO_OLD", active: true },
      "stale",
    ],
    [
      "موقعٌ بلا ختم",
      { lat: null, lng: null, age_seconds: null, stale_reason: "NO_TIMESTAMP", active: true },
      "unknown",
    ],
    ["لا قراءة", null, "unknown"],
  ];
  for (const [name, payload, kind] of cases) {
    it(`${name} ⇒ ${kind}`, () => {
      expect(trackingView(payload).kind).toBe(kind);
      const html = live(payload);
      expect(html).toContain(`data-state="${kind}"`);
    });
  }

  it("الرابطُ غيرُ الصالح «مرفوض» تنبيهاً، والعطلُ «غيرُ متاح» حالةً — وكلاهما بلا قراءة", () => {
    const refused = renderTrackingPage({ kind: "not-found", nonce: NONCE });
    expect(refused).toContain('data-state="refused"');
    expect(refused).toContain('role="alert"');
    expect(refused).not.toContain('id="coords"');
    const unavailable = renderTrackingPage({ kind: "unavailable", nonce: NONCE });
    expect(unavailable).toContain('data-state="unavailable"');
    expect(unavailable).toContain('role="status"');
    expect(unavailable).toContain("أعد المحاولة");
  });

  it("نصُّ الصفحةِ يعرفُ الحالاتِ الباقية: تحميل، خطأ، رفضٌ بـ429 و404، عدمُ إتاحة، ردٌّ مجهول", () => {
    const html = live(LOCATED);
    for (const marker of [
      'kind:"loading"',
      'kind:"error"',
      'end("refused"',
      "r.status===429",
      "retry-after",
      'kind:"unavailable"',
      'kind:"unknown"',
      "القراءة المعروضة لم تتغيّر",
    ]) {
      expect(html).toContain(marker);
    }
  });
});

describe("UI-7 · لا رقمَ لما لم يُقَس", () => {
  it("العمرُ الغائبُ «غير معروف» لا صفر", () => {
    expect(formatAge(null)).toBe("غير معروف");
    expect(formatAge(Number.NaN)).toBe("غير معروف");
    expect(formatAge(-3)).toBe("غير معروف");
    expect(formatAge(0)).toBe("0 ثانية");
    expect(formatAge(125)).toBe("2 دقيقة");
    const html = live({
      lat: null,
      lng: null,
      age_seconds: null,
      stale_reason: "NEVER_REPORTED",
      active: true,
    });
    expect(html).toContain('<span id="age">غير معروف</span>');
    expect(html).not.toContain(">0 ثانية");
  });

  it("الإحداثيّةُ المحجوبةُ لا تُعرض ولا تُستبدلُ بصفر", () => {
    const html = live({
      lat: null,
      lng: null,
      age_seconds: 400,
      stale_reason: "TOO_OLD",
      active: true,
    });
    expect(html).toContain('<span id="coords" class="coords">لا يُعرض</span>');
    expect(html).not.toMatch(/0\.00000/);
  });

  it("الإحداثيّةُ المقيسةُ تُعرض بمصدرِها وعمرِها", () => {
    const html = live(LOCATED);
    expect(html).toContain("21.54321 , 39.17283");
    expect(html).toContain('<span id="age">12 ثانية</span>');
    expect(html).toContain("المصدر: مقيسٌ في خادم وَصْلة");
    expect(html).toContain("المصدر: آخرُ ما أبلغ به جهازُ السائق");
  });

  it("تقديرُ الوصولِ صمتٌ معلَنٌ لا رقم — العقدُ لا يحملُ تقديراً", () => {
    const html = live(LOCATED);
    const eta = html.slice(html.indexOf("<dt>تقديرُ الوصول</dt>"), html.indexOf("</dl>"));
    expect(eta).toContain("لا يُعرض");
    expect(eta).not.toMatch(/\d/);
    expect(html).not.toMatch(/\bETA\b|\beta_/);
  });

  it("وقتُ القراءةِ ساعةُ الخادم، وقِدَمُ الصفحةِ يُعلَنُ بلا جافاسكربت بعد العتبة", () => {
    const html = live(LOCATED);
    expect(html).toContain(`<time id="observed" datetime="${NOW.toISOString()}">`);
    expect(html).toContain("(توقيت الرياض)");
    expect(html).toContain(`.page-stale{animation-delay:${PAGE_STALE_SECONDS}s}`);
    expect(STYLES).toContain(".page-stale{visibility:hidden");
    expect(html).toContain("الصفحة لا تتحدّث وحدها");
  });
});

describe("UI-7 · لا استقصاءَ ولا وعدَ بتحديثٍ تلقائيّ (§9)", () => {
  it("لا مؤقّتَ ولا إعادةَ تحميلٍ ذاتيّة ولا ادّعاءَ «تلقائياً»", () => {
    for (const html of [live(LOCATED), live(LOCATED, "configured")]) {
      expect(html).not.toContain("setInterval");
      expect(html).not.toContain("setTimeout");
      expect(html).not.toContain("location.reload");
      expect(html).not.toContain('http-equiv="refresh"');
      expect(html).not.toContain("تلقائي");
    }
  });

  it("طلبُ الشبكةِ الوحيدُ نقرةُ التحديث، والرابطُ يعملُ بلا جافاسكربت", () => {
    const html = live(LOCATED);
    expect(html.match(/fetch\(/g)?.length).toBe(1);
    expect(html).toContain('refreshEl.addEventListener("click"');
    expect(html).toContain('<a id="refresh" class="refresh" href="">تحديثُ القراءة</a>');
  });
});

describe("UI-7 · CSP والأمن", () => {
  it("كلُّ وسمِ نصٍّ أو نمطٍ يحملُ nonce، ولا سمةَ style ولا سماتِ أحداث ولا نموذج", () => {
    for (const html of [
      live(LOCATED),
      live(LOCATED, "configured"),
      renderTrackingPage({ kind: "not-found", nonce: NONCE }),
      renderTrackingPage({ kind: "unavailable", nonce: NONCE }),
    ]) {
      for (const tag of html.match(/<(script|style)\b[^>]*>/g) ?? []) {
        expect(tag).toContain(`nonce="${NONCE}"`);
      }
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\son[a-z]+=/);
      expect(html).not.toContain("<form");
    }
  });

  it("الردُّ يحملُ سياسةً بـnonce الصفحةِ نفسِه، بلا unsafe-inline، وform-action 'none'", async () => {
    const response = await app(
      reading({ kind: "located", active: true, position: { lat: 1, lng: 2, ageSeconds: 3 } }),
    ).request(`/track/${TOKEN}`);
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    const html = await response.text();
    const nonce = /nonce="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(nonce).not.toBe("");
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("لا هويّةَ في الصفحة — ولا اسمَ حقلٍ من معجمِ الهويّة", () => {
    for (const html of [live(LOCATED), live(LOCATED, "configured")]) {
      for (const token of IDENTITY_TOKENS) expect(html).not.toContain(token);
    }
  });

  it("الخريطةُ مخفيّةٌ حتى تصلَ إحداثيّة، وحركتُها تحترمُ reduced-motion", () => {
    const awaiting = live(
      { lat: null, lng: null, age_seconds: null, stale_reason: "NEVER_REPORTED", active: true },
      "configured",
    );
    expect(awaiting).toContain('aria-label="موقع السائق على الخريطة" hidden');
    expect(live(LOCATED, "configured")).not.toContain(
      'aria-label="موقع السائق على الخريطة" hidden',
    );
    expect(awaiting).toContain("prefers-reduced-motion: reduce");
    expect(awaiting).toContain("duration:reduce?0:600");
  });

  it("الحمولةُ المضمَّنةُ لا تُنهي وسمَ النصّ", () => {
    const html = live(LOCATED);
    const script = html.slice(html.lastIndexOf("<script"), html.lastIndexOf("</script>"));
    expect(script.match(/<\/script/gi)).toBeNull();
  });
});

describe("UI-7 · المسارُ على العقدِ القائم", () => {
  it("رمزٌ بشكلٍ غيرِ صالح ⇒ 404 «مرفوض» بلا نداءِ قاعدة", async () => {
    let called = false;
    const response = await app(async () => {
      called = true;
      return ok({ kind: "invalid" });
    }).request("/track/NOT-A-TOKEN");
    expect(response.status).toBe(404);
    expect(called).toBe(false);
    expect(await response.text()).toContain('data-state="refused"');
  });

  it("رمزٌ منتهٍ ⇒ 404 «مرفوض»، وعطلُ القاعدة ⇒ 503 «غيرُ متاح» لا «انتهى الرابط»", async () => {
    const dead = await app(reading({ kind: "invalid" })).request(`/track/${TOKEN}`);
    expect(dead.status).toBe(404);
    expect(await dead.text()).toContain('data-state="refused"');

    const down = await app(async () => err({ kind: "port_failure", detail: "db down" })).request(
      `/track/${TOKEN}`,
    );
    expect(down.status).toBe(503);
    const body = await down.text();
    expect(body).toContain('data-state="unavailable"');
    expect(body).not.toContain("انتهت مدّته");
  });

  it("كلُّ حالِ قراءةٍ من العقد تُصيَّرُ بحالتِها", async () => {
    const pairs: readonly [TrackingReadState, string][] = [
      [
        { kind: "located", active: true, position: { lat: 21.5, lng: 39.2, ageSeconds: 4 } },
        "located",
      ],
      [
        { kind: "located", active: false, position: { lat: 21.5, lng: 39.2, ageSeconds: 4 } },
        "ended",
      ],
      [{ kind: "awaiting", active: true, reason: "NEVER_REPORTED", ageSeconds: null }, "empty"],
      [{ kind: "awaiting", active: true, reason: "TOO_OLD", ageSeconds: 500 }, "stale"],
      [{ kind: "awaiting", active: true, reason: "NO_TIMESTAMP", ageSeconds: null }, "unknown"],
    ];
    for (const [state, kind] of pairs) {
      const response = await app(reading(state)).request(`/track/${TOKEN}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`data-state="${kind}"`);
    }
  });

  it("مسارُ الموقعِ لم يتغيّر شكلُه: الحقولُ نفسُها، و404/503 كما كانا", async () => {
    const located = await app(
      reading({ kind: "located", active: true, position: { lat: 1, lng: 2, ageSeconds: 3 } }),
    ).request(`/api/track/${TOKEN}/position`);
    expect(await located.json()).toEqual({
      lat: 1,
      lng: 2,
      age_seconds: 3,
      stale_reason: null,
      active: true,
    });
    const dead = await app(reading({ kind: "invalid" })).request(`/api/track/${TOKEN}/position`);
    expect(dead.status).toBe(404);
    const down = await app(async () => err({ kind: "port_failure", detail: "x" })).request(
      `/api/track/${TOKEN}/position`,
    );
    expect(down.status).toBe(503);
  });
});

describe("UI-7 · الوصول والتباين", () => {
  it("معالمُ الصفحة: لغةٌ واتجاه، رابطُ تخطٍّ، main، عنوانٌ واحد، شريطٌ حيٌّ مُعلَن", () => {
    for (const html of [
      live(LOCATED),
      renderTrackingPage({ kind: "not-found", nonce: NONCE }),
      renderTrackingPage({ kind: "unavailable", nonce: NONCE }),
    ]) {
      expect(html).toContain('lang="ar" dir="rtl"');
      expect(html).toContain('<a class="skip" href="#main">');
      expect(html).toContain('<main id="main" tabindex="-1">');
      expect(html.match(/<h1>/g)?.length).toBe(1);
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('class="glyph" aria-hidden="true"');
    }
  });

  it("لا خصائصَ فيزيائيّة، لا !important ولا @layer، والانتقالُ تحت no-preference وحده", () => {
    expect(STYLES).not.toContain("!important");
    expect(STYLES).not.toContain("@layer");
    expect(STYLES).not.toMatch(/(margin|padding)-(left|right)\s*:/);
    expect(STYLES).not.toMatch(/text-align:\s*(left|right)/);
    expect(STYLES.split("@media (prefers-reduced-motion:no-preference)")[0]).not.toContain(
      "transition",
    );
    expect(STYLES).toContain(":focus-visible");
  });

  it("تباينُ الرموز ≥ 4.5 (WCAG AA)", () => {
    const lum = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      const ch = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const token = (name: string) => {
      const m = STYLES.match(new RegExp(`--${name}:(#[0-9a-f]{6})`));
      if (m?.[1] === undefined) throw new Error(name);
      return m[1];
    };
    for (const surface of ["bg", "panel"]) {
      for (const fg of ["text", "muted", "brand", "amber", "ok", "bad"]) {
        expect({ fg, surface, ok: ratio(token(fg), token(surface)) >= 4.5 }).toEqual({
          fg,
          surface,
          ok: true,
        });
      }
    }
    expect(ratio(token("on-solid"), token("brand"))).toBeGreaterThanOrEqual(4.5);
  });
});
