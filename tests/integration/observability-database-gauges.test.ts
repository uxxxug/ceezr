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
  createDatabaseGaugeCollector,
  createOperationalMetrics,
} from "../../packages/infrastructure/observability/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

interface ExpectedGaugesRow {
  readonly searching_orders: number;
  readonly available_drivers: number;
  readonly expired_subscriptions_today: number;
  readonly last_successful_backup_timestamp_seconds: number | null;
}

let sql: Sql;

describe("gauges المراقبة على قاعدة PostgreSQL حقيقية", () => {
  beforeAll(() => {
    if (DATABASE_URL === undefined) {
      throw new Error("يتطلب اختبار gauges تعيين TEST_DATABASE_URL");
    }
    sql = createSql({ connectionString: DATABASE_URL });
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
          where status = 'success') as last_successful_backup_timestamp_seconds
    `;
    const expected = expectedRows[0];
    expect(first.value).toEqual({
      searchingOrders: expected?.searching_orders ?? 0,
      availableDrivers: expected?.available_drivers ?? 0,
      expiredSubscriptionsToday: expected?.expired_subscriptions_today ?? 0,
      lastSuccessfulBackupTimestampSeconds: expected?.last_successful_backup_timestamp_seconds ?? 0,
    });

    const beforeCachedRender = metrics.registry.render();
    nowMs += 1_000;
    const second = await collector.collect();
    expect(second).toEqual(first);
    const afterCachedRender = metrics.registry.render();
    expect(afterCachedRender).toBe(beforeCachedRender);
  });
});
