/**
 * الغرض: قراءة gauges المراقبة من PostgreSQL الحقيقي وإثبات أنها تطابق القاعدة لا
 *   قيماً صورية، مع اختبار cache القصير الذي يحمي مسار /metrics من تكرار الاستعلام.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI وخدمة Render التي تجمع /metrics.
 * ملاحظات مستقبلية: لا يكتب هذا الاختبار في جداول التشغيل كي لا يتسابق مع اختبارات التكامل.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  ASSIGNMENT_WINDOW_SECONDS,
  createDatabaseGaugeCollector,
  createOperationalMetrics,
} from "../../packages/infrastructure/observability/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

interface ExpectedGaugesRow {
  readonly searching_orders: number;
  readonly available_drivers: number;
  readonly expired_subscriptions_today: number;
  readonly last_successful_backup_timestamp_seconds: number | null;
  readonly outbox_depth: number;
  readonly outbox_claimed: number;
  readonly telegram_jobs_depth: number;
  readonly telegram_jobs_claimed: number;
  readonly connections_limit: number;
  readonly matched_in_window: number;
}

let sql: Sql;

/**
 * التخطّي عند غياب القاعدة — لا الإسقاط.
 *
 * كان هذا الملفّ وحده يرمي في `beforeAll` عند غياب `TEST_DATABASE_URL`، وسائرُ
 * اختبارات التكامل تتخطّى بتحذير. ووظيفةُ `verify` في CI تُشغّل `bun test` كاملةً
 * **بلا** قاعدة عن قصد، فكان هذا الملفّ يُسقط CI في كلّ دفعةٍ على كلّ فرع — أي
 * أنّ CI كان أحمرَ دائماً لسببٍ لا علاقة له بأيّ تغيير. وحمرةٌ دائمةٌ أسوأ من
 * لا CI: تُدرَّب العينُ على تجاهل العلامة، فيمرّ الإخفاق الحقيقيّ بينها.
 *
 * والتخطّي هنا ليس تهويناً: وظيفةُ `integration` تُشغّل نفس الملفّ **بقاعدةٍ
 * حقيقيّة**، وفيها خطوةٌ تُسقط البناء إن ظهرت كلمة «مُتخطّاة» في مخرجاتها. فلا
 * سبيلَ إلى أن يمرّ هذا الاختبار متخطّى في الموضع الذي يجب أن يجري فيه.
 */
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة gauges.");
}

describeIf("gauges المراقبة على قاعدة PostgreSQL حقيقية", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("تقرأ الطلبات والسائقين والاشتراكات والنسخة الاحتياطية من SQL ثم تعيد cache", async () => {
    const metrics = createOperationalMetrics();
    let nowMs = 1_000;
    const collector = createDatabaseGaugeCollector(sql, metrics, {
      now: () => nowMs,
      cacheTtlMs: 15_000,
      statementTimeoutMs: 2_000,
    });

    const first = await collector.collect();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const expectedRows = await sql<ExpectedGaugesRow[]>`
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
        (select count(*)::int from notification_outbox
          where status in ('pending', 'sending')) as outbox_depth,
        (select count(*)::int from notification_outbox
          where status = 'sending') as outbox_claimed,
        (select count(*)::int from telegram_update_jobs
          where status in ('pending', 'claimed')) as telegram_jobs_depth,
        (select count(*)::int from telegram_update_jobs
          where status = 'claimed') as telegram_jobs_claimed,
        (select current_setting('max_connections')::int) as connections_limit,
        (select count(*)::int from orders
          where matched_at is not null
            and matched_at >= now() - make_interval(secs => ${ASSIGNMENT_WINDOW_SECONDS}))
          as matched_in_window
    `;
    const expected = expectedRows[0];
    expect(first.value).toEqual({
      searchingOrders: expected?.searching_orders ?? 0,
      availableDrivers: expected?.available_drivers ?? 0,
      expiredSubscriptionsToday: expected?.expired_subscriptions_today ?? 0,
      lastSuccessfulBackupTimestampSeconds: expected?.last_successful_backup_timestamp_seconds ?? 0,
      queues: first.value.queues,
      connections: first.value.connections,
      maxConnections: expected?.connections_limit ?? 0,
      assignment: first.value.assignment,
    });

    // الاتّصالاتُ (F8-02): الحالاتُ الأربعُ مُغطّاةٌ ومجموعُها لا يتجاوزُ السقفَ
    // المُعلَنَ في المحرِّكِ. ولا تُقارَنُ بعددٍ ثابتٍ: الاتّصالاتُ تتغيّرُ بينَ
    // الاستعلامَينِ بطبعِها، والدعوى القابلةُ للفحصِ هي الحدُّ لا القيمةُ.
    expect(first.value.connections.map((entry) => entry.state)).toEqual([
      "active",
      "idle",
      "idle_in_transaction",
      "other",
    ]);
    expect(first.value.maxConnections).toBeGreaterThan(0);
    const totalConnections = first.value.connections.reduce((sum, entry) => sum + entry.count, 0);
    expect(totalConnections).toBeGreaterThan(0);
    expect(totalConnections).toBeLessThanOrEqual(first.value.maxConnections);

    // زمنُ الإسنادِ (F8-02): النافذةُ **منشورةٌ** معَ الأرقامِ، والعدُّ يطابقُ
    // استعلاماً مستقلّاً، والمئينانِ غيرُ سالبَينِ و p90 ≥ p50 بحكمِ التعريفِ.
    expect(first.value.assignment.windowSeconds).toBe(ASSIGNMENT_WINDOW_SECONDS);
    expect(first.value.assignment.matchedInWindow).toBe(expected?.matched_in_window ?? 0);
    expect(first.value.assignment.p50Seconds).toBeGreaterThanOrEqual(0);
    expect(first.value.assignment.p90Seconds).toBeGreaterThanOrEqual(
      first.value.assignment.p50Seconds,
    );
    // ولا إسنادَ في النافذةِ يُنشَرُ صفراً بعدٍّ صفرٍ، فيُقرأُ غياباً لا سرعةً.
    if (first.value.assignment.matchedInWindow === 0) {
      expect(first.value.assignment.p50Seconds).toBe(0);
      expect(first.value.assignment.p90Seconds).toBe(0);
    }

    // حِمْلُ الطوابيرِ يُقابَلُ باستعلامٍ **مستقلٍّ** لا بقيمةٍ منسوخةٍ من المُجمِّعِ
    // نفسِه: مطابقةُ الشيءِ بنفسِه تنجحُ دائماً ولا تُثبِتُ شيئاً (F6-06).
    expect(first.value.queues.map((queue) => queue.queue)).toEqual([
      "notification_outbox",
      "telegram_update_jobs",
    ]);
    const outbox = first.value.queues[0];
    const jobs = first.value.queues[1];
    expect(outbox?.depth).toBe(expected?.outbox_depth ?? 0);
    expect(outbox?.claimed).toBe(expected?.outbox_claimed ?? 0);
    expect(jobs?.depth).toBe(expected?.telegram_jobs_depth ?? 0);
    expect(jobs?.claimed).toBe(expected?.telegram_jobs_claimed ?? 0);
    // العمرُ لا يُقارَنُ بقيمةٍ ثابتةٍ — إنَّه يزيدُ بينَ الاستعلامَينِ. والدعوى
    // القابلةُ للفحصِ: طابورٌ فارغٌ عمرُه صفرٌ، وطابورٌ ذو مستحقٍّ عمرُه غيرُ سالبٍ.
    for (const queue of first.value.queues) {
      expect(queue.oldestDueAgeSeconds).toBeGreaterThanOrEqual(0);
      // عمقٌ صفرٌ يعني لا معلَّقَ ولا محجوزَ، فلا مستحقَّ، فالعمرُ صفرٌ حتماً.
      if (queue.depth === 0) expect(queue.oldestDueAgeSeconds).toBe(0);
      expect(queue.deadInWindow).toBeGreaterThanOrEqual(0);
    }

    const beforeCachedRender = metrics.registry.render();
    nowMs += 1_000;
    const second = await collector.collect();
    expect(second).toEqual(first);
    const afterCachedRender = metrics.registry.render();
    expect(afterCachedRender).toBe(beforeCachedRender);
  });
});
