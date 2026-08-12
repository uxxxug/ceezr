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
 *   الوسمَ الوحيد بلا nonce.)
 * ملاحظات مستقبلية: التدخّل اليدوي (إعادة بثّ، إسناد قسري) لا يُضاف إلا بأمر صريح:
 *   زرٌّ يتجاوز محرّك المطابقة يجب أن يكون قراراً معلَناً لا ميزة عابرة.
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
  readonly matchedAt: string | null;
  readonly startedAt: string | null;
  readonly broadcastRound: number;
  readonly pendingOffers: number;
  /** مرحلة التفاوض مع قروب غير المشتركين إن وصل الطلب إليها. */
  readonly negotiationStage: string | null;
}

export interface LiveOrdersData {
  readonly now: Date;
  readonly rows: readonly LiveOrderRow[];
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  /** عمر يتجاوزه الطلب فيصير مُقلقاً — يأتي من إعدادات المدينة لا من رقم في العرض. */
  readonly stallSeconds: number;
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  searching: "يبحث عن سائق",
  matched: "مُسنَد",
  in_progress: "جارٍ",
};

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  searching: "warn",
  matched: "ok",
  in_progress: "ok",
};

const SERVICE_LABEL: Readonly<Record<string, string>> = {
  transport: "مشوار",
  delivery: "توصيل",
};

const MS_PER_SECOND = 1000;

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
      r.status === "searching" &&
      (data.now.getTime() - new Date(r.createdAt).getTime()) / MS_PER_SECOND > data.stallSeconds,
  ).length;

  const cards = [
    metricCard("طلبات حية", formatNumber(data.rows.length)),
    metricCard("تبحث عن سائق", formatNumber(searching)),
    metricCard(
      "متعثّرة",
      formatNumber(stalled),
      `تجاوزت ${formatNumber(data.stallSeconds)} ثانية بلا إسناد`,
    ),
  ].join("");

  const rows = data.rows.map((row) => {
    const ageSeconds = (data.now.getTime() - new Date(row.createdAt).getTime()) / MS_PER_SECOND;
    const isStalled = row.status === "searching" && ageSeconds > data.stallSeconds;
    return [
      `<span class="mono">${escapeHtml(shortId(row.orderId))}</span>`,
      `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
      escapeHtml(SERVICE_LABEL[row.service] ?? row.service),
      badge(STATUS_LABEL[row.status] ?? row.status, STATUS_TONE[row.status] ?? "muted") +
        (row.negotiationStage === null
          ? ""
          : ` ${badge(escapeHtml(row.negotiationStage), "warn")}`),
      `<div>${escapeHtml(row.riderName ?? "بلا اسم")}</div>
       <div class="card-hint mono">${escapeHtml(row.riderTelegramId)}</div>`,
      escapeHtml(row.driverName ?? EMPTY_CELL),
      `<div>${escapeHtml(row.pickupLabel ?? EMPTY_CELL)}</div>
       <div class="card-hint">${escapeHtml(row.dropoffLabel ?? "")}</div>`,
      formatNumber(row.broadcastRound),
      formatNumber(row.pendingOffers),
      isStalled
        ? `${badge(formatAge(row.createdAt, data.now), "bad")}`
        : escapeHtml(formatAge(row.createdAt, data.now)),
      formatDateTime(row.startedAt ?? row.matchedAt ?? row.createdAt),
    ];
  });

  return `<h1>الطلبات الحية</h1>
<p class="note">تحديث تلقائي كل نصف دقيقة. حالة اللحظة: ${escapeHtml(formatDateTime(data.now))}</p>
<form class="filters" method="get" action="/admin/live-orders">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards" style="margin-bottom:16px">${cards}</div>
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
    ],
    rows,
    emptyText: "لا طلب حيّ الآن.",
  }),
)}`;
}
