/**
 * الغرض: إثباتُ سلوك `resolveMapStyle` — التمييز بين «غير مُهيَّأ» و«خطأ ضبط»،
 *   ورفضِ ما يُنتج عطلاً صامتاً في المتصفّح، واشتقاقِ أصول سياسة أمن المحتوى.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: بلاطاتٌ على مضيفٍ غير مضيف النمط (R-36) تحتاج قراءةَ
 *   `sources` من ملفّ النمط، ويُختبر حينها بملفّ نمطٍ مُزوَّر لا بمتغيّر بيئة.
 */

import { describe, expect, it } from "bun:test";
import {
  MAPLIBRE_CDN_ORIGIN,
  MAPLIBRE_SRI_UNSET,
  MAPLIBRE_VERSION,
  maplibreScriptUrl,
  maplibreStylesheetUrl,
  resolveMapStyle,
} from "../../packages/maps/index.ts";

const STYLE = "https://api.maptiler.com/maps/streets/style.json";

describe("تحليل نمط MapLibre", () => {
  it("مزوّد none يعني غيرَ مُهيَّأ لا خطأ — المنصّة تعمل بلا خريطة", () => {
    const result = resolveMapStyle({ provider: "none", styleUrl: STYLE, publicApiKey: "k" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.configured).toBe(false);
    if (result.value.configured) return;
    expect(result.value.reason).toContain("MAP_PROVIDER");
  });

  it("مزوّدٌ مُفعَّل بلا رابط نمط لا يمنع الإقلاع بل يُبلِّغ سبباً", () => {
    for (const styleUrl of [null, "", "   "]) {
      const result = resolveMapStyle({ provider: "maplibre", styleUrl, publicApiKey: null });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.configured).toBe(false);
      if (result.value.configured) continue;
      expect(result.value.reason).toContain("MAP_STYLE_URL");
    }
  });

  it("رابطٌ غير صالح خطأُ ضبطٍ لا حالةُ صمت", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: "not-a-url",
      publicApiKey: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.key).toBe("MAP_STYLE_URL");
    expect(result.error.code).toBe("MAP_CONFIG_INVALID");
  });

  it("http يُرفض: المتصفّح يحجبه محتوىً مختلطاً فتظهر خريطةٌ فارغة بلا سبب", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: "http://api.maptiler.com/maps/streets/style.json",
      publicApiKey: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toContain("https");
  });

  it("مفتاحٌ في الرابط ومفتاحٌ منفصل معاً = مصدران للحقيقة، يُرفض", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: `${STYLE}?key=in-url`,
      publicApiKey: "separate",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.key).toBe("MAP_TILES_PUBLIC_KEY");
  });

  it("مفتاحٌ في الرابط وحده مقبول ويُترك كما هو", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: `${STYLE}?key=in-url`,
      publicApiKey: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.configured) throw new Error("توقّعنا نمطاً مُهيَّأً");
    expect(result.value.styleUrl).toContain("key=in-url");
  });

  it("مفتاحٌ منفصل يُلحَق بالرابط مُرمَّزاً لا مُلصَقاً نصّاً", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: STYLE,
      publicApiKey: "a b&c=d",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.configured) throw new Error("توقّعنا نمطاً مُهيَّأً");
    // الترميز هو ما يمنع المفتاحَ من أن يُقرأ مُعاملاً إضافياً في الرابط.
    expect(result.value.styleUrl).not.toContain("a b&c=d");
    expect(new URL(result.value.styleUrl).searchParams.get("key")).toBe("a b&c=d");
  });

  it("المفتاحُ الفارغ أو المسافاتُ لا تُلحَق: ?key= فارغاً يُرفضه المورّد", () => {
    for (const publicApiKey of ["", "   ", null]) {
      const result = resolveMapStyle({ provider: "maplibre", styleUrl: STYLE, publicApiKey });
      expect(result.ok).toBe(true);
      if (!result.ok || !result.value.configured) continue;
      expect(result.value.styleUrl).not.toContain("key=");
    }
  });

  it("الأصول مُشتقّةٌ من الرابط لا مكتوبةٌ نصّاً — وإلا خريطةٌ فارغةٌ عند تبديل المورّد", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: "https://tiles.example.org/style.json",
      publicApiKey: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.configured) throw new Error("توقّعنا نمطاً مُهيَّأً");
    expect(result.value.origins).toEqual(["https://tiles.example.org", MAPLIBRE_CDN_ORIGIN]);
    // ولا شيءَ سواهما: كلُّ أصلٍ زائد أصلٌ يُسمح له بشيءٍ في صفحةِ مسؤول.
    expect(result.value.origins.length).toBe(2);
  });

  it("الأصلُ لا يحمل المسارَ ولا المفتاح: تسريبُه في الترويسة تسريبُ سرّ", () => {
    const result = resolveMapStyle({
      provider: "maplibre",
      styleUrl: `${STYLE}?key=secret-key-value`,
      publicApiKey: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.configured) throw new Error("توقّعنا نمطاً مُهيَّأً");
    for (const origin of result.value.origins) {
      expect(origin).not.toContain("secret-key-value");
      expect(origin).not.toContain("style.json");
    }
  });

  it("الإصدار مُثبَّتٌ بالرقم لا latest، والروابط تحمله", () => {
    expect(MAPLIBRE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(maplibreScriptUrl()).toContain(`@${MAPLIBRE_VERSION}/`);
    expect(maplibreStylesheetUrl()).toContain(`@${MAPLIBRE_VERSION}/`);
    for (const url of [maplibreScriptUrl(), maplibreStylesheetUrl()]) {
      expect(url).not.toContain("latest");
      expect(new URL(url).origin).toBe(MAPLIBRE_CDN_ORIGIN);
      expect(url.startsWith("https://")).toBe(true);
    }
  });

  it("البصمةُ الافتراضية قيمةٌ لا تُقبل، لا سلسلةٌ فارغة تُقرأ خطأً برمجياً", () => {
    expect(MAPLIBRE_SRI_UNSET).toBe("sha384-UNSET");
    // العقد: لا تُشبه بصمةً حقيقية، فلا يمرّ فحصُ الصيغة في `renderMapPanel`.
    expect(MAPLIBRE_SRI_UNSET).not.toMatch(/^sha384-[A-Za-z0-9+/]{27,}={0,2}$/);
  });
});
