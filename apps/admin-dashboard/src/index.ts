/**
 * الغرض: واجهة حزمة لوحة الإدارة: تصدير الصفحات الثماني وصفحة الدخول وأدوات
 *   الهيكل. الحزمة عرضٌ محض بلا أي دخل/خرج: كل دالّة هنا تأخذ بيانات جاهزة وتعيد
 *   نصّ HTML، فتُختبَر بلا قاعدة ولا خادم، ويستضيفها apps/gateway (ADR 0007).
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1)، ثمانِ صفحات لا هياكل.
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts، tests/unit/admin-*.test.ts
 * ملاحظات مستقبلية: أي صفحة تاسعة تُضاف هنا وفي NAV_ITEMS معاً، وإلا صارت صفحة
 *   لا يصل إليها أحد.
 */

export {
  DISPLAY_TIME_ZONE,
  EMPTY_CELL,
  formatAge,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatStars,
  formatTime,
  shortId,
} from "./format.ts";
export {
  type AdminUser,
  type BadgeTone,
  badge,
  escapeHtml,
  metricCard,
  NAV_ITEMS,
  type NavItem,
  renderShell,
  type ShellOptions,
  section,
  type TableOptions,
  table,
} from "./layout.ts";

export { type LoginPageData, renderLoginPage } from "./login.ts";

export {
  type AttendanceEvent,
  type AttendancePageData,
  type AttendanceSummaryRow,
  renderAttendancePage,
} from "./pages/attendance.ts";
export { type DisputeRow, type DisputesPageData, renderDisputesPage } from "./pages/disputes.ts";
export {
  type CityOption,
  type DriverRow,
  type DriverSubscription,
  type DriversFilters,
  type DriversPageData,
  renderDriversPage,
} from "./pages/drivers.ts";
export { type HeatCell, type HeatmapPageData, renderHeatmapPage } from "./pages/heatmap.ts";
export {
  type LiveOrderRow,
  type LiveOrdersData,
  renderLiveOrdersPage,
} from "./pages/live-orders.ts";
export {
  type AuditEntry,
  type CityPulse,
  type HealthIndicator,
  type OverviewCounters,
  type OverviewData,
  renderOverviewPage,
} from "./pages/overview.ts";
export {
  type RatingRow,
  type RatingsPageData,
  type RatingsSummary,
  renderRatingsPage,
} from "./pages/ratings.ts";
export {
  renderSettingsPage,
  type SettingRow,
  type SettingsPageData,
} from "./pages/settings.ts";
