/**
 * الغرض: إثباتُ أن حقنَ نموذج العرض في كتلة `<script>` لا يُنهي سياقَ النصّ،
 *   وأن اللوحَ يتدهور بسببٍ مقروء بلا ضبطٍ أو بلا بصمة، وأن سياسةَ أمن المحتوى
 *   تُشتقّ من الضبط ولا تحمل `'unsafe-inline'` في `script-src`.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: تصييرُ الخريطة في متصفّحٍ حقيقي غيرُ مُختبَرٍ هنا (R-34)؛
 *   ذلك يحتاج متصفّحاً بلا رأسٍ في CI، وهو من نطاق المرحلة ٢٢.
 */

import { describe, expect, it } from "bun:test";
import { escapeHtml } from "../../apps/admin-dashboard/src/index.ts";
import {
  isUsableIntegrity,
  jsonForScript,
  renderMapPanel,
} from "../../apps/admin-dashboard/src/map.ts";
import { buildContentSecurityPolicyForTest } from "../../apps/gateway/src/admin/security-headers.ts";
import {
  MAPLIBRE_CDN_ORIGIN,
  MAPLIBRE_SRI_UNSET,
  type MapViewModel,
  maplibreScriptUrl,
  maplibreStylesheetUrl,
  type ResolvedMapStyle,
} from "../../packages/maps/index.ts";

/** بصمةٌ ذاتُ صيغةٍ صحيحة — لا تُدّعى صحّتُها لملفٍّ بعينه، الصيغةُ هي المفحوص. */
const VALID_SRI = `sha384-${"A".repeat(64)}`;

const CONFIGURED: ResolvedMapStyle = {
  configured: true,
  provider: "maplibre",
  styleUrl: "https://tiles.example.org/style.json",
  origins: ["https://tiles.example.org", MAPLIBRE_CDN_ORIGIN],
};

function model(overrides: Partial<MapViewModel> = {}): MapViewModel {
  return {
    center: { lat: 21.5471, lng: 39.1751 },
    zoom: 12,
    points: [],
    polylines: [],
    ...overrides,
  };
}

function panel(style: ResolvedMapStyle, m: MapViewModel, integrity = VALID_SRI): string {
  return renderMapPanel({
    title: "خريطة",
    style,
    model: m,
    nonce: "nonce-abc",
    scriptUrl: maplibreScriptUrl(),
    stylesheetUrl: maplibreStylesheetUrl(),
    integrity,
  });
}

describe("هروب JSON في سياق جافاسكربت", () => {
  it("‹/script› لا يُنهي الكتلة — وهذا هو العطب الذي قِيس قبل الإصلاح", () => {
    const hostile = "</script><script>alert(document.cookie)</script>";
    const out = jsonForScript({ name: hostile });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<script");
    expect(out).toContain("\\u003c");
    // ومع ذلك يبقى JSON صالحاً — وهو ما تفشل فيه `escapeHtml`.
    expect(JSON.parse(out)).toEqual({ name: hostile });
  });

  it("‹!-- لا يفتح تعليقاً يُبلع بقيّة النصّ", () => {
    const out = jsonForScript({ v: "<!--" });
    expect(out).not.toContain("<!--");
    expect(JSON.parse(out).v).toBe("<!--");
  });

  it("U+2028 و U+2029 يُهرَبان: صالحان في JSON وفاصلا سطرٍ في جافاسكربت", () => {
    const raw = "أ\u2028ب\u2029ج";
    // إثباتُ الدافع: `JSON.stringify` وحده يُبقيهما حرفيّين فيَكسر النصّ.
    expect(JSON.stringify({ raw })).toContain("\u2028");
    const out = jsonForScript({ raw });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(out).toContain("\\u2028");
    expect(JSON.parse(out).raw).toBe(raw);
  });

  it("‹&› يُهرَب فلا يُعاد تفسيرُه لو نُقل النصّ إلى سياق HTML", () => {
    const out = jsonForScript({ v: "&amp;" });
    expect(out).not.toContain("&");
    expect(JSON.parse(out).v).toBe("&amp;");
  });

  it("escapeHtml غيرُ صالحةٍ هنا — يُوثَّق بالاختبار كي لا تُستعمل ثانيةً", () => {
    const broken = escapeHtml(JSON.stringify({ id: 1 }));
    expect(broken).toContain("&quot;");
    expect(() => JSON.parse(broken)).toThrow();
  });
});

describe("لوح الخريطة", () => {
  it("بلا ضبطٍ: سببٌ مقروء، ولا حاويةَ ولا نصَّ يُوهم بأن شيئاً سيظهر", () => {
    const html = panel(
      { configured: false, reason: "مزوّد الخريطة غير مُفعَّل (MAP_PROVIDER=none)." },
      model(),
    );
    expect(html).toContain("MAP_PROVIDER");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("waslah-map");
    expect(html).not.toContain(MAPLIBRE_CDN_ORIGIN);
  });

  it("بلا بصمةٍ مضبوطة: لا يُصيَّر نصٌّ خارجي أصلاً", () => {
    const html = panel(CONFIGURED, model(), MAPLIBRE_SRI_UNSET);
    expect(html).not.toContain("<script");
    expect(html).toContain("SRI");
    expect(html).toContain("openssl");
  });

  it("مع الضبط والبصمة: وسمان يحملان integrity و crossorigin و nonce", () => {
    const html = panel(CONFIGURED, model());
    expect(html).toContain(`integrity="${VALID_SRI}"`);
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).toContain('nonce="nonce-abc"');
    // البصمة على الاثنين: ورقةُ الأنماط تُحمَّل من نفس المضيف فلها نفسُ الخطر.
    expect(html.split("integrity=").length - 1).toBe(2);
  });

  it("أسماءُ السائقين المُعادية تُحقَن بلا كسرِ السياق", () => {
    const html = panel(
      CONFIGURED,
      model({
        points: [
          {
            id: "d1",
            type: "driver",
            position: { lat: 21.5, lng: 39.2 },
            label: "</script><script>alert(1)</script>",
          },
        ],
      }),
    );
    // وسمَا النصّ المتوقَّعان فقط: MapLibre وكتلةُ التهيئة. لا ثالثَ مُحقَن.
    expect(html.split("<script").length - 1).toBe(2);
    expect(html.split("</script").length - 1).toBe(2);
    // النصُّ المُعادي يظهر في الصفحة — لكن بياناً خامداً داخل نصّ JSON لا وسماً.
    // فالمقياس الصحيح ليس غيابَ `alert(1)` (فهو اسمُ سائقٍ مشروعٌ أن يُنقل)، بل
    // أن يكون مسبوقاً بمحرفٍ مهروبٍ فلا يُفتح سياقٌ جديد يُنفِّذه.
    expect(html).toContain("u003cscript");
    expect(html).not.toContain("<script>alert");
    // والقيمةُ تعود كما دخلت عند التصريف: الهروبُ نقلٌ لا تشويه.
    const payload = html.slice(html.indexOf("JSON.parse(") + "JSON.parse(".length);
    const literal = payload.slice(0, payload.indexOf(");"));
    const parsed = JSON.parse(JSON.parse(literal) as string) as MapViewModel;
    expect(parsed.points[0]?.label).toBe("</script><script>alert(1)</script>");
  });

  it("الارتفاع يُقصّ إلى مدىً معقول فلا خريطةٌ بارتفاع مليون بكسل", () => {
    const tall = renderMapPanel({
      title: "خريطة",
      style: CONFIGURED,
      model: model(),
      nonce: "n",
      scriptUrl: maplibreScriptUrl(),
      stylesheetUrl: maplibreStylesheetUrl(),
      integrity: VALID_SRI,
      heightPx: 1_000_000,
    });
    expect(tall).toContain("height:1200px");
    expect(tall).not.toContain("1000000");
  });

  it("بديلٌ نصّي لمن لا جافاسكربت لديه", () => {
    expect(panel(CONFIGURED, model())).toContain("<noscript>");
  });

  it("فحصُ صيغة البصمة يقبل الصحيح ويرفض ما دونه", () => {
    expect(isUsableIntegrity(VALID_SRI)).toBe(true);
    expect(isUsableIntegrity(`sha256-${"B".repeat(43)}=`)).toBe(true);
    for (const bad of [MAPLIBRE_SRI_UNSET, "", "sha384-", "abc", "md5-xxxx", "sha384-قصير"]) {
      expect(isUsableIntegrity(bad)).toBe(false);
    }
  });
});

describe("سياسة أمن المحتوى", () => {
  it("script-src بـnonce فقط، بلا unsafe-inline — وإلا فالسياسةُ زينة", () => {
    const csp = buildContentSecurityPolicyForTest("N1", []);
    expect(csp).toContain("script-src 'nonce-N1'");
    expect(csp).not.toContain("script-src 'nonce-N1' 'unsafe-inline'");
    // التنازل الوحيد المُعلَن: سماتُ النمط (ADR 0019 البند ٤). ولا يمسّ النصّ.
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("بلا خريطةٍ: لا أصلَ خارجيّاً في أي توجيه، ولا عاملَ blob", () => {
    const csp = buildContentSecurityPolicyForTest("N1", []);
    expect(csp).not.toContain("https://");
    expect(csp).not.toContain("blob:");
    expect(csp).toContain("worker-src 'none'");
  });

  it("مع خريطةٍ: الأصولُ المُمرَّرة وحدها تُسمَح", () => {
    const csp = buildContentSecurityPolicyForTest("N1", CONFIGURED.origins);
    for (const origin of CONFIGURED.origins) {
      expect(csp).toContain(origin);
    }
    expect(csp).toContain("worker-src blob:");
    expect(csp).toContain("connect-src 'self' https://tiles.example.org");
    // ولا يُسمح لأصلٍ لم يُمرَّر.
    expect(csp).not.toContain("https://evil.example.com");
  });

  it("الـnonce يظهر في script-src و style-src معاً لا في أحدهما", () => {
    const csp = buildContentSecurityPolicyForTest("XYZ", []);
    expect(csp.split("'nonce-XYZ'").length - 1).toBe(2);
  });
});
