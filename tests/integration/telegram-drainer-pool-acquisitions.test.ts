/**
 * الغرض: LOAD-01 (الدفعةُ 28) — شاهدٌ سببيٌّ على PostgreSQL حقيقيّ لحجوزاتِ مجمّعِ الاتصالاتِ لكلِّ
 *   وظيفةِ Telegram في الدرينر. يَعُدُّ الحجوزاتِ من داخلِ بوّابةِ المجمّع (`query-deadline.ts`:
 *   كلُّ حدثٍ `query`/`tx` من `observeQueryTimings` = حجزُ مقعدٍ واحد؛ `txQuery` على مقعدٍ محجوز)،
 *   لا بعدِّ نصوصِ الاستعلامات. على `main` يُحجَزُ مقعدٌ لفحصِ `telegram_update_effect_recorded`
 *   لكلِّ وظيفةٍ والفحصُ باطلٌ حتمًا ما دامَ الإيجارُ طازجًا؛ المرشّحُ يُسقِطُه في تلك النافذةِ فقط.
 *   ويحرسُ: لا اتصالاتٍ جديدة ولا تغييرَ في سعةِ المجمّع، لا فقدَ ولا تكرارَ تحتَ درينرَين متزامنَين،
 *   الفحصُ باقٍ للإيجارِ القديم، فشلُ العبارةِ/التراجعُ/قطعُ الاتصالِ لا يتركُ وظيفةً محجوزة،
 *   وترتيبُ تحديثاتِ المستخدمِ الواحد محفوظ.
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. `B28_WITNESS_OUT` (اختياريّ) = ملفُّ JSON للنتائجِ الخام.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  observeQueryTimings,
  type QueryTiming,
} from "../../packages/infrastructure/db/query-deadline.ts";
import {
  createPostgresTelegramUpdateQueue,
  type TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
const APP = "b28-witness";
const POOL_MAX = 5; // = gatewayRequest في المقعد والإنتاج؛ لا يُغيَّر
const BASE = 8_800_000 + (Date.now() % 100_000) * 10;
const SPAN = 1_000;

let admin: Sql;
let pool: Sql;
const events: QueryTiming[] = [];
const results: Record<string, unknown> = {};
let parked: { bot: string; update_id: number; next_attempt_at: Date }[] = [];

async function enqueue(id: number, user: number, secs: number) {
  await admin`select claim_and_enqueue_telegram_update('driver', ${id}, ${admin.json({ update_id: id, message: { from: { id: user }, chat: { id: user } } })}::jsonb, 100000)`;
  await admin`update telegram_update_jobs set created_at = timestamptz '2001-01-01' + make_interval(secs => ${secs})
               where bot = 'driver' and update_id = ${id}`;
}

async function statusOf(from: number, to: number) {
  return admin<{ update_id: number; status: string; attempts: number; recorded: boolean }[]>`
    select update_id::int, status, attempts, effect_recorded_at is not null as recorded
      from telegram_update_jobs where bot = 'driver' and update_id between ${from} and ${to}
     order by update_id`;
}

function acquisitions(since: number) {
  const list = events.slice(since).filter((e) => e.label === APP && e.kind !== "txQuery");
  const bySig: Record<string, number> = {};
  for (const e of list) {
    const key = (e.sig ?? "?").replace(/\(.*$/, "").slice(0, 60);
    bySig[key] = (bySig[key] ?? 0) + 1;
  }
  return { total: list.length, bySig };
}

/** معالجٌ مُتَحكَّمٌ به: استعلامُ قاعدةٍ ثابتٌ في الأثر (يمثّلُ مستودعاتِ المعالج) وردٌّ واحد. */
function makeHandler(opts: { onPrepare?: (id: number, n: number) => Promise<void> } = {}) {
  const prepared = new Map<number, number>();
  const order: number[] = [];
  const handler = {
    handle: async () => true,
    prepare: async (_bot: string, payload: unknown) => {
      const id = (payload as { update_id: number }).update_id;
      const n = (prepared.get(id) ?? 0) + 1;
      prepared.set(id, n);
      order.push(id);
      await pool`select 1 as b28_prepare_stub`;
      await opts.onPrepare?.(id, n);
      return { handled: true, replies: [{ text: `r${id}` }] };
    },
    deliver: async (_bot: string, replies: readonly unknown[]) => ({
      sent: replies.length,
      error: null,
    }),
  };
  return { handler, prepared, order };
}

async function drainUntil(
  deps: Parameters<typeof drainTelegramUpdateJobsOnce>[0],
  from: number,
  to: number,
  maxRounds = 40,
) {
  for (let i = 0; i < maxRounds; i++) {
    await drainTelegramUpdateJobsOnce(deps);
    const rows = await statusOf(from, to);
    if (rows.every((r) => r.status === "done")) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return statusOf(from, to);
}

d("الدفعة 28: حجوزاتُ المجمّعِ لكلِّ وظيفةٍ في الدرينر (PostgreSQL حقيقي)", () => {
  beforeAll(async () => {
    admin = createSql({ connectionString: URL ?? "" });
    pool = createSql({
      connectionString: URL ?? "",
      max: POOL_MAX,
      queryDeadlineMs: 15_000,
      applicationName: APP,
      idleTimeoutSeconds: null,
    });
    // عزلٌ: وظائفُ معلَّقةٌ من ملفّاتٍ أخرى تُؤجَّلُ مؤقّتًا وتُعادُ كما كانت في afterAll.
    parked = [
      ...(await admin<{ bot: string; update_id: number; next_attempt_at: Date }[]>`
        with old as (select bot, update_id, next_attempt_at from telegram_update_jobs
                      where status = 'pending' and not (update_id between ${BASE} and ${BASE + SPAN}))
        update telegram_update_jobs j set next_attempt_at = now() + interval '1 day'
          from old where j.bot = old.bot and j.update_id = old.update_id
        returning old.bot, old.update_id::int, old.next_attempt_at`),
    ];
    observeQueryTimings((t) => void events.push(t));
  });
  afterAll(async () => {
    observeQueryTimings(null);
    for (const p of parked)
      await admin`update telegram_update_jobs set next_attempt_at = ${p.next_attempt_at}
                   where bot = ${p.bot} and update_id = ${p.update_id} and status = 'pending'`;
    await admin`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    await admin`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + SPAN}`;
    const out = process.env.B28_WITNESS_OUT;
    if (out !== undefined && out !== "")
      writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    await pool.end({ timeout: 2 });
    await admin.end({ timeout: 2 });
  });

  it("W1 الشاهد: لا حجزَ لفحصِ الأثرِ والإيجارُ طازج — والإجماليُّ لكلِّ وظيفةٍ ينقصُ ولا يزيد", async () => {
    const N = 60;
    for (let i = 0; i < N; i++) await enqueue(BASE + i, 70_000 + i, i);
    const { handler, prepared } = makeHandler();
    const queue = createPostgresTelegramUpdateQueue(pool);
    const since = events.length;
    const rows = await drainUntil(
      { queue, handler: handler as never, lanes: 8, fairBots: ["driver", "rider"] },
      BASE,
      BASE + N - 1,
    );
    const acq = acquisitions(since);
    const effectChecks = acq.bySig["select telegram_update_effect_recorded"] ?? 0;
    const backends = await admin<{ n: number }[]>`
      select count(*)::int n from pg_stat_activity where application_name = ${APP}`;
    results.W1 = {
      jobs: N,
      acquisitionsTotal: acq.total,
      acquisitionsPerJob: acq.total / N,
      bySig: acq.bySig,
      effectCheckAcquisitionsPerJob: effectChecks / N,
      backends: backends[0]?.n ?? null,
      poolMax: POOL_MAX,
    };
    expect(rows.length).toBe(N);
    expect(rows.every((r) => r.status === "done" && r.recorded)).toBe(true);
    expect([...prepared.values()].every((n) => n === 1)).toBe(true);
    expect(prepared.size).toBe(N);
    // لا اتصالاتٍ جديدة: الخلفيّاتُ لا تتجاوزُ سعةَ المجمّع.
    expect(backends[0]?.n ?? 0).toBeLessThanOrEqual(POOL_MAX);
    // الشرطُ السببيُّ (يفشلُ على main حيثُ = 1.0).
    expect(effectChecks).toBe(0);
  });

  it("W2 درينران متزامنان على مجمّعَين: لا فقدَ ولا تكرارَ ولا محجوزَ عالق", async () => {
    const from = BASE + 100;
    const N = 80;
    for (let i = 0; i < N; i++) await enqueue(from + i, 71_000 + (i % 40), 100 + i);
    const { handler, prepared } = makeHandler();
    const qa = createPostgresTelegramUpdateQueue(pool);
    const other = createSql({
      connectionString: URL ?? "",
      max: POOL_MAX,
      applicationName: `${APP}-b`,
    });
    try {
      const qb = createPostgresTelegramUpdateQueue(other);
      const depsA = {
        queue: qa,
        handler: handler as never,
        lanes: 8,
        fairBots: ["driver", "rider"],
      };
      const depsB = {
        queue: qb,
        handler: handler as never,
        lanes: 8,
        fairBots: ["driver", "rider"],
      };
      for (let r = 0; r < 20; r++) {
        await Promise.all([drainTelegramUpdateJobsOnce(depsA), drainTelegramUpdateJobsOnce(depsB)]);
        const rows = await statusOf(from, from + N - 1);
        if (rows.every((x) => x.status === "done")) break;
      }
    } finally {
      await other.end({ timeout: 2 });
    }
    const rows = await statusOf(from, from + N - 1);
    const dup = [...prepared.values()].filter((n) => n > 1).length;
    results.W2 = {
      jobs: N,
      done: rows.filter((r) => r.status === "done").length,
      dup,
      prepared: prepared.size,
    };
    expect(rows.every((r) => r.status === "done" && r.recorded && r.attempts === 1)).toBe(true);
    expect(prepared.size).toBe(N);
    expect(dup).toBe(0);
  });

  it("W3 الإيجارُ القديم: يبقى الفحصُ، وأثرٌ ختمَه حائزٌ آخرُ لا يُعادُ تنفيذُه", async () => {
    const id = BASE + 300;
    await enqueue(id, 72_000, 300);
    const qa = createPostgresTelegramUpdateQueue(pool, { leaseTimeoutSeconds: 1 });
    const qb = createPostgresTelegramUpdateQueue(pool, { leaseTimeoutSeconds: 1 });
    const claimedA = await (qa.claimBatchFor as NonNullable<TelegramUpdateQueue["claimBatchFor"]>)(
      "driver",
      100,
    );
    const stale = claimedA.jobs.find((j) => j.updateId === id);
    expect(stale).toBeDefined();
    await new Promise((r) => setTimeout(r, 1_300)); // إيجارُ A انقضى
    const b = makeHandler();
    await drainUntil(
      { queue: qb, handler: b.handler as never, lanes: 4, fairBots: ["driver"] },
      id,
      id,
    );
    expect(b.prepared.get(id)).toBe(1);
    // A يستأنفُ وظيفتَه القديمةَ (رمزٌ منتهٍ): يجبُ أن يفحصَ فيرى الأثرَ ولا يعيدَ التنفيذ.
    let served = false;
    const replay: TelegramUpdateQueue = {
      ...qa,
      claimBatchFor: async () => {
        if (served) return { jobs: [] };
        served = true;
        return { jobs: stale === undefined ? [] : [stale] };
      },
      claimFor: async () => ({ job: null }),
      claim: async () => ({ job: null }),
    };
    const a = makeHandler();
    const since = events.length;
    await drainTelegramUpdateJobsOnce({
      queue: replay,
      handler: a.handler as never,
      lanes: 4,
      fairBots: ["driver", "rider"],
    });
    const acq = acquisitions(since);
    results.W3 = {
      staleEffectChecks: acq.bySig["select telegram_update_effect_recorded"] ?? 0,
      reExecuted: a.prepared.size,
    };
    expect(acq.bySig["select telegram_update_effect_recorded"] ?? 0).toBe(1);
    expect(a.prepared.size).toBe(0);
    const rows = await statusOf(id, id);
    expect(rows[0]?.status).toBe("done");
  });

  it("W4 فشلُ العبارة/التراجع: فشلُ الأثرِ وختمٌ مرفوضٌ لا يتركان وظيفةً محجوزة", async () => {
    const from = BASE + 400;
    await enqueue(from, 73_000, 400); // الأثرُ يرمي في المحاولةِ الأولى
    await enqueue(from + 1, 73_001, 401); // الختمُ يُرفَضُ (سُرِقَ الرمز) في الأولى
    const queue = createPostgresTelegramUpdateQueue(pool, {
      leaseTimeoutSeconds: 1,
      retryDelaySeconds: 0,
    });
    const { handler, prepared } = makeHandler({
      onPrepare: async (id, n) => {
        if (n > 1) return;
        if (id === from) throw new Error("b28: prepare failure");
        if (id === from + 1)
          await admin`update telegram_update_jobs set claim_token = gen_random_uuid()
                       where bot = 'driver' and update_id = ${id}`;
      },
    });
    const rows = await drainUntil(
      { queue, handler: handler as never, lanes: 4, fairBots: ["driver"] },
      from,
      from + 1,
    );
    results.W4 = { rows, prepared: Object.fromEntries(prepared) };
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(rows.every((r) => r.recorded)).toBe(true);
  });

  it("W5 انقطاعُ PostgreSQL أثناءَ الوظيفة: تتعافى بانقضاءِ الإيجار ولا تبقى محجوزة", async () => {
    const from = BASE + 500;
    // وظيفةٌ واحدة: القطعُ يقعُ والمقاعدُ خاملةٌ (لا استعلامَ آخرَ طائر)، فالعبارةُ التاليةُ —
    // ختمُ الأثر — هي التي تلقى الاتصالَ المقطوع. (قطعُ اتصالٍ عليه استعلامٌ طائرٌ يرمي
    // postgres.js خطأً غيرَ ملتقَطٍ بينَ الاختبارات على main والمرشّحِ سواءً — موثَّقٌ في الحزمة.)
    await enqueue(from, 74_000, 500);
    const queue = createPostgresTelegramUpdateQueue(pool, {
      leaseTimeoutSeconds: 1,
      retryDelaySeconds: 0,
    });
    let killed = 0;
    let armed = false;
    const w5logs: unknown[] = [];
    const { handler } = makeHandler({
      onPrepare: async (_id, n) => {
        if (n > 1 || armed) return;
        armed = true; // مرّةً واحدة: المساراتُ متوازيةٌ فلا يُعادُ القطعُ ولا يُكتَبُ فوقَ العدد
        await new Promise((r) => setTimeout(r, 50));
        const r = await admin<{ n: number }[]>`
          select count(pg_terminate_backend(pid))::int n from pg_stat_activity
           where application_name = ${APP} and pid <> pg_backend_pid()`;
        killed += r[0]?.n ?? 0;
      },
    });
    const t0 = performance.now();
    const ev0 = events.length;
    const rows = await drainUntil(
      {
        queue,
        handler: handler as never,
        lanes: 4,
        fairBots: ["driver"],
        log: (m: string, meta: Record<string, unknown>) =>
          void w5logs.push([Math.round(performance.now() - t0), m, meta]),
      },
      from,
      from,
    );
    const backends = await admin<{ n: number }[]>`
      select count(*)::int n from pg_stat_activity where application_name = ${APP}`;
    results.W5 = {
      killed,
      recoveryMs: Math.round(performance.now() - t0),
      events: events
        .slice(ev0)
        .filter((e) => e.label === APP)
        .map((e) => [
          e.kind,
          Math.round(e.waitMs),
          Math.round(e.runMs),
          (e.sig ?? "").slice(0, 40),
        ]),
      logs: w5logs,
      rows,
      backendsAfter: backends[0]?.n ?? null,
    };
    expect(killed).toBeGreaterThan(0);
    expect(rows.map((r) => r.status)).toEqual(["done"]);
    // المحاولةُ الأولى لم تُختَم (الاتصالُ مقطوع) فاستُرجِعَت. قد تقعُ عبارةٌ تاليةٌ على اتصالٍ
    // نصفِ ميّتٍ فتعلقُ حتى مهلةِ الاستعلام (15ث) فتُلغى ⇒ محاولةٌ ثالثة؛ رُصِدَ على main والمرشّحِ
    // كليهما (الحزمة 28). الثابتُ: تُتمُّ ولا تُفقَدُ ولا تبقى محجوزةً ولا تموت، ضمنَ المهلة+الإيجار.
    expect(rows[0]?.attempts ?? 0).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.attempts ?? 99).toBeLessThanOrEqual(3);
    expect(Number(results.W5 && (results.W5 as { recoveryMs: number }).recoveryMs)).toBeLessThan(
      15_000 + 5_000,
    );
    expect(backends[0]?.n ?? 0).toBeLessThanOrEqual(POOL_MAX);
  }, 60_000);

  it("W6 ترتيبُ تحديثاتِ المستخدمِ الواحد وآثارُها محفوظ", async () => {
    const from = BASE + 600;
    for (let i = 0; i < 5; i++) await enqueue(from + i, 75_000, 600 + i);
    const { handler, order } = makeHandler();
    const queue = createPostgresTelegramUpdateQueue(pool);
    const rows = await drainUntil(
      { queue, handler: handler as never, lanes: 8, fairBots: ["driver", "rider"] },
      from,
      from + 4,
    );
    const replies = await admin<
      { update_id: number; reply_status: string | null; replies_sent: number }[]
    >`
      select update_id::int, reply_status, replies_sent from telegram_update_jobs where bot = 'driver'
         and update_id between ${from} and ${from + 4} order by update_id`;
    results.W6 = { order, replies };
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(order).toEqual([from, from + 1, from + 2, from + 3, from + 4]);
    // الأثرُ الجانبيُّ (الردُّ) أُرسِلَ وخُتِمَ لكلِّ وظيفة.
    expect(replies.every((r) => r.replies_sent === 1)).toBe(true);
  });

  it("W7 صفٌّ مختومٌ أُعيدَ معلَّقًا يدويًّا يُختَمُ بالدُّفعيِّ بلا أثرٍ ثانٍ ولا حجزٍ للفحص", async () => {
    const id = BASE + 700;
    await enqueue(id, 76_000, 700);
    const queue = createPostgresTelegramUpdateQueue(pool);
    const first = makeHandler();
    const deps = {
      queue,
      handler: first.handler as never,
      lanes: 8,
      fairBots: ["driver", "rider"],
    };
    await drainUntil(deps, id, id);
    expect(first.prepared.get(id)).toBe(1);
    await admin`update telegram_update_jobs set status = 'pending', next_attempt_at = now() - interval '1 second'
                 where bot = 'driver' and update_id = ${id}`;
    const again = makeHandler();
    const log: string[] = [];
    const since = events.length;
    await drainTelegramUpdateJobsOnce({
      ...deps,
      handler: again.handler as never,
      log: (m: string) => void log.push(m),
    });
    const acq = acquisitions(since);
    const rows = await statusOf(id, id);
    results.W7 = {
      reExecuted: again.prepared.size,
      bySig: acq.bySig,
      status: rows[0]?.status,
      log,
    };
    expect(again.prepared.size).toBe(0);
    expect(log).toContain("telegram.drainer.effect_replay_skipped");
    expect(acq.bySig["select telegram_update_effect_recorded"] ?? 0).toBe(0);
    expect(rows[0]?.status).toBe("done");
  });
});
