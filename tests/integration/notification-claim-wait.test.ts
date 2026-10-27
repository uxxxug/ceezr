/**
 * `LOAD-01` (CLAIM-WAIT) على postgres.js 3.4.9 وPostgreSQL حقيقيّين. يتحقّقُ من أنّ الرصدَ يميّزُ
 * بين ثلاثِ حالاتٍ معروفةٍ مسبقًا:
 * - **انتظارُ التجمّع**: تجمّعٌ باتّصالٍ واحدٍ تحجزُه معاملةٌ مفتوحة، فلا يُكتبُ الاستعلامُ قبلَ انتهائها.
 * - **الأنبوب**: الاتّصالُ الوحيدُ مشغولٌ باستعلامٍ بطيءٍ خارجَ معاملة، فيُكتبُ الاستعلامُ فورًا وينتظرُ خلفَه.
 * - **الخلوّ**: لا انتظار.
 * ويتحقّقُ أيضًا من أنّ عدّادَ ما في الطيرانِ يعدُّ الاستعلامَ المنفَّذَ والمعاملة، ويعودُ صفرًا، ولا يعدُّ
 * المقطعَ المتداخلَ الذي لا يُنفَّذُ وحدَه. وأنّ المحوّلَ المشعَلَ يُرجعُ تفصيلًا مرصودًا للاستعلامين.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createSql,
  type Sql,
  withRequestContext,
} from "../../packages/infrastructure/db/client.ts";
import {
  createCalibratedClock,
  instrumentPoolSql,
  observeQuery,
} from "../../packages/infrastructure/notification/claim-split-probe.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const TAG = "claim-wait";

let raw: Sql;
let cityId = "";
const clock = createCalibratedClock();
const now = () => clock.realtimeMs();

describeIf("مراحلُ الاستعلامِ وما في الطيران — CLAIM-WAIT", () => {
  beforeAll(async () => {
    raw = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    await raw`select 1`;
    const city = await raw<{ id: string }[]>`select id from cities where code = 'JED'`;
    cityId = city[0]?.id ?? "";
    if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
    clock.calibrate();
  });

  afterAll(async () => {
    await raw`delete from notification_outbox where dedup_key like ${`${TAG}:%`}`;
    await raw.end();
  });

  it("الخلوّ: لا انتظارَ في التجمّعِ ولا في الأنبوب", async () => {
    const t0 = now();
    const q = raw`select 1 as x`;
    const o = observeQuery(q, now);
    await q;
    expect(o.pipelined).toBe(false);
    expect((o.tWrite ?? 0) - t0).toBeLessThan(5);
    expect((o.tActive ?? 0) - (o.tWrite ?? 0)).toBeLessThan(1);
    expect(o.tResolved).not.toBeNull();
  });

  it("الأنبوب: يُكتبُ فورًا خلفَ استعلامٍ بطيءٍ على الاتّصالِ نفسِه، فينتظرُ رأسَ الاتّصال", async () => {
    const slow = raw`select pg_sleep(0.08)`;
    const pending = slow.then(() => undefined);
    await Promise.resolve();
    const t0 = now();
    const q = raw`select 1 as x`;
    const o = observeQuery(q, now);
    await q;
    await pending;
    expect(o.pipelined).toBe(true);
    expect((o.tWrite ?? 0) - t0).toBeLessThan(10);
    expect((o.tActive ?? 0) - (o.tWrite ?? 0)).toBeGreaterThan(50);
  });

  it("انتظارُ التجمّع: معاملةٌ تحجزُ الاتّصالَ الوحيد، فلا يُكتبُ الاستعلامُ قبلَ انتهائها", async () => {
    const pooled = instrumentPoolSql(raw);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const tx = withRequestContext(pooled.sql, async (t) => {
      await t`select 1`;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(pooled.counter.read()).toEqual({ queries: 0, transactions: 1 });
    const t0 = now();
    const q = pooled.sql`select 1 as x`;
    const o = observeQuery(q, now);
    const done = q.then(() => undefined);
    await new Promise((r) => setTimeout(r, 60));
    expect(o.tWrite).toBeNull();
    expect(pooled.counter.read()).toEqual({ queries: 1, transactions: 1 });
    release();
    await tx;
    await done;
    expect((o.tWrite ?? 0) - t0).toBeGreaterThan(50);
    expect(pooled.counter.read()).toEqual({ queries: 0, transactions: 0 });
  });

  it("العدّاد: المقطعُ المتداخلُ لا يُعَدّ، والخطأُ يُنقِصُ كالنجاح", async () => {
    const pooled = instrumentPoolSql(raw);
    const frag = pooled.sql`1`;
    await pooled.sql`select ${frag} as x`.catch(() => undefined);
    await pooled.sql`select ${2}::int as x`;
    await pooled.sql`select 1/0`.catch(() => undefined);
    await pooled.sql.unsafe("select 1");
    expect(pooled.counter.read()).toEqual({ queries: 0, transactions: 0 });
  });

  it("المحوّلُ المشعَل: تفصيلٌ مرصودٌ للاستعلامين، وما في الطيرانِ مقروءٌ قبلَ الإصدار", async () => {
    await raw`
      insert into notification_outbox (city_id, kind, dedup_key, status, attempts, next_attempt_at)
      values (${cityId}::uuid, 'dispute_resolution', ${`${TAG}:${crypto.randomUUID()}`}, 'pending', 0, now())`;
    const pooled = instrumentPoolSql(raw);
    const port = createNotificationOutboxPort(pooled.sql, {
      claimSplit: { realtimeMs: now, inflight: pooled.counter.read, poolMax: 1 },
    });
    const r = await port.claim();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.value.timing?.detail ?? [];
    expect(d.length).toBe(r.value.delivery === null ? 1 : 2);
    for (const x of d) {
      expect(x.stamped).toBe(true);
      expect(x.skewed).toBe(false);
      expect(x.inflight).toEqual({ queries: 0, transactions: 0 });
      expect(x.busyAtIssue).toBe(false);
      expect(x.poolMs).toBeGreaterThanOrEqual(0);
      expect(x.postWireMs + x.contMs).toBeCloseTo(x.postMs, 6);
    }
    console.log(
      `── CLAIM-WAIT: ${d
        .map(
          (x) =>
            `q${x.index} pre=${x.preMs.toFixed(2)} (pool ${x.poolMs.toFixed(2)} pipe ${x.pipeMs.toFixed(2)}) server=${x.serverMs.toFixed(2)} post=${x.postMs.toFixed(2)} (wire ${x.postWireMs.toFixed(2)} cont ${x.contMs.toFixed(2)})`,
        )
        .join(" · ")}`,
    );
  });
});
