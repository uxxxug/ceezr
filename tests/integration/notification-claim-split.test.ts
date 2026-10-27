/**
 * `LOAD-01` (CLAIM-SPLIT) على PostgreSQL حقيقيّ. يتحقّقُ من ثلاثة أمور:
 * - الاستعلامُ المفكَّكُ يُرجعُ ختمَي الخادمِ بترتيبٍ صحيح (`offset 0` يحجزُ الدالّة، فيأتي
 *   `clock_timestamp()` بعدَها)؛
 * - الأجزاءُ الثلاثةُ تجمعُ زمنَ النداءِ الجداريّ؛
 * - الاستعلامُ الافتراضيُّ لا يحملُ `timing` (لا تغييرَ حينَ يكونُ التفكيكُ مطفأً).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createCalibratedClock } from "../../packages/infrastructure/notification/claim-split-probe.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const TAG = "claim-split";

let sql: Sql;
let cityId = "";

describeIf("تفكيكُ زمنِ الالتقاط — CLAIM-SPLIT", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  });

  afterAll(async () => {
    await sql`delete from notification_outbox where dedup_key like ${`${TAG}:%`}`;
    await sql.end();
  });

  it("ختما الخادمِ مرتّبانِ والأجزاءُ تجمعُ الزمنَ الجداريّ؛ والافتراضيُّ بلا timing", async () => {
    // الترتيبُ نفسُه الذي يعتمدُ عليه المحوّل: الدالّةُ في استعلامٍ فرعيٍّ ثمّ الساعة.
    const order = await sql<{ st: number; ct: number }[]>`
      select (extract(epoch from statement_timestamp()) * 1000)::float8 as st,
             (extract(epoch from clock_timestamp()) * 1000)::float8 as ct
        from (select pg_sleep(0.05)::text r offset 0) x`;
    expect((order[0]?.ct ?? 0) - (order[0]?.st ?? 0)).toBeGreaterThanOrEqual(49);

    await sql`
      insert into notification_outbox (city_id, kind, dedup_key, status, attempts, next_attempt_at)
      values (${cityId}::uuid, 'dispute_resolution', ${`${TAG}:${crypto.randomUUID()}`}, 'pending', 0, now())`;

    const clock = createCalibratedClock();
    clock.calibrate();
    const split = createNotificationOutboxPort(sql, { claimSplit: clock });
    const t0 = clock.realtimeMs();
    const r = await split.claim();
    const wall = clock.realtimeMs() - t0;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.value.timing;
    expect(t).toBeDefined();
    if (t === undefined) return;
    expect(t.queries).toBe(r.value.delivery === null ? 1 : 2);
    expect(t.skewed).toBe(0);
    expect(t.serverMs).toBeGreaterThanOrEqual(0);
    const parts = t.preMs + t.serverMs + t.postMs;
    expect(parts).toBeLessThanOrEqual(wall + 1);
    expect(parts).toBeGreaterThan(0);
    console.log(
      `── CLAIM-SPLIT: wall=${wall.toFixed(2)}ms pre=${t.preMs.toFixed(2)} server=${t.serverMs.toFixed(2)} post=${t.postMs.toFixed(2)} queries=${t.queries}`,
    );

    const plain = createNotificationOutboxPort(sql);
    const p = await plain.claim();
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value.timing).toBeUndefined();
  });
});
