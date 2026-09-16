/**
 * الغرض: صفحة النظرة العامة: مؤشرات التشغيل الآن، ومؤشرات صحة النظام التي تُقرأ
 *   من الواقع لا من فرضية — كل مؤشر منها استعلام على القاعدة، لا عدّاد في الذاكرة
 *   يُصفَّر مع كل إعادة تشغيل.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard/pages
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts
 * ملاحظات مستقبلية: عند وصل مراقبة خارجية (القسم د.4) تُعرض حالتها هنا مؤشراً تاسعاً.
 */

import type { MetricTruthStamp } from "../../../../packages/domain/admin/metric-snapshot.ts";
import { formatDateTime, formatDuration, formatNumber, formatStars } from "../format.ts";
import { type BadgeTone, badge, escapeHtml, metricCard, section, table } from "../layout.ts";

export interface HealthIndicator {
  readonly name: string;
  readonly status: "ok" | "warn" | "bad";
  readonly detail: string;
}

export interface OverviewCounters {
  readonly searchingOrders: number;
  readonly matchedOrders: number;
  readonly inProgressOrders: number;
  readonly availableDrivers: number;
  readonly verifiedDrivers: number;
  readonly pendingDrivers: number;
  readonly activeSubscriptions: number;
  readonly trialSubscriptions: number;
  readonly openTickets: number;
  readonly completedOrdersDay: number;
  readonly failedOrdersDay: number;
  readonly cancelledOrdersDay: number;
  readonly averageMatchSeconds: number | null;
  readonly averageDriverRating: number | null;
}

/**
 * نبضُ مدينةٍ. و`null` **ليسَ صفراً** (`F7-08`): مدينةٌ بلا لقطةٍ لم تُقَس،
 * ومدينةٌ بلقطةٍ أصفارٍ مقيسةٌ هادئةٌ — وعرضُهما بنفسِ الشكلِ يسترُ عطبَ الشوطِ
 * وراءَ هدوءٍ مُريحٍ.
 */
export interface CityPulse {
  readonly code: string;
  readonly nameAr: string;
  readonly isActive: boolean;
  readonly liveOrders: number | null;
  readonly availableDrivers: number | null;
  readonly openTickets: number | null;
}

export interface AuditEntry {
  readonly createdAt: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly entityType: string;
}

export interface OverviewData {
  readonly now: Date;
  readonly counters: OverviewCounters;
  readonly health: readonly HealthIndicator[];
  readonly cities: readonly CityPulse[];
  readonly recentAudit: readonly AuditEntry[];
  /** نافذة الحساب اليومية بالساعات — تأتي من الاستعلام لا من افتراض في العرض. */
  readonly windowHours: number;
  /**
   * وَسمُ صدقِ العدَّاداتِ (`F7-08`). **حقلٌ واجبٌ لا اختياريٌ**: لو كانَ
   * `?` لمرَّ مسارٌ ينشُرُ أرقاماً بلا عُمرٍ بلا أن يمنعَهُ مُترجِمٌ.
   */
  readonly stamp: MetricTruthStamp;
}

const TONE_BY_STATUS: Readonly<Record<HealthIndicator["status"], BadgeTone>> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
};

const STATUS_LABEL: Readonly<Record<HealthIndicator["status"], string>> = {
  ok: "سليم",
  warn: "انتبه",
  bad: "عطل",
};

/** عدَدٌ غائبٌ يُعرَضُ «لم تُقَس» ولا يُعرَضُ صفراً. */
function measured(value: number | null): string {
  return value === null ? "لم تُقَس" : formatNumber(value);
}

const SOURCE_LABEL: Readonly<Record<MetricTruthStamp["source"], string>> = {
  snapshot: "لقطةٌ مجمّعةٌ",
  live: "مسحٌ حيٌّ مباشرٌ",
};

/**
 * شريطُ صدقِ العدَّاداتِ — **فوقَ الأرقامِ لا تحتَها**. وحينَ لا لقطةَ ألبتَّةَ
 * يقولُ إنَّ الأرقامَ غيرُ متاحةٍ صراحةً: أصفارٌ بلا لقطةٍ تُقرَأُ «ليلةٌ هادئةٌ»
 * وهيَ في الحقيقةِ «لا أحدَ يقيسُ».
 */
function truthBanner(stamp: MetricTruthStamp): string {
  const source = SOURCE_LABEL[stamp.source];
  const coverage = `مدنٌ مقيسةٌ: ${formatNumber(stamp.citiesMeasured)} من ${formatNumber(stamp.citiesExpected)}`;

  if (stamp.computedAt === null) {
    return `<p class="note">${badge("عدَّاداتٌ غيرُ متاحةٍ", "bad")} لا توجدُ لقطةٌ محسوبةٌ بعدُ، فالأرقامُ أعلاهُ لم تُقَس وليستِ أصفاراً مقيسةً. ${escapeHtml(coverage)}</p>`;
  }

  const age =
    stamp.ageSeconds === null ? "عُمرٌ غيرُ معروفٍ" : `عُمرُ القياسِ: ${formatDuration(stamp.ageSeconds)}`;
  const tone = stamp.isStale ? badge("متقادِمٌ", "warn") : badge("حديثٌ", "ok");
  const threshold =
    stamp.staleAfterSeconds > 0
      ? `حدُّ التقادُمِ: ${formatDuration(stamp.staleAfterSeconds)}`
      : "حدُّ التقادُمِ غيرُ مضبوطٍ — فيُعامَلُ متقادِماً";

  return `<p class="note">${tone} ${escapeHtml(source)} · ${escapeHtml(age)} · قيسَ في ${escapeHtml(formatDateTime(stamp.computedAt))} · ${escapeHtml(threshold)} · ${escapeHtml(coverage)}</p>`;
}

export function renderOverviewPage(data: OverviewData): string {
  const c = data.counters;
  const window = `آخر ${formatNumber(data.windowHours)} ساعة`;

  const liveCards = [
    metricCard("طلبات تبحث عن سائق", formatNumber(c.searchingOrders), "لم تُسنَد بعد"),
    metricCard("طلبات مُسنَدة", formatNumber(c.matchedOrders), "سائق قبِل ولم يبدأ"),
    metricCard("رحلات جارية", formatNumber(c.inProgressOrders), "بدأت ولم تنتهِ"),
    metricCard("سائقون متاحون الآن", formatNumber(c.availableDrivers)),
    metricCard("سائقون موثَّقون", formatNumber(c.verifiedDrivers)),
    metricCard("بانتظار التوثيق", formatNumber(c.pendingDrivers), "يحتاجون قراراً"),
    metricCard("اشتراكات فعّالة", formatNumber(c.activeSubscriptions)),
    metricCard("داخل الشهر المجاني", formatNumber(c.trialSubscriptions)),
    metricCard("نزاعات مفتوحة", formatNumber(c.openTickets)),
  ].join("");

  const dayCards = [
    metricCard("رحلات مكتملة", formatNumber(c.completedOrdersDay), window),
    metricCard("طلبات ملغاة", formatNumber(c.cancelledOrdersDay), window),
    metricCard("طلبات فشلت مطابقتها", formatNumber(c.failedOrdersDay), window),
    metricCard(
      "متوسط زمن المطابقة",
      c.averageMatchSeconds === null ? "—" : formatDuration(c.averageMatchSeconds),
      window,
    ),
    metricCard(
      "متوسط تقييم السائقين",
      c.averageDriverRating === null ? "—" : formatStars(c.averageDriverRating),
      c.averageDriverRating === null ? "لا تقييم بعد" : formatNumber(c.averageDriverRating),
    ),
  ].join("");

  const healthRows = data.health.map((item) => [
    escapeHtml(item.name),
    badge(STATUS_LABEL[item.status], TONE_BY_STATUS[item.status]),
    escapeHtml(item.detail),
  ]);

  const cityRows = data.cities.map((city) => [
    `${escapeHtml(city.nameAr)} <span class="mono">${escapeHtml(city.code)}</span>`,
    city.isActive ? badge("مفعَّلة", "ok") : badge("غير مفعَّلة", "muted"),
    escapeHtml(measured(city.liveOrders)),
    escapeHtml(measured(city.availableDrivers)),
    escapeHtml(measured(city.openTickets)),
  ]);

  const auditRows = data.recentAudit.map((entry) => [
    formatDateTime(entry.createdAt),
    `<span class="mono">${escapeHtml(entry.action)}</span>`,
    escapeHtml(entry.entityType),
    escapeHtml(entry.actorName ?? "—"),
  ]);

  return `<h1>نظرة عامة</h1>
<p class="note">حالة اللحظة: ${escapeHtml(formatDateTime(data.now))}</p>
${truthBanner(data.stamp)}
${section("التشغيل الآن", `<div class="cards">${liveCards}</div>`)}
${section(`الحصيلة — ${window}`, `<div class="cards">${dayCards}</div>`)}
${section(
  "صحة النظام",
  table({
    headers: ["المؤشر", "الحالة", "التفصيل"],
    rows: healthRows,
    emptyText: "لا مؤشرات.",
  }),
  "كل مؤشر هنا محسوب من القاعدة لحظة فتح الصفحة، لا من ذاكرة العملية.",
)}
${section(
  "المدن",
  table({
    headers: ["المدينة", "الحالة", "طلبات حية", "سائقون متاحون", "نزاعات مفتوحة"],
    rows: cityRows,
    emptyText: "لا مدن مسجَّلة.",
  }),
)}
${section(
  "آخر الأحداث المسجَّلة",
  table({
    headers: ["الوقت", "الحدث", "الكيان", "المنفِّذ"],
    rows: auditRows,
    emptyText: "لا أحداث بعد.",
  }),
  "من سجلّ التدقيق (audit_log): ما يُكتب هنا لا يُمحى من اللوحة.",
)}`;
}
