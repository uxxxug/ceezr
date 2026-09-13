/**
 * الغرض: تصييرُ صفحة التتبّع العامّة كاملةً — وسمُ HTML واحدٌ عربيٌّ من اليمين
 *   إلى اليسار، فيه خريطةُ MapLibre ونصُّ استفتاءٍ صغير، ونصٌّ بديلٌ كاملُ المعنى
 *   حين لا تكون الخريطة مضبوطةً أو لا بصمةَ سلامةٍ لنصّها.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: apps/gateway/src/public
 * يُتوقع أن يستخدمه: apps/gateway/src/routes/public-tracking.ts.
 * ملاحظات مستقبلية: زرُّ «فتح في تطبيق الخرائط» يُضاف برابط `geo:` واحدٍ بلا أيّ
 *   أصلٍ خارجيّ جديد — فلا يمسّ سياسةَ الأمن.
 *
 * ## صفحةٌ واحدةٌ بلا ملفّاتٍ ثابتة — عن قصد
 *
 * ولا ورقةَ أنماطٍ خارجيّةً ولا صورةً ولا خطّاً: الصفحةُ نصٌّ واحدٌ يُرسَل في ردٍّ
 * واحد. ولو كانت أصولاً منفصلةً لاحتاجت مساراً ثابتاً في البوابة وتخزيناً مؤقّتاً
 * — وهي الصفحةُ التي تُمنع من التخزين المؤقّت أصلاً لأنّها تعرض موقعَ إنسان.
 *
 * ## البصمةُ الغائبة تُطفئ الخريطة لا الصفحة
 *
 * نفسُ حكم `renderMapPanel` في اللوحة: نصٌّ من طرفٍ ثالثٍ بلا تحقّقٍ من بايتاته لا
 * يُصيَّر. والفرقُ أنّ هذه الصفحةَ **تبقى مفيدةً كاملةً** بلا خريطة: إحداثيّتان
 * ووقتُ آخرِ تحديثٍ وحالةُ الرحلة نصّاً — وهو ما يريده المنتظِر فعلاً. فلا يُقال
 * له «الخريطةُ معطّلة» ويُترك بلا جواب.
 */

import type { ResolvedMapStyle } from "../../../../packages/maps/index.ts";
import { MAPLIBRE_SRI_UNSET } from "../../../../packages/maps/index.ts";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * الهروبُ يُكرَّر هنا ولا يُستورد من `apps/admin-dashboard`: البوابةُ العامّة لا
 * يجوز أن تعتمد على حزمة لوحة الإدارة لأجل دالّةٍ من سطرين — وربطُهما كان سيجعل
 * أيّ تغييرٍ في أنماط اللوحة يمسّ صفحةً يفتحها الجمهور.
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * هروبٌ صالحٌ داخل كتلة `<script>` — نفسُ منهاج `jsonForScript` في اللوحة وبنفس
 * أسبابه: `escapeHtml` يُنتج JSON لا يُقرأ، و`JSON.stringify` عارياً يُنهي الكتلة
 * بـ`</script>` في قيمةٍ نصّية. وهنا القيمُ أرقامٌ وطوابعُ زمنٍ لا نصوصَ بشرٍ،
 * لكنّ الاعتماد على ذلك افتراضٌ يُكسَر بأوّل حقلٍ يُضاف.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * ## إضافةُ البند F2-09 (2026-09-14): عُمرٌ مقيسٌ وسببٌ مُصنَّفٌ
 *
 * كانَ `updated_at` يُقرأُ بـ`new Date` في **المتصفّحِ**، وساعةُ المتصفّحِ
 * ليست شاهداً: جهازٌ متقدّمٌ أو متأخّرٌ كانَ يكذبُ على صاحبِه في الاتّجاهَينِ.
 * فالعُمرُ الآنَ يُقاسُ في القاعدةِ ويُعرَضُ كما وصلَ.
 */
export interface TrackingPagePosition {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly age_seconds: number | null;
  readonly stale_reason: "NEVER_REPORTED" | "NO_TIMESTAMP" | "TOO_OLD" | null;
  readonly active: boolean;
}

export type TrackingPageInput =
  | { readonly kind: "not-found"; readonly nonce: string }
  | { readonly kind: "unavailable"; readonly nonce: string }
  | {
      readonly kind: "live";
      readonly nonce: string;
      readonly token: string;
      readonly pollSeconds: number;
      readonly initial: TrackingPagePosition | null;
      readonly mapStyle: ResolvedMapStyle;
      readonly scriptUrl: string;
      readonly stylesheetUrl: string;
      readonly integrity: string;
    };

/** بصمةٌ غيرُ محسوبةٍ أو فارغةٌ = لا نصَّ خارجيّاً (ADR 0019). */
function isUsableIntegrity(integrity: string): boolean {
  return integrity.trim() !== "" && integrity !== MAPLIBRE_SRI_UNSET;
}

const STYLES = `:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
background:#0f1115;color:#e8eaed;display:flex;flex-direction:column;min-height:100vh}
header{padding:14px 16px;background:#161a21;border-bottom:1px solid #262c36}
h1{margin:0;font-size:1.05rem;font-weight:600}
main{flex:1;display:flex;flex-direction:column}
#map{flex:1;min-height:55vh;background:#1b2027}
.panel{padding:14px 16px;background:#161a21;border-top:1px solid #262c36;
display:flex;flex-direction:column;gap:6px}
.state{font-size:1rem;font-weight:600}
.muted{color:#9aa4b2;font-size:.85rem}
.coords{font-variant-numeric:tabular-nums;letter-spacing:.02em}
.notice{margin:0;padding:24px 16px;text-align:center;line-height:1.9}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;
margin-inline-end:6px;vertical-align:middle;background:#9aa4b2}
.dot.on{background:#2fbf71}
.dot.off{background:#e0803a}`;

function shell(nonce: string, title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<!-- المُحيل مكتومٌ في الترويسة أيضاً؛ والوسمُ هنا لمتصفّحٍ يقرأ الوسمَ ولا يقرؤها. -->
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style nonce="${escapeHtml(nonce)}">${STYLES}</style>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

/** نصُّ الصفحة: يرسم علامةً إن كانت الخريطةُ مضبوطة، ويُحدِّث النصّ دائماً. */
function pageScript(payload: string, hasMap: boolean): string {
  return `(function(){
// القيمُ مهروبةٌ في المُصيِّر فلا يظهر محرفُ وسمٍ في المصدر، وJSON الصالح تعبيرٌ
// صالحٌ في جافاسكربت — فلا حاجةَ لتحليل نصٍّ مُقتبَسٍ مرّتين.
var cfg=${payload};
var stateEl=document.getElementById("state");
var coordsEl=document.getElementById("coords");
var updatedEl=document.getElementById("updated");
var dotEl=document.getElementById("dot");
var map=null,marker=null;
// العُمرُ رقمٌ جاءَ من القاعدةِ — **ولا تُستعمَلُ ساعةُ الجهازِ ههنا قطُّ**.
function age(sec){
  if(sec===null||sec===undefined||isNaN(sec))return "—";
  if(sec<60)return "منذ "+Math.round(sec)+" ثانية";
  var m=Math.round(sec/60);
  if(m<60)return "منذ "+m+" دقيقة";
  return "منذ "+Math.round(m/60)+" ساعة";
}
function paint(p){
  if(!p){
    // الرمزُ مات بيننا وبين آخر استفتاء: يُقال صريحاً ويتوقّف الاستفتاء.
    stateEl.textContent="انتهى هذا الرابط";
    coordsEl.textContent="";
    updatedEl.textContent="";
    dotEl.className="dot";
    return false;
  }
  dotEl.className="dot "+(p.active?"on":"off");
  if(p.lat===null||p.lng===null){
    // **السببُ يُقالُ صريحاً**: «جارٍ التحديثُ» إلى الأبدِ كانَ يُخفي
    // انقطاعاً يستحقُّ أن يُتصَّلَ لأجلِه.
    if(!p.active){
      stateEl.textContent="انتهت الرحلة";
    }else if(p.stale_reason==="TOO_OLD"){
      stateEl.textContent="في الطريق — انقطعت إشارة السائق";
    }else{
      stateEl.textContent="في الطريق — لم يصل موقعٌ بعد";
    }
    coordsEl.textContent="";
  }else{
    stateEl.textContent=p.active?"في الطريق":"انتهت الرحلة — آخر موقع معروف";
    coordsEl.textContent=p.lat.toFixed(5)+" , "+p.lng.toFixed(5);
    ${hasMap ? "place(p.lat,p.lng);" : ""}
  }
  updatedEl.textContent=p.age_seconds===null?"":"آخر موقع: "+age(p.age_seconds);
  return true;
}
${
  hasMap
    ? `function place(lat,lng){
  if(typeof maplibregl==="undefined")return;
  if(map===null){
    map=new maplibregl.Map({container:"map",style:cfg.styleUrl,center:[lng,lat],zoom:15,attributionControl:true});
    marker=new maplibregl.Marker().setLngLat([lng,lat]).addTo(map);
    return;
  }
  marker.setLngLat([lng,lat]);
  map.easeTo({center:[lng,lat],duration:600});
}`
    : ""
}
function tick(){
  fetch(cfg.positionUrl,{cache:"no-store",credentials:"omit",redirect:"error"})
    .then(function(r){ return r.status===200?r.json():null; })
    .then(function(p){ if(paint(p))schedule(); })
    // خطأُ شبكةٍ لا يُغيّر المعروض: يُعاد المحاولةُ بصمت، فقطعُ إشارةٍ لحظيٌّ لا
    // يجوز أن يُقرأ «انتهى الرابط».
    .catch(function(){ schedule(); });
}
function schedule(){ window.setTimeout(tick, cfg.pollMs); }
if(paint(cfg.initial))schedule();
})();`;
}

export function renderTrackingPage(input: TrackingPageInput): string {
  if (input.kind === "not-found") {
    return shell(
      input.nonce,
      "رابط تتبّع غير صالح",
      `<header><h1>وصلة</h1></header>
<main><p class="notice">هذا الرابط غير صالح أو انتهت مدّته.<br>
<span class="muted">روابط التتبّع مؤقّتة وتنتهي بانتهاء الرحلة أو بإلغائها من صاحبها.</span></p></main>`,
    );
  }

  if (input.kind === "unavailable") {
    return shell(
      input.nonce,
      "تعذّر عرض التتبّع",
      `<header><h1>وصلة</h1></header>
<main><p class="notice">تعذّر جلب الموقع الآن.<br>
<span class="muted">الرابط قد يكون سليماً — أعِد المحاولة بعد لحظات.</span></p></main>`,
    );
  }

  const configured = input.mapStyle.configured && isUsableIntegrity(input.integrity);
  const payload = jsonForScript({
    positionUrl: `/api/track/${input.token}/position`,
    pollMs: input.pollSeconds * 1000,
    initial: input.initial,
    styleUrl: input.mapStyle.configured ? input.mapStyle.styleUrl : null,
  });
  const nonce = escapeHtml(input.nonce);

  const head = configured
    ? `<link rel="stylesheet" href="${escapeHtml(input.stylesheetUrl)}"
      integrity="${escapeHtml(input.integrity)}" crossorigin="anonymous">
<script src="${escapeHtml(input.scriptUrl)}" integrity="${escapeHtml(input.integrity)}"
        crossorigin="anonymous" nonce="${nonce}" defer></script>`
    : "";

  // بلا خريطةٍ لا تُصيَّر حاويتُها: مربّعٌ رماديٌّ فارغ يُقرأ عطلاً فيُبحث عنه في
  // المكان الخطأ (نفسُ حكم `renderMapPanel`).
  const mapSlot = configured
    ? `<div id="map" role="img" aria-label="موقع السائق على الخريطة"></div>`
    : `<p class="notice muted">الخريطة غير مُهيَّأة على هذه المنصّة — الإحداثيّات أدناه محدَّثةٌ لحظيّاً.</p>`;

  const body = `<header><h1>تتبّع الرحلة</h1></header>
<main>
${mapSlot}
<section class="panel">
  <div class="state"><span id="dot" class="dot"></span><span id="state">جارٍ التحديث…</span></div>
  <div class="coords muted" id="coords"></div>
  <div class="muted" id="updated"></div>
  <div class="muted">يُحدَّث الموقع تلقائياً كلّ ${String(input.pollSeconds)} ثوانٍ.</div>
  <noscript><div class="muted">التحديث التلقائي يحتاج جافاسكربت — أعِد تحميل الصفحة لرؤية آخر موقع.</div></noscript>
</section>
</main>
<script nonce="${nonce}">${pageScript(payload, configured)}</script>`;

  return shell(input.nonce, "تتبّع الرحلة", body, head);
}
