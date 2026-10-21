/**
 * الغرض: LOAD-01 (الدفعةُ 31) — الالتقاطُ المسبَقُ في درينرِ تيليجرام على PostgreSQL حقيقي.
 *   الدُّفعةُ صارت بحصّةِ البوتِ من المساراتِ لا بالفارغِ منها لحظةَ الرحلة، فقد تنتظرُ وظيفةٌ ملتقَطةٌ
 *   في المخزَّنِ حتى يفرغَ مسار. هذا الشاهدُ يُثبتُ أنّ انتظارَها لا يُفلتُ إيجارَها: إيجارٌ 1ث، ومعالجةٌ
 *   1.6ث، ووظيفةٌ تنتظرُ في المخزَّنِ أطولَ من الإيجار، وشوطٌ ثانٍ متداخلٌ يلتقطُ كلَّ ما انتهى إيجارُه
 *   ⇒ كلُّ وظيفةٍ تُعالَجُ مرّةً واحدةً وتُختَم، ومحاولتُها 1.
 *   يتطلّبُ TEST_DATABASE_URL بقاعدةٍ مهاجَرة. يعزلُ نفسَه بمعرّفاتِ update_id فريدةٍ وcreated_at أقدم.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const URL = process.env.TEST_DATABASE_URL;
const d = URL === undefined ? describe.skip : describe;
let sql: Sql;
const BASE = 9_800_000 + (Date.now() % 100_000) * 10;
const N = 6;
// الوظائفُ 1 و2 و3 و5 طويلة، و4 و6 قصيرة: بعدَ أن تنتهيَ 4 تُعيدُ الرحلةُ [5، 6] والجاري 3 من 4،
// فيبدأُ 5 ويبقى 6 في المخزَّنِ حتى يفرغَ مسارٌ (~1.6ث) — أطولَ من الإيجار.
const LONG = new Set([0, 1, 2, 4].map((i) => BASE + i));

d("ب31 على قاعدةٍ حقيقية: المخزَّنُ بالالتقاطِ المسبَقِ لا يُفلتُ إيجارَه", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: URL ?? "" });
    for (let i = 0; i < N; i++)
      await sql`select claim_and_enqueue_telegram_update('driver', ${BASE + i}, ${sql.json({ update_id: BASE + i, message: { from: { id: 88_000 + i }, chat: { id: 88_000 + i } } })}::jsonb, 100)`;
    await sql`update telegram_update_jobs
                 set created_at = timestamptz '2000-01-01' + make_interval(secs => (update_id - ${BASE}))
               where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
  });
  afterAll(async () => {
    await sql`delete from telegram_update_jobs where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql`delete from telegram_update_receipts where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1}`;
    await sql.end({ timeout: 2 });
  });

  it("وظيفةٌ تنتظرُ في المخزَّنِ أطولَ من الإيجار، وشوطٌ متداخل: كلٌّ مرّةً واحدةً وتُختَم", async () => {
    const queue = createPostgresTelegramUpdateQueue(sql, {
      leaseTimeoutSeconds: 1,
      maxAttempts: 5,
      retryDelaySeconds: 1,
    });
    expect(queue.claimBatchFor).toBeDefined();
    const handled = new Map<number, number>();
    const startedAt = new Map<number, number>();
    const t0 = Date.now();
    const handler = {
      handle: async (_bot: string, payload: unknown) => {
        const id = (payload as { update_id: number }).update_id;
        handled.set(id, (handled.get(id) ?? 0) + 1);
        if (!startedAt.has(id)) startedAt.set(id, Date.now() - t0);
        await new Promise((r) => setTimeout(r, LONG.has(id) ? 1600 : 20));
        return true;
      },
    };
    const stamps: string[] = [];
    const deps = {
      queue,
      handler: handler as never,
      maxJobsPerRun: N,
      lanes: 4,
      fairBots: ["driver", "rider"] as const,
      leaseRenewEveryMs: 300,
      log: (m: string) => void stamps.push(m),
    };
    await Promise.all([
      drainTelegramUpdateJobsOnce(deps as never),
      (async () => {
        await new Promise((r) => setTimeout(r, 1300));
        await drainTelegramUpdateJobsOnce({ ...deps, maxJobsPerRun: 50 } as never);
      })(),
    ]);
    const ours = [...handled.keys()].filter((id) => id >= BASE && id < BASE + N);
    expect(ours.length).toBe(N);
    for (const id of ours) expect(handled.get(id)).toBe(1);
    // الشاهدُ يختبرُ ما وُضِعَ له: الأخيرةُ بدأت بعدَ انتهاءِ إيجارٍ لم يُجدَّد (> 1ث من الالتقاط).
    expect(startedAt.get(BASE + N - 1) ?? 0).toBeGreaterThan(1200);
    expect(stamps.filter((s) => s === "telegram.drainer.stamp_failed").length).toBe(0);
    const rows = await sql<{ status: string; attempts: number; n: number }[]>`
      select status::text, attempts, count(*)::int n from telegram_update_jobs
       where bot = 'driver' and update_id between ${BASE} and ${BASE + N - 1} group by 1, 2`;
    expect([...rows]).toEqual([{ status: "done", attempts: 1, n: N }]);
  }, 30_000);
});
