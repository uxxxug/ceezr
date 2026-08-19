/**
 * الغرض: تصييرُ لوحِ خريطة MapLibre في صفحةٍ مبنيّةٍ في الخادم: وسمُ النصّ ببصمة
 *   سلامة، وحقنُ نموذج العرض بصيغةٍ آمنةٍ في سياق جافاسكربت، وبديلٌ مقروء عند
 *   غياب الضبط. ومعه `jsonForScript` — أداةُ الهروب التي كانت ناقصة.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: المرحلة ١٣ (خريطة العمليات الحيّة)، و١١ و١٢
 * ملاحظات مستقبلية: تحديثُ الدبابيس بلا إعادة تحميل يحتاج مصدرَ أحداثٍ
 *   (SSE، ADR-0016) — يُضاف بنداءٍ إلى `waslahMap.update(...)` لا بإعادة كتابة هذا الملف.
 */

import type { LatLng, MapViewModel, ResolvedMapStyle } from "../../../packages/maps/index.ts";
import { escapeHtml, section } from "./layout.ts";

/**
 * تحويلُ قيمةٍ إلى نصٍّ صالحٍ للحقن **داخل كتلة `<script>`**.
 *
 * ## لماذا لا يكفي `escapeHtml` ولا `JSON.stringify` وحده
 *
 * أداةُ الهروب الوحيدة في اللوحة هي `escapeHtml`، وهي صحيحةٌ في سياق HTML وخاطئةٌ
 * تماماً هنا: `escapeHtml(JSON.stringify(x))` يُنتج `[{&quot;id&quot;:…}]`، و`JSON.parse`
 * عليه يفشل بـ`Unrecognized token '&'` — أي أن الطريق الطبيعي الذي سيسلكه من
 * يكتب صفحة الخريطة **مكسورٌ وظيفياً**، فسينتقل إلى `JSON.stringify` عارياً.
 *
 * و`JSON.stringify` عارياً **ثقبُ تنفيذٍ**: قيمةٌ نصّية تحوي `</script>` تُنهي
 * الكتلة، فما بعدها يُقرأ HTML لا نصّاً. وقد قِيس ذلك فعلاً: اسمٌ قيمتُه
 * `</script><script>alert(document.cookie)</script>` يُنتج كتلتين، الثانية تُنفَّذ.
 * وأسماءُ السائقين وتعليقاتُ التقييم كتبها بشرٌ عبر تلغرام، والصفحةُ التي ستُنفِّذ
 * ذلك تحمل كعكةَ جلسةِ مسؤول.
 *
 * فالهروب هنا ثلاثةُ أشياء لا واحد:
 * ١. `<` و`>` إلى `\\u003c`/`\\u003e` — فلا `</script` ولا `<!--` يُنهي السياق.
 * ٢. `&` إلى `\\u0026` — يمنع إعادةَ تفسيرٍ إن نُقل النصّ إلى سياق HTML لاحقاً.
 * ٣. `U+2028`/`U+2029` — فاصلا سطرٍ في جافاسكربت (وهما صالحان في JSON!) يجعلان
 *    النصّ غير قابلٍ للتصريف. قِيس بقاؤهما حرفيّين في ناتج `JSON.stringify`.
 *
 * والأربعةُ كلُّها هروبٌ **داخل نصّ JSON**، فالناتج يبقى JSON صالحاً يُقرأ
 * بـ`JSON.parse` كما هو — بخلاف `escapeHtml`.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface MapPanelOptions {
  readonly title: string;
  readonly style: ResolvedMapStyle;
  readonly model: MapViewModel;
  /**
   * قيمةُ `nonce` الموافقة لسياسة أمن المحتوى في الترويسة. بلا تطابقٍ بينهما
   * يرفض المتصفّح النصّ فتظهر خريطةٌ فارغة — فهي إلزامية لا اختيارية.
   */
  readonly nonce: string;
  /** رابط نصّ MapLibre وبصمتُه — يُمرَّران لا يُكتبان هنا (تُنظر ملاحظةُ البصمة). */
  readonly scriptUrl: string;
  readonly stylesheetUrl: string;
  readonly integrity: string;
  /** ارتفاع اللوح — رقمٌ بالبكسل، يُقصّ إلى مدىً معقول. */
  readonly heightPx?: number;
}

const DEFAULT_HEIGHT_PX = 460;
const MIN_HEIGHT_PX = 200;
const MAX_HEIGHT_PX = 1200;

/**
 * لوحُ الخريطة كاملاً: قسمٌ بعنوانٍ، وحاويةٌ، ونصُّ التهيئة.
 *
 * وعند غياب الضبط **لا يُصيَّر أي نصّ ولا حاوية**: يُعرض سببٌ مقروء. ومربّعٌ
 * رماديٌّ فارغ كان سيُقرأ عطلاً فيُبحث عنه في المكان الخطأ، وحاويةٌ بلا نصٍّ
 * كانت ستُبقي في الصفحة عنصراً يوهم بأن شيئاً سيظهر.
 */
export function renderMapPanel(options: MapPanelOptions): string {
  if (!options.style.configured) {
    return section(
      options.title,
      `<p class="empty">${escapeHtml(options.style.reason)}</p>`,
      "تُضبط الخريطة بمتغيّري MAP_PROVIDER وMAP_STYLE_URL؛ وبقيّة اللوحة تعمل بلا خريطة.",
    );
  }

  // بصمةٌ غير مضبوطة = نصٌّ من طرفٍ ثالث بلا تحقّقٍ من بايتاته في صفحةٍ تحمل جلسة
  // مسؤول. ولن أُصيّره: فشلٌ مرئيٌّ للمشغّل أهونُ من نافذةِ تنفيذٍ صامتة، وهو
  // نفسُ المِنهاج المتّبع في هذه المراحل — لا نُسلّم قدرةً غيرَ مُحصَّنة.
  if (!isUsableIntegrity(options.integrity)) {
    return section(
      options.title,
      `<p class="empty">لم تُضبَط بصمةُ سلامة (SRI) لنصّ MapLibre — لن يُحمَّل نصٌّ خارجي بلا تحقّق.</p>`,
      "تُحسب بالأمر: openssl dgst -sha384 -binary maplibre-gl.js | openssl base64 -A",
    );
  }

  const height = clampHeight(options.heightPx);
  const containerId = "waslah-map";
  const payload = jsonForScript({
    styleUrl: options.style.styleUrl,
    center: options.model.center,
    zoom: options.model.zoom,
    points: options.model.points,
    polylines: options.model.polylines,
    fitToPoints: options.model.fitToPoints === true,
  });
  const nonce = escapeHtml(options.nonce);

  const body = `<link rel="stylesheet" href="${escapeHtml(options.stylesheetUrl)}"
      integrity="${escapeHtml(options.integrity)}" crossorigin="anonymous">
<div id="${containerId}" class="map-canvas" style="height:${height}px"
     role="img" aria-label="خريطة المواقع"></div>
<noscript><p class="empty">الخريطة تحتاج جافاسكربت؛ الجداول أعلاه تعرض نفس البيانات نصّاً.</p></noscript>
<script src="${escapeHtml(options.scriptUrl)}" integrity="${escapeHtml(options.integrity)}"
        crossorigin="anonymous" nonce="${nonce}" defer></script>
<script nonce="${nonce}">${initScript(containerId, payload)}</script>`;

  return section(options.title, body);
}

/** بصمةٌ صالحةٌ للاستعمال: صيغة `sha(256|384|512)-<base64>` وليست القيمة غير المضبوطة. */
export function isUsableIntegrity(integrity: string): boolean {
  return /^sha(?:256|384|512)-[A-Za-z0-9+/]{27,}={0,2}$/.test(integrity.trim());
}

function clampHeight(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_HEIGHT_PX;
  return Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, Math.trunc(value)));
}

/**
 * نصُّ التهيئة. يُعلَّق على `DOMContentLoaded` لأن وسم النصّ يحمل `defer`، فلو
 * نُفِّذ هذا فوراً لما كان `maplibregl` موجوداً بعد.
 *
 * ويُعرَّض `window.waslahMap` بدالّتين (`update`, `fit`) لا لأن أحداً يستعملهما
 * اليوم، بل لأن المرحلة ١٣ ستُحدِّث الدبابيس من مصدر أحداث (ADR-0016) فتحتاج
 * مقبضاً؛ وإضافتُه لاحقاً تعني إعادةَ كتابة هذا النصّ كلِّه.
 */
function initScript(containerId: string, payload: string): string {
  return `(function(){
  var data = JSON.parse(${JSON.stringify(payload)});
  function boot(){
    if (typeof maplibregl === "undefined") return;
    var map = new maplibregl.Map({
      container: ${JSON.stringify(containerId)},
      style: data.styleUrl,
      center: [data.center.lng, data.center.lat],
      zoom: data.zoom,
      attributionControl: true
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    var markers = {};
    function place(points){
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var existing = markers[p.id];
        if (existing) { existing.setLngLat([p.position.lng, p.position.lat]); continue; }
        var m = new maplibregl.Marker({ color: colorFor(p.type) })
          .setLngLat([p.position.lng, p.position.lat]);
        if (p.label) m.setPopup(new maplibregl.Popup({ closeButton: false }).setText(p.label));
        m.addTo(map);
        markers[p.id] = m;
      }
    }
    function colorFor(type){
      if (type === "driver") return "#2f9e63";
      if (type === "pickup") return "#3f7cc4";
      if (type === "dropoff") return "#c8901f";
      return "#9aa3b2";
    }
    function fit(points){
      if (!points.length) return;
      var b = new maplibregl.LngLatBounds();
      for (var i = 0; i < points.length; i++) b.extend([points[i].lng, points[i].lat]);
      map.fitBounds(b, { padding: 48, maxZoom: 15 });
    }
    map.on("load", function(){
      for (var j = 0; j < data.polylines.length; j++) {
        var pl = data.polylines[j];
        var id = "line-" + j;
        map.addSource(id, { type: "geojson", data: { type: "Feature", properties: {},
          geometry: { type: "LineString",
            coordinates: pl.line.points.map(function(pt){ return [pt.lng, pt.lat]; }) } } });
        map.addLayer({ id: id, type: "line", source: id,
          paint: { "line-color": (pl.options && pl.options.color) || "#3f7cc4",
                   "line-width": (pl.options && pl.options.width) || 4,
                   "line-opacity": (pl.options && pl.options.opacity) || 0.9 } });
      }
      place(data.points);
      if (data.fitToPoints) fit(data.points.map(function(p){ return p.position; }));
    });
    window.waslahMap = { update: place, fit: fit };
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();`;
}

/** مركزٌ مُشتقٌّ من نقاطٍ — يمنع تصييرَ خريطةٍ مركزُها 0,0 في المحيط. */
export function centerOf(points: readonly LatLng[], fallback: LatLng): LatLng {
  if (points.length === 0) return fallback;
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}
