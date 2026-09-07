/**
 * الغرض: إثباتُ إغلاقِ `BUG-002` / `F6-02` على قاعدةٍ حقيقيّةٍ — أنّ استلامَ تحديثِ
 *   تيليجرام **صامدٌ** ومنعَ تكرارِه **ذرّيٌّ في القاعدةِ**، وأنّ المعالجةَ مفصولةٌ
 *   عن مسارِ HTTP: الويبهوكُ يُودعُ الإيصالَ والوظيفةَ بالحمولةِ ذرّيًّا ويعيدُ ACK
 *   سريعاً **دونَ استدعاءِ `handler.handle`**، والدرينرُ الخلفيُّ يلتقطُ الوظيفةَ
 *   بإيجارٍ ويُعالجُها ويُختمُها برمزِها.
 *
 *   ثمانيةُ أقسامٍ بحرفِ ما توجبُه
 *   [ADR 0057](../../docs/adr/0057-telegram-ingress-bound-payload-carrier-and-worker.md)
 *   و§٥/٦ من [ADR 0054](../../docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md):
 *     (أ) POST لا يستدعي handler — ثمّ drainOnce يستدعيه، ولا وظيفةَ ثانيةَ للمكرَّرِ.
 *     (ب) حدُّ المعدَّلِ قبلَ الإيداعِ: 429 لا يُودِعُ إيصالاً ولا وظيفةً، والإعادةُ تُقبَل.
 *     (ج) عبرَ العملياتِ: القرارُ في القاعدةِ لا في ذاكرةِ العمليةِ.
 *     (د) الإيجارُ: التقاطٌ · منعُ التقاطٍ متزامنٍ مزدوجٍ · استرجاعُ إيجارٍ مهجورٍ ·
 *         ختمٌ برمزٍ · رفضُ ختمٍ برمزٍ قديمٍ.
 *     (هـ) لا فقدَ: مكرَّراتٌ وتجاوزُ حدٍّ، والأصلُ يُعالَج مرّةً واحدةً ولا يضيعُ.
 *     (و) 503 عندَ عجزِ القاعدةِ قبلَ الإيداعِ — لا 200 كاذبٌ يُبتلعُ التحديثُ.
 *     (ز) الموتُ النهائيُّ: وظيفةٌ تفشلُ حتى استنفادِ المحاولاتِ تصيرُ `dead`، والإيصالُ
 *         `failed`، ولا تُعادُ معالجتُها أبداً.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب `TEST_DATABASE_URL` بقاعدةٍ مطبَّقةٍ عليها الهجرات.
 *   **ولا يُقبل بديلٌ mock**: الذرّيّةُ وسلوكُ `FOR UPDATE SKIP LOCKED` وعبرِ العملياتِ
 *   لا يُثبتُها إلّا محرّكٌ حقيقيٌّ.
 * ينتمي إلى: tests/integration
 * يُتوقَّع أن يستخدمه لاحقاً: CI (خدمة postgis مع `CI_REQUIRE_DB=1`)
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { createMemoryRateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import {
  createTelegramWebhookRoutes,
  TELEGRAM_SECRET_HEADER,
} from "../../apps/gateway/src/routes/telegram-webhook.ts";
import {
  createPostgresUpdateIntake,
  type DurableUpdateIntake,
  type TelegramUpdateEnqueuer,
} from "../../apps/gateway/src/routes/update-intake.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createPostgresTelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const SECRET = "durable-intake-secret";
const BASE_UPDATE_ID = 920_000;

let sql: Sql;
let intake: DurableUpdateIntake & TelegramUpdateEnqueuer;

interface ReceiptRow {
  readonly status: string;
  readonly attempts: number;
  readonly claim_token: string | null;
  readonly completed_at: Date | null;
}

interface JobRow {
  readonly status: string;
  readonly attempts: number;
  readonly claim_token: string | null;
  readonly completed_at: Date | null;
}

function update(updateId: number, actorId: number): Record<string, unknown> {
  return { update_id: updateId, message: { from: { id: actorId }, text: "/start" } };
}

async function post(
  app: ReturnType<typeof createTelegramWebhookRoutes>,
  body: unknown,
): Promise<Response> {
  return await app.request(
    new Request("http://localhost/webhook/telegram/driver", {
      method: "POST",
      headers: { "content-type": "application/json", [TELEGRAM_SECRET_HEADER]: SECRET },
      body: JSON.stringify(body),
    }),
  );
}

function buildGateway(options?: {
  readonly limit?: number;
  readonly clock?: () => number;
  readonly handled?: boolean;
}) {
  const calls: number[] = [];
  const routes = createTelegramWebhookRoutes({
    webhookSecret: SECRET,
    intake,
    handler: {
      handle: async (_bot, received) => {
        calls.push((received as { update_id: number }).update_id);
        return options?.handled ?? true;
      },
    },
    ...(options?.limit === undefined
      ? {}
      : {
          rateLimits: {
            users: createMemoryRateLimiter(
              { limit: options.limit, windowSeconds: 60 },
              options.clock ?? (() => 0),
            ),
          },
        }),
  });
  return { routes, calls };
}

function makeDrainer(calls: number[], handled = true) {
  return drainTelegramUpdateJobsOnce({
    queue: createPostgresTelegramUpdateQueue(sql),
    handler: {
      handle: async (_bot, received) => {
        calls.push((received as { update_id: number }).update_id);
        return handled;
      },
    },
  });
}

function receiptsOf(updateId: number): Promise<ReceiptRow[]> {
  return sql<ReceiptRow[]>`
    select status, attempts, claim_token, completed_at
      from telegram_update_receipts
     where bot = 'driver' and update_id = ${updateId}
  `;
}

function jobsOf(updateId: number): Promise<JobRow[]> {
  return sql<JobRow[]>`
    select status, attempts, claim_token, completed_at
      from telegram_update_jobs
     where bot = 'driver' and update_id = ${updateId}
  `;
}

describeIf("الاستلامُ الصامدُ لتحديثاتِ تيليجرام (BUG-002 / F6-02)", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    intake = createPostgresUpdateIntake(sql);
  });

  afterEach(async () => {
    await sql`delete from telegram_update_jobs where update_id >= ${BASE_UPDATE_ID}`;
    await sql`delete from telegram_update_receipts where update_id >= ${BASE_UPDATE_ID}`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("أ: POST يُودعُ ولا يستدعي handler، ثمّ drainOnce يُعالجُ مرّةً واحدةً", async () => {
    const id = BASE_UPDATE_ID + 1;
    const { routes, calls } = buildGateway();

    const first = await post(routes, update(id, 5001));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const second = await post(routes, update(id, 5001));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });

    expect(calls).toEqual([]);

    expect(await receiptsOf(id)).toHaveLength(1);
    const [jobRow] = await jobsOf(id);
    expect(jobRow?.status).toBe("pending");
    expect(jobRow?.claim_token).toBeNull();

    const report = await makeDrainer(calls);
    expect(report.claimed).toBe(1);
    expect(report.done).toBe(1);
    expect(calls).toEqual([id]);

    const [receipt] = await receiptsOf(id);
    expect(receipt?.status).toBe("done");
    expect(receipt?.attempts).toBe(1);
    expect(receipt?.completed_at).not.toBeNull();
    expect(receipt?.claim_token).toBeNull();
    const [doneJob] = await jobsOf(id);
    expect(doneJob?.status).toBe("done");
    expect(doneJob?.claim_token).toBeNull();

    const third = await post(routes, update(id, 5001));
    expect(await third.json()).toEqual({ ok: true, duplicate: true });
    const report2 = await makeDrainer(calls);
    expect(report2.claimed).toBe(0);
    expect(calls).toEqual([id]);
  });

  it("ب: المرفوضُ بحدِّ المعدَّلِ لا يُودِعُ إيصالاً ولا وظيفةً، وإعادتُه تُقبَل", async () => {
    const allowed = BASE_UPDATE_ID + 10;
    const rejected = BASE_UPDATE_ID + 11;
    const actor = 5002;
    let now = 0;
    const { routes, calls } = buildGateway({ limit: 1, clock: () => now });

    expect((await post(routes, update(allowed, actor))).status).toBe(200);

    const blocked = await post(routes, update(rejected, actor));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ ok: false, error: "RATE_LIMITED" });

    expect(await receiptsOf(rejected)).toHaveLength(0);
    expect(await jobsOf(rejected)).toHaveLength(0);

    now = 61_000;
    const retried = await post(routes, update(rejected, actor));
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ ok: true });

    expect(calls).toEqual([]);
    const report = await makeDrainer(calls);
    expect(report.done).toBe(2);
    expect(calls).toEqual([allowed, rejected]);

    expect((await receiptsOf(rejected))[0]?.status).toBe("done");
    expect((await jobsOf(rejected))[0]?.status).toBe("done");
  });

  it("ج: القرارُ صامدٌ عبرَ عمليتَينِ منفصلتَينِ ولا يعتمد على ذاكرةِ العمليةِ", async () => {
    const id = BASE_UPDATE_ID + 20;

    const enqueueInSeparateProcess = async (): Promise<string> => {
      const script = `
        const { createSql } = await import("${import.meta.dir}/../../packages/infrastructure/db/client.ts");
        const { createPostgresUpdateIntake } = await import("${import.meta.dir}/../../apps/gateway/src/routes/update-intake.ts");
        const sql = createSql({ connectionString: process.env.TEST_DATABASE_URL });
        const result = await createPostgresUpdateIntake(sql).claimAndEnqueue("driver", ${id}, { update_id: ${id}, message: { from: { id: 5101 }, text: "/start" } });
        await sql.end({ timeout: 5 });
        console.log(JSON.stringify(result));
      `;
      const proc = Bun.spawn(["bun", "-e", script], {
        env: { ...process.env, TEST_DATABASE_URL: DATABASE_URL ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(`عمليةٌ فرعيةٌ فشلت (${code}): ${err}`);
      return JSON.parse(out.trim()) as string;
    };

    expect(await enqueueInSeparateProcess()).toBe("enqueued");
    expect(await enqueueInSeparateProcess()).toBe("in_progress");

    expect(await receiptsOf(id)).toHaveLength(1);
    expect(await jobsOf(id)).toHaveLength(1);

    const calls: number[] = [];
    const report = await makeDrainer(calls);
    expect(report.done).toBe(1);
    expect(await enqueueInSeparateProcess()).toBe("duplicate");
  }, 30_000);

  it("د: إيجارٌ، ومنعُ التقاطٍ مزدوجٍ، واسترجاعُ مهجورٍ، ورفضُ رمزٍ قديمٍ", async () => {
    const id = BASE_UPDATE_ID + 30;
    const queue = createPostgresTelegramUpdateQueue(sql);

    expect(await intake.claimAndEnqueue("driver", id, update(id, 5201))).toBe("enqueued");

    const first = await queue.claim();
    expect(first.job).not.toBeNull();
    expect(first.job?.bot).toBe("driver");
    expect(first.job?.claimToken).not.toBe("");
    expect(first.job?.attempts).toBe(1);

    const second = await queue.claim();
    expect(second.job).toBeNull();

    const stale = "00000000-0000-4000-8000-000000000000";
    expect(await queue.finish({ bot: "driver", updateId: id, claimToken: stale }, true)).toBe(
      false,
    );

    await sql`
      update telegram_update_jobs
         set claimed_at = now() - interval '1 hour'
       where bot = 'driver' and update_id = ${id}
    `;
    await sql`
      update telegram_update_receipts
         set claimed_at = now() - interval '1 hour'
       where bot = 'driver' and update_id = ${id}
    `;

    const reclaimed = await queue.claim();
    expect(reclaimed.job).not.toBeNull();
    expect(reclaimed.job?.claimToken).not.toBe(first.job?.claimToken);
    expect(reclaimed.job?.attempts).toBe(2);

    expect(
      await queue.finish(
        { bot: "driver", updateId: id, claimToken: first.job?.claimToken ?? "" },
        true,
      ),
    ).toBe(false);

    expect(
      await queue.finish(
        { bot: "driver", updateId: id, claimToken: reclaimed.job?.claimToken ?? "" },
        true,
      ),
    ).toBe(true);

    expect((await receiptsOf(id))[0]?.status).toBe("done");
    expect((await jobsOf(id))[0]?.status).toBe("done");
  });

  it("هـ: مكرَّراتٌ وتجاوزُ حدٍّ معاً — ولا تحديثَ واحدٌ يضيع", async () => {
    const actor = 5005;
    const first = BASE_UPDATE_ID + 40;
    const starved = BASE_UPDATE_ID + 41;
    let now = 0;
    const { routes, calls } = buildGateway({ limit: 2, clock: () => now });

    expect((await post(routes, update(first, actor))).status).toBe(200);
    expect(await (await post(routes, update(first, actor))).json()).toEqual({
      ok: true,
      duplicate: true,
    });
    expect((await post(routes, update(starved, actor))).status).toBe(429);
    expect((await post(routes, update(starved, actor))).status).toBe(429);

    expect(await receiptsOf(starved)).toHaveLength(0);
    expect(await jobsOf(starved)).toHaveLength(0);

    now = 61_000;
    expect((await post(routes, update(starved, actor))).status).toBe(200);

    const report = await makeDrainer(calls);
    expect(report.done).toBe(2);
    expect(calls).toEqual([first, starved]);

    expect((await receiptsOf(first))[0]?.status).toBe("done");
    expect((await jobsOf(first))[0]?.status).toBe("done");
    expect((await receiptsOf(starved))[0]?.status).toBe("done");
    expect((await jobsOf(starved))[0]?.status).toBe("done");
  });

  it("و: عجزُ الإيداعِ يُترجَمُ 503 لا 200 كاذبٌ يُبتلعُ التحديثَ", async () => {
    const throwingIntake: DurableUpdateIntake & TelegramUpdateEnqueuer = {
      ...intake,
      claimAndEnqueue: async () => {
        throw new Error("DB_DOWN");
      },
    };
    const routes = createTelegramWebhookRoutes({
      webhookSecret: SECRET,
      intake: throwingIntake,
      handler: { handle: async () => true },
    });

    const res = await post(routes, update(BASE_UPDATE_ID + 50, 5301));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "INTAKE_UNAVAILABLE" });

    expect(await receiptsOf(BASE_UPDATE_ID + 50)).toHaveLength(0);
  });

  it("ز: وظيفةٌ تفشلُ حتى استنفادِ المحاولاتِ تصيرُ dead، ولا تُعادُ معالجتُها", async () => {
    const id = BASE_UPDATE_ID + 60;
    const queue = createPostgresTelegramUpdateQueue(sql, { maxAttempts: 2, retryDelaySeconds: 5 });

    expect(await intake.claimAndEnqueue("driver", id, update(id, 5401))).toBe("enqueued");

    // المحاولةُ الأولى: فشلٌ، فتُؤجَّلُ إعادةُ التقاطِها بفترةِ احتياطٍ — لا يلتقطُها
    // الدرينرُ في الشوطِ نفسه (مانعُ الاستنفادِ الفوريّ).
    const r1 = await drainTelegramUpdateJobsOnce({
      queue,
      handler: { handle: async () => false },
    });
    expect(r1.claimed).toBe(1);
    expect(r1.failed).toBe(1);
    const [j1] = await jobsOf(id);
    expect(j1?.status).toBe("pending");
    expect(j1?.attempts).toBe(1);

    // ما زالت في فترةِ الاحتياطِ: الدرينرُ لا يلتقطُها في الشوطِ التالي مباشرةً.
    const r1b = await drainTelegramUpdateJobsOnce({
      queue,
      handler: { handle: async () => false },
    });
    expect(r1b.claimed).toBe(0);

    // انقضى الاحتياطُ (محاكاةُ مرورِ الوقتِ): تصيرُ مؤهَّلةً للالتقاطِ من جديد.
    await sql`update telegram_update_jobs set next_attempt_at = now() - interval '10 seconds'
             where bot = 'driver' and update_id = ${id}`;

    const r2 = await drainTelegramUpdateJobsOnce({
      queue,
      handler: { handle: async () => false },
    });
    expect(r2.claimed).toBe(1);
    const [j2] = await jobsOf(id);
    expect(j2?.status).toBe("dead");
    expect(j2?.claim_token).toBeNull();

    expect((await receiptsOf(id))[0]?.status).toBe("failed");

    const r3 = await drainTelegramUpdateJobsOnce({
      queue,
      handler: { handle: async () => true },
    });
    expect(r3.claimed).toBe(0);
  });

  it("ح: إيجارٌ منتهٍ وقد استُنفدتِ المحاولاتُ يُختمُ dead — لا يبقى عالقاً معلَّقاً", async () => {
    const id = BASE_UPDATE_ID + 70;
    const queue = createPostgresTelegramUpdateQueue(sql, {
      maxAttempts: 1,
      leaseTimeoutSeconds: 1,
    });

    expect(await intake.claimAndEnqueue("driver", id, update(id, 5501))).toBe("enqueued");

    // التقاطٌ واحد: تصبحُ المحاولاتُ 1 = الحدَّ. لا نُختمُ — فيموتُ الحائزُ قبلَ الختمِ.
    const c1 = await queue.claim();
    expect(c1.job).not.toBeNull();

    // محاكاةُ انتهاءِ الإيجارِ: claimed_at قديمٌ فيسترجعُه الـclaim التالي.
    await sql`update telegram_update_jobs set claimed_at = now() - interval '10 seconds'
             where bot = 'driver' and update_id = ${id}`;

    // الـclaim التالي: استرجاعٌ لإيجارٍ منتهٍ لكنّه استُنفدتْ محاولاتُه (1 >= 1)
    // فيُختمُ dead مع إيصالِه failed — لا يبقى معلَّقاً غيرَ قابلٍ للالتقاطِ أبداً.
    const c2 = await queue.claim();
    expect(c2.job).toBeNull();

    const [j] = await jobsOf(id);
    expect(j?.status).toBe("dead");
    expect(j?.claim_token).toBeNull();
    const [r] = await receiptsOf(id);
    expect(r?.status).toBe("failed");
  });
});
