/**
 * الغرض: خريطةُ العمليات الحيّة: كلُّ سائقٍ مرئيٍّ الآن بحالتِه التشغيلية المُشتقّة
 *   من الحالات العشر، وعمرِ آخر إصلاحةٍ، وجودةِ موقعه، ورحلتِه إن كانت له رحلة —
 *   وهي الشاشةُ التي يفتحها المشغّل ليقول «أين أسطولي الآن، ومن يحتاج تدخّلاً».
 * الحالة: منفّذ فعلياً — المرحلة ١٣.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts (المسار
 *   `/admin/live-map`)، والمرحلة ١٤ (التوزيع يضيف عمودَ العروض المعلّقة).
 * ملاحظات مستقبلية: التحديثُ اليوم بإعادةِ تحميلٍ دوريّة من الهيكل، ومجرى SSE
 *   قائمٌ فعلاً (`/admin/api/live/drivers`) لكن ربطَه بالدبابيس تحديثاً جزئياً
 *   لم يُنفَّذ في هذه المرحلة ولم يُدَّعَ: يُنظر «ما لا تدّعيه هذه الصفحة» أدناه.
 *
 * ## ما لا تدّعيه هذه الصفحة
 *
 * ١. **ليست شاشةَ تدخّل**: لا إسنادَ قسريّاً ولا إنهاءَ رحلةٍ ولا إنهاءَ جلسة. لا
 *    زرَّ يتجاوز محرّكَ المطابقة إلا بأمرٍ صريح (نفسُ قاعدةِ صفحة الطلبات الحيّة).
 * ٢. **الجدولُ هو السطحُ ذو الحُجّية، لا الخريطة**: الترتيبُ والحالةُ والعمرُ كلُّها
 *    في الجدول، وتعمل الصفحةُ كاملةً بـ`MAP_PROVIDER=none`. ولو كانت الخريطةُ هي
 *    السطحَ الأساسي لصارت ميزةٌ تشغيليةٌ حرجةٌ معلّقةً بضبطِ مزوّدٍ خارجي وبصمةِ
 *    سلامةٍ لم تُحسب — وهذا ما يمنعه ADR 0019.
 * ٣. **الحالةُ لحظيةٌ لا تاريخية**: تُقرأ «هو الآن عند الانطلاق»، ولا يُقرأ «متى
 *    وصل». تسجيلُ لحظةِ الوصول يستلزم جدولَ أحداث (المرحلة ٢٤)، وليس عموداً
 *    يُخزّن حالةً فيصير مصدرَ حقيقةٍ ثانياً إلى جانب الاشتقاق (ADR 0022).
 */

import { EMPTY_CELL, formatAge, formatDateTime, formatNumber, shortId } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

/** الحالاتُ العشر كما يقرؤها المجال — تُستورد نصّاً لا نوعاً لتبقى العرضُ بلا اعتماد. */
export type LiveMapStatus =
  | "AVAILABLE"
  | "ASSIGNED"
  | "TO_PICKUP"
  | "AT_PICKUP"
  | "PICKED_UP"
  | "TO_CUSTOMER"
  | "ARRIVED"
  | "COMPLETED"
  | "OFFLINE"
  | "STALE";

export interface LiveMapDriverRow {
  readonly driverId: string;
  readonly driverName: string | null;
  readonly cityCode: string;
  readonly status: LiveMapStatus;
  readonly lat: number;
  readonly lng: number;
  readonly quality: string | null;
  readonly accuracyMeters: number | null;
  readonly lastFixAt: string | null;
  readonly sessionStartedAt: string | null;
  readonly tripId: string | null;
  readonly tripStatus: string | null;
  readonly isAvailable: boolean;
}

export interface LiveMapData {
  readonly now: Date;
  readonly rows: readonly LiveMapDriverRow[];
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  /**
   * لوحُ الخريطة مُصيَّراً بالكامل (`renderMapPanel`) أو `null` حين لا يُطلب.
   * يُمرَّر مُصيَّراً لأن هذه الصفحةَ لا تعرف الـ`nonce` ولا رابطَ النصّ ولا
   * البصمة — تلك من شأن البوابة، وقراءتُها هنا كانت ستكسر حدَّ الطبقات.
   */
  readonly mapPanel: string | null;
  /**
   * حدُّ اعتبارِ الإصلاحة منقطعة بالثواني — يأتي من سياسة المجال
   * (`DEFAULT_SESSION_POLICY.staleAfterSeconds`) لا من رقمٍ في العرض، حتى لا
   * يقول الجدولُ «متأخّر» والحالةُ المُشتقّة تقول غيرَ ذلك.
   */
  readonly staleAfterSeconds: number;
  /**
   * F4-06 — بصمة أمن المحتوى لنصّ العميل (SSE). تأتي من البوابة (`cspNonce`).
   * حين تكون `undefined` لا يُحقَن نصُّ المجرى: الصفحةُ تعمل بإعادة تحميلٍ دوريّة.
   */
  readonly cspNonce?: string;
  /**
   * F4-06 — رابط مجرى SSE مع فلتر المدينة إن وُجد. مثلًا:
   * `/admin/api/live/drivers` أو `/admin/api/live/drivers?city=uuid`.
   * حين يكون `undefined` لا يُحقَن نصُّ المجرى.
   */
  readonly sseUrl?: string;
}

const STATUS_LABEL: Readonly<Record<LiveMapStatus, string>> = {
  AVAILABLE: "متاح",
  ASSIGNED: "مُسنَد — بلا موقعٍ صالح",
  TO_PICKUP: "متوجّه للانطلاق",
  AT_PICKUP: "عند الانطلاق",
  PICKED_UP: "أقلَّ الراكب",
  TO_CUSTOMER: "متوجّه للمقصد",
  ARRIVED: "عند المقصد",
  COMPLETED: "أنهى الرحلة",
  OFFLINE: "خارج الخدمة",
  STALE: "انقطع تتبّعُه",
};

/**
 * الألوان تقول شيئاً واحداً: هل يحتاج هذا الصفُّ نظراً؟
 *
 * فـ`STALE` و`ASSIGNED` وحدهما `bad`، لأنهما الحالتان اللتان لا يستطيع المشغّل
 * الاعتمادَ عليهما: الأولى موقعُها غيرُ موثوق، والثانية سائقٌ مُسنَدٌ لا يُعرف أين
 * هو. وبقيّةُ حالاتِ الرحلة `ok` وإن اختلفت مراحلُها — تلوينُ «متوجّه للمقصد»
 * تحذيراً كان سيُغرق الشاشةَ بالأصفر فيصير اللونُ بلا معنى.
 */
const STATUS_TONE: Readonly<Record<LiveMapStatus, BadgeTone>> = {
  AVAILABLE: "ok",
  ASSIGNED: "bad",
  TO_PICKUP: "ok",
  AT_PICKUP: "ok",
  PICKED_UP: "ok",
  TO_CUSTOMER: "ok",
  ARRIVED: "ok",
  COMPLETED: "muted",
  OFFLINE: "muted",
  STALE: "bad",
};

/** الحالاتُ التي تستدعي نظرَ المشغّل — نفسُ قائمةِ `needsAttention` في المجال. */
const ATTENTION: readonly LiveMapStatus[] = ["STALE", "ASSIGNED"];

/** الحالاتُ التي تعني «هذا السائقُ على رحلةٍ قائمة». */
const ON_TRIP: readonly LiveMapStatus[] = [
  "TO_PICKUP",
  "AT_PICKUP",
  "PICKED_UP",
  "TO_CUSTOMER",
  "ARRIVED",
];

const QUALITY_TONE: Readonly<Record<string, BadgeTone>> = {
  ACCEPT: "ok",
  WARNING: "warn",
  ALERT: "bad",
};

const TRIP_STATUS_LABEL: Readonly<Record<string, string>> = {
  matched: "مُسنَد",
  in_progress: "جارٍ",
};

const COORD_DIGITS = 5;

export function renderLiveMapPage(data: LiveMapData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const attention = data.rows.filter((row) => ATTENTION.includes(row.status)).length;
  const onTrip = data.rows.filter((row) => ON_TRIP.includes(row.status)).length;
  const available = data.rows.filter((row) => row.status === "AVAILABLE").length;

  const cards = [
    metricCard("سائقون مرئيون", formatNumber(data.rows.length), "له جلسةٌ مفتوحة أو رحلةٌ حيّة"),
    metricCard("على رحلة", formatNumber(onTrip)),
    metricCard("متاح بلا رحلة", formatNumber(available)),
    metricCard(
      "يحتاج نظراً",
      formatNumber(attention),
      `انقطع تتبّعُه (أكثرَ من ${formatNumber(data.staleAfterSeconds)} ثانية) أو مُسنَدٌ بلا موقعٍ صالح`,
    ),
  ].join("");

  const rows = data.rows.map((row) => [
    `<div data-driver-id="${escapeHtml(row.driverId)}">${escapeHtml(row.driverName ?? "بلا اسم")}</div>
     <div class="card-hint mono">${escapeHtml(shortId(row.driverId))}</div>`,
    `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
    badge(STATUS_LABEL[row.status], STATUS_TONE[row.status]),
    row.tripId === null
      ? EMPTY_CELL
      : `<div class="mono">${escapeHtml(shortId(row.tripId))}</div>
         <div class="card-hint">${escapeHtml(
           row.tripStatus === null
             ? "بلا حالة"
             : (TRIP_STATUS_LABEL[row.tripStatus] ?? row.tripStatus),
         )}</div>`,
    // العمرُ يُعرض دائماً بلا تلوينٍ ثانٍ: الشارةُ في عمود الحالة قالت الحكمَ
    // مرّةً، وتكرارُه هنا كان سيسمح باختلافِ الشاشة عن نفسها لو تباعد الحدّان.
    row.lastFixAt === null
      ? EMPTY_CELL
      : `<span data-driver-fix="${escapeHtml(row.driverId)}">${escapeHtml(formatAge(row.lastFixAt, data.now))}</span>`,
    row.quality === null
      ? EMPTY_CELL
      : badge(escapeHtml(row.quality), QUALITY_TONE[row.quality] ?? "muted"),
    row.accuracyMeters === null ? EMPTY_CELL : `${formatNumber(Math.round(row.accuracyMeters))} م`,
    `<span class="mono" data-driver-coords="${escapeHtml(row.driverId)}">${escapeHtml(
      `${row.lat.toFixed(COORD_DIGITS)}, ${row.lng.toFixed(COORD_DIGITS)}`,
    )}</span>`,
    row.sessionStartedAt === null
      ? badge("بلا جلسة", "warn")
      : escapeHtml(formatDateTime(row.sessionStartedAt)),
  ]);

  const statusTable = table({
    headers: [
      "السائق",
      "المدينة",
      "الحالة",
      "الرحلة",
      "عمر آخر إصلاحة",
      "الجودة",
      "الدقّة",
      "الإحداثيّات",
      "بدء الجلسة",
    ],
    rows,
    emptyText: "لا سائقَ مرئيّاً الآن: لا جلسةَ تتبّعٍ مفتوحة ولا رحلةٌ حيّة.",
  });

  return `<h1>خريطة العمليات</h1>
<p class="note">حالة اللحظة: ${escapeHtml(formatDateTime(data.now))}. تُعرض مواقعُ من له
جلسةُ تتبّعٍ مفتوحة أو رحلةٌ حيّة؛ ومن ليس في الخدمة ولا على رحلةٍ لا يُعرض موقعُه.
<span id="live-map-status" class="card-hint"></span></p>
<form class="filters" method="get" action="/admin/live-map">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards" style="margin-bottom:16px" id="fleet-metrics">${cards}</div>
${section("حالة الأسطول", statusTable)}
${data.mapPanel ?? ""}
${sseScript(data)}`;
}

/**
 * F4-06 — نصُّ عميل SSE يفتح المجرى المشترك ويحدّث الصفحة بلا إعادة تحميل.
 *
 * اللقطةُ تُستبدَل كاملةً (مصالحة)، والدلتا تُطبَّق بفاصل الترتيب (BUG-009).
 * والصفحةُ تعمل كاملةً بلا هذا النص: الجدولُ والخريطةُ مُصيَّران من الخادم،
 * فإن فشل المجرى أو تعطّل JS تبقى الشاشةُ الأخيرةُ مرئيّةً حتى يُصلِحها المشغّل.
 */
function sseScript(data: LiveMapData): string {
  if (data.cspNonce === undefined || data.sseUrl === undefined) return "";
  const nonce = escapeHtml(data.cspNonce);
  const url = escapeHtml(data.sseUrl);
  return `<script nonce="${nonce}">
(function(){
  var statusEl = document.getElementById("live-map-status");
  var coords = {};
  document.querySelectorAll("[data-driver-coords]").forEach(function(el){
    coords[el.getAttribute("data-driver-coords")] = el;
  });
  var lastSeq = null, lastSessionId = null;
  function setStatus(text){ if(statusEl) statusEl.textContent = text; }
  function fmtCoord(lat, lng){ return lat.toFixed(5) + ", " + lng.toFixed(5); }
  function applySnapshot(rows){
    var metrics = document.getElementById("fleet-metrics");
    if(!metrics) return;
    var onTrip = 0, available = 0, attention = 0;
    rows.forEach(function(r){
      if(["TO_PICKUP","AT_PICKUP","PICKED_UP","TO_CUSTOMER","ARRIVED"].indexOf(r.status) >= 0) onTrip++;
      if(r.status === "AVAILABLE") available++;
      if(["STALE","ASSIGNED"].indexOf(r.status) >= 0) attention++;
    });
    var cards = metrics.querySelectorAll(".card");
    if(cards.length >= 4){
      cards[0].querySelector(".card-value").textContent = String(rows.length);
      cards[1].querySelector(".card-value").textContent = String(onTrip);
      cards[2].querySelector(".card-value").textContent = String(available);
      cards[3].querySelector(".card-value").textContent = String(attention);
    }
    var latest = null;
    rows.forEach(function(r){
      if(r.sessionSequence !== undefined && r.sessionId && (!latest || r.sessionSequence > latest.sessionSequence)) latest = r;
    });
    if(latest){ lastSeq = latest.sessionSequence; lastSessionId = latest.sessionId; }
    if(typeof window.waslahMap === "object" && window.waslahMap){
      var pts = rows.filter(function(r){ return r.lat && r.lng; }).map(function(r){
        return { id: r.driverId, position: { lat: r.lat, lng: r.lng }, label: r.driverName || r.driverId, type: "driver" };
      });
      window.waslahMap.update(pts);
    }
  }
  function applyDelta(d){
    if(lastSessionId !== null && d.sessionId !== lastSessionId) return;
    if(lastSeq !== null && d.sequence <= lastSeq) return;
    lastSeq = d.sequence;
    if(d.position === null) return;
    var el = coords[d.driverId];
    if(el) el.textContent = fmtCoord(d.position.lat, d.position.lng);
    if(typeof window.waslahMap === "object" && window.waslahMap){
      window.waslahMap.update([{ id: d.driverId, position: { lat: d.position.lat, lng: d.position.lng }, label: d.driverName || d.driverId, type: "driver" }]);
    }
  }
  try {
    var es = new EventSource("${url}");
    es.addEventListener("snapshot", function(e){
      var data = JSON.parse(e.data);
      setStatus("");
      applySnapshot(data.rows || []);
    });
    es.addEventListener("tracking", function(e){
      applyDelta(JSON.parse(e.data));
    });
    es.addEventListener("heartbeat", function(){
      setStatus("");
    });
    es.addEventListener("error", function(){
      setStatus("— إعادة الاتصال…");
    });
  } catch(_) { setStatus("— المجرى غير متاح"); }
})();
</script>`;
}
