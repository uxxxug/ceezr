/**
 * الغرض: قراءة مؤشرات تشغيلية مختصرة من PostgreSQL عند طلب /metrics، مع cache قصير
 *   وstatement_timeout كي لا يصبح جامِع المراقبة نفسه حملاً أو نقطة تعطل.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/metrics.ts.
 * ملاحظات مستقبلية: إذا كبرت الجداول تُراجع EXPLAIN لهذه الاستعلامات قبل تقصير cache.
 */

import { QUEUE_DEAD_WINDOW_SECONDS } from "../../shared/config/queue-backpressure.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import type { DatabaseGaugeValues, OperationalMetrics } from "./metrics.ts";

interface GaugeRow {
  readonly searching_orders: number;
  readonly available_drivers: number;
  readonly expired_subscriptions_today: number;
  readonly last_successful_backup_timestamp_seconds: number | null;
  readonly outbox_depth: number;
  readonly outbox_oldest_due_age_seconds: number | null;
  readonly outbox_dead_recent: number;
  readonly outbox_claimed: number;
  readonly telegram_jobs_depth: number;
  readonly telegram_jobs_oldest_due_age_seconds: number | null;
  readonly telegram_jobs_dead_recent: number;
  readonly telegram_jobs_claimed: number;
}

export interface DatabaseGaugeCollectionError {
  readonly code: "DATABASE_GAUGE_COLLECTION_FAILED";
  readonly detail: string;
}

export interface DatabaseGaugeCollectorOptions {
  /** مدة حفظ قصيرة: تمنع تضخيم استعلامات العد عند تزامن جامعين Prometheus. */
  readonly cacheTtlMs?: number;
  /** حد زمني تقني داخل PostgreSQL؛ لا يترك الاستعلام العالق يستهلك اتصالاً. */
  readonly statementTimeoutMs?: number;
  readonly now?: () => number;
}

export interface DatabaseGaugeCollector {
  collect(): Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>>;
}

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 2_000;

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/**
 * الجواب محفوظ 15 ثانية افتراضياً، لا بدقائق: هذه أرقام إنذار حيّة، لكن قراءة أربعة
 * عدّادات عند كل طلب من أكثر من جامع تكلف القاعدة أكثر من قيمة الدقة اللحظية.
 */
export function createDatabaseGaugeCollector(
  sql: Sql,
  metrics: OperationalMetrics,
  options: DatabaseGaugeCollectorOptions = {},
): DatabaseGaugeCollector {
  const cacheTtlMs = positiveInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
  );
  const statementTimeoutMs = positiveInteger(
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const now = options.now ?? Date.now;
  let cached: { readonly atMs: number; readonly value: DatabaseGaugeValues } | null = null;
  let inFlight: Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>> | null = null;

  async function query(): Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>> {
    const startedAt = now();
    try {
      const rows = await sql.begin(async (transaction) => {
        // القيمة رقم مُطبّع محلياً قبل إدخالها في SET، فلا تدخل نصوص من طلب HTTP إلى SQL.
        await transaction.unsafe(`set local statement_timeout = ${statementTimeoutMs}`);
        return transaction<GaugeRow[]>`
          select
            (select count(*)::int from orders where status = 'searching') as searching_orders,
            (select count(*)::int from driver_availability where is_available) as available_drivers,
            (select count(*)::int
               from subscriptions
              where status = 'expired'
                and updated_at >= date_trunc('day', now())
                and updated_at < date_trunc('day', now()) + interval '1 day')
              as expired_subscriptions_today,
            (select extract(epoch from max(created_at))::float8
               from db_backups
              where status = 'success') as last_successful_backup_timestamp_seconds,
            -- حِمْلُ الطوابيرِ الصامدةِ (F6-06): مجموعٌ على المدنِ كلِّها، فلا وسمَ
            -- مدينةٍ في المقياسِ. والتعريفاتُ حرفاً حرفاً كما في دالَّتَي الحِمْلِ
            -- notification_outbox_load وtelegram_update_jobs_load: عمقٌ = عملٌ لم
            -- يُنهَ (معلَّقٌ + محجوزٌ)، وعمرٌ = أقدمُ **مستحقٍّ** معلَّقٍ، وموتى في
            -- نافذةٍ. واختلافُ التعريفِ بينَ اللوحةِ وحكمِ القاعدةِ هوَ عينُ العطبِ
            -- الذي يُصلِحُه هذا البندُ: رقمانِ باسمٍ واحدٍ ومعنيَينِ.
            (select count(*)::int from notification_outbox
              where status in ('pending', 'sending')) as outbox_depth,
            (select extract(epoch from now() - min(next_attempt_at))::float8
               from notification_outbox
              where status = 'pending' and next_attempt_at <= now())
              as outbox_oldest_due_age_seconds,
            (select count(*)::int from notification_outbox
              where status = 'dead' and died_at is not null
                and died_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as outbox_dead_recent,
            (select count(*)::int from notification_outbox
              where status = 'sending') as outbox_claimed,
            (select count(*)::int from telegram_update_jobs
              where status in ('pending', 'claimed')) as telegram_jobs_depth,
            (select extract(epoch from now() - min(coalesce(next_attempt_at, created_at)))::float8
               from telegram_update_jobs
              where status = 'pending' and coalesce(next_attempt_at, created_at) <= now())
              as telegram_jobs_oldest_due_age_seconds,
            (select count(*)::int from telegram_update_jobs
              where status = 'dead' and completed_at is not null
                and completed_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as telegram_jobs_dead_recent,
            (select count(*)::int from telegram_update_jobs
              where status = 'claimed') as telegram_jobs_claimed
        `;
      });
      const row = rows[0];
      const value: DatabaseGaugeValues = {
        searchingOrders: row?.searching_orders ?? 0,
        availableDrivers: row?.available_drivers ?? 0,
        expiredSubscriptionsToday: row?.expired_subscriptions_today ?? 0,
        lastSuccessfulBackupTimestampSeconds: row?.last_successful_backup_timestamp_seconds ?? 0,
        queues: [
          {
            queue: "notification_outbox",
            depth: row?.outbox_depth ?? 0,
            oldestDueAgeSeconds: row?.outbox_oldest_due_age_seconds ?? 0,
            deadInWindow: row?.outbox_dead_recent ?? 0,
            claimed: row?.outbox_claimed ?? 0,
          },
          {
            queue: "telegram_update_jobs",
            depth: row?.telegram_jobs_depth ?? 0,
            oldestDueAgeSeconds: row?.telegram_jobs_oldest_due_age_seconds ?? 0,
            deadInWindow: row?.telegram_jobs_dead_recent ?? 0,
            claimed: row?.telegram_jobs_claimed ?? 0,
          },
        ],
      };
      metrics.observeCriticalDatabaseQuery("operational_gauges", now() - startedAt);
      metrics.setDatabaseGauges(value);
      cached = { atMs: now(), value };
      return ok(value);
    } catch (cause) {
      metrics.observeCriticalDatabaseQuery("operational_gauges", now() - startedAt);
      metrics.recordDatabaseGaugeCollectionFailure();
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err({ code: "DATABASE_GAUGE_COLLECTION_FAILED", detail });
    }
  }

  return {
    collect: async () => {
      const current = cached;
      if (current !== null && now() - current.atMs < cacheTtlMs) return ok(current.value);
      if (inFlight !== null) return inFlight;
      inFlight = query();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}
