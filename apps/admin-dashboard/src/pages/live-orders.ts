/**
 * الغرض: صفحة الطلبات الحية: كل طلب لم يصل حالة نهائية، بعمره وعدد عروضه المعلّقة
 *   ودورة بثّه — وهي الشاشة التي يفتحها المشغّل حين يقول أحدهم «طلبي لم يصله سائق».
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات المرحلة ١٠: كان في هذه الصفحة وسمُ نصٍّ داخليٌّ يُعيد التحميل كلَّ ٣٠
 *   ثانية، والهيكلُ يُمرَّر له `refreshSeconds = 20` لنفس الصفحة — مؤقّتان
 *   متنافسان على شاشةٍ واحدة، وأحدُهما (الداخلي) يُعيد التحميل ولو كان المسؤول
 *   يكتب أو يقرأ نتائجَ بحثٍ مفتوحة. حُذف الداخلي: التحديثُ مسؤوليةُ الهيكل وحده،
 *   فمصدرُ الحقيقة لدوريّة التحديث واحد. (وكشفَه فحصُ سياسةِ أمن المحتوى: كان
 *   الوسمَ الوحيد بلا nonce.) وفي UI-6 / PR 9 (ADR 0240) أُزيل مؤقّتُ الهيكلِ نفسُه
 *   (المصدرُ الكانونيُّ §9 يحظرُ الاستقصاء): الصفحةُ تُعلِنُ ساعةَ قراءتِها، وبعدَ
 *   20 ثانيةً يظهرُ شريطُ «قراءةٌ قديمة» برابطِ تحديثٍ يدويّ.
 * ملاحظات مستقبلية: التدخّل اليدوي (إعادة بثّ، إسناد قسري) لا يُضاف إلا بأمر صريح:
 *   زرٌّ يتجاوز محرّك المطابقة يجب أن يكون قراراً معلَناً لا ميزة عابرة.
 * `WR-42` — بأمرٍ صريحٍ أُضيفَ التدخّلُ المُوثَّقُ: إلغاءٌ/إنهاءٌ إداريٌّ بسبَبٍ
 *   مكتوبٍ وسجلٍّ محاسبيٍّ (audit) وشرطِ CSRF، عبرَ `admin_intervene_order`
 *   في القاعدة — لا مسارَ خادمٍ سريعٍ يكتُبُ خارجَها. الإجراءُ حصرٌ على
 *   الحالاتِ الحيةِ القابلةِ للتدخّلِ (searching/matched/in_progress)
 *   ولا يُتيحُ إنهاءً إلا لرحلةٍ في الواقعِ (in_progress).
 */

import { EMPTY_CELL, formatAge, formatDateTime, formatNumber, shortId } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface LiveOrderRow {
  readonly orderId: string;
  readonly cityCode: string;
  readonly service: string;
  readonly status: string;
  readonly riderName: string | null;
  readonly riderTelegramId: string;
  readonly driverName: string | null;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAt: string;
  /** `WR-06` — بدءُ البحثِ إن بدأَ بعدَ الإنشاء (إطلاقُ مجدول)؛ التعثّرُ يُقاسُ منه. */
  readonly searchingSince?: string | null;
  /** `WR-06` — موعدُ الحضورِ إن طُلِبَ لاحقًا. */
  readonly pickupAt?: string | null;
  readonly matchedAt: string | null;
  readonly startedAt: string | null;
  readonly broadcastRound: number;
  readonly pendingOffers: number;
  /** مرحلة التفاوض مع قروب غير المشتركين إن وصل الطلب إليها. */
  readonly negotiationStage: string | null;
  /** آخر تحوّل على الطلب — يُقاسُ منه تعثّرُ الحالاتِ المسنَدةِ والجاريةِ (`WR-42`). */
  readonly updatedAt: string;
  /** آخر أحداث السجل المحاسبي للطلب — تعرضها الصفحة للمشغّل (`WR-42`). */
  readonly events: readonly {
    createdAt: string;
    action: string;
    payload: unknown;
  }[];
}

export interface LiveOrdersData {
  readonly now: Date;
  /**
   * `F16-03` — بصمةُ CSRF لنموذجِ قطعِ روابطِ التتبُّعِ في كلِّ صفٍّ: الإلغاءُ
   * بالنيابةِ عن مُصدِرِها (تلغرامُ صاحبِ الطلبِ) بطلبِ دعمٍ.
   */
  readonly csrfToken: string;
  readonly rows: readonly LiveOrderRow[];
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  /** عمر يتجاوزه الطلب فيصير مُقلقاً — يأتي من إعدادات المدينة لا من رقم في العرض. */
  readonly stallSeconds: number;
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  scheduled: "مجدول",
  searching: "يبحث عن سائق",
  matched: "مُسنَد",
  in_progress: "جارٍ",
};

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  scheduled: "muted",
  searching: "warn",
  matched: "ok",
  in_progress: "ok",
};

const SERVICE_LABEL: Readonly<Record<string, string>> = {
  transport: "مشوار",
  delivery: "توصيل",
};

const MS_PER_SECOND = 1000;

/** `WR-42` — عتبةُ قلقٍ موحّدةٌ للعرضِ: تعثّرُ الحالةِ يُقاسُ من آخرِ
 *  تحوّلٍ حقيقيٍّ عليها (إسنادٍ أو بدءٍ)، لا من عمرِ الإنشاءِ وحده. */
function stallRefTime(row: LiveOrderRow): string {
  if (row.status === "searching") {
    return row.searchingSince ?? row.createdAt;
  }
  if (row.status === "in_progress") {
    return row.startedAt ?? row.updatedAt;
  }
  return row.matchedAt ?? row.updatedAt;
}

export function renderLiveOrdersPage(data: LiveOrdersData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const searching = data.rows.filter((r) => r.status === "searching").length;
  const stalled = data.rows.filter(
    (r) =>
      r.status !== "scheduled" &&
      (data.now.getTime() - new Date(stallRefTime(r)).getTime()) / MS_PER_SECOND >
        data.stallSeconds,
  ).length;

  const cards = [
    metricCard("طلبات حية", formatNumber(data.rows.length)),
    metricCard("تبحث عن سائق", formatNumber(searching)),
    metricCard(
      "متعثّرة",
      formatNumber(stalled),
      `تجاوزت ${formatNumber(data.stallSeconds)} ثانية بلا تحوّل`,
    ),
  ].join("");

  const rows = data.rows.map((row) => {
    const ageSeconds = (data.now.getTime() - new Date(stallRefTime(row)).getTime()) / MS_PER_SECOND;
    const isStalled = row.status !== "scheduled" && ageSeconds > data.stallSeconds;
    const canComplete = row.status === "in_progress";
    const interveneUrl = `/admin/live-orders/${escapeHtml(row.orderId)}/intervene`;
    const eventsList = row.events
      .map(
        (event) =>
          `<li><span class="mono">${escapeHtml(event.action)}</span> — ${escapeHtml(formatDateTime(new Date(event.createdAt)))}</li>`,
      )
      .join("");
    return [
      `<span class="mono">${escapeHtml(shortId(row.orderId))}</span>`,
      `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
      escapeHtml(SERVICE_LABEL[row.service] ?? row.service),
      badge(STATUS_LABEL[row.status] ?? row.status, STATUS_TONE[row.status] ?? "muted") +
        (isStalled ? ` ${badge("متعثّرة", "bad")}` : "") +
        (row.negotiationStage === null
          ? ""
          : ` ${badge(escapeHtml(row.negotiationStage), "warn")}`) +
        (row.status === "scheduled" && row.pickupAt
          ? `<div class="card-hint">الحضور: ${escapeHtml(formatDateTime(new Date(row.pickupAt)))}</div>`
          : ""),
      `<div>${escapeHtml(row.riderName ?? "بلا اسم")}</div>
       <div class="card-hint mono">${escapeHtml(row.riderTelegramId)}</div>
       <form class="inline" method="post" data-confirm="قطعُ كلِّ روابطِ تتبّعِ هذا الطلب؟ من يحملُ رابطاً منها يفقدُ الوصولَ إليه." action="/admin/live-orders/${escapeHtml(row.orderId)}/revoke-tracking">
  <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
  <button class="danger" type="submit">قطع روابط التتبّع</button>
</form>`,
      escapeHtml(row.driverName ?? EMPTY_CELL),
      `<div>${escapeHtml(row.pickupLabel ?? EMPTY_CELL)}</div>
       <div class="card-hint">${escapeHtml(row.dropoffLabel ?? "")}</div>`,
      formatNumber(row.broadcastRound),
      formatNumber(row.pendingOffers),
      isStalled
        ? `${badge(formatAge(row.createdAt, data.now), "bad")}`
        : escapeHtml(formatAge(row.createdAt, data.now)),
      formatDateTime(row.startedAt ?? row.matchedAt ?? row.createdAt),
      `<details>
  <summary>تدخّل إداري</summary>
  <form class="inline" method="post" action="${interveneUrl}">
    <input type="hidden" name="csrf" value="${escapeHtml(data.csrfToken)}">
    <label>سبب التدخّل (إلزامي)
      <input name="reason" required maxlength="500" placeholder="مثال: طلب متعثّر من يوم كامل والراكب عالق">
    </label>
    <button class="danger" type="submit" name="action" value="cancel" data-confirm="إلغاءٌ إداريٌّ لهذا الطلب؟ سيُخطرُ الراكبُ والسائقُ ويُسجَّلُ السببُ في السجل المحاسبي.">إلغاء إداري</button>
    ${
      canComplete
        ? `<button type="submit" name="action" value="complete" data-confirm="إنهاءٌ إداريٌّ لهذه الرحلة؟ الرحلة في الواقعِ (in_progress) وسيمُنحُ السائقُ حريتَه ويُخطرُ الطرفان.">إنهاء إداري</button>`
        : ""
    }
  </form>
  ${eventsList === "" ? "" : `<div class="card-hint">آخر الأحداث:</div><ul class="card-hint">${eventsList}</ul>`}
</details>`,
    ];
  });

  return `<h1>الطلبات الحية</h1>
<p class="note">الصفحة لا تتحدّث وحدها؛ حدّثها يدويًا. «قطع روابط التتبّع» يُلغي روابط الطلب بالنيابة عن صاحبه بطلب دعم — والملكية محكومة في القاعدة. التدخّل الإداري (WR-42) يُلغي أو يُنهي بطلبِ سببٍ مكتوبٍ ويُخطرُ الراكبَ والسائقَ ويُسجَّلُ في السجل المحاسبي. حالة اللحظة: ${escapeHtml(formatDateTime(data.now))}</p>
<form class="filters" method="get" action="/admin/live-orders">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards cards--spaced">${cards}</div>
${section(
  "الطلبات",
  table({
    headers: [
      "الطلب",
      "المدينة",
      "الخدمة",
      "الحالة",
      "العميل",
      "السائق",
      "من / إلى",
      "دورة البثّ",
      "عروض معلّقة",
      "العمر",
      "آخر تحوّل",
      "إجراءات",
    ],
    rows,
    emptyText: "لا طلب حيّ الآن.",
  }),
)}`;
}
