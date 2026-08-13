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
import { DEFAULT_SESSION_POLICY } from "../../../../packages/domain/tracking/session.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
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
  type CityGroupStatus,
  type CityOption,
  renderAttendancePage,
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
  attendanceSummary,
  cityPulse,
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
  type LiveDriverStatusRow,
  LOW_RATING_FALLBACK,
  listAttendanceEvents,
  listCities,
  listDisputes,
  listDrivers,
  listLiveDriverStatuses,
  listLiveOrders,
  listRatings,
  listSettings,
  numericSetting,
  overviewCounters,
  RATINGS_LIMIT,
  ratingsTotals,
  recentAudit,
  setDriverVerification,
  setUserBlocked,
  stallSeconds,
  updateCityGroupIds,
  updateSetting,
} from "../admin/queries.ts";
import { createAdminSecurityHeaders } from "../admin/security-headers.ts";

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
const TELEGRAM_ID_PATTERN = /^[0-9]{5,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 404;
const CODE_PATTERN = /^[0-9]{6}$/;
const MIN_BIGINT = -(2n ** 63n);
const MAX_BIGINT = 2n ** 63n - 1n;

/** رسائل الرفض موحَّدة عمداً: من يجرّب معرّفات لا يعرف أيّها موجود. */
const GENERIC_LOGIN_ERROR = "تعذّر إرسال الرمز. تأكّد من المعرّف، أو راجع صاحب النظام.";

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

export function createAdminUiRoutes(deps: AdminUiDependencies): Hono<AdminEnv> {
  const app = new Hono<AdminEnv>();
  const log = deps.log ?? ((): void => undefined);

  // قبل كل مسار، ومنها /login: الدخول هو الصفحة التي تُرسَل فيها كلمةُ المرور
  // الوقتية، فإخراجُها من السياسة كان سيترك أضعفَ صفحةٍ بلا حماية.
  app.use("*", createAdminSecurityHeaders({ mapOrigins: deps.mapOrigins ?? [] }));

  // -------------------------------------------------------------------------
  // الدخول — خارج الحارس، وإلا استحال الدخول أصلاً
  // -------------------------------------------------------------------------

  app.get("/login", (c) => {
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
        log("عطل قاعدة بيانات أثناء إصدار رمز دخول اللوحة", { detail: issueOutcome.reason });
      } else {
        log("رُفض طلب رمز دخول للوحة لسبب أعمال", { reason: issueOutcome.reason });
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
      log("تعذّر تسليم رمز دخول اللوحة على تلغرام", { stage: "telegram_delivery" });
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
        log("عطل قاعدة بيانات أثناء التحقّق من رمز دخول اللوحة", {
          detail: consumeOutcome.reason,
        });
      } else {
        log("رُفض رمز دخول للوحة لسبب أعمال", { reason: consumeOutcome.reason });
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
        log("عطل قاعدة بيانات أثناء فتح جلسة اللوحة", { detail: openOutcome.reason });
      } else {
        log("رُفض فتح جلسة اللوحة لسبب أعمال", { reason: openOutcome.reason });
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

  app.get("/", async (c) => {
    const stall = await stallSeconds(deps.sql, null);
    const [counters, pulse, audit, signals] = await Promise.all([
      overviewCounters(deps.sql, DAY_WINDOW_HOURS),
      cityPulse(deps.sql),
      recentAudit(deps.sql, AUDIT_PREVIEW_LIMIT),
      healthSignals(deps.sql, stall),
    ]);

    return page(
      c,
      "نظرة عامة",
      "/admin",
      renderOverviewPage({
        now: new Date(),
        counters,
        cities: pulse,
        recentAudit: audit,
        health: healthIndicators(signals),
        windowHours: DAY_WINDOW_HOURS,
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
      }),
      LIVE_REFRESH_SECONDS,
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
    log("تغيير حالة توثيق سائق من اللوحة", { ok: outcome.ok, error: outcome.error });
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
    log("تغيير حظر مستخدم من اللوحة", { ok: outcome.ok, error: outcome.error, blocked });
    return c.redirect(formText(checked.form, "back") ?? "/admin/drivers", SEE_OTHER);
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
    log("تعديل معرّفات قروبات المدينة من اللوحة", { ok: outcome.ok, error: outcome.error });
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
    log("تعديل إعداد من اللوحة", { ok: outcome.ok, error: outcome.error });
    return c.redirect(`/admin/settings?city=${encodeURIComponent(cityId)}`, SEE_OTHER);
  });

  return app;
}
