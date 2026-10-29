/**
 * الغرض: نبضةُ المهمّةِ العامّةِ لا تضيعُ حينَ لا مدينةَ مفعَّلة — هجرةُ
 *   `20261029180000_job_heartbeat_global_without_active_cities.sql`.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 *
 * كلُّ حالةٍ تجري داخلَ معاملةٍ تُلغى في آخرِها (`ROLLBACK_SENTINEL`)، فلا تتغيّرُ
 * حالةُ المدنِ ولا صفوفُ النبضِ لملفٍّ آخر. والتفعيلُ لا يُكتبُ هنا أصلًا: الحالةُ
 * الموجبةُ تختارُ مدينةً مفعَّلةً إن وُجدت في القاعدةِ، وإلّا تكتفي بحالةِ الصفر.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ROLLBACK_SENTINEL = "rollback-job-heartbeat-test";

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  نبضةُ المهمّةِ العامّةِ بلا مدينةٍ مفعَّلةٍ مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

let sql: Sql;

/** يُشغِّلُ `body` في معاملةٍ ثمّ يُلغيها دائمًا. */
async function inRolledBackTx(body: (tx: Sql) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await body(tx as unknown as Sql);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (cause) {
    if (!(cause instanceof Error) || cause.message !== ROLLBACK_SENTINEL) throw cause;
  }
}

describeIf("نبضةُ المهمّةِ العامّةِ بلا مدينةٍ مفعَّلة", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "", max: 2 });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("بلا مدينةٍ مفعَّلةٍ: صفٌّ لكلِّ مدينةٍ معرَّفة، فيراها `/ready`", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`update cities set is_active = false where is_active`;
      const totalRows = await tx<{ total: number }[]>`select count(*)::int as total from cities`;
      const total = totalRows[0]?.total ?? 0;
      const name = `hb-test-global-${crypto.randomUUID()}`;

      const resultRows = await tx<{ result: { ok: boolean; rows: number } }[]>`
        select record_job_heartbeat(${name}::text, null::uuid, 'ok'::text, null::text) as result
      `;
      expect(resultRows[0]?.result.ok).toBe(true);
      expect(resultRows[0]?.result.rows).toBe(total);

      const countRows = await tx<{ count: number }[]>`
        select count(*)::int as count from job_heartbeats where job_name = ${name}
      `;
      const count = countRows[0]?.count ?? -1;
      expect(count).toBe(total);
      expect(total).toBeGreaterThan(0);
    });
  });

  it("معَ مدينةٍ مفعَّلةٍ: صفوفُ المفعَّلةِ وحدَها، كما كانَ حرفًا", async () => {
    await inRolledBackTx(async (tx) => {
      const active = await tx<{ id: string }[]>`select id from cities where is_active`;
      if (active.length === 0) return; // لا تفعيلَ في هذا الملفِّ عن قصد (OPS-020).
      const name = `hb-test-active-${crypto.randomUUID()}`;
      await tx`select record_job_heartbeat(${name}::text, null::uuid, 'ok'::text, null::text)`;
      const rows = await tx<{ city_id: string }[]>`
        select city_id::text from job_heartbeats where job_name = ${name} order by city_id
      `;
      expect(rows.map((r) => r.city_id).sort()).toEqual(active.map((r) => r.id).sort());
    });
  });

  it("المهمّةُ المدنيّةُ لا تتأثّر: صفٌّ واحدٌ لمدينتِها", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`update cities set is_active = false where is_active`;
      const [city] = await tx<{ id: string }[]>`select id from cities limit 1`;
      if (city === undefined) throw new Error("لا مدينةَ في البذرة");
      const name = `hb-test-city-${crypto.randomUUID()}`;
      await tx`select record_job_heartbeat(${name}::text, ${city.id}::uuid, 'ok'::text, null::text)`;
      const countRows = await tx<{ count: number }[]>`
        select count(*)::int as count from job_heartbeats where job_name = ${name}
      `;
      const count = countRows[0]?.count ?? -1;
      expect(count).toBe(1);
    });
  });
});
