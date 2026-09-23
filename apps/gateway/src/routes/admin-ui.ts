/**
 * الغرض: صفحات لوحة الإدارة المُقدَّمة من الخادم: الدخول برمز تلغرام، والصفحات
 *   الثماني، والأفعال الكتابية الثلاثة. المسار يجمع البيانات ويسلّمها لدوالّ
 *   العرض في apps/admin-dashboard، فلا HTML هنا ولا SQL هناك (ADR 0007).
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/gateway-admin-ui.test.ts
 * ملاحظات مستقبلية: أي صفحة جديدة تُضاف هنا وفي NAV_ITEMS معاً.
 */

import { type Context, Hono } from "hono";
import type {
  BroadcastAdminPort,
  BroadcastFilters,
} from "../../../../packages/application/broadcast/ports.ts";
import type { SessionRevocationStore } from "../../../../packages/application/identity/ports.ts";
import { isSessionRevocationReason } from "../../../../packages/application/identity/session-revocation-reasons.ts";
import { DEFAULT_SESSION_POLICY } from "../../../../packages/domain/tracking/session.ts";
import { createBroadcastAdminPort } from "../../../../packages/infrastructure/broadcast/broadcast-adapters.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import { MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS } from "../../../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  MAPLIBRE_SRI_UNSET,
  type MapPoint,
  type MapViewModel,
  maplibreScriptUrl,
  maplibreStylesheetUrl,
  type ResolvedMapStyle,
} from "../../../../packages/maps/index.ts";
import {
  type AdminUser,
  BROADCAST_BODY_LIMIT,
  type BroadcastAudienceChoice,
  type BroadcastFormState,
  type BroadcastPreview,
  type CityGroupStatus,
  type CityOption,
  renderAttendancePage,
  renderBreakGlassPage,
  renderBroadcastPage,
  renderDisputesPage,
  renderDriverDetailPage,
  renderDriversPage,
  renderHeatmapPage,
  renderLiveMapPage,
  renderLiveOrdersPage,
  renderLoginPage,
  renderOverviewPage,
  renderPaymentsPage,
  renderRatingsPage,
  renderRecoveryPage,
  renderSettingsPage,
  renderShell,
} from "../../../admin-dashboard/src/index.ts";
import { renderMapPanel } from "../../../admin-dashboard/src/map.ts";
import {
  type AdminAuthPort,
  type AdminCodeSender,
  classifyAuth,
  generateLoginCode,
  generateSessionToken,
  loginCodeMessage,
  sha256Hex,
} from "../admin/auth.ts";
import {
  type AdminBreakGlassPort,
  BREAK_GLASS_INVALID_CREDENTIALS,
  createAdminBreakGlassPort,
} from "../admin/break-glass.ts";
import {
  type AdminEnv,
  clearSessionCookie,
  createAdminGuard,
  formText,
  readSessionToken,
  requireCsrf,
  writeSessionCookie,
} from "../admin/guard.ts";
import {
  ATTENDANCE_WINDOWS,
  adminBreakGlassCredential,
  adminOverviewReading,
  attendanceSummary,
  DAY_WINDOW_HOURS,
  DISPUTES_LIMIT,
  DRIVER_TICKETS_LIMIT,
  DRIVERS_LIMIT,
  disputeTotals,
  driverDetail,
  EVENTS_LIMIT,
  HEATMAP_CELL_FALLBACK_DEGREES,
  HEATMAP_WINDOWS,
  healthIndicators,
  healthSignals,
  heatmap,
  isRecoveryDecisionReason,
  type LiveDriverStatusRow,
  LOW_RATING_FALLBACK,
  listAttendanceEvents,
  listBroadcastCampaigns,
  listCities,
  listDisputes,
  listDrivers,
  listLiveDriverStatuses,
  listLiveOrders,
  listPendingRecoveryRequests,
  listRatings,
  listSettings,
  logMiniAppSessionRevocation,
  numericSetting,
  RATINGS_LIMIT,
  ratingsTotals,
  readUserTelegramId,
  recentAudit,
  reviewAccountRecoveryRequest,
  setDriverVerification,
  setUserBlocked,
  stallSeconds,
  submitAccountRecoveryRequest,
  updateCityGroupIds,
  updateSetting,
} from "../admin/queries.ts";
import { createAdminSecurityHeaders } from "../admin/security-headers.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { clientAddress, rateLimitRejection } from "../rate-limit/guard.ts";

export interface AdminUiDependencies {
  readonly sql: Sql;
  readonly auth: AdminAuthPort;
  /** قناة تسليم رمز الدخول: بوت السائق يراسل المسؤول في محادثته الخاصة. */
  readonly codeSender: AdminCodeSender;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * أصولُ الخريطة المسموحة في سياسة أمن المحتوى، مُشتقّةً من `resolveMapStyle`
   * (المرحلة ١٠). تُمرَّر ولا تُحسب هنا: هذا الموجّه لا يقرأ الضبط، وحسابُها هنا
   * كان سيصنع مصدرَ حقيقةٍ ثانياً لنمط الخريطة إلى جانب `packages/maps`.
   * الافتراض عند الغياب: لا أصلَ خارجيّاً — أضيقُ سياسةٍ ممكنة.
   */
  readonly mapOrigins?: readonly string[];
  /**
   * نمطُ الخريطة مُحلَّلاً (`resolveMapStyle`). يُمرَّر ولا يُحسب — نفسُ حجّة
   * `mapOrigins`: هذا الموجّه لا يقرأ الضبط. الافتراضُ عند الغياب: غيرُ مُهيَّأ،
   * فيُعرض سببٌ مقروءٌ وتعمل الصفحةُ بجدولها كاملاً.
   */
  readonly mapStyle?: ResolvedMapStyle;
  /** بصمةُ سلامة نصّ MapLibre. الغيابُ يعني «لا تُصيَّر الخريطة» (ADR 0019). */
  readonly maplibreSri?: string | null;
  /**
   * منفذ البثّ الجماعي. الافتراضُ عند الغياب هو المنفذ الحقيقيّ على `sql` لا
   * تعطيلُ الصفحة: منفذٌ اختياريٌّ يُنسى في مُتصِلٍ واحد يعني صفحةَ بثٍّ تُعرض
   * ثم تسقط عند أوّل إرسال. الحقلُ للاستبدال في الاختبار لا للتشغيل بدونه.
   */
  readonly broadcast?: BroadcastAdminPort;
  /**
   * مخزنُ إبطالِ الجلساتِ (`SEC-18-ب`) — بهِ يُنفَذُ إبطالُ جلساتِ Mini App من
   * اللوحةِ. **وغيابُهُ إغلاقٌ لا تجاوُزٌ**: المسلكُ يردُّ ٥٠٣ ولا يُسجِّلُ قراراً،
   * إذ أثرٌ بلا إنفاذٍ كذبٌ في السجلِّ — وهو عينُ ما يُغلِقُهُ هذا البندُ.
   * واختياريٌّ لا إلزاميٌّ كي لا تُكسَرَ عشرةُ مُتصِلي اختبارٍ لا تمسُّ هذا المسلكَ،
   * **والثقبُ محروسٌ لا مأمولٌ**: اختبارٌ يُثبِتُ الردَّ ٥٠٣ عندَ الغيابِ.
   */
  readonly revocation?: SessionRevocationStore;
  /**
   * `SEC-21` · `ADR 0176` — مفتاحُ تشفيرِ أسرارِ TOTP للبابِ الموازي من
   * البيئةِ (`ADMIN_BREAK_GLASS_TOTP_KEY`). يُمرَّرُ ولا يُقرأُ ههنا (هذا
   * الموجِّهُ لا يقرأُ الضبطَ — كسائرِ حقولِ هذه الواجهةِ). غيابُهُ (`null`)
   * يُعطِّلُ تسجيلَ البابِ ودخولَهُ بردٍّ موحَّدٍ لا بإسقاطِ الخدمةِ، ويُسجَّلُ
   * أثرُهُ في السجلِّ المهيكلِ.
   */
  readonly breakGlassTotpKey?: string | null;
  /**
   * منفذُ البابِ الموازي — للاستبدالِ في الاختبارِ. الافتراضُ عندَ الغيابِ هو
   * المنفذُ الحقيقيُّ على `sql` والمفتاحِ المُمرَّرِ أعلاهُ.
   */
  readonly breakGlass?: AdminBreakGlassPort;
  /**
   * حاصرُ دخولِ البابِ الموازي قبلَ المصادقةِ (`SEC-21` · ADR 0176). الاسمُ
   * المجهولُ لا صفَّ لهُ في القاعدةِ فلا يلمسُهُ إقفالُ القاعدةِ — فالهمْرُ عليه
   * لا يَحدُّهُ إلّا هذا العدّادُ في الذاكرةِ. يُمرَّرُ ولا يُبنى ههنا (الموجِّهُ لا
   * يقرأُ سِجلَّ السياسةِ)، والغيابُ تدهورٌ مُعلَنٌ لا صمتٌ: نقطةُ التركيبِ
   * تُسجِّلُ الحدَّ في `rate-limit/policy.ts` — **مصدرِ الحقيقةِ الواحدِ** —
   * وتُركِّبُهُ في موضعَي التشغيلِ كليهما.
   */
  readonly limits?: { readonly breakGlassLoginPerAddress: RateLimiter };
}

/** الافتراضُ حين لا سائقَ مرئيّاً: مركزُ الجزيرة تقريباً بتكبيرٍ واسع. */
const FALLBACK_CENTER = { lat: 24.7136, lng: 46.6753 } as const;
const FLEET_ZOOM = 11;

/**
 * نموذجُ عرضِ الأسطول. الدبابيسُ سائقون فقط: إضافةُ نقاطِ الانطلاق والمقاصد كانت
 * ستُثلّث عددَ الدبابيس على شاشةٍ غرضُها «أين سائقي»، وتخفي بينها من يحتاج نظراً.
 *
 * و`fitToPoints` مُفعَّلة والمركزُ احتياطيٌّ فقط: مركزٌ ثابتٌ في مدينةٍ واحدة كان
 * سيُظهر خريطةً فارغةً لمشغّلٍ يُرشّح مدينةً أخرى.
 */
function fleetViewModel(rows: readonly LiveDriverStatusRow[]): MapViewModel {
  const points: MapPoint[] = rows.map((row) => ({
    id: row.driverId,
    position: { lat: row.lat, lng: row.lng },
    label: row.driverName ?? row.driverId,
    type: "driver",
  }));
  const first = points[0];
  return {
    center: first === undefined ? FALLBACK_CENTER : first.position,
    zoom: FLEET_ZOOM,
    points,
    /**
     * فارغةٌ بقرارٍ لا بنقصٍ — ADR 0025. المُصيِّرُ يرسم الخطوطَ فعلاً، فالإغراءُ
     * أن تُملأ بأثرِ إصلاحاتِ السائق. لكنّ المرحلة ١٦ قاست ذلك: طولُ الأثرِ
     * الخام يخطئ −٨.٧٪ إلى −٩.٥٪ لأن الإصلاحاتَ المتباعدةَ تقطع المنحنيات،
     * ومطابقتُه بـ`/match` تخطئ +١٣.٦٪ عند تشويشِ ٢٠م وحدَه. وخطٌّ يُرسَم فوق
     * خريطةِ طرقٍ يُقرأ كدعوى «هذا ما سلكه السائق» — وهي دعوى لا تحملها البيانات.
     * ولا يوجد في هذا الإصدار مخزنُ أثرٍ أصلاً: `drivers.last_location` نقطةٌ
     * واحدةٌ تُحدَّث في موضعها. فالخريطةُ تعرض أين هو، لا أين كان.
     */
    polylines: [],
    fitToPoints: true,
  };
}

const AUDIT_PREVIEW_LIMIT = 12;
const DEFAULT_HEATMAP_HOURS = 6;
const SEE_OTHER = 303;
const HTML_UNPROCESSABLE = 422;
const SERVER_ERROR = 500;
const SERVICE_UNAVAILABLE = 503;
const TELEGRAM_ID_PATTERN = /^[0-9]{5,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 404;
const CODE_PATTERN = /^[0-9]{6}$/;
const MIN_BIGINT = -(2n ** 63n);
const MAX_BIGINT = 2n ** 63n - 1n;

/** رسائل الرفض موحَّدة عمداً: من يجرّب معرّفات لا يعرف أيّها موجود. */
const GENERIC_LOGIN_ERROR = "تعذّر إرسال الرمز. تأكّد من المعرّف، أو راجع صاحب النظام.";

/** نصوصُ رفضِ التسجيلِ للمسؤولِ (جلسةٌ مُوثَّقةٌ — صريحةٌ لا مكتومة). */
function enrollmentErrorText(code: string): string {
  if (code === "SESSION_NOT_FOUND") return "انتهت الجلسةُ — أعدِ الدخولَ ثم أعدِ المحاولةَ.";
  if (code === "NOT_ADMIN") return "هذه الصفحةُ لمسؤولٍ فحسبُ.";
  if (code === "INVALID_LOGIN_NAME")
    return "اسمُ الدخولِ حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطاتٌ (3-64) بلا فراغاتٍ.";
  if (code === "LOGIN_NAME_TAKEN") return "اسمُ الدخولِ محجوزٌ لمسؤولٍ آخر — اختر اسمًا آخر.";
  if (code === "TOTP_KEY_NOT_CONFIGURED")
    return "مفتاحُ تشفيرِ المصادقةِ غيرُ مضبوطٍ في البيئةِ (ADMIN_BREAK_GLASS_TOTP_KEY) — راجع صاحبَ النظام.";
  if (code === "EMPTY_CREDENTIAL") return "كلمةُ السرِّ والسرُّ لا يكونانِ فارغَينِ.";
  return `تعذّر إتمامُ التسجيلِ (${code}). راجع السجلَّ ثم أعد المحاولة.`;
}

function cityParam(value: string | undefined): string | null {
  return value === undefined || value === "" || value === "all" ? null : value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * بوليانٌ من نموذج، وما لا يُفهم يُردّ لا يُحمَل على false.
 *
 * العطب الذي أوجب هذه الدالّة: كان المسار يكتب `formText(form,"blocked") === "1"`
 * بينما صفحة السائقين تُرسل "true"/"false" — فزرّ «حظر» في اللوحة لم يكن يحظر
 * أحداً قطّ: يُنادي الدالّة الذرّية بـ false فتُجيب ok وتُكتب في سجلّ التدقيق، وتُعاد
 * الصفحة بلا رسالة خطأ، ويبقى المستخدم غير محظور. واختبار التكامل لم يمسكه لأنه
 * يُرسل "1" مباشرة لا ما يُرسله الزرّ فعلاً.
 *
 * والردّ لا الحمل على false هو أصل الإصلاح: مقارنةٌ صامتة تجعل أي تغيير في قيمة
 * النموذج عطلاً بلا أثر مرئي، والردّ بـ 422 يجعله مرئيّاً في أوّل نقرة.
 */
function formBoolean(form: FormData, key: string): boolean | null {
  const raw = formText(form, key);
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
}

function optionalQuery(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value.trim();
}

function toCityOptions(
  cities: readonly { id: string; code: string; nameAr: string }[],
): readonly CityOption[] {
  return cities.map((city) => ({ id: city.id, code: city.code, nameAr: city.nameAr }));
}

function toCityGroupStatuses(
  cities: readonly {
    id: string;
    code: string;
    nameAr: string;
    isActive: boolean;
    supportGroupId: string | null;
    escalationGroupId: string | null;
    unsubscribedDriversGroupId: string | null;
    unsubscribedGroupLink: string | null;
  }[],
): readonly CityGroupStatus[] {
  return cities.map((city) => ({
    id: city.id,
    code: city.code,
    nameAr: city.nameAr,
    isActive: city.isActive,
    supportGroupId: city.supportGroupId,
    escalationGroupId: city.escalationGroupId,
    unsubscribedDriversGroupId: city.unsubscribedDriversGroupId,
    unsubscribedGroupLink: city.unsubscribedGroupLink,
  }));
}

/**
 * فارغٌ يعني «غير مضبوط»؛ وغير ذلك يُفحص كـ bigint لا Number كي لا تضيع دقة
 * معرّفات تيليجرام الكبيرة. الصفر ليس chat_id صالحاً، والسالب مقبول للقروبات.
 */
function groupIdFromForm(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = BigInt(trimmed);
  if (parsed === 0n || parsed < MIN_BIGINT || parsed > MAX_BIGINT) return null;
  return parsed.toString();
}

function groupIdsAreDistinct(values: readonly (string | null)[]): boolean {
  const present = values.filter((value): value is string => value !== null);
  return new Set(present).size === present.length;
}

/**
 * كل صفحة تُعيد جسمها فقط، والهيكل يُلبس هنا مرّة واحدة: عنوان الصفحة، والتنقّل،
 * ومن الداخل، ورمز CSRF — فلا تتفرّق ثماني نسخ من الترويسة تختلف يوماً.
 */
function page(
  c: Context<AdminEnv>,
  title: string,
  activePath: string,
  body: string,
  refreshSeconds?: number,
  notice?: { readonly kind: "ok" | "error"; readonly text: string },
): Response {
  const admin = c.get("admin");
  const user: AdminUser = {
    userId: admin.userId,
    cityId: admin.cityId,
    telegramId: admin.telegramId,
    fullName: admin.fullName,
  };
  return c.html(
    renderShell({
      title,
      activePath,
      user,
      csrfToken: c.get("csrfToken"),
      cspNonce: c.get("cspNonce"),
      body,
      ...(refreshSeconds === undefined ? {} : { refreshSeconds }),
      ...(notice === undefined ? {} : { notice }),
    }),
  );
}

/**
 * دورية تحديث الصفحات التشغيلية. الطلبات الحية أسرع لأنها الشاشة التي يُتابَع
 * عليها ما يجري الآن — وهي التي رُئي فيها طلب ملغى معروضاً كأنه يبحث عن سائق.
 */
const LIVE_REFRESH_SECONDS = 20;
const OVERVIEW_REFRESH_SECONDS = 60;

const VERIFICATION_VALUES = new Set(["pending", "verified", "rejected", "suspended"]);
const TICKET_STATUS_VALUES = new Set(["open", "claimed", "resolved", "rejected"]);
const DIRECTION_VALUES = new Set(["rider_to_driver", "driver_to_rider"]);

function oneOf(value: string | undefined, allowed: ReadonlySet<string>): string | null {
  return value !== undefined && allowed.has(value) ? value : null;
}

/**
 * حقلُ اختيارٍ غائبٌ يعني «الافتراضيّ» لا «قيمةٌ فاسدة»: الصفحةُ المعروضة تُرسل كلَّ
 * قوائمها دائماً، لكنّ ردَّ نموذجٍ كاملٍ بـ`INVALID_BROADCAST_FORM` لمجرّد أنّ
 * حقلاً اختيارياً لم يُرسَل يُحوّل غيابَ تضييقٍ إلى فشلٍ صامتٍ بلا سبب مقروء. أمّا
 * القيمةُ المكتوبةُ غيرُ المعروفة فتُردّ كما كانت — تلك محاولةُ تمريرِ ما لا يُعرَف.
 */
function oneOfOrDefault(
  value: string | null,
  allowed: ReadonlySet<string>,
  fallback: string,
): string | null {
  if (value === null || value.trim() === "") return fallback;
  return allowed.has(value) ? value : null;
}

const BROADCAST_AUDIENCES = new Set(["drivers", "riders"]);
const BROADCAST_AVAILABILITY = new Set(["any", "available", "unavailable"]);
const BROADCAST_ACTIVITY = new Set(["any", "ordered_recently", "never_ordered"]);
const BROADCAST_LANGUAGES = new Set(["ar", "en", "ur"]);
const BROADCAST_VERIFICATION = VERIFICATION_VALUES;
const BROADCAST_SUBSCRIPTION = new Set(["none", "trialing", "active"]);

/**
 * إزاحةُ وقتِ العرض ثابتةٌ: المملكة بلا توقيتٍ صيفيّ، فـ`+03:00` صحيحةٌ طولَ السنة.
 * وقراءةُ `datetime-local` بـ`new Date()` وحدَها كانت ستُفسَّر بتوقيتِ الخادم — أي
 * UTC في الإنتاج — فيتأخّر بثٌّ جُدوِل للعاشرة صباحاً ثلاثَ ساعات بلا أن يشتكي أحد.
 */
function broadcastSendAfter(raw: string | null): { ok: true; value: Date | null } | { ok: false } {
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  const trimmed = raw.trim();
  // متصفّحاتٌ تُرسل دقائقَ فقط وأخرى تلحق الثواني: تُقبَل الصيغتان وما سواهما يُردّ.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return { ok: false };
  const parsed = new Date(`${normalized}+03:00`);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, value: parsed };
}

/** قيمُ صناديق الاختيار المسموحة فقط: ما لا يُعرَف يُطرح لا يُمرَّر إلى القاعدة. */
function broadcastChoices(form: FormData, key: string, allowed: ReadonlySet<string>): string[] {
  return form
    .getAll(key)
    .filter((value): value is string => typeof value === "string" && allowed.has(value));
}

/**
 * المرشّحات تُبنى بحسب الجمهور: مرشّحُ توثيقٍ في بثٍّ للركّاب ليس تضييقاً بل تشويشٌ
 * في سجلّ التدقيق، ومن يراجع بعد شهر يقرأ شرطاً لم يُطبَّق قطّ.
 */
function broadcastFiltersOf(state: BroadcastFormState): BroadcastFilters {
  const filters: {
    languages?: readonly string[];
    verification?: readonly string[];
    subscription?: readonly string[];
    availability?: "any" | "available" | "unavailable";
    activity?: "any" | "ordered_recently" | "never_ordered";
  } = {};
  if (state.languages.length > 0) filters.languages = state.languages;
  if (state.audience === "drivers") {
    if (state.verification.length > 0) filters.verification = state.verification;
    if (state.subscription.length > 0) filters.subscription = state.subscription;
    if (state.availability === "available" || state.availability === "unavailable") {
      filters.availability = state.availability;
    }
  } else if (state.activity === "ordered_recently" || state.activity === "never_ordered") {
    filters.activity = state.activity;
  }
  return filters;
}

const EMPTY_BROADCAST_FORM: BroadcastFormState = {
  audience: "drivers",
  cityId: null,
  languages: [],
  verification: [],
  subscription: [],
  availability: "any",
  activity: "any",
  body: "",
  linkLabel: "",
  linkUrl: "",
  silent: false,
  sendAfter: "",
};

/** رسائلُ رفضِ القاعدة بالعربية: رمزٌ لاتينيٌّ في شاشةِ مشغّلٍ لا يُقرأ فعلاً. */
const BROADCAST_ERRORS: Readonly<Record<string, string>> = {
  NOT_ADMIN: "هذا الحساب ليس مسؤولاً، أو محظور.",
  EMPTY_AUDIENCE: "لا مستقبِل واحد يطابق هذه المرشّحات — لم تُنشأ حملة.",
  EMPTY_BODY: "نصّ الرسالة مطلوب.",
  BODY_TOO_LONG: "نصّ الرسالة أطول من الحدّ المسموح.",
  // الأسماء هنا هي حرفياً ما تُرجعه دوالّ القاعدة. اختلافُ حرفٍ يُنتج رسالةً
  // عامّةً بشفرةٍ إنجليزية في وجه المسؤول بدل سببٍ يفهمه ويُصلحه.
  INCOMPLETE_LINK: "الزرّ يحتاج نصّاً ورابطاً معاً، أو لا شيء منهما.",
  INVALID_LINK_URL: "رابط الزرّ يجب أن يبدأ بـ https.",
  INVALID_AUDIENCE: "الجمهور غير معروف.",
  CITY_NOT_FOUND: "المدينة غير موجودة.",
  BATCH_NOT_FOUND: "لا حملة بهذا المعرّف.",
  BROADCAST_BATCH_SETTING_MISSING: "إعداد حجم دفعة البثّ غير مضبوط لهذه المدينة.",
  BROADCAST_ATTEMPTS_SETTING_MISSING: "إعداد حدّ محاولات البثّ غير مضبوط لهذه المدينة.",
};

function broadcastError(code: string): string {
  return BROADCAST_ERRORS[code] ?? `تعذّر إتمام الطلب (${code}).`;
}

export function createAdminUiRoutes(deps: AdminUiDependencies): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const log = deps.log ?? ((): void => undefined);
  const broadcast = deps.broadcast ?? createBroadcastAdminPort(deps.sql);
  const breakGlass =
    deps.breakGlass ??
    createAdminBreakGlassPort(deps.sql, {
      totpKey: deps.breakGlassTotpKey ?? null,
      issuer: "WASLA",
    });

  // قبل كل مسار، ومنها /login: الدخول هو الصفحة التي تُرسَل فيها كلمةُ المرور
  // الوقتية، فإخراجُها من السياسة كان سيترك أضعفَ صفحةٍ بلا حماية.
  app.use("*", createAdminSecurityHeaders({ mapOrigins: deps.mapOrigins ?? [] }));

  // -------------------------------------------------------------------------
  // الدخول — خارج الحارس، وإلا استحال الدخول أصلاً
  // -------------------------------------------------------------------------

  app.get("/login", (c) => {
    // بابُ النجاةِ (`SEC-21`): وصلٌ صريحٌ لا رابطٌ مُكتومٌ — من لا يعرفُ أنَّ
    // للبابِ وجودًا لا يُقايضُ صبرَهُ على تجريبِه، ومن يعرفُهُ يصلُهُ بأقصرِ طريقٌ.
    if (c.req.query("break") === "1") {
      return c.html(renderLoginPage({ cspNonce: c.get("cspNonce"), step: "break-glass" }));
    }
    const notice = c.req.query("sent") === "1" ? "أُرسِل الرمز إلى محادثتك مع بوت السائق." : null;
    return c.html(
      renderLoginPage({
        cspNonce: c.get("cspNonce"),
        step: notice === null ? "identify" : "verify",
        ...(notice === null ? {} : { notice }),
        ...(c.req.query("tg") === undefined ? {} : { telegramId: String(c.req.query("tg")) }),
      }),
    );
  });

  app.post("/login/code", async (c) => {
    const form = await c.req.formData();
    const telegramId = formText(form, "telegram_id");

    if (telegramId === null || !TELEGRAM_ID_PATTERN.test(telegramId)) {
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "identify",
          error: "معرّف تلغرام يُكتب أرقاماً فقط.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    const code = generateLoginCode();
    const issued = await deps.auth.issueCode(telegramId, sha256Hex(code));

    const issueOutcome = classifyAuth(issued);
    if (issueOutcome.kind !== "ok") {
      // سطران مختلفان لا سطر واحد: عطل القاعدة يستدعي مشغّلاً، ورفض الأعمال لا.
      if (issueOutcome.kind === "db") {
        log("admin.login_code_issue_db_error", { detail: issueOutcome.reason });
      } else {
        log("admin.login_code_issue_rejected", { reason: issueOutcome.reason });
      }
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "identify",
          telegramId,
          error: GENERIC_LOGIN_ERROR,
        }),
        HTML_UNPROCESSABLE,
      );
    }

    // الرمز أُصدِر في القاعدة قبل إرساله: لو فشل التسليم يبقى الحساب سليماً وتُعاد المحاولة
    const delivered = await deps.codeSender.send(
      issueOutcome.value.telegramId,
      loginCodeMessage(code),
    );
    if (!delivered) {
      // مميَّز عمداً عن عطل القاعدة: الرمز صدر بنجاح، والعطل في التسليم وحده.
      log("admin.login_code_delivery_failed", { stage: "telegram_delivery" });
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "identify",
          telegramId,
          error: "تعذّر تسليم الرمز على تلغرام. ابدأ محادثة مع بوت السائق ثم أعِد المحاولة.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    return c.redirect(`/admin/login?sent=1&tg=${encodeURIComponent(telegramId)}`, SEE_OTHER);
  });

  app.post("/login/verify", async (c) => {
    const form = await c.req.formData();
    const telegramId = formText(form, "telegram_id");
    const code = formText(form, "code");

    if (telegramId === null || code === null || !CODE_PATTERN.test(code)) {
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "verify",
          ...(telegramId === null ? {} : { telegramId }),
          error: "الرمز ستّ خانات رقمية.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    const consumed = await deps.auth.consumeCode(telegramId, sha256Hex(code));
    const consumeOutcome = classifyAuth(consumed);
    if (consumeOutcome.kind !== "ok") {
      if (consumeOutcome.kind === "db") {
        log("admin.login_code_consume_db_error", {
          detail: consumeOutcome.reason,
        });
      } else {
        log("admin.login_code_consume_rejected", { reason: consumeOutcome.reason });
      }
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "verify",
          telegramId,
          error: "رمز غير صحيح أو منتهٍ. اطلب رمزاً جديداً.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    const token = generateSessionToken();
    const opened = await deps.auth.openSession(
      consumeOutcome.value.userId,
      sha256Hex(token),
      c.req.header("user-agent") ?? null,
    );
    const openOutcome = classifyAuth(opened);
    if (openOutcome.kind !== "ok") {
      if (openOutcome.kind === "db") {
        log("admin.session_open_db_error", { detail: openOutcome.reason });
      } else {
        log("admin.session_open_rejected", { reason: openOutcome.reason });
      }
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "verify",
          telegramId,
          error: GENERIC_LOGIN_ERROR,
        }),
        HTML_UNPROCESSABLE,
      );
    }

    writeSessionCookie(c, token);
    return c.redirect("/admin", SEE_OTHER);
  });

  // بابُ النجاةِ (`SEC-21` · ADR 0176): دخولُ المسؤولِ بديلًا عن تلغرام وقتَ
  // عطبِه. الردُّ على كلِّ فشلٍ واحدٌ ونصُّهُ واحدٌ (رفضٌ عامٌّ موحَّدٌ) — لا
  // فرقَ في الردِّ بينَ اسمٍ مجهولٍ وكلمةِ سرٍّ خاطئةٍ ورمزٍ مُستهلَكٍ.
  app.post("/login/break-glass", async (c) => {
    // الحدُّ قبلَ قراءةِ الجسمِ وقبلَ scrypt (`SEC-21`): الاسمُ المجهولُ لا صفَّ
    // لهُ في القاعدةِ فلا يلمسُهُ إقفالُها — فبلا هذا العدّادِ يبقى همْرُهُ بلا
    // حصرٍ. والنداءُ يقرأُ العنوانَ المُنتحَلَ من الوسيطِ بوصفِهِ مفتاحَ عدٍّ لا
    // هويّةً (`ADR 0139`). والغيابُ تدهورٌ مُعلَنٌ في السِجلِّ لا صمتٌ.
    const exceeded = rateLimitRejection(
      c,
      await deps.limits?.breakGlassLoginPerAddress.hit(
        `admin-break-glass:${clientAddress(c.req.header("x-forwarded-for"))}`,
      ),
    );
    if (exceeded !== null) return exceeded;

    const form = await c.req.formData();
    const loginName = formText(form, "login_name");
    const password = formText(form, "password");
    const totpCode = formText(form, "totp_code");

    const invalid =
      loginName === null || password === null || totpCode === null || !CODE_PATTERN.test(totpCode);
    if (invalid) {
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "break-glass",
          error: "الاسمُ وكلمةُ السرِّ ورمزُ المصادقةِ (ستُّ خاناتٍ) كلُّها مطلوبة.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    const token = generateSessionToken();
    const result = await breakGlass.login(
      loginName,
      password,
      totpCode,
      sha256Hex(token),
      c.req.header("user-agent") ?? null,
    );
    let loginFailed: { port: string | null; reason: string | null } | null = null;
    if (!result.ok) {
      loginFailed = { port: String(result.error), reason: null };
    } else if (!result.value.ok) {
      loginFailed = { port: null, reason: result.value.error };
    }
    if (loginFailed !== null) {
      if (loginFailed.port !== null) {
        log("admin.break_glass_login_port_failure", { detail: loginFailed.port });
      } else if (loginFailed.reason === BREAK_GLASS_INVALID_CREDENTIALS) {
        // رفضٌ مقصودٌ بلا تفصيلٍ في الردِّ العامِّ؛ السجلُّ المهيكلُ هو موضعُ
        // التشخيصِ لا صفحةُ الدخولِ.
        log("admin.break_glass_login_rejected", {});
      } else {
        log("admin.break_glass_login_db_error", { reason: loginFailed.reason ?? "UNKNOWN" });
      }
      return c.html(
        renderLoginPage({
          cspNonce: c.get("cspNonce"),
          step: "break-glass",
          error: "اعتمادٌ غيرُ صحيحٍ أو مقفلٌ. أعدِ المحاولةَ بعدَ ربعِ ساعةٍ إن استمرَّ.",
        }),
        HTML_UNPROCESSABLE,
      );
    }

    writeSessionCookie(c, token);
    return c.redirect("/admin", SEE_OTHER);
  });

  // -------------------------------------------------------------------------
  // كل ما بعد هذا السطر يمرّ بالحارس
  // -------------------------------------------------------------------------

  app.use("*", createAdminGuard(deps.auth, "page", log));

  app.post("/logout", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;
    const token = readSessionToken(c);
    if (token !== null) await deps.auth.closeSession(sha256Hex(token));
    clearSessionCookie(c);
    return c.redirect("/admin/login", SEE_OTHER);
  });

  // -------------------------------------------------------------------------
  // البابُ الموازي (`SEC-21` · ADR 0176): تسجيلُ الاعتمادِ وتدويرُهُ وتعطيلُهُ
  // — من داخلِ جلسةِ مسؤولٍ فتحَها رمزُ القناةِ الأولى (تيليجرام) فحسبُ؛
  // الجلسةُ المفتوحةُ منَ البابِ نفسِهِ لا تُنشئُ بابًا موازيًا (يُرفضُ في
  // الدالّةِ الذرّيّةِ بشرطِ `origin = 'telegram_code'` لا في الواجهةِ وحدَها).
  // -------------------------------------------------------------------------

  app.get("/break-glass", async (c) => {
    const credential = await adminBreakGlassCredential(deps.sql, c.get("admin").userId);
    return c.html(
      renderShell({
        title: "بابُ النجاة",
        activePath: "/admin/break-glass",
        user: c.get("admin"),
        csrfToken: c.get("csrfToken"),
        cspNonce: c.get("cspNonce"),
        body: renderBreakGlassPage({
          csrfToken: c.get("csrfToken"),
          hasActiveCredential: credential?.isActive === true,
          loginName: credential?.loginName ?? null,
          ...(c.req.query("registered") === "1"
            ? { notice: "سُجِّلَ الاعتمادُ. اضبط تطبيقَ المصادقةِ من الرابطِ أعلاهُ قبلَ مغادرةِ الصفحةِ." }
            : {}),
        }),
      }),
    );
  });

  app.post("/break-glass", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;
    const form = await c.req.formData();
    const loginName = formText(form, "login_name");
    const password = formText(form, "password");

    if (
      loginName === null ||
      password === null ||
      !/^[a-z0-9_-]{3,64}$/.test(loginName) ||
      password.length < 12 ||
      password.length > 200
    ) {
      return c.html(
        renderShell({
          title: "بابُ النجاة",
          activePath: "/admin/break-glass",
          user: c.get("admin"),
          csrfToken: c.get("csrfToken"),
          cspNonce: c.get("cspNonce"),
          body: renderBreakGlassPage({
            csrfToken: c.get("csrfToken"),
            hasActiveCredential: false,
            loginName: null,
            error: "اسمُ الدخولِ حروفٌ لاتينيّةٌ صغيرةٌ وأرقامٌ وشرطاتٌ (3-64)، وكلمةُ السرِّ 12 محرفًا فأكثر.",
          }),
        }),
        HTML_UNPROCESSABLE,
      );
    }

    const token = readSessionToken(c);
    if (token === null) return c.redirect("/admin/login", SEE_OTHER);
    const result = await breakGlass.enroll(sha256Hex(token), loginName, password);

    const credential = await adminBreakGlassCredential(deps.sql, c.get("admin").userId);
    const enrollFailure = !result.ok
      ? { port: String(result.error) }
      : !result.value.ok
        ? { reason: result.value.error }
        : null;
    const pageError =
      enrollFailure === null
        ? undefined
        : "port" in enrollFailure
          ? `تعذّر إتمامُ التسجيلِ (${enrollFailure.port}). راجع السجلَّ ثم أعد المحاولة.`
          : enrollmentErrorText(enrollFailure.reason);

    if (pageError !== undefined) {
      log("admin.break_glass_enroll_failed", {
        reason:
          enrollFailure === null
            ? "UNKNOWN"
            : "port" in enrollFailure
              ? "PORT_FAILURE"
              : enrollFailure.reason,
      });
      return c.html(
        renderShell({
          title: "بابُ النجاة",
          activePath: "/admin/break-glass",
          user: c.get("admin"),
          csrfToken: c.get("csrfToken"),
          cspNonce: c.get("cspNonce"),
          body: renderBreakGlassPage({
            csrfToken: c.get("csrfToken"),
            hasActiveCredential: credential?.isActive === true,
            loginName: credential?.loginName ?? null,
            error: pageError,
          }),
        }),
        HTML_UNPROCESSABLE,
      );
    }

    // النجاحُ: الرابطُ يُعرضُ في الصفحةِ نفسِها (مرّةً واحدةً) لا في ترويسةِ
    // تحويلٍ تُبتلَعُ ولا في معاملِ رابطٍ يبقى في سجلِّ المتصفحِ.
    return c.html(
      renderShell({
        title: "بابُ النجاة",
        activePath: "/admin/break-glass",
        user: c.get("admin"),
        csrfToken: c.get("csrfToken"),
        cspNonce: c.get("cspNonce"),
        body: renderBreakGlassPage({
          csrfToken: c.get("csrfToken"),
          hasActiveCredential: true,
          loginName,
          ...(result.ok && result.value.ok ? { otpauthUri: result.value.value.otpauthUri } : {}),
          notice:
            "سُجِّلَ الاعتمادُ. اضبط تطبيقَ المصادقةِ من الرابطِ أدناهُ قبلَ مغادرةِ الصفحةِ — لن يُعرضَ مرةً أخرى.",
        }),
      }),
    );
  });

  app.post("/break-glass/disable", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;
    const token = readSessionToken(c);
    if (token === null) return c.redirect("/admin/login", SEE_OTHER);
    const result = await breakGlass.disable(sha256Hex(token));
    const disableFailure = !result.ok
      ? "PORT_FAILURE"
      : !result.value.ok
        ? result.value.error
        : null;
    if (disableFailure !== null) {
      log("admin.break_glass_disable_failed", { reason: disableFailure });
    }
    return c.redirect("/admin/break-glass", SEE_OTHER);
  });

  app.get("/", async (c) => {
    const stall = await stallSeconds(deps.sql, null);
    /**
     * لحظةُ الملاحظةِ **واحدةٌ للصفحةِ كلِّها** (`F7-08`): لو قُرئتِ الساعةُ في
     * موضِعَينِ لظهرَ عُمرٌ في الشريطِ وعُمرٌ آخرُ في الترويسةِ على شاشةٍ واحدةٍ.
     */
    const observedAt = new Date();
    const [reading, audit, signals] = await Promise.all([
      adminOverviewReading(deps.sql, DAY_WINDOW_HOURS, observedAt),
      recentAudit(deps.sql, AUDIT_PREVIEW_LIMIT),
      healthSignals(deps.sql, stall),
    ]);

    return page(
      c,
      "نظرة عامة",
      "/admin",
      renderOverviewPage({
        now: observedAt,
        counters: reading.counters,
        cities: reading.cities,
        recentAudit: audit,
        health: healthIndicators(signals),
        windowHours: DAY_WINDOW_HOURS,
        stamp: reading.stamp,
      }),
      OVERVIEW_REFRESH_SECONDS,
    );
  });

  app.get("/live-orders", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const [cities, rows, stall] = await Promise.all([
      listCities(deps.sql),
      listLiveOrders(deps.sql, cityId),
      stallSeconds(deps.sql, cityId),
    ]);
    return page(
      c,
      "الطلبات الحية",
      "/admin/live-orders",
      renderLiveOrdersPage({
        now: new Date(),
        rows,
        cities: toCityOptions(cities),
        cityId,
        stallSeconds: stall,
      }),
      LIVE_REFRESH_SECONDS,
    );
  });

  /**
   * خريطةُ العمليات. تُقرأ الحالاتُ من `listLiveDriverStatuses` وهو موضعُ الاشتقاق
   * الواحد الذي تقرأ منه لقطةُ SSE أيضاً — فلا تختلف الصفحةُ عن المجرى الحيّ.
   *
   * ولوحُ الخريطة يُصيَّر هنا لا في الصفحة: الـ`nonce` ورابطُ النصّ والبصمةُ كلُّها
   * من شأن البوابة، وقراءةُ الضبط من داخل صفحةِ عرضٍ كانت ستكسر حدَّ الطبقات
   * وتصنع مصدرَ حقيقةٍ ثانياً لنمط الخريطة.
   */
  app.get("/live-map", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const now = new Date();
    const [cities, rows] = await Promise.all([
      listCities(deps.sql),
      listLiveDriverStatuses(deps.sql, cityId, now.getTime()),
    ]);
    const style: ResolvedMapStyle = deps.mapStyle ?? {
      configured: false,
      reason: "لم يُضبَط مزوّدُ خريطة (MAP_PROVIDER)؛ الجدولُ أعلاه يعرض نفسَ البيانات.",
    };
    const mapPanel = renderMapPanel({
      title: "مواقع الأسطول",
      style,
      model: fleetViewModel(rows),
      nonce: c.get("cspNonce"),
      scriptUrl: maplibreScriptUrl(),
      stylesheetUrl: maplibreStylesheetUrl(),
      integrity: deps.maplibreSri ?? MAPLIBRE_SRI_UNSET,
    });
    return page(
      c,
      "خريطة العمليات",
      "/admin/live-map",
      renderLiveMapPage({
        now,
        rows,
        cities: toCityOptions(cities),
        cityId,
        mapPanel,
        staleAfterSeconds: DEFAULT_SESSION_POLICY.staleAfterSeconds,
        cspNonce: c.get("cspNonce"),
        sseUrl:
          cityId === null ? "/admin/api/live/drivers" : `/admin/api/live/drivers?city=${cityId}`,
      }),
    );
  });

  app.get("/drivers", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const verification = oneOf(c.req.query("verification"), VERIFICATION_VALUES);
    const query = optionalQuery(c.req.query("q"));
    const [cities, drivers] = await Promise.all([
      listCities(deps.sql),
      listDrivers(deps.sql, { cityId, verification, search: query, limit: DRIVERS_LIMIT }),
    ]);
    return page(
      c,
      "السائقون",
      "/admin/drivers",
      renderDriversPage({
        rows: drivers.rows,
        total: drivers.total,
        limit: DRIVERS_LIMIT,
        cities: toCityOptions(cities),
        filters: { cityId, verification, query },
        csrfToken: c.get("csrfToken"),
      }),
    );
  });

  /**
   * مسار التفاصيل بعد مسار القائمة وليس قبله: `/drivers` حرفيٌ و`/drivers/:id`
   * متغير، وفحص صيغة UUID قبل مسّ القاعدة يمنع خطأ 22P02 من أن يصير 500 تقرأه
   * المشغّلة كعطل في اللوحة لا كرابط مكسور.
   */
  app.get("/drivers/:id", async (c) => {
    const driverId = c.req.param("id");
    if (!UUID_PATTERN.test(driverId)) {
      return c.text("معرّف سائق غير صالح.", HTML_UNPROCESSABLE);
    }

    const detail = await driverDetail(deps.sql, driverId);
    if (detail === null) {
      return c.text("لا سائق بهذا المعرّف.", NOT_FOUND);
    }

    return page(
      c,
      detail.profile.fullName ?? "سائق",
      "/admin/drivers",
      renderDriverDetailPage({
        now: new Date(),
        profile: detail.profile,
        orders: detail.orders,
        tickets: detail.tickets,
        ticketsLimit: DRIVER_TICKETS_LIMIT,
        csrfToken: c.get("csrfToken"),
      }),
    );
  });

  app.get("/attendance", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const windowHours = positiveInt(c.req.query("hours"), DAY_WINDOW_HOURS);
    const query = optionalQuery(c.req.query("q"));
    const [cities, events, summary] = await Promise.all([
      listCities(deps.sql),
      listAttendanceEvents(deps.sql, cityId, windowHours, query, EVENTS_LIMIT),
      attendanceSummary(deps.sql, cityId, windowHours, query),
    ]);
    return page(
      c,
      "الحضور",
      "/admin/attendance",
      renderAttendancePage({
        events,
        summary,
        cities: toCityOptions(cities),
        cityId,
        windowHours,
        availableWindows: ATTENDANCE_WINDOWS,
        query,
        eventLimit: EVENTS_LIMIT,
      }),
    );
  });

  app.get("/ratings", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const direction = oneOf(c.req.query("direction"), DIRECTION_VALUES);
    const onlyLow = c.req.query("low") === "1";
    const lowThreshold = await numericSetting(
      deps.sql,
      "admin_low_rating_threshold",
      cityId,
      LOW_RATING_FALLBACK,
    );
    const [cities, rows, totals] = await Promise.all([
      listCities(deps.sql),
      listRatings(deps.sql, { cityId, direction, onlyLow, lowThreshold, limit: RATINGS_LIMIT }),
      ratingsTotals(deps.sql, cityId, lowThreshold),
    ]);
    return page(
      c,
      "التقييمات",
      "/admin/ratings",
      renderRatingsPage({
        rows,
        summary: { ...totals, lowThreshold },
        cities: toCityOptions(cities),
        cityId,
        direction,
        onlyLow,
        limit: RATINGS_LIMIT,
      }),
    );
  });

  app.get("/disputes", async (c) => {
    const cityId = cityParam(c.req.query("city"));
    const status = oneOf(c.req.query("status"), TICKET_STATUS_VALUES);
    const [cities, rows, totals] = await Promise.all([
      listCities(deps.sql),
      listDisputes(deps.sql, cityId, status, DISPUTES_LIMIT),
      disputeTotals(deps.sql, cityId, DAY_WINDOW_HOURS),
    ]);
    return page(
      c,
      "النزاعات",
      "/admin/disputes",
      renderDisputesPage({
        now: new Date(),
        rows,
        cities: toCityOptions(cities),
        cityId,
        status,
        openCount: totals.open,
        claimedCount: totals.claimed,
        resolvedDayCount: totals.resolvedInWindow,
        windowHours: DAY_WINDOW_HOURS,
        limit: DISPUTES_LIMIT,
      }),
    );
  });

  app.get("/heatmap", async (c) => {
    const cities = await listCities(deps.sql);
    const requested = cityParam(c.req.query("city"));
    // خريطة بلا مدينة لا معنى لها: خلايا مدن متباعدة على شبكة واحدة تعني شبكة فارغة
    const cityId = requested ?? cities[0]?.id ?? null;
    const windowHours = positiveInt(c.req.query("hours"), DEFAULT_HEATMAP_HOURS);
    const options = toCityOptions(cities);
    const cityName = options.find((city) => city.id === cityId)?.nameAr ?? null;

    if (cityId === null) {
      return page(
        c,
        "خريطة الطلب والعرض",
        "/admin/heatmap",
        renderHeatmapPage({
          cells: [],
          rows: 0,
          cols: 0,
          cities: options,
          cityId: null,
          cityName: null,
          windowHours,
          availableWindows: HEATMAP_WINDOWS,
          totalDemand: 0,
          totalSupply: 0,
          cellDegrees: HEATMAP_CELL_FALLBACK_DEGREES,
        }),
      );
    }

    const cellDegrees = await numericSetting(
      deps.sql,
      "admin_heatmap_cell_degrees",
      cityId,
      HEATMAP_CELL_FALLBACK_DEGREES,
    );
    const grid = await heatmap(deps.sql, cityId, windowHours, cellDegrees);

    return page(
      c,
      "خريطة الطلب والعرض",
      "/admin/heatmap",
      renderHeatmapPage({
        ...grid,
        cities: options,
        cityId,
        cityName,
        windowHours,
        availableWindows: HEATMAP_WINDOWS,
        cellDegrees,
      }),
    );
  });

  app.get("/settings", async (c) => {
    const cities = await listCities(deps.sql);
    const requested = cityParam(c.req.query("city"));
    const cityId = requested ?? c.get("admin").cityId;
    const options = toCityGroupStatuses(cities);
    const cityName = options.find((city) => city.id === cityId)?.nameAr ?? "—";
    const rows = await listSettings(deps.sql, cityId);

    return page(
      c,
      "الإعدادات",
      "/admin/settings",
      renderSettingsPage({
        cities: options,
        cityId,
        cityName,
        rows,
        csrfToken: c.get("csrfToken"),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // المدفوعات — عرض معاملات الدفع وحالة الاشتراك (البند 8)
  // -------------------------------------------------------------------------
  app.get("/payments", async (c) => {
    const cities = await listCities(deps.sql);
    const requested = cityParam(c.req.query("city"));
    const cityId = requested ?? c.get("admin").cityId;
    const options = toCityGroupStatuses(cities);
    const cityName = options.find((city) => city.id === cityId)?.nameAr ?? "—";
    const rows = await deps.sql`
      select pt.id, d.user_id as driver_id, c.name_ar as city_name,
             pt.purpose, pt.amount_minor, pt.currency, pt.provider,
             pt.provider_transaction_id, pt.status, pt.created_at
        from payment_transactions pt
        join drivers d on d.id = pt.payer_driver_id
        join cities c on c.id = pt.city_id
       where pt.city_id = ${cityId}::uuid
       order by pt.created_at desc
       limit 50
    `;

    return page(
      c,
      "المدفوعات",
      "/admin/payments",
      renderPaymentsPage({
        cityOptions: options.map((city) => ({ id: city.id, code: city.code, nameAr: city.nameAr })),
        cityId,
        cityName,
        transactions: rows.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          driverName: String(r.driver_id ?? "—"),
          cityName: String(r.city_name ?? "—"),
          purpose: String(r.purpose),
          amountMinor: Number(r.amount_minor),
          currency: String(r.currency),
          provider: String(r.provider),
          providerTransactionId:
            r.provider_transaction_id === null ? null : String(r.provider_transaction_id),
          status: String(r.status),
          createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
        })),
        providerName: process.env.PAYMENT_PROVIDER ?? null,
        environment: process.env.PAYMENT_ENVIRONMENT ?? null,
        driverSubscriptionEnabled: process.env.ENABLE_DRIVER_SUBSCRIPTION === "true",
      }),
    );
  });

  // -------------------------------------------------------------------------
  // البثّ الجماعي — رسالةٌ واحدة إلى جمهورٍ مُرشّح، بمعاينةٍ قبل الإرسال
  // -------------------------------------------------------------------------

  /** تقرأ النموذج وتُعيد حالتَه مُدقّقةً، أو `null` إن حمل قيمةً لا تُعرَف. */
  const readBroadcastForm = (form: FormData): BroadcastFormState | null => {
    const audience = oneOf(formText(form, "audience") ?? undefined, BROADCAST_AUDIENCES);
    if (audience === null) return null;
    const availability = oneOfOrDefault(
      formText(form, "availability"),
      BROADCAST_AVAILABILITY,
      "any",
    );
    const activity = oneOfOrDefault(formText(form, "activity"), BROADCAST_ACTIVITY, "any");
    if (availability === null || activity === null) return null;
    const rawCity = formText(form, "city");
    if (rawCity !== null && rawCity !== "all" && !UUID_PATTERN.test(rawCity)) return null;
    return {
      audience: audience as BroadcastAudienceChoice,
      cityId: rawCity === null || rawCity === "all" ? null : rawCity,
      languages: broadcastChoices(form, "languages", BROADCAST_LANGUAGES),
      verification: broadcastChoices(form, "verification", BROADCAST_VERIFICATION),
      subscription: broadcastChoices(form, "subscription", BROADCAST_SUBSCRIPTION),
      availability,
      activity,
      body: formText(form, "body") ?? "",
      linkLabel: formText(form, "link_label") ?? "",
      linkUrl: formText(form, "link_url") ?? "",
      silent: formText(form, "silent") !== null,
      sendAfter: formText(form, "send_after") ?? "",
    };
  };

  const broadcastPage = async (
    c: Context<AdminEnv>,
    form: BroadcastFormState,
    preview: BroadcastPreview | null,
    notice?: { readonly kind: "ok" | "error"; readonly text: string },
    status?: 422,
  ): Promise<Response> => {
    const cities = await listCities(deps.sql);
    const campaigns = await listBroadcastCampaigns(deps.sql);
    const body = renderBroadcastPage({
      cities: toCityOptions(cities),
      form,
      preview,
      campaigns,
      bodyLimit: BROADCAST_BODY_LIMIT,
      csrfToken: c.get("csrfToken"),
      cspNonce: c.get("cspNonce"),
    });
    const response = page(c, "البثّ الجماعي", "/admin/broadcast", body, undefined, notice);
    // الرفضُ يُعاد بالصفحة نفسها ورمزِ 422 معاً: المسؤول يرى سببَ الرفض وما
    // كتبه لم يضع، والمُختبِر يرى أنّ الطلب رُفِض فعلاً لا أنّه مرّ بصمت.
    return status === undefined
      ? response
      : new Response(response.body, { status, headers: response.headers });
  };

  app.get("/broadcast", async (c) => {
    // حصيلةُ الفعل الأخير تعود في الرابط لا في الجلسة: إعادةُ التوجيه تمنع البثّ
    // المكرّر، لكنّها كانت ستترك المسؤول بلا دليلٍ على أنّ شيئاً حدث أصلاً.
    const sent = positiveInt(c.req.query("sent"), 0);
    const canceled = positiveInt(c.req.query("canceled"), 0);
    const notice =
      c.req.query("sent") !== undefined
        ? { kind: "ok" as const, text: `بدأ البثّ إلى ${sent} مستقبِلاً.` }
        : c.req.query("canceled") !== undefined
          ? { kind: "ok" as const, text: `أُلغي ${canceled} مستقبِلاً لم تُرسل لهم الرسالة بعد.` }
          : undefined;
    return await broadcastPage(c, EMPTY_BROADCAST_FORM, null, notice);
  });

  app.post("/broadcast", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const state = readBroadcastForm(checked.form);
    if (state === null) return c.text("INVALID_BROADCAST_FORM", HTML_UNPROCESSABLE);
    const action = formText(checked.form, "action");
    if (action !== "preview" && action !== "send") {
      return c.text("INVALID_ACTION", HTML_UNPROCESSABLE);
    }
    const schedule = broadcastSendAfter(state.sendAfter === "" ? null : state.sendAfter);
    if (!schedule.ok) {
      return await broadcastPage(
        c,
        state,
        null,
        { kind: "error", text: "وقت الإرسال غير مفهوم." },
        HTML_UNPROCESSABLE,
      );
    }

    const filters = broadcastFiltersOf(state);
    const actorUserId = c.get("admin").userId;

    if (action === "preview") {
      const counted = await broadcast.count({
        actorUserId,
        cityId: state.cityId,
        audience: state.audience,
        filters,
      });
      if (!counted.ok) return c.text("BROADCAST_COUNT_FAILED", HTML_UNPROCESSABLE);
      if ("error" in counted.value) {
        return await broadcastPage(
          c,
          state,
          null,
          { kind: "error", text: broadcastError(counted.value.error) },
          HTML_UNPROCESSABLE,
        );
      }
      const plan = counted.value;
      return await broadcastPage(c, state, {
        total: plan.total,
        cities: plan.cities.map((city) => ({ nameAr: city.nameAr, recipients: city.recipients })),
      });
    }

    const created = await broadcast.create({
      actorUserId,
      cityId: state.cityId,
      audience: state.audience,
      filters,
      body: state.body,
      linkLabel: state.linkLabel.trim() === "" ? null : state.linkLabel.trim(),
      linkUrl: state.linkUrl.trim() === "" ? null : state.linkUrl.trim(),
      silent: state.silent,
      sendAfter: schedule.value,
    });
    if (!created.ok) return c.text("BROADCAST_CREATE_FAILED", HTML_UNPROCESSABLE);
    if ("error" in created.value) {
      log("admin.broadcast_create_rejected", { error: created.value.error });
      return await broadcastPage(
        c,
        state,
        null,
        { kind: "error", text: broadcastError(created.value.error) },
        HTML_UNPROCESSABLE,
      );
    }
    log("admin.broadcast_created", {
      batchId: created.value.batchId,
      total: created.value.total,
      audience: state.audience,
    });
    // إعادةُ توجيهٍ بعد الإنشاء: تحديثُ المتصفّح لصفحةٍ ناتجةٍ عن POST كان سيبثّ
    // الرسالة مرّتين، ولا شيء أسوأ من رسالةٍ جماعية مكرّرة.
    return c.redirect(`/admin/broadcast?sent=${created.value.total}`, SEE_OTHER);
  });

  app.post("/broadcast/:batchId/cancel", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const batchId = c.req.param("batchId");
    if (!UUID_PATTERN.test(batchId)) return c.text("INVALID_BATCH_ID", HTML_UNPROCESSABLE);
    const canceled = await broadcast.cancel({ actorUserId: c.get("admin").userId, batchId });
    if (!canceled.ok) return c.text("BROADCAST_CANCEL_FAILED", HTML_UNPROCESSABLE);
    if ("error" in canceled.value) {
      return await broadcastPage(
        c,
        EMPTY_BROADCAST_FORM,
        null,
        { kind: "error", text: broadcastError(canceled.value.error) },
        HTML_UNPROCESSABLE,
      );
    }
    log("admin.broadcast_canceled", { batchId, canceled: canceled.value.canceled });
    return c.redirect(`/admin/broadcast?canceled=${canceled.value.canceled}`, SEE_OTHER);
  });

  // -------------------------------------------------------------------------
  // الأفعال الكتابية الأربعة — كلها تمرّ بدوالّ ذرّية تتحقّق من الصفة في القاعدة
  // -------------------------------------------------------------------------

  app.post("/drivers/:id/verification", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const status = formText(checked.form, "status");
    if (status === null || !VERIFICATION_VALUES.has(status)) {
      return c.text("INVALID_STATUS", HTML_UNPROCESSABLE);
    }

    const outcome = await setDriverVerification(
      deps.sql,
      c.get("admin").userId,
      c.req.param("id"),
      status,
    );
    log("admin.driver_verification_changed", { ok: outcome.ok, error: outcome.error });
    return c.redirect(formText(checked.form, "back") ?? "/admin/drivers", SEE_OTHER);
  });

  app.post("/users/:id/blocked", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const blocked = formBoolean(checked.form, "blocked");
    if (blocked === null) return c.text("INVALID_BLOCKED", HTML_UNPROCESSABLE);
    const outcome = await setUserBlocked(
      deps.sql,
      c.get("admin").userId,
      c.req.param("id"),
      blocked,
    );
    log("admin.user_block_changed", { ok: outcome.ok, error: outcome.error, blocked });
    return c.redirect(formText(checked.form, "back") ?? "/admin/drivers", SEE_OTHER);
  });

  /*
   * إبطالُ جلساتِ Mini App لمستخدمٍ (`SEC-18-ب`) — الساقُ الغائبةُ التي أبقَت
   * `SEC-18` على `[~]`: المحرِّكُ كانَ مبنيّاً و`revoke` بلا موضعِ نداءٍ إنتاجيٍّ.
   *
   * والترتيبُ **مقصودٌ ومُحتجٌّ لهُ**: تحقُّقُ السببِ، ثمَّ الإنفاذُ، ثمَّ التسجيلُ.
   *   ــ السببُ أوّلاً لأنَّهُ الشرطُ الوحيدُ الذي يُبطِلُ الطلبَ كلَّه، فلا يُنفَذُ
   *      إبطالٌ ثمَّ يُرفَضُ سببُه.
   *   ــ والإنفاذُ قبلَ التسجيلِ لأنَّ إخفاقَ التسجيلِ يُخلِّفُ **إنفاذاً بلا أثرٍ**
   *      وذاكَ يُعاد بلا ضرَرٍ، أمّا إخفاقُ الإنفاذِ بعدَ التسجيلِ فيُخلِّفُ
   *      **أثراً يكذبُ**: سجلٌّ يقولُ «أُبطِلَت» وجلسةٌ حيّةٌ بيدِ مَن سُرِقَت منه.
   */
  app.post("/users/:id/revoke-sessions", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const reason = formText(checked.form, "reason");
    if (!isSessionRevocationReason(reason)) {
      return c.text("INVALID_REASON", HTML_UNPROCESSABLE);
    }

    const revocation = deps.revocation;
    if (revocation === undefined) {
      log("admin.miniapp_sessions_revoke_unavailable", { reason: "STORE_NOT_WIRED" });
      return c.text("SESSION_REVOCATION_NOT_AVAILABLE", SERVICE_UNAVAILABLE);
    }

    const targetUserId = c.req.param("id");
    const telegramUserId = await readUserTelegramId(deps.sql, targetUserId);
    if (telegramUserId === null) {
      return c.text("USER_NOT_FOUND", HTML_UNPROCESSABLE);
    }

    const nowMs = Date.now();
    const enforced = await revocation.revokeAllForUser(
      telegramUserId,
      nowMs,
      MINIAPP_SESSION_ABSOLUTE_TTL_SECONDS,
      reason,
    );
    if (!enforced.ok) {
      log("admin.miniapp_sessions_revoke_enforcement_failed", { detail: enforced.error.detail });
      return c.text("SESSION_REVOCATION_NOT_AVAILABLE", SERVICE_UNAVAILABLE);
    }

    const logged = await logMiniAppSessionRevocation(
      deps.sql,
      c.get("admin").userId,
      targetUserId,
      reason,
    );
    log("admin.miniapp_sessions_revoked", { ok: logged.ok, error: logged.error });
    if (!logged.ok) {
      /*
       * الإبطالُ **نافذٌ** والأثرُ غائبٌ. فلا يُقالُ «تمَّ»: يُردُّ خطأٌ ليُعادَ
       * الطلبُ، والإعادةُ تضربُ العتبةَ نفسَها وتكتبُ الأثرَ.
       */
      return c.text("REVOKED_BUT_NOT_LOGGED", SERVER_ERROR);
    }
    return c.redirect(formText(checked.form, "back") ?? "/admin/drivers", SEE_OTHER);
  });

  // ── SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ ──────────────────

  app.post("/users/:id/recovery", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const targetUserId = c.req.param("id");
    const admin = c.get("admin");
    const evidenceSummary = formText(checked.form, "evidence_summary");
    const claimantTelegramId = formText(checked.form, "claimant_telegram_id");

    if (!evidenceSummary || evidenceSummary.trim().length === 0) {
      return c.text("EMPTY_EVIDENCE_SUMMARY", HTML_UNPROCESSABLE);
    }

    const outcome = await submitAccountRecoveryRequest(
      deps.sql,
      admin.cityId,
      targetUserId,
      claimantTelegramId,
      evidenceSummary,
      admin.userId,
    );
    if (!outcome.ok) {
      log("admin.account_recovery_submit_failed", { error: outcome.error });
      return c.text(outcome.error ?? "SUBMIT_FAILED", HTML_UNPROCESSABLE);
    }

    log("admin.account_recovery_submitted", { target: targetUserId });
    return c.redirect("/admin/recovery", SEE_OTHER);
  });

  app.post("/recovery/:requestId/review", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const requestId = c.req.param("requestId");
    const admin = c.get("admin");
    const decision = formText(checked.form, "decision");
    const reason = formText(checked.form, "reason");

    if (decision !== "approved" && decision !== "rejected") {
      return c.text("INVALID_DECISION", HTML_UNPROCESSABLE);
    }

    if (!reason || !isRecoveryDecisionReason(reason)) {
      return c.text("INVALID_REASON", HTML_UNPROCESSABLE);
    }

    const outcome = await reviewAccountRecoveryRequest(
      deps.sql,
      requestId,
      admin.userId,
      decision,
      reason,
    );
    if (!outcome.ok) {
      log("admin.account_recovery_review_failed", { error: outcome.error });
      return c.text(outcome.error ?? "REVIEW_FAILED", HTML_UNPROCESSABLE);
    }

    log("admin.account_recovery_reviewed", { request: requestId, decision });
    return c.redirect("/admin/recovery", SEE_OTHER);
  });

  app.get("/recovery", async (c) => {
    const admin = c.get("admin");
    const requests = await listPendingRecoveryRequests(deps.sql, admin.userId, admin.cityId);

    return page(c, "استرداد الحسابات", "/admin/recovery", renderRecoveryPage(requests), 60);
  });

  // هذا المسار الأخصّ يجب أن يسبق :key، وإلا عومل group-ids كمفتاح إعداد عادي.
  app.post("/settings/:cityId/group-ids", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const rawSupport = formText(checked.form, "support_group_id");
    const rawEscalation = formText(checked.form, "escalation_group_id");
    const rawUnsubscribed = formText(checked.form, "unsubscribed_drivers_group_id");
    const values = [rawSupport, rawEscalation, rawUnsubscribed];
    const parsed = values.map(groupIdFromForm);
    const hasInvalid = values.some(
      (value, index) => value !== null && value.trim() !== "" && parsed[index] === null,
    );
    if (hasInvalid || !groupIdsAreDistinct(parsed)) {
      return c.text("INVALID_TELEGRAM_GROUP_ID", HTML_UNPROCESSABLE);
    }

    const cityId = c.req.param("cityId");
    const outcome = await updateCityGroupIds(
      deps.sql,
      c.get("admin").userId,
      cityId,
      parsed[0] ?? null,
      parsed[1] ?? null,
      parsed[2] ?? null,
    );
    log("admin.city_groups_updated", { ok: outcome.ok, error: outcome.error });
    if (!outcome.ok) return c.text(outcome.error ?? "CITY_GROUP_IDS_REJECTED", HTML_UNPROCESSABLE);
    return c.redirect(`/admin/settings?city=${encodeURIComponent(cityId)}`, SEE_OTHER);
  });

  app.post("/settings/:cityId/:key", async (c) => {
    const checked = await requireCsrf(c);
    if (!checked.ok) return checked.response;

    const value = formText(checked.form, "value");
    if (value === null) return c.text("EMPTY_VALUE", HTML_UNPROCESSABLE);

    const cityId = c.req.param("cityId");
    const outcome = await updateSetting(
      deps.sql,
      c.get("admin").userId,
      cityId,
      c.req.param("key"),
      value,
    );
    log("admin.setting_updated", { ok: outcome.ok, error: outcome.error });
    // القيمةُ المرفوضة تُبيَّن للمسؤول: إعادةُ توجيهٍ صامتة تعني أنّه يحسب أنّه حفظ.
    if (!outcome.ok) return c.text(outcome.error ?? "SETTING_REJECTED", HTML_UNPROCESSABLE);
    return c.redirect(`/admin/settings?city=${encodeURIComponent(cityId)}`, SEE_OTHER);
  });

  return app;
}
