/**
 * الغرض: صفحة الحضور: سجلّ كل تبديل «متاح/غير متاح»، وملخّص ساعات الإتاحة لكل
 *   سائق في النافذة المختارة — لأن «كم ساعة كان فلان متاحاً» سؤال تشغيلي يومي،
 *   والإجابة عنه بعدّ صفوف السجلّ يدوياً ليست إجابة.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: تصدير CSV يُضاف حين يُطلب فعلاً، لا استباقاً.
 */

import { formatDateTime, formatDuration, formatNumber } from "../format.ts";
import { badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface AttendanceEvent {
  readonly changedAt: string;
  readonly driverId: string;
  readonly driverName: string | null;
  readonly telegramId: string;
  readonly cityCode: string;
  readonly isAvailable: boolean;
  readonly source: string;
}

export interface AttendanceSummaryRow {
  readonly driverId: string;
  readonly driverName: string | null;
  readonly cityCode: string;
  /** ثوانٍ كان فيها السائق متاحاً داخل النافذة — محسوبة في القاعدة لا في المتصفّح. */
  readonly onlineSeconds: number;
  readonly toggles: number;
  readonly isAvailableNow: boolean;
}

export interface AttendancePageData {
  readonly events: readonly AttendanceEvent[];
  readonly summary: readonly AttendanceSummaryRow[];
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  readonly windowHours: number;
  readonly availableWindows: readonly number[];
  readonly query: string | null;
  readonly eventLimit: number;
}

export function renderAttendancePage(data: AttendancePageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const windowOptions = data.availableWindows
    .map(
      (hours) =>
        `<option value="${hours}"${data.windowHours === hours ? " selected" : ""}>${escapeHtml(
          formatNumber(hours),
        )} ساعة</option>`,
    )
    .join("");

  const totalOnline = data.summary.reduce((sum, row) => sum + row.onlineSeconds, 0);
  const activeDrivers = data.summary.filter((row) => row.onlineSeconds > 0).length;

  const cards = [
    metricCard("سائقون ظهروا في النافذة", formatNumber(activeDrivers)),
    metricCard("مجموع ساعات الإتاحة", formatDuration(totalOnline)),
    metricCard("عدد التبديلات المسجَّلة", formatNumber(data.events.length)),
  ].join("");

  const summaryRows = data.summary.map((row) => [
    escapeHtml(row.driverName ?? "بلا اسم"),
    `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
    escapeHtml(formatDuration(row.onlineSeconds)),
    formatNumber(row.toggles),
    row.isAvailableNow ? badge("متاح الآن", "ok") : badge("غير متاح", "muted"),
  ]);

  const eventRows = data.events.map((event) => [
    formatDateTime(event.changedAt),
    `<div>${escapeHtml(event.driverName ?? "بلا اسم")}</div>
     <div class="card-hint mono">${escapeHtml(event.telegramId)}</div>`,
    `<span class="mono">${escapeHtml(event.cityCode)}</span>`,
    event.isAvailable ? badge("صار متاحاً", "ok") : badge("صار غير متاح", "muted"),
    `<span class="mono">${escapeHtml(event.source)}</span>`,
  ]);

  return `<h1>الحضور</h1>
<form class="filters" method="get" action="/admin/attendance">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <label>النافذة
    <select name="hours">${windowOptions}</select>
  </label>
  <label>بحث
    <input type="search" name="q" value="${escapeHtml(data.query ?? "")}" placeholder="اسم السائق">
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards" style="margin-bottom:16px">${cards}</div>
${section(
  "ملخّص الإتاحة لكل سائق",
  table({
    headers: ["السائق", "المدينة", "مدّة الإتاحة", "عدد التبديلات", "الآن"],
    rows: summaryRows,
    emptyText: "لا سائق ظهر في هذه النافذة.",
  }),
  "المدّة محسوبة من فترات الإتاحة داخل النافذة فقط: من كان متاحاً قبلها يُحتسب من بدايتها.",
)}
${section(
  "سجلّ التبديلات",
  table({
    headers: ["الوقت", "السائق", "المدينة", "التبديل", "المصدر"],
    rows: eventRows,
    emptyText: "لا تبديل مسجَّل في هذه النافذة.",
  }),
  `آخر ${formatNumber(data.eventLimit)} تبديل كحدّ أقصى.`,
)}`;
}
