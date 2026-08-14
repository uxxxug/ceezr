/**
 * الغرض: صفحة البثّ الجماعي: رسالةٌ واحدة إلى السائقين أو الركّاب، بمرشّحاتٍ
 *   تفضيلية، لمدينةٍ واحدة أو لكلّ المدن — مع تقدير العدد قبل الإرسال، وسجلّ
 *   الحملات وتقدّمها، وإلغاءِ ما لم يُرسَل بعد. بلا هذه الصفحة يبقى إبلاغ
 *   السائقين بتغييرٍ في السعر أو انقطاعٍ في الخدمة رسائلَ يدوية لا تكتمل.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: جدولةُ الإرسال مدعومة في القاعدة (`send_after`) وحقلُها معروض؛
 *   عند الحاجة إلى تقويمِ حملاتٍ مجدولة يُضاف عرضٌ لها بلا تغيير في القاعدة.
 */

import { formatDateTime, formatNumber } from "../format.ts";
import { badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export type BroadcastAudienceChoice = "drivers" | "riders";

/** ما اختاره المسؤول في النموذج، معاداً إليه كما هو بعد المعاينة. */
export interface BroadcastFormState {
  readonly audience: BroadcastAudienceChoice;
  /** `null` تعني كلّ المدن. */
  readonly cityId: string | null;
  readonly languages: readonly string[];
  readonly verification: readonly string[];
  readonly subscription: readonly string[];
  readonly availability: string;
  readonly activity: string;
  readonly body: string;
  readonly linkLabel: string;
  readonly linkUrl: string;
  readonly silent: boolean;
  readonly sendAfter: string;
}

export interface BroadcastPreview {
  readonly total: number;
  readonly cities: readonly { readonly nameAr: string; readonly recipients: number }[];
}

export interface BroadcastHistoryRow {
  readonly batchId: string;
  readonly audience: BroadcastAudienceChoice;
  readonly cities: string;
  readonly cityCount: number;
  readonly body: string;
  readonly filters: string;
  readonly silent: boolean;
  readonly linkLabel: string | null;
  readonly linkUrl: string | null;
  readonly status: "sending" | "completed" | "canceled";
  readonly total: number;
  readonly sent: number;
  readonly failed: number;
  readonly pending: number;
  readonly canceled: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export interface BroadcastPageData {
  readonly cities: readonly CityOption[];
  readonly form: BroadcastFormState;
  /** نتيجةُ آخر معاينة، أو `null` إن لم يُعاين المسؤول بعد. */
  readonly preview: BroadcastPreview | null;
  readonly campaigns: readonly BroadcastHistoryRow[];
  readonly bodyLimit: number;
  readonly csrfToken: string;
  readonly cspNonce: string;
}

export const BROADCAST_BODY_LIMIT = 3500;

/** رموزٌ تُدرَج بنقرةٍ: أسرعُ من لوحةِ مفاتيحٍ عربية، وأقلُّ خطأً من اللصق. */
const EMOJI_CHIPS: readonly string[] = [
  "📣",
  "🚗",
  "🧭",
  "⏰",
  "💳",
  "✅",
  "⚠️",
  "🎉",
  "🙏",
  "📍",
  "🔔",
  "🌙",
];

const AUDIENCE_LABEL: Readonly<Record<BroadcastAudienceChoice, string>> = {
  drivers: "🚗 السائقون",
  riders: "🧍 الركّاب",
};

const LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
  { code: "ur", label: "اردو" },
];

const VERIFICATION: readonly { readonly value: string; readonly label: string }[] = [
  { value: "pending", label: "بانتظار التوثيق" },
  { value: "verified", label: "موثَّق" },
  { value: "rejected", label: "مرفوض" },
  { value: "suspended", label: "موقوف" },
];

const SUBSCRIPTION: readonly { readonly value: string; readonly label: string }[] = [
  { value: "none", label: "بلا اشتراك" },
  { value: "trialing", label: "في التجربة المجانية" },
  { value: "active", label: "اشتراك سارٍ" },
];

const AVAILABILITY: readonly { readonly value: string; readonly label: string }[] = [
  { value: "any", label: "الكل" },
  { value: "available", label: "متاح الآن" },
  { value: "unavailable", label: "غير متاح" },
];

const ACTIVITY: readonly { readonly value: string; readonly label: string }[] = [
  { value: "any", label: "الكل" },
  { value: "ordered_recently", label: "طلب حديثاً" },
  { value: "never_ordered", label: "لم يطلب قطّ" },
];

const STATUS_BADGE: Readonly<
  Record<BroadcastHistoryRow["status"], { label: string; tone: "ok" | "warn" | "muted" }>
> = {
  sending: { label: "جارٍ الإرسال", tone: "warn" },
  completed: { label: "انتهى", tone: "ok" },
  canceled: { label: "أُلغي", tone: "muted" },
};

function checkboxes(
  name: string,
  items: readonly { readonly value: string; readonly label: string }[],
  selected: readonly string[],
): string {
  return `<div class="optionset">${items
    .map(
      (item) =>
        `<label><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(item.value)}"${
          selected.includes(item.value) ? " checked" : ""
        }>${escapeHtml(item.label)}</label>`,
    )
    .join("")}</div>`;
}

function selectField(
  label: string,
  name: string,
  items: readonly { readonly value: string; readonly label: string }[],
  selected: string,
): string {
  const options = items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.value)}"${
          item.value === selected ? " selected" : ""
        }>${escapeHtml(item.label)}</option>`,
    )
    .join("");
  return `<label>${escapeHtml(label)}<select name="${escapeHtml(name)}">${options}</select></label>`;
}

/** نصٌّ مقتطعٌ للجدول: رسالةُ ٣٥٠٠ حرفاً تُفسد صفّاً واحداً كلَّ الجدول. */
function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

const COUNTER_SCRIPT = `
(function(){
  var body=document.getElementById('broadcast-body');
  var counter=document.getElementById('broadcast-count');
  var limit=Number(counter&&counter.getAttribute('data-limit')||0);
  function paint(){
    if(!body||!counter)return;
    var used=body.value.length;
    counter.textContent=used+' / '+limit+' حرفاً';
    counter.style.color=used>limit?'#e08a8a':(used>limit*0.9?'#e0b45c':'#9aa3b2');
  }
  if(body){body.addEventListener('input',paint);paint();}
  for(var chip of document.querySelectorAll('[data-emoji]')){
    chip.addEventListener('click',function(event){
      event.preventDefault();
      if(!body)return;
      var glyph=this.getAttribute('data-emoji')||'';
      var start=body.selectionStart===null?body.value.length:body.selectionStart;
      var end=body.selectionEnd===null?start:body.selectionEnd;
      body.value=body.value.slice(0,start)+glyph+body.value.slice(end);
      body.focus();
      body.selectionStart=body.selectionEnd=start+glyph.length;
      paint();
    });
  }
})();
`;

export function renderBroadcastPage(data: BroadcastPageData): string {
  const form = data.form;
  const cityOptions = [
    `<option value="all"${form.cityId === null ? " selected" : ""}>🌍 كل المدن</option>`,
    ...data.cities.map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          form.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    ),
  ].join("");

  const previewBlock =
    data.preview === null
      ? `<p class="note">اضغط «تقدير العدد» قبل الإرسال: العددُ يُحسب في القاعدة بنفس
         الاستعلام الذي سيُنشئ المستقبِلين، فما تراه هنا هو ما سيُرسَل بالضبط.</p>`
      : `<div class="cards">
          ${metricCard("عدد المستقبِلين", formatNumber(data.preview.total), "بعد استثناء المحظورين")}
          ${data.preview.cities
            .map((city) => metricCard(city.nameAr, formatNumber(city.recipients)))
            .join("")}
        </div>
        ${
          data.preview.total === 0
            ? `<p class="note">${escapeHtml(
                "لا مستقبِل واحد يطابق هذه المرشّحات — الإرسال سيُرفض لا أن يُنشئ حملةً فارغة.",
              )}</p>`
            : ""
        }`;

  const historyRows = data.campaigns.map((row) => {
    const done = row.sent + row.failed + row.canceled;
    const ratio = row.total === 0 ? 0 : Math.round((done / row.total) * 100);
    const status = STATUS_BADGE[row.status];
    return [
      `<div>${escapeHtml(truncate(row.body, 90))}</div>
       <div class="card-hint">${escapeHtml(AUDIENCE_LABEL[row.audience])} · ${escapeHtml(
         row.cityCount > 1 ? `${row.cityCount} مدن: ${row.cities}` : row.cities,
       )}${row.silent ? " · 🔇 صامتة" : ""}${row.linkUrl === null ? "" : " · 🔗 زرّ"}</div>`,
      `<span class="mono">${escapeHtml(row.filters)}</span>`,
      `${badge(status.label, status.tone)}
       <div class="bar" title="${ratio}%"><i style="width:${ratio}%"></i></div>`,
      `<span class="mono">${formatNumber(row.sent)} ✅ · ${formatNumber(row.failed)} ⚠️ · ${formatNumber(
        row.pending,
      )} ⏳${row.canceled === 0 ? "" : ` · ${formatNumber(row.canceled)} 🚫`}</span>
       <div class="card-hint">${escapeHtml(`من ${formatNumber(row.total)}`)}</div>`,
      `${escapeHtml(row.createdBy ?? "—")}
       <div class="card-hint">${formatDateTime(row.createdAt)}</div>`,
      row.status === "sending" && row.pending > 0
        ? `<form class="inline" method="post" action="/admin/broadcast/${escapeHtml(
            row.batchId,
          )}/cancel">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
            <button type="submit" class="ghost">إلغاء ما لم يُرسَل</button>
          </form>`
        : `<span class="card-hint">—</span>`,
    ];
  });

  return `<h1>📣 البثّ الجماعي</h1>
${section(
  "رسالة جديدة",
  `<form method="post" action="/admin/broadcast">
    <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
    <div class="filters">
      ${selectField(
        "الجمهور",
        "audience",
        [
          { value: "drivers", label: AUDIENCE_LABEL.drivers },
          { value: "riders", label: AUDIENCE_LABEL.riders },
        ],
        form.audience,
      )}
      <label>النطاق<select name="city">${cityOptions}</select></label>
      ${selectField("جاهزية السائق", "availability", AVAILABILITY, form.availability)}
      ${selectField("نشاط الراكب", "activity", ACTIVITY, form.activity)}
      <label>لا تُرسل قبل
        <input type="datetime-local" name="send_after" value="${escapeHtml(form.sendAfter)}">
      </label>
    </div>
    <div class="stack"><span>اللغة</span>${checkboxes(
      "languages",
      LANGUAGES.map((l) => ({ value: l.code, label: l.label })),
      form.languages,
    )}</div>
    <div class="stack"><span>حالة توثيق السائق</span>${checkboxes("verification", VERIFICATION, form.verification)}</div>
    <div class="stack"><span>حالة اشتراك السائق</span>${checkboxes("subscription", SUBSCRIPTION, form.subscription)}</div>
    <div class="chips">${EMOJI_CHIPS.map(
      (glyph) =>
        `<button type="button" class="chip" data-emoji="${escapeHtml(glyph)}" aria-label="أدرج ${escapeHtml(
          glyph,
        )}">${escapeHtml(glyph)}</button>`,
    ).join("")}</div>
    <textarea id="broadcast-body" name="body" maxlength="${data.bodyLimit}"
      placeholder="اكتب الرسالة كما ستظهر للمستقبِل…"
      aria-label="نصّ الرسالة">${escapeHtml(form.body)}</textarea>
    <p class="note" id="broadcast-count" data-limit="${data.bodyLimit}">0 / ${
      data.bodyLimit
    } حرفاً</p>
    <div class="filters">
      <label>نصّ الزرّ (اختياري)
        <input type="text" name="link_label" value="${escapeHtml(form.linkLabel)}" maxlength="64">
      </label>
      <label>رابط الزرّ (https فقط)
        <input type="url" name="link_url" value="${escapeHtml(
          form.linkUrl,
        )}" class="mono" inputmode="url">
      </label>
      <label>&nbsp;
        <span class="optionset"><label><input type="checkbox" name="silent" value="1"${
          form.silent ? " checked" : ""
        }>🔇 بلا صوت تنبيه</label></span>
      </label>
    </div>
    <div class="filters">
      <button type="submit" name="action" value="preview" class="ghost">تقدير العدد</button>
      <button type="submit" name="action" value="send">إرسال الآن</button>
    </div>
  </form>
  ${previewBlock}`,
  "المرشّحات الفارغة تعني «الكل». تُستثنى الحسابات المحظورة دائماً. الرسالة تُرسَل نصّاً " +
    "خالصاً بلا تنسيق: الرموز تظهر كما تكتبها، ووسوم HTML لا تُفسَّر ولا تُعطب الرسالة.",
)}
${section(
  "الحملات الأخيرة",
  table({
    headers: ["الرسالة", "المرشّحات", "الحالة", "الحصيلة", "المُرسِل", ""],
    rows: historyRows,
    emptyText: "لا حملة بثّ بعد.",
  }),
  "الإلغاء يمسّ ما لم يُرسَل فقط: رسالةٌ سُلّمت لا تُستعاد، ورسالةٌ في الطريق لا تُقطع نصفها.",
)}
<script nonce="${escapeHtml(data.cspNonce)}">${COUNTER_SCRIPT}</script>`;
}
