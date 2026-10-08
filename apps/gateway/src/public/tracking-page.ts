/**
 * الغرض: تصييرُ صفحة التتبّع العامّة كاملةً — وسمُ HTML واحدٌ عربيٌّ من اليمين
 *   إلى اليسار، فيه شريطُ حالةٍ واحد، وقراءةٌ بمصدرِها وعُمرِها، وخريطةُ MapLibre
 *   متى ضُبطت، ونصٌّ بديلٌ كاملُ المعنى حين لا تكون الخريطة مضبوطةً.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري)؛ وأُعيد
 *   بناؤه في UI-7 / PR 10 (ADR 0241): لا استقصاءَ، والحالاتُ السبعُ كاملة.
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
      /** ساعةُ الخادمِ لحظةَ القراءة — لا ساعةَ الجهاز. */
      readonly observedAt: Date;
      /** بعدَها يُعلَنُ أنَّ **هذه الصفحة** قديمة (عُمرُ القراءةِ لا عُمرُ الموقع). */
      readonly pageStaleAfterSeconds: number;
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

/**
 * الحالاتُ السبعُ (المصدرُ الكانونيُّ §5) وحالةُ القراءةِ الصادقة — UI-7 / PR 10.
 *
 * كلُّ حالةٍ تُشتقُّ من حقلٍ في الحمولةِ لا من تخمين: `located` إحداثيّةٌ وعمرُها
 * مقيسان؛ `ended` الرحلةُ لم تعد جارية (`active=false`)؛ `empty` لم يُبلَّغ موقعٌ قطّ
 * (`NEVER_REPORTED`)؛ `stale` انقطعت الإشارةُ فحجبَ الخادمُ الإحداثيّة (`TOO_OLD`)؛
 * `unknown` موقعٌ بلا ختمٍ زمنيٍّ فعُمرُه مجهول (`NO_TIMESTAMP`) أو حمولةٌ لا تُفهم؛
 * `refused` رابطٌ غيرُ صالحٍ/منتهٍ/ملغىً أو تجاوزُ حدِّ المعدّل؛ `unavailable` عطلُ
 * خدمة (503)؛ `error` فشلُ تحديثٍ يدويٍّ لسببٍ آخر؛ `loading` أثناءَ التحديث.
 */
export type TrackingViewKind =
  | "located"
  | "ended"
  | "loading"
  | "empty"
  | "error"
  | "refused"
  | "unavailable"
  | "stale"
  | "unknown";

export interface TrackingView {
  readonly kind: TrackingViewKind;
  readonly label: string;
  readonly reason: string;
}

export const STATE_GLYPH: Readonly<Record<TrackingViewKind, string>> = {
  located: "●",
  ended: "■",
  loading: "…",
  empty: "○",
  error: "!",
  refused: "⊘",
  unavailable: "⏸",
  stale: "⏱",
  unknown: "?",
};

/** عُمرٌ مقيسٌ في القاعدة بصياغةٍ مقروءة — و«غيرُ معروف» لا صفرٌ متى غاب. */
export function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "غير معروف";
  if (seconds < 60) return `${Math.round(seconds)} ثانية`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  return `${Math.round(minutes / 60)} ساعة`;
}

const CLOCK = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
  timeZone: "Asia/Riyadh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** ساعةُ الخادمِ لحظةَ القراءة بتوقيتِ الرياض. */
export function formatClock(at: Date): string {
  return CLOCK.format(at);
}

export function trackingView(p: TrackingPagePosition | null): TrackingView {
  if (p === null) {
    return { kind: "unknown", label: "حالةٌ غيرُ معروفة", reason: "لم تصل قراءةٌ تُفهم." };
  }
  const hasPoint = p.lat !== null && p.lng !== null;
  if (!p.active) {
    return {
      kind: "ended",
      label: "انتهت الرحلة",
      reason: hasPoint
        ? "المعروضُ آخرُ موقعٍ معروف، لا موقعٌ حاليّ."
        : "لا موقعَ يُعرض بعد انتهاء الرحلة.",
    };
  }
  if (hasPoint) {
    return {
      kind: "located",
      label: "الرحلة جارية",
      reason: `آخرُ موقعٍ أبلغ به جهازُ السائق، عمرُه عند القراءة ${formatAge(p.age_seconds)}.`,
    };
  }
  if (p.stale_reason === "TOO_OLD") {
    return {
      kind: "stale",
      label: "انقطعت إشارةُ السائق",
      reason: `آخرُ إشارةٍ عمرُها ${formatAge(p.age_seconds)} — أقدمُ من أن تُعرض موقعاً حاليّاً، فحُجبت.`,
    };
  }
  if (p.stale_reason === "NO_TIMESTAMP") {
    return {
      kind: "unknown",
      label: "عمرُ الموقع غير معروف",
      reason: "وصل موقعٌ بلا ختمٍ زمنيّ، فلا يُعرض: موقعٌ مجهولُ العمر قد يكون قديماً.",
    };
  }
  return {
    kind: "empty",
    label: "الرحلة جارية — لا موقعَ بعد",
    reason: "لم يُبلِّغ جهازُ السائق عن موقعه بعدُ في هذه الرحلة.",
  };
}

/**
 * رموزُ §2 (القيمُ الداكنة) وسلّمُ §3. خصائصُ منطقيةٌ فقط؛ لا `!important` ولا
 * `@layer`؛ الحركةُ الوحيدةُ (انتقالُ الزرّ) تحت `prefers-reduced-motion:
 * no-preference`؛ وكشفُ شريطِ قِدَمِ الصفحةِ تبديلُ ظهورٍ بلا مدّة. **ولا سمةَ
 * `style` في الصفحة**: السياسةُ هنا لا تُجيزُ الأنماطَ المضمَّنةَ أصلاً.
 */
export const STYLES = `:root{color-scheme:dark;--bg:#0f1115;--panel:#171a21;--line:#2c3242;--text:#e7e9ee;
--muted:#a7afbd;--brand:#8b90ff;--amber:#f5b23e;--ok:#34d399;--bad:#ef5350;--on-solid:#0f1115}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
font-family:-apple-system,BlinkMacSystemFont,"SF Arabic","Segoe UI","Noto Sans Arabic",Roboto,system-ui,Tahoma,sans-serif;
font-size:.9375rem;line-height:1.6;display:flex;flex-direction:column;min-block-size:100vh;
font-variant-numeric:tabular-nums lining-nums}
a{color:var(--brand)}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.skip{position:absolute;inset-inline-start:12px;inset-block-start:-48px;padding-block:8px;padding-inline:14px;
border-radius:8px;background:var(--brand);color:var(--on-solid);font-weight:700}
.skip:focus{inset-block-start:8px}
header{padding-block:14px;padding-inline:16px;background:var(--panel);border-block-end:1px solid var(--line)}
h1{margin:0;font-size:1.375rem;line-height:1.95rem;font-weight:800}
h2{margin:0 0 6px;font-size:1.0625rem;font-weight:700}
main{flex:1;display:flex;flex-direction:column;inline-size:100%;max-inline-size:720px;margin-inline:auto}
main:focus{outline:none}
.ribbon{display:flex;gap:10px;align-items:flex-start;padding-block:12px;padding-inline:16px;
border-block-end:1px solid var(--line);background:var(--panel)}
.glyph{flex:none;inline-size:26px;block-size:26px;border-radius:999px;display:inline-flex;align-items:center;
justify-content:center;font-weight:800;border:1px solid currentColor;color:var(--muted)}
.ribbon p{margin:0}
.label{font-weight:700;display:block}
.reason{color:var(--muted)}
.state--located .glyph{color:var(--ok)}
.state--stale .glyph,.state--unavailable .glyph,.state--ended .glyph{color:var(--amber)}
.state--error .glyph,.state--refused .glyph{color:#ff8a87}
#map{block-size:50vh;min-block-size:260px;background:#1b2027}
.reading{padding-block:12px;padding-inline:16px;display:grid;gap:4px}
.reading dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}
.reading dt{color:var(--muted)}
.reading dd{margin:0}
.seal{display:block;color:var(--muted);font-size:.75rem}
.coords{direction:ltr;unicode-bidi:isolate}
.actions{padding-block:4px 14px;padding-inline:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.refresh{display:inline-flex;align-items:center;min-block-size:44px;padding-inline:16px;border-radius:8px;
background:var(--brand);color:var(--on-solid);font-weight:700;text-decoration:none;border:0;font:inherit;cursor:pointer}
.refresh[aria-disabled=true]{opacity:.55;pointer-events:none}
.note{color:var(--muted);font-size:.8125rem;margin:0;padding-block:0 12px;padding-inline:16px}
.notice{margin:0;padding-block:24px;padding-inline:16px;line-height:1.9}
.page-stale{visibility:hidden;margin-block:0 12px;margin-inline:16px;padding-block:10px;padding-inline:12px;
border:1px solid rgba(245,178,62,.45);border-radius:8px;
animation-name:page-stale;animation-duration:0s;animation-fill-mode:forwards}
@keyframes page-stale{to{visibility:visible}}
@media (prefers-reduced-motion:no-preference){.refresh{transition:filter .12s ease}}
.refresh:hover{filter:brightness(1.1)}`;

function shell(nonce: string, title: string, body: string, head = "", extraCss = ""): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<!-- المُحيل مكتومٌ في الترويسة أيضاً؛ والوسمُ هنا لمتصفّحٍ يقرأ الوسمَ ولا يقرؤها. -->
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style nonce="${escapeHtml(nonce)}">${STYLES}${extraCss}</style>
${head}
</head>
<body>
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
${body}
</body>
</html>`;
}

function ribbon(view: TrackingView): string {
  const role = view.kind === "error" || view.kind === "refused" ? "alert" : "status";
  return `<section id="ribbon" class="ribbon state--${view.kind}" data-state="${view.kind}" role="${role}" aria-live="polite" aria-atomic="true">
<span id="glyph" class="glyph" aria-hidden="true">${STATE_GLYPH[view.kind]}</span>
<p><strong id="label" class="label">${escapeHtml(view.label)}</strong><span id="reason" class="reason">${escapeHtml(view.reason)}</span></p>
</section>`;
}

/** صفحةُ حالةٍ نهائيّةٍ بلا قراءة: رابطٌ مرفوضٌ أو خدمةٌ غيرُ متاحة. */
function terminalPage(nonce: string, title: string, view: TrackingView, extra: string): string {
  return shell(
    nonce,
    title,
    `<header><h1>وَصْلة — تتبّع الرحلة</h1></header>
<main id="main" tabindex="-1">
${ribbon(view)}
${extra}
</main>`,
  );
}

/**
 * نصُّ الصفحة: **لا مؤقّتَ ولا استقصاء** (§9). طلبُ الشبكةِ الوحيدُ نقرةُ «تحديثُ
 * القراءة» — والرابطُ نفسُه يُعيدُ تحميلَ الصفحةِ بلا جافاسكربت. العُمرُ رقمٌ من
 * القاعدةِ ولا تُستعمل ساعةُ الجهازِ قطّ.
 */
function pageScript(payload: string, hasMap: boolean): string {
  return `(function(){
var cfg=${payload};
var GLYPH=${jsonForScript(STATE_GLYPH)};
function $(id){return document.getElementById(id);}
var ribbonEl=$("ribbon"),glyphEl=$("glyph"),labelEl=$("label"),reasonEl=$("reason");
var coordsEl=$("coords"),ageEl=$("age"),timeEl=$("observed"),pageStale=$("page-stale");
var refreshEl=$("refresh"),mapEl=$("map");
var map=null,marker=null,busy=false;
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function age(sec){
  if(sec===null||sec===undefined||!isFinite(sec)||sec<0)return "غير معروف";
  if(sec<60)return Math.round(sec)+" ثانية";
  var m=Math.round(sec/60);
  if(m<60)return m+" دقيقة";
  return Math.round(m/60)+" ساعة";
}
function view(p){
  if(!p||typeof p!=="object"||typeof p.active!=="boolean")return {kind:"unknown",label:"حالةٌ غيرُ معروفة",reason:"وصل ردٌّ لا يُفهم شكلُه — لا يُعرض منه شيء."};
  var has=typeof p.lat==="number"&&typeof p.lng==="number";
  if(!p.active)return {kind:"ended",label:"انتهت الرحلة",reason:has?"المعروضُ آخرُ موقعٍ معروف، لا موقعٌ حاليّ.":"لا موقعَ يُعرض بعد انتهاء الرحلة."};
  if(has)return {kind:"located",label:"الرحلة جارية",reason:"آخرُ موقعٍ أبلغ به جهازُ السائق، عمرُه عند القراءة "+age(p.age_seconds)+"."};
  if(p.stale_reason==="TOO_OLD")return {kind:"stale",label:"انقطعت إشارةُ السائق",reason:"آخرُ إشارةٍ عمرُها "+age(p.age_seconds)+" — أقدمُ من أن تُعرض موقعاً حاليّاً، فحُجبت."};
  if(p.stale_reason==="NO_TIMESTAMP")return {kind:"unknown",label:"عمرُ الموقع غير معروف",reason:"وصل موقعٌ بلا ختمٍ زمنيّ، فلا يُعرض: موقعٌ مجهولُ العمر قد يكون قديماً."};
  return {kind:"empty",label:"الرحلة جارية — لا موقعَ بعد",reason:"لم يُبلِّغ جهازُ السائق عن موقعه بعدُ في هذه الرحلة."};
}
function show(v){
  ribbonEl.className="ribbon state--"+v.kind;
  ribbonEl.setAttribute("data-state",v.kind);
  ribbonEl.setAttribute("role",(v.kind==="error"||v.kind==="refused")?"alert":"status");
  glyphEl.textContent=GLYPH[v.kind]||"?";
  labelEl.textContent=v.label;
  reasonEl.textContent=v.reason;
}
function paint(p){
  var v=view(p);
  show(v);
  var has=p&&typeof p.lat==="number"&&typeof p.lng==="number";
  coordsEl.textContent=has?p.lat.toFixed(5)+" , "+p.lng.toFixed(5):"لا يُعرض";
  ageEl.textContent=p?age(p.age_seconds):"غير معروف";
  ${hasMap ? "if(has)place(p.lat,p.lng);else if(mapEl)mapEl.hidden=true;" : ""}
}
${
  hasMap
    ? `function place(lat,lng){
  if(typeof maplibregl==="undefined"||!mapEl)return;
  mapEl.hidden=false;
  if(map===null){
    map=new maplibregl.Map({container:"map",style:cfg.styleUrl,center:[lng,lat],zoom:15,attributionControl:true});
    marker=new maplibregl.Marker().setLngLat([lng,lat]).addTo(map);
    return;
  }
  marker.setLngLat([lng,lat]);
  map.easeTo({center:[lng,lat],duration:reduce?0:600});
}`
    : ""
}
function restartStale(){
  if(!pageStale)return;
  pageStale.classList.remove("page-stale");
  void pageStale.offsetWidth;
  pageStale.classList.add("page-stale");
}
function stamp(){
  var now=new Date();
  // ساعةُ الجهازِ هنا لوقتِ **النقرة** لا لعُمرِ الموقع: العمرُ يبقى من القاعدة.
  timeEl.textContent="عند آخر تحديثٍ يدويّ";
  timeEl.setAttribute("datetime",now.toISOString());
}
function end(kind,label,reason){
  show({kind:kind,label:label,reason:reason});
  coordsEl.textContent="لا يُعرض";
  ageEl.textContent="غير معروف";
  if(mapEl)mapEl.hidden=true;
  refreshEl.setAttribute("aria-disabled","true");
  refreshEl.removeAttribute("href");
}
function refresh(){
  if(busy)return;
  busy=true;
  refreshEl.setAttribute("aria-busy","true");
  show({kind:"loading",label:"جارٍ تحديثُ القراءة",reason:"يُسأل الخادم عن آخر موقعٍ معروف…"});
  fetch(cfg.positionUrl,{cache:"no-store",credentials:"omit",redirect:"error",headers:{accept:"application/json"}})
    .then(function(r){
      if(r.status===200)return r.json().then(function(p){paint(p);stamp();restartStale();},function(){show({kind:"unknown",label:"حالةٌ غيرُ معروفة",reason:"وصل ردٌّ لا يُفهم شكلُه — لا يُعرض منه شيء."});});
      if(r.status===404){end("refused","انتهى هذا الرابط","الرابط لم يعد صالحاً: انتهت الرحلة أو ألغاه صاحبُه.");return;}
      if(r.status===429){var s=Number(r.headers.get("retry-after"));show({kind:"refused",label:"طلباتُ تحديثٍ كثيرة",reason:"أعد المحاولة بعد "+(isFinite(s)&&s>0?Math.ceil(s)+" ثانية":"قليل")+". القراءة المعروضة لم تتغيّر."});return;}
      if(r.status===503){show({kind:"unavailable",label:"الخدمة غير متاحة الآن",reason:"الرابط قد يكون سليماً؛ القراءة المعروضة لم تتغيّر — أعد المحاولة بعد لحظات."});return;}
      show({kind:"error",label:"تعذّر التحديث",reason:"ردّ الخادم برمز "+r.status+". القراءة المعروضة لم تتغيّر."});
    },function(){
      show({kind:"error",label:"تعذّر الاتصال",reason:"لا اتصال بالشبكة الآن — القراءة المعروضة لم تتغيّر، وهذا لا يعني أن الرابط انتهى."});
    })
    .then(function(){busy=false;refreshEl.removeAttribute("aria-busy");});
}
refreshEl.addEventListener("click",function(ev){ev.preventDefault();refresh();});
paint(cfg.initial);
})();`;
}

export function renderTrackingPage(input: TrackingPageInput): string {
  if (input.kind === "not-found") {
    return terminalPage(
      input.nonce,
      "رابط تتبّع غير صالح",
      {
        kind: "refused",
        label: "هذا الرابط غير صالح أو انتهت مدّته",
        reason: "روابط التتبّع مؤقّتة وتنتهي بانتهاء الرحلة أو بإلغائها من صاحبها.",
      },
      `<p class="notice reason">لا يُعرض هنا أيُّ موقعٍ أو حالةٍ لرابطٍ لا يصحّ. اطلب من صاحب الرحلة رابطاً جديداً إن كانت الرحلة جارية.</p>`,
    );
  }

  if (input.kind === "unavailable") {
    return terminalPage(
      input.nonce,
      "تعذّر عرض التتبّع",
      {
        kind: "unavailable",
        label: "تعذّر جلب الموقع الآن",
        reason: "الخدمة غير متاحة مؤقّتاً — الرابط قد يكون سليماً.",
      },
      `<p class="actions"><a class="refresh" href="">أعد المحاولة</a></p>`,
    );
  }

  const configured = input.mapStyle.configured && isUsableIntegrity(input.integrity);
  const payload = jsonForScript({
    positionUrl: `/api/track/${input.token}/position`,
    initial: input.initial,
    styleUrl: input.mapStyle.configured ? input.mapStyle.styleUrl : null,
  });
  const nonce = escapeHtml(input.nonce);
  const view = trackingView(input.initial);
  const p = input.initial;
  const hasPoint = p !== null && p.lat !== null && p.lng !== null;
  const staleAfter = Math.max(5, Math.trunc(input.pageStaleAfterSeconds));

  const head = configured
    ? `<link rel="stylesheet" href="${escapeHtml(input.stylesheetUrl)}"
      integrity="${escapeHtml(input.integrity)}" crossorigin="anonymous">
<script src="${escapeHtml(input.scriptUrl)}" integrity="${escapeHtml(input.integrity)}"
        crossorigin="anonymous" nonce="${nonce}" defer></script>`
    : "";

  // الحاويةُ مخفيّةٌ حتى تصلَ إحداثيّة: مربّعٌ رماديٌّ فارغ يُقرأ عطلاً.
  const mapSlot = configured
    ? `<div id="map" role="img" aria-label="موقع السائق على الخريطة"${hasPoint ? "" : " hidden"}></div>`
    : `<p class="note">الخريطة غير مُهيَّأة على هذه المنصّة — الإحداثيّة أدناه هي القراءة نفسها نصّاً.</p>`;

  const coords =
    hasPoint && p.lat !== null && p.lng !== null
      ? `${p.lat.toFixed(5)} , ${p.lng.toFixed(5)}`
      : "لا يُعرض";

  const body = `<header><h1>وَصْلة — تتبّع الرحلة</h1></header>
<main id="main" tabindex="-1">
${ribbon(view)}
${mapSlot}
<section class="reading" aria-labelledby="reading-title">
  <h2 id="reading-title">القراءة</h2>
  <dl>
    <dt>الموقع</dt>
    <dd><span id="coords" class="coords">${escapeHtml(coords)}</span>
      <small class="seal">المصدر: آخرُ ما أبلغ به جهازُ السائق، ويحجبه الخادمُ متى قدُم.</small></dd>
    <dt>عمرُ الموقع</dt>
    <dd><span id="age">${escapeHtml(formatAge(p === null ? null : p.age_seconds))}</span>
      <small class="seal">المصدر: مقيسٌ في خادم وَصْلة عند القراءة — لا ساعةَ جهازك.</small></dd>
    <dt>وقتُ القراءة</dt>
    <dd><time id="observed" datetime="${escapeHtml(input.observedAt.toISOString())}">${escapeHtml(formatClock(input.observedAt))} (توقيت الرياض)</time>
      <small class="seal">الصفحة لا تتحدّث وحدها؛ التحديث بيدك.</small></dd>
    <dt>تقديرُ الوصول</dt>
    <dd>لا يُعرض
      <small class="seal">لا تقديرَ مقيساً لهذه الرحلة في هذا الرابط — ولا يُختلَق رقم.</small></dd>
  </dl>
</section>
<div id="page-stale" class="page-stale" data-state="stale" role="note">
  <strong>هذه القراءة قديمة.</strong> مضى على فتح الصفحة أكثر من ${staleAfter} ثانية، وما يجري الآن قد يختلف — حدِّث القراءة.
</div>
<p class="actions"><a id="refresh" class="refresh" href="">تحديثُ القراءة</a></p>
<p class="note">لا يُكشف هنا اسمٌ ولا رقمُ هاتفٍ ولا لوحةٌ ولا رقمُ رحلة. الرابط مؤقّت وينتهي بانتهاء الرحلة.</p>
<noscript><p class="note">بلا جافاسكربت: «تحديثُ القراءة» يُعيد تحميل الصفحة${configured ? "، والخريطة لا تُرسم" : ""}.</p></noscript>
</main>
<script nonce="${nonce}">${pageScript(payload, configured)}</script>`;

  return shell(
    input.nonce,
    "تتبّع الرحلة",
    body,
    head,
    `.page-stale{animation-delay:${staleAfter}s}`,
  );
}
