/**
 * الغرض: تنسيق القيم المعروضة في اللوحة: التواريخ بتوقيت المدينة، والأرقام بأرقام
 *   لاتينية داخل نصّ عربي (فالمشغّل يقارن أرقاماً، والأرقام الهندية تُبطئ المقارنة
 *   البصرية في جدول)، والمدد بصيغة يفهمها إنسان لا بميلي ثانية.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/admin-dashboard
 * يُتوقع أن يستخدمه لاحقاً: كل صفحة في apps/admin-dashboard/src/pages
 * ملاحظات مستقبلية: عند دعم مدن خارج السعودية يصير المنطقة الزمنية حقلاً في cities.
 */

/** توقيت التشغيل الفعلي للمدن الخمس. ليس قيمة تجارية بل حقيقة جغرافية. */
export const DISPLAY_TIME_ZONE = "Asia/Riyadh";

const dateTimeFormat = new Intl.DateTimeFormat("ar", {
  timeZone: DISPLAY_TIME_ZONE,
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormat = new Intl.DateTimeFormat("ar", {
  timeZone: DISPLAY_TIME_ZONE,
  numberingSystem: "latn",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const numberFormat = new Intl.NumberFormat("ar", { numberingSystem: "latn" });

const decimalFormat = new Intl.NumberFormat("ar", {
  numberingSystem: "latn",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/** قيمة غائبة تُعرض شرطة لا فراغاً: الفراغ في جدول يبدو خطأ عرض لا حقيقة بيانات. */
export const EMPTY_CELL = "—";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_CELL;
  return dateTimeFormat.format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_CELL;
  return timeFormat.format(date);
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_CELL;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return EMPTY_CELL;
  return Number.isInteger(numeric) ? numberFormat.format(numeric) : decimalFormat.format(numeric);
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** مدّة بالثواني إلى نصّ عربي مختصر: «٣ س ١٢ د» لا «11520 ثانية». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY_CELL;
  const total = Math.max(0, Math.round(seconds));
  if (total < SECONDS_PER_MINUTE) return `${formatNumber(total)} ث`;

  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${formatNumber(minutes)} د`;

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const restMinutes = minutes % MINUTES_PER_HOUR;
  if (hours < HOURS_PER_DAY) {
    return restMinutes === 0
      ? `${formatNumber(hours)} س`
      : `${formatNumber(hours)} س ${formatNumber(restMinutes)} د`;
  }

  const days = Math.floor(hours / HOURS_PER_DAY);
  const restHours = hours % HOURS_PER_DAY;
  return restHours === 0
    ? `${formatNumber(days)} ي`
    : `${formatNumber(days)} ي ${formatNumber(restHours)} س`;
}

/** عمر صفٍّ منذ لحظة إنشائه حتى «الآن» المُمرَّرة — لا حتى Date.now لتبقى الصفحة قابلة للاختبار. */
export function formatAge(since: string | Date | null | undefined, now: Date): string {
  if (since === null || since === undefined) return EMPTY_CELL;
  const date = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(date.getTime())) return EMPTY_CELL;
  const MS_PER_SECOND = 1000;
  return formatDuration((now.getTime() - date.getTime()) / MS_PER_SECOND);
}

/** نجوم مرئية: القراءة البصرية أسرع من قراءة رقم في عمود من مئة صفّ. */
export function formatStars(stars: number | null | undefined): string {
  if (stars === null || stars === undefined || !Number.isFinite(stars)) return EMPTY_CELL;
  const MAX_STARS = 5;
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
  return `${"★".repeat(filled)}${"☆".repeat(MAX_STARS - filled)}`;
}

/** معرّف UUID مختصر للعرض: الجدول لا يتّسع لستة وثلاثين محرفاً في كل صفّ. */
export function shortId(id: string | null | undefined): string {
  if (id === null || id === undefined || id === "") return EMPTY_CELL;
  const SHORT_LENGTH = 8;
  return id.slice(0, SHORT_LENGTH);
}
