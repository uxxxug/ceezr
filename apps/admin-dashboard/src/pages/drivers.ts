/**
 * الغرض: صفحة السائقين: تسجيل وتوثيق وحالة اشتراك وشهر مجاني وإتاحة، مع فعلين
 *   كتابيين حقيقيين (تغيير حالة التوثيق، والحظر/رفعه) يمرّان بدوالّ ذرّية تكتب
 *   سجلّ تدقيق — لا زرّ يُغيّر صفّاً بلا أثر.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: تفعيل اشتراك يدوياً يبقى في مسار الدعم (تذكرة) لأنه يقتضي إيصالاً.
 */

import { EMPTY_CELL, formatDateTime, formatNumber, formatStars } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, section, table } from "../layout.ts";

export interface DriverSubscription {
  readonly plan: string;
  readonly status: string;
  readonly trialEndsAt: string | null;
  readonly currentPeriodEnd: string | null;
}

export interface DriverRow {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string | null;
  readonly telegramId: string;
  readonly phone: string | null;
  readonly cityCode: string;
  readonly verificationStatus: string;
  readonly isBlocked: boolean;
  readonly isAvailable: boolean;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly services: readonly string[];
  readonly subscription: DriverSubscription | null;
  readonly completedOrders: number;
  readonly registeredAt: string;
}

export interface CityOption {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
}

export interface DriversFilters {
  readonly cityId: string | null;
  readonly verification: string | null;
  readonly query: string | null;
}

export interface DriversPageData {
  readonly rows: readonly DriverRow[];
  readonly cities: readonly CityOption[];
  readonly filters: DriversFilters;
  readonly csrfToken: string;
  readonly total: number;
  readonly limit: number;
}

const VERIFICATION_LABEL: Readonly<Record<string, string>> = {
  pending: "بانتظار التوثيق",
  verified: "موثَّق",
  rejected: "مرفوض",
  suspended: "معلَّق",
};

const VERIFICATION_TONE: Readonly<Record<string, BadgeTone>> = {
  pending: "warn",
  verified: "ok",
  rejected: "bad",
  suspended: "bad",
};

const SUBSCRIPTION_LABEL: Readonly<Record<string, string>> = {
  trialing: "شهر مجاني",
  active: "فعّال",
  expired: "منتهٍ",
  cancelled: "ملغى",
};

const SUBSCRIPTION_TONE: Readonly<Record<string, BadgeTone>> = {
  trialing: "warn",
  active: "ok",
  expired: "muted",
  cancelled: "muted",
};

const PLAN_LABEL: Readonly<Record<string, string>> = {
  transport: "مشاوير",
  delivery: "توصيل",
  both: "الخدمتان",
};

const SERVICE_LABEL: Readonly<Record<string, string>> = {
  transport: "مشاوير",
  delivery: "توصيل",
};

function subscriptionCell(subscription: DriverSubscription | null): string {
  if (subscription === null) return badge("بلا اشتراك", "muted");
  const status = badge(
    SUBSCRIPTION_LABEL[subscription.status] ?? subscription.status,
    SUBSCRIPTION_TONE[subscription.status] ?? "muted",
  );
  const plan = escapeHtml(PLAN_LABEL[subscription.plan] ?? subscription.plan);
  const until = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
  const untilText =
    until === null ? "" : `<div class="card-hint">حتى ${escapeHtml(formatDateTime(until))}</div>`;
  return `${status} <span>${plan}</span>${untilText}`;
}

function actionsCell(row: DriverRow, csrfToken: string): string {
  const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">`;
  const nextVerification = row.verificationStatus === "verified" ? "suspended" : "verified";
  const verificationLabel = row.verificationStatus === "verified" ? "تعليق" : "توثيق";

  return `<form class="inline" method="post" action="/admin/drivers/${escapeHtml(row.driverId)}/verification">
  ${csrf}
  <input type="hidden" name="status" value="${escapeHtml(nextVerification)}">
  <button type="submit">${escapeHtml(verificationLabel)}</button>
</form>
<form class="inline" method="post" action="/admin/users/${escapeHtml(row.userId)}/blocked">
  ${csrf}
  <input type="hidden" name="blocked" value="${row.isBlocked ? "0" : "1"}">
  <button class="ghost" type="submit">${row.isBlocked ? "رفع الحظر" : "حظر"}</button>
</form>`;
}

export function renderDriversPage(data: DriversPageData): string {
  const cityOptions = data.cities
    .map(
      (city) =>
        `<option value="${escapeHtml(city.id)}"${
          data.filters.cityId === city.id ? " selected" : ""
        }>${escapeHtml(city.nameAr)}</option>`,
    )
    .join("");

  const verificationOptions = Object.entries(VERIFICATION_LABEL)
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${
          data.filters.verification === value ? " selected" : ""
        }>${escapeHtml(label)}</option>`,
    )
    .join("");

  const filters = `<form class="filters" method="get" action="/admin/drivers">
  <label>المدينة
    <select name="city">
      <option value="">كل المدن</option>${cityOptions}
    </select>
  </label>
  <label>حالة التوثيق
    <select name="verification">
      <option value="">كل الحالات</option>${verificationOptions}
    </select>
  </label>
  <label>بحث
    <input type="search" name="q" value="${escapeHtml(data.filters.query ?? "")}"
           placeholder="اسم أو جوال أو معرّف تلغرام">
  </label>
  <button type="submit">تطبيق</button>
</form>`;

  const rows = data.rows.map((row) => [
    // الاسم رابطٌ لا نصّ: القائمة تعرض عشرة أعمدة، ومراجعة سائق قبل توثيقه تحتاج
    // ملفّه كاملاً لا عمودين منه. وبلا رابط من هنا تبقى صفحة التفاصيل موجودة ولا يصلها أحد.
    `<div><a href="/admin/drivers/${escapeHtml(row.driverId)}">${escapeHtml(
      row.fullName ?? "بلا اسم",
    )}</a></div>
     <div class="card-hint mono">${escapeHtml(row.telegramId)}${
       row.phone === null ? "" : ` · ${escapeHtml(row.phone)}`
}</div>`,
    `<span class="mono">${escapeHtml(row.cityCode)}</span>`,
    badge(
      VERIFICATION_LABEL[row.verificationStatus] ?? row.verificationStatus,
      VERIFICATION_TONE[row.verificationStatus] ?? "muted",
    ) + (row.isBlocked ? ` ${badge("محظور", "bad")}` : ""),
    row.services.length === 0
      ? EMPTY_CELL
      : row.services.map((s) => escapeHtml(SERVICE_LABEL[s] ?? s)).join(" · "),
    subscriptionCell(row.subscription),
    row.isAvailable ? badge("متاح", "ok") : badge("غير متاح", "muted"),
    row.ratingAverage === null
      ? EMPTY_CELL
      : `${formatStars(row.ratingAverage)} <span class="card-hint">${formatNumber(
          row.ratingAverage,
        )} (${formatNumber(row.ratingCount)})</span>`,
    formatNumber(row.completedOrders),
    formatDateTime(row.registeredAt),
    actionsCell(row, data.csrfToken),
  ]);

  const note =
    data.total > data.rows.length
      ? `يُعرض ${formatNumber(data.rows.length)} من ${formatNumber(
          data.total,
        )} — ضيِّق البحث لرؤية البقية.`
      : `${formatNumber(data.total)} سائقاً.`;

  return `<h1>السائقون</h1>
${filters}
${section(
  "القائمة",
  table({
    headers: [
      "السائق",
      "المدينة",
      "التوثيق",
      "الخدمات",
      "الاشتراك",
      "الإتاحة",
      "التقييم",
      "رحلات مكتملة",
      "مسجَّل منذ",
      "إجراءات",
    ],
    rows,
    emptyText: "لا سائق يطابق هذا الفلتر.",
  }),
  note,
)}`;
}
