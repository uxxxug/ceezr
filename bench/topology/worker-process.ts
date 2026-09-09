/**
 * الغرض: عمليةُ عاملٍ خلفيٍّ حقيقيةٌ تُقلَع منفصلةً لأجلِ اختبارِ ازدواجِ العاملين
 *        (§6 و§8 من أمرِ وحدة 2-6): حاويةُ العاملِ الحقيقية، ومهامُّها الحقيقية،
 *        وقفلُها الاستشاريُّ الحقيقيّ على القاعدة — بلا شبكةِ تلغرام.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `bench/topology/worker-duel.ts`
 * ملاحظات مستقبلية: إن صار للعاملِ قفلٌ في Redis بدلَ القاعدة، فهذه العمليةُ هي
 *   موضعُ إثباتِ أنّ البديلَ يحمي كما يحمي `pg_try_advisory_lock`.
 *
 * ## لماذا عمليةٌ لا استدعاءٌ داخليّ
 *
 * `pg_try_advisory_lock` قفلٌ لكلِّ **جلسةِ قاعدة**. فعاملان في نفسِ العملية قد
 * يتقاسمان بِركةَ اتصالاتٍ واحدة، فيصير الاختبارُ اختبارَ بِركةٍ لا اختبارَ قفل.
 * وعمليتان مستقلّتان لهما جلستان لا محالة — وهذا وحدَه ما يشبه نسختين على Render.
 *
 * ## البروتوكول
 *
 * تطبع العمليةُ سطرَ جهوزيةٍ ثم تنتظر لحظةً متّفقاً عليها (`BENCH_WORKER_BARRIER_MS`)
 * فتشتغل شوطاً واحداً وتطبع نتائجَه. والحاجزُ الزمنيُّ مقصود: بلا موعدٍ مشترك
 * ينتهي الأوّلُ قبل أن يبدأ الثاني، فلا تزاحمَ أصلاً، فيخرج اختبارٌ «ناجحٌ» لم
 * يقس شيئاً. وهذا بالضبط ما يحذّر منه §8 من قياسٍ لا يقيس ما يدّعيه.
 */

import { buildWorkerContainer, MAX_JOB_CONCURRENCY } from "../../apps/workers/src/container.ts";
import { createJobRunner, type JobLogger, type JobOutcome } from "../../apps/workers/src/runner.ts";
import { loadConfig } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import { assertConnectedToBenchDatabase } from "../isolation.ts";

export const WORKER_READY_MARKER = "BENCH_WORKER_READY";
export const WORKER_OUTCOMES_MARKER = "BENCH_WORKER_OUTCOMES";
export const WORKER_LOG_MARKER = "BENCH_WORKER_LOG";
export const WORKER_SPANS_MARKER = "BENCH_WORKER_SPANS";

/**
 * مدّةُ تنفيذٍ مرصودةٌ **داخلَ** القفل: المشغّلُ يأخذ القفلَ ثم ينادي `run`، فتغليفُ
 * `run` يقيس بالضبطِ المنطقةَ التي يدّعي القفلُ حصريّتَها. وهذا ما يجعل تقاطعَ
 * مدّتين من عمليتين دليلَ خللٍ لا مجرّدَ تصادفِ توقيت.
 */
export interface JobSpan {
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
}

interface WorkerEnv {
  readonly databaseUrl: string;
  readonly workerId: string;
  /** لحظةُ البدءِ المتّفق عليها (epoch ms). صفرٌ يعني: ابدأ فوراً. */
  readonly barrierMs: number;
  /** يقصر الشوطَ على المهامِّ التي يتضمّن اسمُها هذا النصّ. فراغٌ يعني كلَّ المهام. */
  readonly onlyJob: string;
}

function readEnv(): WorkerEnv {
  const databaseUrl = process.env.BENCH_DATABASE_URL ?? "";
  if (databaseUrl === "") throw new Error("[bench-worker] BENCH_DATABASE_URL مطلوب.");
  return {
    databaseUrl,
    workerId: process.env.BENCH_WORKER_ID ?? "w?",
    barrierMs: Number(process.env.BENCH_WORKER_BARRIER_MS ?? "0"),
    onlyJob: process.env.BENCH_WORKER_ONLY_JOB ?? "",
  };
}

/** انتظارٌ حتى اللحظةِ المتّفق عليها بدقّةٍ معقولة: نومٌ خشِنٌ ثم دورانٌ قصيرٌ في النهاية. */
async function waitForBarrier(barrierMs: number): Promise<void> {
  if (barrierMs <= 0) return;
  const coarse = barrierMs - Date.now() - 25;
  if (coarse > 0) await new Promise((resolve) => setTimeout(resolve, coarse));
  while (Date.now() < barrierMs) await new Promise((resolve) => setTimeout(resolve, 1));
}

async function main(): Promise<void> {
  const env = readEnv();
  const lines: string[] = [];
  const log: JobLogger = {
    info: (message, fields) => lines.push(`info ${message} ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => lines.push(`error ${message} ${JSON.stringify(fields ?? {})}`),
  };

  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3999",
    SUPABASE_URL: "https://local.bench.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "bench-topology",
    DATABASE_URL: env.databaseUrl,
    UPSTASH_REDIS_REST_URL: "https://local.bench.redis",
    UPSTASH_REDIS_REST_TOKEN: "bench-topology",
    DRIVER_BOT_TOKEN: "bench-topology-driver",
    RIDER_BOT_TOKEN: "bench-topology-rider",
    TELEGRAM_WEBHOOK_SECRET: "bench-scenarios-secret-bench-scenarios-01",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
    SESSION_STORE: "memory",
    TRANSLATION_PROVIDER: "none",
    RUN_WORKER_IN_GATEWAY: "false",
    // ‏`RUN_ADMIN_IN_GATEWAY` مُعلَنٌ ههنا **توثيقاً لا أثراً**: هذا المِقياسُ يبني
    // الحاويةَ ويُركّب `createServer` بيدِه ولا يمرُّ بـ`apps/gateway/src/index.ts`،
    // فسطحُ الإدارةِ غيرُ مُركَّبٍ فيه أصلاً في الحالَين. والإعلانُ يمنع أن يُقرأ
    // غيابُه يوماً على أنّه سهوٌ فيُقلَبَ إلى `true` فتُقاس لوحةٌ لا تُقاس (F5-08).
    RUN_ADMIN_IN_GATEWAY: "false",
  });

  /**
   * المُرسِلاتُ الخارجةُ مزدوجاتٌ صامتة — نفسُ ما تفعله اختباراتُ المهامِّ على قاعدةٍ
   * حقيقية. والمقيسُ هنا القفلُ وأثرُ القاعدة، لا شبكةُ تلغرام. وما لا يُقاس لا يُدَّعى.
   */
  const container = buildWorkerContainer(config, {
    log,
    driverOut: { send: async () => true },
    riderOut: { send: async () => true },
    identifyingDriver: { sendReturningId: async () => "1" },
    warningSender: { send: async () => ok(undefined) },
    broadcastPublisher: { publish: async () => ok({ messageId: "1" }) },
    subscriptionNoticePublisher: { publish: async () => ok({ messageId: "1" }) },
  });

  let outcomes: readonly JobOutcome[] = [];
  const spans: JobSpan[] = [];
  try {
    await assertConnectedToBenchDatabase(container.sql);
    const all = await container.jobs();
    const selected = env.onlyJob === "" ? all : all.filter((job) => job.name.includes(env.onlyJob));

    const runner = createJobRunner({
      // `runOnStart` يجعل كلَّ مهمّةٍ مستحقّةً في الشوطِ الأوّل: المقيسُ القفلُ لا الجدولة.
      jobs: selected.map((job) => ({
        ...job,
        runOnStart: true,
        run: async (): Promise<string> => {
          const startedAtMs = Date.now();
          try {
            return await job.run();
          } finally {
            spans.push({ name: job.name, startedAtMs, endedAtMs: Date.now() });
          }
        },
      })),
      lock: container.lock,
      maxConcurrency: MAX_JOB_CONCURRENCY,
      clock: { now: () => new Date() },
      log,
    });

    console.log(
      `${WORKER_READY_MARKER} ${JSON.stringify({
        workerId: env.workerId,
        pid: process.pid,
        jobs: selected.map((job) => job.name),
      })}`,
    );

    await waitForBarrier(env.barrierMs);
    outcomes = await runner.runDue();
  } finally {
    console.log(
      `${WORKER_OUTCOMES_MARKER} ${JSON.stringify({
        workerId: env.workerId,
        pid: process.pid,
        outcomes: outcomes.map((outcome) => ({
          name: outcome.name,
          status: outcome.status,
          durationMs: outcome.durationMs,
          detail: outcome.detail,
        })),
      })}`,
    );
    console.log(`${WORKER_SPANS_MARKER} ${JSON.stringify({ workerId: env.workerId, spans })}`);
    for (const line of lines) console.log(`${WORKER_LOG_MARKER} ${env.workerId} ${line}`);
    await container.close();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[bench-worker] ${String(error)}`);
    process.exit(1);
  });
}
