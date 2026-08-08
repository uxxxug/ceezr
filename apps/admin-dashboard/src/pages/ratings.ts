/**
 * الغرض: صفحة التقييمات: كل تقييم متبادل بنجومه وتعليقه، مع تمييز التقييمات
 *   المنخفضة لأنها المؤشّر المبكّر لمشكلة سائق أو عميل قبل أن تصير نزاعاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: علَم الإساءة (is_flagged) يُرفع اليوم من مسار الدعم؛ زرّه من
 *   اللوحة لا يُضاف قبل أمر صريح لأنه يغيّر متوسطاً يدخل في معادلة المطابقة.
 */

import { EMPTY_CELL, formatDateTime, formatNumber, formatStars, shortId } from "../format.ts";
import { badge, escapeHtml, metricCard, section, table } from "../layout.ts";
import type { CityOption } from "./drivers.ts";

export interface RatingRow {
  readonly createdAt: string;
  readonly orderId: string;
  readonly cityCode: string;
  readonly direction: string;
  readonly raterName: string | null;
  readonly rateeName: string | null;
  readonly stars: number;
  readonly comment: string | null;
  readonly isFlagged: boolean;
}

export interface RatingsSummary {
  readonly total: number;
  readonly averageOnDriver: number | null;
  readonly averageOnRider: number | null;
  readonly lowCount: number;
  readonly flaggedCount: number;
  /** حدّ «التقييم المنخفض» — من إعدادات المدينة لا من رقم مكتوب في العرض. */
  readonly lowThreshold: number;
}

export interface RatingsPageData {
  readonly rows: readonly RatingRow[];
  readonly summary: RatingsSummary;
  readonly cities: readonly CityOption[];
  readonly cityId: string | null;
  readonly direction: string | null;
  readonly onlyLow: boolean;
  readonly limit: number;
}

const DIRECTION_LABEL: Readonly<Record<string, string>> = {
  driver_to_rider: "سائق ← عميل",
  rider_to_driver: "عميل ← سائق",
};

export function renderRatingsPage(data: RatingsPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const directionOptions = Object.entries(DIRECTION_LABEL)
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${
          data.direction === value ? " selected" : ""
        }>${escapeHtml(label)}</option>`,
    )
    .join("");

  const s = data.summary;
  const cards = [
    metricCard("عدد التقييمات", formatNumber(s.total)),
    metricCard(
      "متوسط تقييم السائقين",
      s.averageOnDriver === null ? EMPTY_CELL : formatNumber(s.averageOnDriver),
      s.averageOnDriver === null ? "لا تقييم بعد" : formatStars(s.averageOnDriver),
    ),
    metricCard(
      "متوسط تقييم العملاء",
      s.averageOnRider === null ? EMPTY_CELL : formatNumber(s.averageOnRider),
      s.averageOnRider === null ? "لا تقييم بعد" : formatStars(s.averageOnRider),
    ),
    metricCard(
      "تقييمات منخفضة",
      formatNumber(s.lowCount),
      `${formatNumber(s.lowThreshold)} نجوم فأقل`,
    ),
    metricCard("مُعلَّمة إساءةً", formatNumber(s.flaggedCount), "مستثناة من المتوسط"),
  ].join("");

  const rows = data.rows.map((row) => [
    formatDateTime(row.createdAt),
    `<span class="mono">${escapeHtml(shortId(row.orderId))}</span>`,
    `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
    escapeHtml(DIRECTION_LABEL[row.direction] ?? row.direction),
    escapeHtml(row.raterName ?? "بلا اسم"),
    escapeHtml(row.rateeName ?? "بلا اسم"),
    row.stars <= data.summary.lowThreshold
      ? badge(formatStars(row.stars), "bad")
      : `<span title="${formatNumber(row.stars)}">${formatStars(row.stars)}</span>`,
    row.comment === null ? EMPTY_CELL : escapeHtml(row.comment),
    row.isFlagged ? badge("مُعلَّم", "warn") : "",
  ]);

  return `<h1>التقييمات</h1>
<form class="filters" method="get" action="/admin/ratings">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <label>الاتجاه
    <select name="direction">
      <option value="">الاتجاهان</option>${directionOptions}
    </select>
  </label>
  <label>المنخفضة فقط
    <select name="low">
      <option value="">لا</option>
      <option value="1"${data.onlyLow ? " selected" : ""}>نعم</option>
    </select>
  </label>
  <button type="submit">تطبيق</button>
</form>
<div class="cards" style="margin-bottom:16px">${cards}</div>
${section(
  "آخر التقييمات",
  table({
    headers: ["الوقت", "الطلب", "المدينة", "الاتجاه", "المُقيِّم", "المُقيَّم", "النجوم", "التعليق", ""],
    rows,
    emptyText: "لا تقييم يطابق هذا الفلتر.",
  }),
  `آخر ${formatNumber(data.limit)} تقييم كحدّ أقصى.`,
)}`;
}
