/**
 * الغرض: نماذج القراءة التي تغذّي صفحات لوحة الإدارة. كل دالّة هنا استعلام واحد
 *   يعيد ما تعرضه صفحة واحدة بالضبط — لا ORM ولا طبقة تجريد ثالثة: اللوحة تقرأ
 *   ولا تُغيّر حالة أعمال، وأفعالها الكتابية الثلاثة تمرّ بدوالّ ذرّية لا من هنا.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: routes/admin-ui.ts، routes/admin-api.ts
 * ملاحظات مستقبلية: عند ثقل أي استعلام يُستبدل بـ materialized view يُحدَّث بجوب،
 *   بلا تغيير في توقيع الدالّة.
 */

import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type {
  AttendanceEvent,
  AttendanceSummaryRow,
  AuditEntry,
  CityOption,
  DisputeRow,
  DriverRow,
  HealthIndicator,
  HeatCell,
  LiveOrderRow,
  OverviewCounters,
  RatingRow,
  SettingRow,
} from "../../../admin-dashboard/src/index.ts";

/** نافذة الحصيلة اليومية بالساعات. تقنية عرض لا سياسة تجارية. */
export const DAY_WINDOW_HOURS = 24;
export const ATTENDANCE_WINDOWS: readonly number[] = [6, 12, 24, 72, 168];
export const HEATMAP_WINDOWS: readonly number[] = [1, 3, 6, 12, 24];
export const DRIVERS_LIMIT = 200;
export const EVENTS_LIMIT = 200;
export const RATINGS_LIMIT = 200;
export const DISPUTES_LIMIT = 200;
export const SEARCH_LIMIT = 8;

export interface CityRecord extends CityOption {
  readonly isActive: boolean;
}

export async function listCities(sql: Sql): Promise<readonly CityRecord[]> {
  const rows = await sql<{ id: string; code: string; name_ar: string; is_active: boolean }[]>`
    select id, code, name_ar, is_active from cities order by code
  `;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    isActive: row.is_active,
  }));
}

/**
 * قيمة عددية من platform_settings. حين لا تُحدَّد مدينة نأخذ الأكبر عبر المدن:
 * عتبة تحذير موحّدة يجب أن تكون الأكثر تسامحاً، وإلا ظهر طلب سليم في مدينة
 * إعداداتها أوسع وكأنه متعثّر.
 */
export async function numericSetting(
  sql: Sql,
  key: string,
  cityId: string | null,
  fallback: number,
): Promise<number> {
  const rows = await sql<{ value: number | null }[]>`
    select max((value #>> '{}')::numeric)::float8 as value
    from platform_settings
    where key = ${key}
      and value_type = 'number'
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const value = rows[0]?.value;
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value;
}

/** الحدّ الافتراضي لعتبة التعثّر حين تغيب الإعدادات: دقيقتان بلا إسناد. */
export const STALL_FALLBACK_SECONDS = 120;
export const LOW_RATING_FALLBACK = 2;
export const HEATMAP_CELL_FALLBACK_DEGREES = 0.01;

/**
 * عتبة اعتبار الطلب متعثّراً: مهلة العرض مضروبة في عدد الدورات المسموح بها.
 * طلب تجاوزها لم يعد ينتظر دورةً قادمة، بل توقف عنده شيء.
 */
export async function stallSeconds(sql: Sql, cityId: string | null): Promise<number> {
  const timeout = await numericSetting(sql, "offer_timeout_seconds", cityId, 0);
  const rounds = await numericSetting(sql, "max_broadcast_rounds", cityId, 0);
  const computed = timeout * rounds;
  return computed > 0 ? computed : STALL_FALLBACK_SECONDS;
}

// ---------------------------------------------------------------------------
// النظرة العامة
// ---------------------------------------------------------------------------

export async function overviewCounters(sql: Sql, windowHours: number): Promise<OverviewCounters> {
  const rows = await sql<
    {
      searching: number;
      matched: number;
      in_progress: number;
      available_drivers: number;
      verified_drivers: number;
      pending_drivers: number;
      active_subscriptions: number;
      trial_subscriptions: number;
      open_tickets: number;
      completed_day: number;
      failed_day: number;
      cancelled_day: number;
      avg_match_seconds: number | null;
      avg_driver_rating: number | null;
    }[]
  >`
    with window_bounds as (
      select now() - make_interval(hours => ${windowHours}::integer) as since
    )
    select
      (select count(*) from orders where status = 'searching')::int as searching,
      (select count(*) from orders where status = 'matched')::int as matched,
      (select count(*) from orders where status = 'in_progress')::int as in_progress,
      (select count(*) from driver_availability where is_available)::int as available_drivers,
      (select count(*) from drivers where verification_status = 'verified')::int
        as verified_drivers,
      (select count(*) from drivers where verification_status = 'pending')::int
        as pending_drivers,
      (select count(*) from subscriptions where status = 'active')::int as active_subscriptions,
      (select count(*) from subscriptions where status = 'trialing')::int as trial_subscriptions,
      (select count(*) from support_tickets where status in ('open', 'claimed'))::int
        as open_tickets,
      (select count(*) from orders, window_bounds
        where status = 'completed' and completed_at >= window_bounds.since)::int as completed_day,
      (select count(*) from orders, window_bounds
        where status = 'failed' and updated_at >= window_bounds.since)::int as failed_day,
      (select count(*) from orders, window_bounds
        where status = 'cancelled' and updated_at >= window_bounds.since)::int as cancelled_day,
      (select avg(extract(epoch from (matched_at - created_at)))::float8
         from orders, window_bounds
        where matched_at is not null and matched_at >= window_bounds.since) as avg_match_seconds,
      (select avg(stars)::float8 from ratings, window_bounds
        where direction = 'rider_to_driver' and is_flagged = false
          and created_at >= window_bounds.since) as avg_driver_rating
  `;

  const row = rows[0];
  return {
    searchingOrders: row?.searching ?? 0,
    matchedOrders: row?.matched ?? 0,
    inProgressOrders: row?.in_progress ?? 0,
    availableDrivers: row?.available_drivers ?? 0,
    verifiedDrivers: row?.verified_drivers ?? 0,
    pendingDrivers: row?.pending_drivers ?? 0,
    activeSubscriptions: row?.active_subscriptions ?? 0,
    trialSubscriptions: row?.trial_subscriptions ?? 0,
    openTickets: row?.open_tickets ?? 0,
    completedOrdersDay: row?.completed_day ?? 0,
    failedOrdersDay: row?.failed_day ?? 0,
    cancelledOrdersDay: row?.cancelled_day ?? 0,
    averageMatchSeconds: row?.avg_match_seconds ?? null,
    averageDriverRating: row?.avg_driver_rating ?? null,
  };
}

export interface CityPulseRow {
  readonly code: string;
  readonly nameAr: string;
  readonly isActive: boolean;
  readonly liveOrders: number;
  readonly availableDrivers: number;
  readonly openTickets: number;
}

export async function cityPulse(sql: Sql): Promise<readonly CityPulseRow[]> {
  const rows = await sql<
    {
      code: string;
      name_ar: string;
      is_active: boolean;
      live_orders: number;
      available_drivers: number;
      open_tickets: number;
    }[]
  >`
    select
      c.code, c.name_ar, c.is_active,
      (select count(*) from orders o
        where o.city_id = c.id and o.status in ('searching', 'matched', 'in_progress'))::int
        as live_orders,
      (select count(*) from driver_availability da
        where da.city_id = c.id and da.is_available)::int as available_drivers,
      (select count(*) from support_tickets t
        where t.city_id = c.id and t.status in ('open', 'claimed'))::int as open_tickets
    from cities c
    order by c.code
  `;
  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    isActive: row.is_active,
    liveOrders: row.live_orders,
    availableDrivers: row.available_drivers,
    openTickets: row.open_tickets,
  }));
}

export async function recentAudit(sql: Sql, limit: number): Promise<readonly AuditEntry[]> {
  const rows = await sql<
    { created_at: string; action: string; entity_type: string; actor_name: string | null }[]
  >`
    select a.created_at, a.action, a.entity_type, u.full_name as actor_name
    from audit_log a
    left join users u on u.id = a.actor_user_id
    order by a.created_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    createdAt: String(row.created_at),
    action: row.action,
    entityType: row.entity_type,
    actorName: row.actor_name,
  }));
}

export interface HealthSignals {
  /** زمن استجابة استعلام تافه على القاعدة بالميلي ثانية. */
  readonly databaseLatencyMs: number;
  /** عروض انتهت صلاحيتها ولم يُغلقها أحد — دليل توقّف الجوب الدوري. */
  readonly staleOffers: number;
  /** طلبات تفاوض تجاوزت مهلتها بلا تدوير. */
  readonly staleNegotiations: number;
  /** طلبات تبحث منذ أطول من عتبة التعثّر. */
  readonly stalledOrders: number;
  /** مدن غير مفعّلة (لم تُربط قروباتها). */
  readonly inactiveCities: number;
  /** سائقون متاحون بلا موقع مسجَّل — لا يظهرون في المطابقة بالقرب. */
  readonly availableWithoutLocation: number;
}

export async function healthSignals(sql: Sql, stallAfterSeconds: number): Promise<HealthSignals> {
  const startedAt = Date.now();
  const rows = await sql<
    {
      stale_offers: number;
      stale_negotiations: number;
      stalled_orders: number;
      inactive_cities: number;
      available_without_location: number;
    }[]
  >`
    select
      (select count(*) from order_offers
        where status = 'pending' and expires_at < now())::int as stale_offers,
      (select count(*) from unsubscribed_negotiations
        where status = 'negotiating' and negotiate_deadline is not null
          and negotiate_deadline < now())::int as stale_negotiations,
      (select count(*) from orders
        where status = 'searching'
          and created_at < now() - make_interval(secs => ${stallAfterSeconds}::float8))::int
        as stalled_orders,
      (select count(*) from cities where is_active = false)::int as inactive_cities,
      (select count(*) from driver_availability da
         join drivers d on d.id = da.driver_id
        where da.is_available and d.last_location is null)::int as available_without_location
  `;
  const row = rows[0];
  return {
    databaseLatencyMs: Date.now() - startedAt,
    staleOffers: row?.stale_offers ?? 0,
    staleNegotiations: row?.stale_negotiations ?? 0,
    stalledOrders: row?.stalled_orders ?? 0,
    inactiveCities: row?.inactive_cities ?? 0,
    availableWithoutLocation: row?.available_without_location ?? 0,
  };
}

/**
 * ترجمة الإشارات الخام إلى مؤشّرات مقروءة. كل مؤشّر يقول ما يعنيه الرقم لا الرقم
 * وحده: «عرض منتهٍ لم يُغلَق» أوضح من «7» لمن يفتح اللوحة في الثالثة فجراً.
 */
export function healthIndicators(signals: HealthSignals): readonly HealthIndicator[] {
  const latencyWarnMs = 300;
  const latencyBadMs = 1500;
  const latency: HealthIndicator["status"] =
    signals.databaseLatencyMs >= latencyBadMs
      ? "bad"
      : signals.databaseLatencyMs >= latencyWarnMs
        ? "warn"
        : "ok";

  const zeroIsOk = (count: number): HealthIndicator["status"] => (count === 0 ? "ok" : "bad");
  const zeroIsFine = (count: number): HealthIndicator["status"] => (count === 0 ? "ok" : "warn");

  return [
    {
      name: "استجابة قاعدة البيانات",
      status: latency,
      detail: `${signals.databaseLatencyMs} ملي ثانية لاستعلام اللوحة`,
    },
    {
      name: "عروض منتهية بلا إغلاق",
      status: zeroIsOk(signals.staleOffers),
      detail:
        signals.staleOffers === 0
          ? "لا عرض عالق"
          : `${signals.staleOffers} — الجوب الدوري لا يعمل غالباً`,
    },
    {
      name: "تفاوض تجاوز مهلته",
      status: zeroIsOk(signals.staleNegotiations),
      detail:
        signals.staleNegotiations === 0
          ? "لا دورة متوقّفة"
          : `${signals.staleNegotiations} دورة تنتظر تدويراً`,
    },
    {
      name: "طلبات متعثّرة في البحث",
      status: zeroIsFine(signals.stalledOrders),
      detail:
        signals.stalledOrders === 0
          ? "لا طلب تجاوز عتبة التعثّر"
          : `${signals.stalledOrders} طلب تجاوز كل دورات النشر`,
    },
    {
      name: "متاحون بلا موقع",
      status: zeroIsFine(signals.availableWithoutLocation),
      detail:
        signals.availableWithoutLocation === 0
          ? "كل متاح له موقع مسجّل"
          : `${signals.availableWithoutLocation} سائقاً لن يظهر في المطابقة بالقُرب`,
    },
    {
      name: "مدن غير مفعّلة",
      status: zeroIsFine(signals.inactiveCities),
      detail:
        signals.inactiveCities === 0
          ? "كل المدن مفعّلة"
          : `${signals.inactiveCities} مدينة بانتظار ربط قروباتها`,
    },
  ];
}

// ---------------------------------------------------------------------------
// السائقون
// ---------------------------------------------------------------------------

export interface DriversQuery {
  readonly cityId: string | null;
  readonly verification: string | null;
  readonly search: string | null;
  readonly limit: number;
}

interface DriverSqlRow {
  driver_id: string;
  user_id: string;
  full_name: string | null;
  telegram_id: string;
  phone: string | null;
  city_code: string;
  verification_status: string;
  is_blocked: boolean;
  is_available: boolean;
  rating_average: number | null;
  rating_count: number;
  services: string[] | null;
  plan: string | null;
  sub_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  completed_orders: number;
  registered_at: string;
  total_count: number;
}

export async function listDrivers(
  sql: Sql,
  query: DriversQuery,
): Promise<{ rows: readonly DriverRow[]; total: number }> {
  const search = query.search === null || query.search.trim() === "" ? null : query.search.trim();
  const rows = await sql<DriverSqlRow[]>`
    with filtered as (
      select d.id as driver_id, d.user_id, d.verification_status, d.rating_average,
             d.rating_count, d.created_at as registered_at,
             u.full_name, u.telegram_id::text as telegram_id, u.phone, u.is_blocked,
             c.code as city_code
      from drivers d
      join users u on u.id = d.user_id
      join cities c on c.id = d.city_id
      where true
        ${query.cityId === null ? sql`` : sql`and d.city_id = ${query.cityId}::uuid`}
        ${
          query.verification === null
            ? sql``
            : sql`and d.verification_status = ${query.verification}::verification_status`
        }
        ${
          search === null
            ? sql``
            : sql`and (
                u.full_name ilike ${`%${search}%`}
                or u.phone ilike ${`%${search}%`}
                or u.telegram_id::text = ${search}
              )`
        }
    )
    select f.driver_id, f.user_id, f.full_name, f.telegram_id, f.phone, f.city_code,
           f.verification_status::text as verification_status, f.is_blocked,
           coalesce(da.is_available, false) as is_available,
           f.rating_average::float8 as rating_average, f.rating_count,
           (select array_agg(dc.service::text order by dc.service)
              from driver_capabilities dc
             where dc.driver_id = f.driver_id and dc.is_enabled) as services,
           s.plan::text as plan, s.status::text as sub_status,
           s.trial_ends_at, s.current_period_end,
           (select count(*) from orders o
             where o.assigned_driver_id = f.driver_id and o.status = 'completed')::int
             as completed_orders,
           f.registered_at,
           (select count(*) from filtered)::int as total_count
    from filtered f
    left join driver_availability da on da.driver_id = f.driver_id
    left join subscriptions s
      on s.driver_id = f.driver_id and s.status in ('trialing', 'active')
    order by
      case f.verification_status when 'pending' then 0 else 1 end,
      f.registered_at desc
    limit ${query.limit}
  `;

  return {
    total: rows[0]?.total_count ?? 0,
    rows: rows.map((row) => ({
      driverId: row.driver_id,
      userId: row.user_id,
      fullName: row.full_name,
      telegramId: row.telegram_id,
      phone: row.phone,
      cityCode: row.city_code,
      verificationStatus: row.verification_status,
      isBlocked: row.is_blocked,
      isAvailable: row.is_available,
      ratingAverage: row.rating_average,
      ratingCount: row.rating_count,
      services: row.services ?? [],
      subscription:
        row.plan === null || row.sub_status === null
          ? null
          : {
              plan: row.plan,
              status: row.sub_status,
              trialEndsAt: row.trial_ends_at === null ? null : String(row.trial_ends_at),
              currentPeriodEnd:
                row.current_period_end === null ? null : String(row.current_period_end),
            },
      completedOrders: row.completed_orders,
      registeredAt: String(row.registered_at),
    })),
  };
}

// ---------------------------------------------------------------------------
// الطلبات الحية
// ---------------------------------------------------------------------------

export async function listLiveOrders(
  sql: Sql,
  cityId: string | null,
): Promise<readonly LiveOrderRow[]> {
  const rows = await sql<
    {
      order_id: string;
      city_code: string;
      service: string;
      status: string;
      rider_name: string | null;
      rider_telegram_id: string;
      driver_name: string | null;
      pickup_label: string | null;
      dropoff_label: string | null;
      created_at: string;
      matched_at: string | null;
      started_at: string | null;
      broadcast_round: number;
      pending_offers: number;
      negotiation_stage: string | null;
    }[]
  >`
    select o.id as order_id, c.code as city_code, o.service::text as service,
           o.status::text as status,
           ru.full_name as rider_name, ru.telegram_id::text as rider_telegram_id,
           du.full_name as driver_name,
           o.pickup_label, o.dropoff_label,
           o.created_at, o.matched_at, o.started_at, o.broadcast_round,
           (select count(*) from order_offers off
             where off.order_id = o.id and off.status = 'pending' and off.expires_at > now())::int
             as pending_offers,
           (select n.status::text from unsubscribed_negotiations n
             where n.order_id = o.id and n.status in ('collecting', 'negotiating')
             limit 1) as negotiation_stage
    from orders o
    join cities c on c.id = o.city_id
    join riders r on r.id = o.rider_id
    join users ru on ru.id = r.user_id
    left join drivers d on d.id = o.assigned_driver_id
    left join users du on du.id = d.user_id
    where o.status in ('searching', 'matched', 'in_progress')
      ${cityId === null ? sql`` : sql`and o.city_id = ${cityId}::uuid`}
    order by o.created_at asc
  `;

  return rows.map((row) => ({
    orderId: row.order_id,
    cityCode: row.city_code,
    service: row.service,
    status: row.status,
    riderName: row.rider_name,
    riderTelegramId: row.rider_telegram_id,
    driverName: row.driver_name,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    createdAt: String(row.created_at),
    matchedAt: row.matched_at === null ? null : String(row.matched_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    broadcastRound: row.broadcast_round,
    pendingOffers: row.pending_offers,
    negotiationStage: row.negotiation_stage,
  }));
}

// ---------------------------------------------------------------------------
// الحضور
// ---------------------------------------------------------------------------

export async function listAttendanceEvents(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
  search: string | null,
  limit: number,
): Promise<readonly AttendanceEvent[]> {
  const term = search === null || search.trim() === "" ? null : search.trim();
  const rows = await sql<
    {
      changed_at: string;
      driver_id: string;
      driver_name: string | null;
      telegram_id: string;
      city_code: string;
      is_available: boolean;
      source: string;
    }[]
  >`
    select a.changed_at, a.driver_id, u.full_name as driver_name,
           u.telegram_id::text as telegram_id, c.code as city_code,
           a.is_available, a.source
    from attendance_log a
    join drivers d on d.id = a.driver_id
    join users u on u.id = d.user_id
    join cities c on c.id = a.city_id
    where a.changed_at >= now() - make_interval(hours => ${windowHours}::integer)
      ${cityId === null ? sql`` : sql`and a.city_id = ${cityId}::uuid`}
      ${term === null ? sql`` : sql`and u.full_name ilike ${`%${term}%`}`}
    order by a.changed_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    changedAt: String(row.changed_at),
    driverId: row.driver_id,
    driverName: row.driver_name,
    telegramId: row.telegram_id,
    cityCode: row.city_code,
    isAvailable: row.is_available,
    source: row.source,
  }));
}

/**
 * مدّة الإتاحة داخل النافذة: تُحسب بجمع الفترات بين كل «صار متاحاً» و«صار غير
 * متاح» تاليه. من كان متاحاً قبل بداية النافذة يُحتسب من بدايتها، ومن بقي متاحاً
 * حتى الآن يُحتسب حتى الآن — وإلا ظهر أنشط سائق بصفر ساعة لأنه لم يُطفئ بعد.
 */
export async function attendanceSummary(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
  search: string | null,
): Promise<readonly AttendanceSummaryRow[]> {
  const term = search === null || search.trim() === "" ? null : search.trim();
  const rows = await sql<
    {
      driver_id: string;
      driver_name: string | null;
      city_code: string;
      online_seconds: number;
      toggles: number;
      is_available_now: boolean;
    }[]
  >`
    with bounds as (
      select now() - make_interval(hours => ${windowHours}::integer) as since, now() as until
    ),
    scoped as (
      select d.id as driver_id, u.full_name as driver_name, c.code as city_code,
             coalesce(da.is_available, false) as is_available_now
      from drivers d
      join users u on u.id = d.user_id
      join cities c on c.id = d.city_id
      left join driver_availability da on da.driver_id = d.id
      where true
        ${cityId === null ? sql`` : sql`and d.city_id = ${cityId}::uuid`}
        ${term === null ? sql`` : sql`and u.full_name ilike ${`%${term}%`}`}
    ),
    events as (
      select a.driver_id, a.is_available, a.changed_at
      from attendance_log a, bounds
      where a.changed_at >= bounds.since
    ),
    -- الحالة عند بداية النافذة: آخر تبديل قبلها
    opening as (
      select s.driver_id,
             coalesce((
               select a.is_available from attendance_log a, bounds
               where a.driver_id = s.driver_id and a.changed_at < bounds.since
               order by a.changed_at desc limit 1
             ), false) as was_available
      from scoped s
    ),
    timeline as (
      select o.driver_id, (select since from bounds) as at, o.was_available as is_available
      from opening o
      union all
      select e.driver_id, e.changed_at as at, e.is_available from events e
    ),
    spans as (
      select t.driver_id, t.is_available, t.at,
             lead(t.at, 1, (select until from bounds))
               over (partition by t.driver_id order by t.at) as next_at
      from timeline t
    )
    select s.driver_id, s.driver_name, s.city_code, s.is_available_now,
           coalesce((
             select sum(extract(epoch from (sp.next_at - sp.at)))
             from spans sp
             where sp.driver_id = s.driver_id and sp.is_available
           ), 0)::float8 as online_seconds,
           (select count(*) from events e where e.driver_id = s.driver_id)::int as toggles
    from scoped s
    order by online_seconds desc, s.driver_name asc
  `;

  return rows.map((row) => ({
    driverId: row.driver_id,
    driverName: row.driver_name,
    cityCode: row.city_code,
    onlineSeconds: row.online_seconds,
    toggles: row.toggles,
    isAvailableNow: row.is_available_now,
  }));
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

export interface RatingsQuery {
  readonly cityId: string | null;
  readonly direction: string | null;
  readonly onlyLow: boolean;
  readonly lowThreshold: number;
  readonly limit: number;
}

export async function listRatings(sql: Sql, query: RatingsQuery): Promise<readonly RatingRow[]> {
  const rows = await sql<
    {
      created_at: string;
      order_id: string;
      city_code: string;
      direction: string;
      rater_name: string | null;
      ratee_name: string | null;
      stars: number;
      comment: string | null;
      is_flagged: boolean;
    }[]
  >`
    select r.created_at, r.order_id, c.code as city_code, r.direction::text as direction,
           rater.full_name as rater_name, ratee.full_name as ratee_name,
           r.stars, r.comment, r.is_flagged
    from ratings r
    join cities c on c.id = r.city_id
    join users rater on rater.id = r.rater_user_id
    join users ratee on ratee.id = r.ratee_user_id
    where true
      ${query.cityId === null ? sql`` : sql`and r.city_id = ${query.cityId}::uuid`}
      ${
        query.direction === null
          ? sql``
          : sql`and r.direction = ${query.direction}::rating_direction`
      }
      ${query.onlyLow ? sql`and r.stars <= ${query.lowThreshold}` : sql``}
    order by r.created_at desc
    limit ${query.limit}
  `;

  return rows.map((row) => ({
    createdAt: String(row.created_at),
    orderId: row.order_id,
    cityCode: row.city_code,
    direction: row.direction,
    raterName: row.rater_name,
    rateeName: row.ratee_name,
    stars: row.stars,
    comment: row.comment,
    isFlagged: row.is_flagged,
  }));
}

export interface RatingsTotals {
  readonly total: number;
  readonly averageOnDriver: number | null;
  readonly averageOnRider: number | null;
  readonly lowCount: number;
  readonly flaggedCount: number;
}

export async function ratingsTotals(
  sql: Sql,
  cityId: string | null,
  lowThreshold: number,
): Promise<RatingsTotals> {
  const rows = await sql<
    {
      total: number;
      avg_driver: number | null;
      avg_rider: number | null;
      low_count: number;
      flagged_count: number;
    }[]
  >`
    select count(*)::int as total,
           avg(stars) filter (where direction = 'rider_to_driver' and is_flagged = false)::float8
             as avg_driver,
           avg(stars) filter (where direction = 'driver_to_rider' and is_flagged = false)::float8
             as avg_rider,
           count(*) filter (where stars <= ${lowThreshold})::int as low_count,
           count(*) filter (where is_flagged)::int as flagged_count
    from ratings
    where true
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    averageOnDriver: row?.avg_driver ?? null,
    averageOnRider: row?.avg_rider ?? null,
    lowCount: row?.low_count ?? 0,
    flaggedCount: row?.flagged_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// النزاعات
// ---------------------------------------------------------------------------

export async function listDisputes(
  sql: Sql,
  cityId: string | null,
  status: string | null,
  limit: number,
): Promise<readonly DisputeRow[]> {
  const rows = await sql<
    {
      ticket_id: string;
      created_at: string;
      type: string;
      status: string;
      city_code: string;
      party_name: string | null;
      party_role: string;
      party_telegram_id: string | null;
      order_id: string | null;
      message: string;
      claimed_by_name: string | null;
      claimed_at: string | null;
    }[]
  >`
    select t.id as ticket_id, t.created_at, t.type::text as type, t.status::text as status,
           c.code as city_code,
           coalesce(du.full_name, ru.full_name) as party_name,
           case when t.driver_id is not null then 'driver' else 'rider' end as party_role,
           coalesce(du.telegram_id, ru.telegram_id)::text as party_telegram_id,
           t.order_id, t.message,
           cu.full_name as claimed_by_name, t.claimed_at
    from support_tickets t
    join cities c on c.id = t.city_id
    left join drivers d on d.id = t.driver_id
    left join users du on du.id = d.user_id
    left join riders r on r.id = t.rider_id
    left join users ru on ru.id = r.user_id
    left join users cu on cu.id = t.claimed_by_user_id
    where true
      ${cityId === null ? sql`` : sql`and t.city_id = ${cityId}::uuid`}
      ${
        status === null
          ? sql`and t.status in ('open', 'claimed')`
          : sql`and t.status = ${status}::support_ticket_status`
      }
    order by t.created_at asc
    limit ${limit}
  `;

  return rows.map((row) => ({
    ticketId: row.ticket_id,
    createdAt: String(row.created_at),
    type: row.type,
    status: row.status,
    cityCode: row.city_code,
    partyName: row.party_name,
    partyRole: row.party_role,
    partyTelegramId: row.party_telegram_id,
    orderId: row.order_id,
    message: row.message,
    claimedByName: row.claimed_by_name,
    claimedAt: row.claimed_at === null ? null : String(row.claimed_at),
  }));
}

export interface DisputeTotals {
  readonly open: number;
  readonly claimed: number;
  readonly resolvedInWindow: number;
}

export async function disputeTotals(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
): Promise<DisputeTotals> {
  const rows = await sql<{ open: number; claimed: number; resolved: number }[]>`
    select
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where status = 'claimed')::int as claimed,
      count(*) filter (
        where status in ('resolved', 'rejected')
          and resolved_at >= now() - make_interval(hours => ${windowHours}::integer)
      )::int as resolved
    from support_tickets
    where true
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const row = rows[0];
  return {
    open: row?.open ?? 0,
    claimed: row?.claimed ?? 0,
    resolvedInWindow: row?.resolved ?? 0,
  };
}

// ---------------------------------------------------------------------------
// الخريطة الحرارية
// ---------------------------------------------------------------------------

export interface HeatmapResult {
  readonly cells: readonly HeatCell[];
  readonly rows: number;
  readonly cols: number;
  readonly totalDemand: number;
  readonly totalSupply: number;
}

/**
 * الطلب والعرض على شبكة واحدة: تُقسَّم الإحداثيات إلى خلايا بحجم ثابت بالدرجات،
 * ثم يُحوَّل رقم الخليّة المطلق إلى صفٍّ وعمود نسبيَّين لأصغر خلية مأهولة — فتكون
 * الشبكة المرسومة محيطة بالنشاط لا بالكوكب.
 */
export async function heatmap(
  sql: Sql,
  cityId: string,
  windowHours: number,
  cellDegrees: number,
): Promise<HeatmapResult> {
  const rows = await sql<{ gx: number; gy: number; demand: number; supply: number }[]>`
    with cell as (select ${cellDegrees}::float8 as size),
    demand_points as (
      select floor(st_x(o.pickup::geometry) / cell.size)::int as gx,
             floor(st_y(o.pickup::geometry) / cell.size)::int as gy
      from orders o, cell
      where o.city_id = ${cityId}::uuid
        and o.created_at >= now() - make_interval(hours => ${windowHours}::integer)
    ),
    supply_points as (
      select floor(st_x(d.last_location::geometry) / cell.size)::int as gx,
             floor(st_y(d.last_location::geometry) / cell.size)::int as gy
      from drivers d
      join driver_availability da on da.driver_id = d.id and da.is_available
      , cell
      where d.city_id = ${cityId}::uuid and d.last_location is not null
    ),
    merged as (
      select gx, gy, count(*)::int as demand, 0 as supply from demand_points group by gx, gy
      union all
      select gx, gy, 0 as demand, count(*)::int as supply from supply_points group by gx, gy
    )
    select gx, gy, sum(demand)::int as demand, sum(supply)::int as supply
    from merged
    group by gx, gy
    order by gy desc, gx asc
  `;

  if (rows.length === 0) {
    return { cells: [], rows: 0, cols: 0, totalDemand: 0, totalSupply: 0 };
  }

  const xs = rows.map((r) => r.gx);
  const ys = rows.map((r) => r.gy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const HALF = 0.5;
  const cells: HeatCell[] = rows.map((row) => ({
    // الصفّ صفر هو أقصى شمال: الشاشة تُقرأ من الأعلى، والخريطة كذلك
    row: maxY - row.gy,
    col: row.gx - minX,
    centerLng: (row.gx + HALF) * cellDegrees,
    centerLat: (row.gy + HALF) * cellDegrees,
    demand: row.demand,
    supply: row.supply,
  }));

  return {
    cells,
    rows: maxY - minY + 1,
    cols: maxX - minX + 1,
    totalDemand: rows.reduce((sum, r) => sum + r.demand, 0),
    totalSupply: rows.reduce((sum, r) => sum + r.supply, 0),
  };
}

// ---------------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------------

export async function listSettings(sql: Sql, cityId: string): Promise<readonly SettingRow[]> {
  const rows = await sql<
    {
      key: string;
      value: unknown;
      value_type: string;
      description_ar: string;
      is_provisional: boolean;
      updated_at: string;
    }[]
  >`
    select key, value, value_type, description_ar, is_provisional, updated_at
    from platform_settings
    where city_id = ${cityId}::uuid
    order by key
  `;
  return rows.map((row) => ({
    key: row.key,
    value: JSON.stringify(row.value),
    valueType: row.value_type,
    descriptionAr: row.description_ar,
    isProvisional: row.is_provisional,
    updatedAt: String(row.updated_at),
  }));
}

// ---------------------------------------------------------------------------
// البحث الموحَّد
// ---------------------------------------------------------------------------

export interface SearchItem {
  readonly label: string;
  readonly detail: string;
  readonly href: string;
}

export interface SearchGroup {
  readonly title: string;
  readonly items: readonly SearchItem[];
}

const UUID_PATTERN = /^[0-9a-f]{4,}$/i;

/**
 * بحث واحد على كل ما يبحث عنه مشغّل فعلاً: شخص باسمه أو جواله أو معرّف تلغرامه،
 * وطلب أو تذكرة ببداية معرّفها. لا فهرس نصّي كامل: عدد الصفوف اليوم لا يبرّره،
 * وإضافته قبل الحاجة تعني فهرساً يُصان بلا مستفيد.
 */
export async function unifiedSearch(
  sql: Sql,
  term: string,
  limit: number,
): Promise<readonly SearchGroup[]> {
  const trimmed = term.trim();
  if (trimmed === "") return [];
  const like = `%${trimmed}%`;
  const groups: SearchGroup[] = [];

  const people = await sql<
    {
      full_name: string | null;
      telegram_id: string;
      phone: string | null;
      role: string;
      city_code: string;
      driver_id: string | null;
    }[]
  >`
    select u.full_name, u.telegram_id::text as telegram_id, u.phone, u.role::text as role,
           c.code as city_code, d.id as driver_id
    from users u
    join cities c on c.id = u.city_id
    left join drivers d on d.user_id = u.id
    where u.full_name ilike ${like}
       or u.phone ilike ${like}
       or u.telegram_id::text = ${trimmed}
    order by u.created_at desc
    limit ${limit}
  `;

  if (people.length > 0) {
    groups.push({
      title: "أشخاص",
      items: people.map((person) => ({
        label: person.full_name ?? person.telegram_id,
        detail: `${person.role} · ${person.city_code} · ${person.telegram_id}${
          person.phone === null ? "" : ` · ${person.phone}`
        }`,
        href:
          person.driver_id === null
            ? `/admin/drivers?q=${encodeURIComponent(person.telegram_id)}`
            : `/admin/drivers?q=${encodeURIComponent(person.telegram_id)}`,
      })),
    });
  }

  if (UUID_PATTERN.test(trimmed)) {
    const prefix = `${trimmed}%`;

    const orders = await sql<
      { id: string; status: string; service: string; city_code: string; created_at: string }[]
    >`
      select o.id, o.status::text as status, o.service::text as service,
             c.code as city_code, o.created_at
      from orders o
      join cities c on c.id = o.city_id
      where o.id::text like ${prefix}
      order by o.created_at desc
      limit ${limit}
    `;
    if (orders.length > 0) {
      groups.push({
        title: "طلبات",
        items: orders.map((order) => ({
          label: order.id,
          detail: `${order.service} · ${order.status} · ${order.city_code}`,
          href: "/admin/live-orders",
        })),
      });
    }

    const tickets = await sql<{ id: string; status: string; type: string; city_code: string }[]>`
      select t.id, t.status::text as status, t.type::text as type, c.code as city_code
      from support_tickets t
      join cities c on c.id = t.city_id
      where t.id::text like ${prefix}
      order by t.created_at desc
      limit ${limit}
    `;
    if (tickets.length > 0) {
      groups.push({
        title: "تذاكر",
        items: tickets.map((ticket) => ({
          label: ticket.id,
          detail: `${ticket.type} · ${ticket.status} · ${ticket.city_code}`,
          href: `/admin/disputes?status=${encodeURIComponent(ticket.status)}`,
        })),
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// الأفعال الكتابية — كلها دوالّ ذرّية تتحقّق من صفة المنفِّذ في القاعدة نفسها
// ---------------------------------------------------------------------------

export interface WriteOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly changed: boolean;
}

function readWrite(value: unknown): WriteOutcome {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "UNREADABLE_RESPONSE", changed: false };
  }
  const record = value as Record<string, unknown>;
  return {
    ok: record.ok === true,
    error: record.ok === true ? null : String(record.error ?? "UNKNOWN"),
    changed: record.changed === true,
  };
}

/**
 * القيمة تُمرَّر نصّاً ثم تُحوَّل في القاعدة (::text::jsonb) لا كـ jsonb مباشرة:
 * مشغّل الاتصال يُسلسِل أي نصّ يُرسَل إلى عمود jsonb بوصفه نصّ JSON، فيصير "0.02"
 * سلسلةً لا رقماً وتُرفض بـ VALUE_TYPE_MISMATCH. اكتُشف باختبار تكامل حقيقي.
 */
export async function updateSetting(
  sql: Sql,
  actorUserId: string,
  cityId: string,
  key: string,
  value: string,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_update_setting(
      ${actorUserId}::uuid, ${cityId}::uuid, ${key}::text, ${value}::text::jsonb
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

export async function setDriverVerification(
  sql: Sql,
  actorUserId: string,
  driverId: string,
  status: string,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_set_driver_verification(
      ${actorUserId}::uuid, ${driverId}::uuid, ${status}::text
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

export async function setUserBlocked(
  sql: Sql,
  actorUserId: string,
  targetUserId: string,
  blocked: boolean,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_set_user_blocked(
      ${actorUserId}::uuid, ${targetUserId}::uuid, ${blocked}::boolean
    ) as result
  `;
  return readWrite(rows[0]?.result);
}
