/**
 * الغرض: صفحة النزاعات: تذاكر الدعم المفتوحة والمستلَمة بعمرها وسياق طلبها،
 *   مرتَّبة بالأقدم أولاً — لأن التذكرة التي طال انتظارها هي التي تُفقد العميل.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: الحلّ والاستلام يبقيان في قروب الدعم على تلغرام عمداً: مسار
 *   واحد للحسم يمنع تذكرة يستلمها اثنان من بابين مختلفين.
 */

import { EMPTY_CELL, formatAge, formatDateTime, formatNumber, shortId } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface DisputeRow {
  readonly ticketId: string;
  readonly createdAt: string;
  readonly type: string;
  readonly status: string;
  readonly cityCode: string;
  readonly partyName: string | null;
  readonly partyRole: string;
  readonly partyTelegramId: string | null;
  readonly orderId: string | null;
  readonly message: string;
  readonly claimedByName: string | null;
  readonly claimedAt: string | null;
}

export interface DisputesPageData {
  readonly now: Date;
  readonly rows: readonly DisputeRow[];
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  readonly status: string | null;
  readonly openCount: number;
  readonly claimedCount: number;
  readonly resolvedDayCount: number;
  readonly windowHours: number;
  readonly limit: number;
}

const STATUS_LABEL: Readonly<Record<string, string>> = {
  open: "مفتوحة",
  claimed: "مستلَمة",
  resolved: "محلولة",
  rejected: "مرفوضة",
};

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  open: "bad",
  claimed: "warn",
  resolved: "ok",
  rejected: "muted",
};

const TYPE_LABEL: Readonly<Record<string, string>> = {
  dispute: "نزاع",
  complaint: "شكوى",
  subscription: "طلب اشتراك",
};

const ROLE_LABEL: Readonly<Record<string, string>> = {
  driver: "سائق",
  rider: "عميل",
};

export function renderDisputesPage(data: DisputesPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const statusOptions = Object.entries(STATUS_LABEL)
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${
          data.status === value ? " selected" : ""
        }>${escapeHtml(label)}</option>`,
    )
    .join("");

  const cards = [
    metricCard("مفتوحة بلا استلام", formatNumber(data.openCount)),
    metricCard("مستلَمة قيد المعالجة", formatNumber(data.claimedCount)),
    metricCard(
      "حُسمت",
      formatNumber(data.resolvedDayCount),
      `آخر ${formatNumber(data.windowHours)} ساعة`,
    ),
  ].join("");

  const rows = data.rows.map((row) => [
    `<span class="mono">${escapeHtml(shortId(row.ticketId))}</span>`,
    formatDateTime(row.createdAt),
    escapeHtml(TYPE_LABEL[row.type] ?? row.type),
    badge(STATUS_LABEL[row.status] ?? row.status, STATUS_TONE[row.status] ?? "muted"),
    `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
    `<div>${escapeHtml(row.partyName ?? "بلا اسم")} <span class="card-hint">${escapeHtml(
      ROLE_LABEL[row.partyRole] ?? row.partyRole,
    )}</span></div>
     <div class="card-hint mono">${escapeHtml(row.partyTelegramId ?? "")}</div>`,
    row.orderId === null
      ? EMPTY_CELL
      : `<span class="mono">${escapeHtml(shortId(row.orderId))}</span>`,
    escapeHtml(row.message),
    row.claimedByName === null
      ? EMPTY_CELL
      : `<div>${escapeHtml(row.claimedByName)}</div>
         <div class="card-hint">${escapeHtml(formatDateTime(row.claimedAt))}</div>`,
    row.status === "open"
      ? badge(formatAge(row.createdAt, data.now), "bad")
      : escapeHtml(formatAge(row.createdAt, data.now)),
  ]);

  return `<h1>النزاعات</h1>
<form class="filters" method="get" action="/admin/disputes">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <label>الحالة
    <select name="status">
      <option value="">المفتوحة والمستلَمة</option>${statusOptions}
    </select>
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards" style="margin-bottom:16px">${cards}</div>
${section(
  "التذاكر",
  table({
    headers: [
      "التذكرة",
      "فُتحت",
      "النوع",
      "الحالة",
      "المدينة",
      "الطرف",
      "الطلب",
      "النصّ",
      "المستلِم",
      "العمر",
    ],
    rows,
    emptyText: "لا تذكرة تطابق هذا الفلتر.",
  }),
  `الأقدم أولاً — آخر ${formatNumber(data.limit)} تذكرة كحدّ أقصى.`,
)}`;
}
