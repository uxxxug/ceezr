/**
 * الغرض: نسخةُ بوّابةٍ **في عمليةِ نظامٍ مستقلّة**، على مقبسٍ حقيقيّ، بحاويةٍ حقيقيّة
 *        ومُوجِّهٍ حقيقيّ — كي تجري سيناريوهاتُ وحدة 2-5 على topology أشبهَ بالإنتاج.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `cluster.ts` يُقلعها ويُخاطبها بالـHTTP لا بالاستيراد.
 *
 * ## لماذا عمليةٌ منفصلةٌ لا نسخةٌ ثانيةٌ في نفس العملية
 *
 * نسختان في عمليةٍ واحدةٍ تتقاسمان الكومةَ نفسَها: نفس `Map` مانعِ التكرار متى
 * تُشارَك، ونفس الجلساتِ في الذاكرة متى تُشارَك، ونفس المؤقّتات. فما «يبدو»
 * موزَّعاً يظلّ في الحقيقة عمليةً واحدةً، وتُثبَت ثوابتُ لا تُثبِت شيئاً عن الإنتاج.
 * عمليةٌ منفصلةٌ تعني: كومةً منفصلة، ومانعَ تكرارٍ منفصلاً، وبِركةَ اتصالاتٍ منفصلة،
 * وحالةً مشتركةً لا تكون مشتركةً إلّا إن كانت خارجَ العمليتين فعلاً.
 *
 * ## الضبطُ من البيئة — ولماذا يُستثنى هذا الملفّ من قاعدة «لا تقرأ process.env»
 *
 * `bench/scenarios/harness.ts` يُعلن ضبطَه كاملاً في الكود لأنّه يعمل في عمليةِ
 * المشغّل. أمّا العمليةُ الابنةُ فلا سبيلَ لضبطِها إلّا البيئةُ أو الوسائط. والحلُّ
 * ليس ترك البابِ مفتوحاً: كلُّ ما يُقرأ هنا مُصرَّحٌ في `BenchGatewayEnv` أدناه،
 * وباقي الضبطِ ثابتٌ في الكود كما في الـharness، والمنفذُ ورقمُ النسخةِ ومخزنُ
 * الجلساتِ ورابطُ Redis هي وحدها ما يختلف بين نسخةٍ وأخرى.
 *
 * ## مسارات `/bench/*`
 *
 * لا تُلمَس مسارات الإنتاج. المُوجِّهُ الحقيقيُّ يُلَفّ بمُوجِّهٍ خارجيّ يخدم أوّلاً
 * مساراتِ القياس (الرسائلُ الملتقطة، نصُّ المقاييس، حالةُ النسخة، الإطفاء) ثم
 * يُمرِّر كلَّ ما عداها إلى البوّابة. فالمقيسُ هو المُوجِّهُ نفسُه بلا زيادة.
 */

import { buildContainer, type Container } from "../../../../apps/gateway/src/container.ts";
import {
  instrumentTelegramHandler,
  instrumentUpdateDeduplicator,
  instrumentUpdateIntake,
} from "../../../../apps/gateway/src/observability/telegram.ts";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "../../../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createUpstashRedis } from "../../../../apps/gateway/src/redis/upstash.ts";
import { createUpdateDeduplicator } from "../../../../apps/gateway/src/routes/update-dedup.ts";
import { createPostgresUpdateIntake } from "../../../../apps/gateway/src/routes/update-intake.ts";
import { createServer } from "../../../../apps/gateway/src/server.ts";
import { createOperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";
import { loadConfig } from "../../../../packages/shared/config/index.ts";
import { assertConnectedToBenchDatabase } from "../isolation.ts";
import { createRecorder } from "../scenarios/recorder.ts";

/** السرُّ نفسُه المستخدَم في وحدة 2-5، كي يكون الطلبُ هو الطلبَ ذاته. */
export const TOPOLOGY_WEBHOOK_SECRET = "bench-scenarios-secret-bench-scenarios-01";

/** السطرُ الذي ينتظره المُنسِّق على المخرَجِ القياسي قبل أن يعتبر النسخةَ جاهزة. */
export const READY_MARKER = "BENCH_GATEWAY_READY";

/** كلُّ ما تقرأه هذه العملية من بيئتها — لا شيءَ غيره. */
interface BenchGatewayEnv {
  readonly instanceId: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly sessionStore: "memory" | "redis";
  readonly redisUrl: string;
  readonly redisToken: string;
  /**
   * حدُّ المعدّل. مرفوعٌ افتراضاً كما في وحدة 2-5، ويُخفَّض عمداً في اختبارٍ يريد
   * إثباتَ أنّ الحدَّ صار موزَّعاً على مفتاحٍ واحدٍ بين النسخ.
   */
  readonly rateLimit: number;
  readonly rateWindowSeconds: number;
}

function readEnv(): BenchGatewayEnv {
  const databaseUrl = process.env.BENCH_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("[bench/topology] BENCH_DATABASE_URL مطلوب لعمليةِ البوّابة.");
  }
  const port = Number.parseInt(process.env.BENCH_GATEWAY_PORT ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("[bench/topology] BENCH_GATEWAY_PORT مطلوب ويجب أن يكون منفذاً صحيحاً.");
  }
  const sessionStore = process.env.BENCH_SESSION_STORE === "redis" ? "redis" : "memory";
  return {
    instanceId: process.env.BENCH_INSTANCE_ID ?? `gw-${port}`,
    port,
    databaseUrl,
    sessionStore,
    redisUrl: process.env.BENCH_REDIS_URL ?? "http://127.0.0.1:1",
    redisToken: process.env.BENCH_REDIS_TOKEN ?? "bench-topology",
    rateLimit: Number.parseInt(process.env.BENCH_RATE_LIMIT ?? "1000000000", 10),
    rateWindowSeconds: Number.parseInt(process.env.BENCH_RATE_WINDOW_SECONDS ?? "60", 10),
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  const recorder = createRecorder();
  const metrics = createOperationalMetrics();

  const config = loadConfig({
    NODE_ENV: "test",
    PORT: String(env.port),
    SUPABASE_URL: "https://local.bench.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "bench-topology",
    DATABASE_URL: env.databaseUrl,
    UPSTASH_REDIS_REST_URL: env.redisUrl,
    UPSTASH_REDIS_REST_TOKEN: env.redisToken,
    DRIVER_BOT_TOKEN: "bench-topology-driver",
    RIDER_BOT_TOKEN: "bench-topology-rider",
    TELEGRAM_WEBHOOK_SECRET: TOPOLOGY_WEBHOOK_SECRET,
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
    SESSION_STORE: env.sessionStore,
    TRANSLATION_PROVIDER: "none",
    RUN_WORKER_IN_GATEWAY: "false",
    // ‏`RUN_ADMIN_IN_GATEWAY` مُعلَنٌ ههنا **توثيقاً لا أثراً**: هذا المِقياسُ يبني
    // الحاويةَ ويُركّب `createServer` بيدِه ولا يمرُّ بـ`apps/gateway/src/index.ts`،
    // فسطحُ الإدارةِ غيرُ مُركَّبٍ فيه أصلاً في الحالَين. والإعلانُ يمنع أن يُقرأ
    // غيابُه يوماً على أنّه سهوٌ فيُقلَبَ إلى `true` فتُقاس لوحةٌ لا تُقاس (F5-08).
    RUN_ADMIN_IN_GATEWAY: "false",
  });

  let container: Container | null = buildContainer(config, {
    driverSender: recorder.sender,
    riderSender: recorder.sender,
    metrics,
  });
  const sql = container.sql;

  try {
    // نفسُ حاجزِ العزلِ المبنيِّ في وحدة 2-4: عمليةٌ ابنةٌ لا تُستثنى منه.
    await assertConnectedToBenchDatabase(sql);
  } catch (error) {
    await container.close();
    container = null;
    throw error;
  }

  /**
   * مخزنُ حدِّ المعدّل مربوطٌ بمخزنِ الجلسات كما في `apps/gateway/src/index.ts`:
   * تقليدُ الإنتاج هنا مقصودٌ، فحدٌّ يعدّ كلَّ نسخةٍ وحدها ليس حدّاً بل قسمةً له.
   */
  const rateRedis =
    config.sessionStore === "redis"
      ? createUpstashRedis({ url: config.redisUrl, token: config.redisToken })
      : null;
  const limiter = (): RateLimiter => {
    const options = { limit: env.rateLimit, windowSeconds: env.rateWindowSeconds };
    return rateRedis === null
      ? createMemoryRateLimiter(options)
      : createRedisRateLimiter(rateRedis, { ...options, onFailure: () => undefined });
  };

  const dedup = instrumentUpdateDeduplicator(createUpdateDeduplicator(), metrics);

  const app = createServer({
    health: {
      now: () => new Date(),
      startedAt: new Date(),
      env: {
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceKey,
        DATABASE_URL: config.databaseUrl,
        UPSTASH_REDIS_REST_URL: config.redisUrl,
        UPSTASH_REDIS_REST_TOKEN: config.redisToken,
        DRIVER_BOT_TOKEN: config.driverBotToken,
        RIDER_BOT_TOKEN: config.riderBotToken,
        TELEGRAM_WEBHOOK_SECRET: config.telegramWebhookSecret,
        BOOTSTRAP_ADMIN_TELEGRAM_ID: config.bootstrapAdminTelegramId,
      },
      readinessChecks: [
        {
          name: "database",
          check: async () => (await sql<{ ok: number }[]>`select 1 as ok`)[0]?.ok === 1,
        },
      ],
    },
    webhook: {
      webhookSecret: TOPOLOGY_WEBHOOK_SECRET,
      // نفسُ لافِّ الإنتاج: بلا هذا لا يتحرّك `waslah_telegram_webhook_*` فيُقرأ صفرٌ على أنّه حقيقة.
      handler: instrumentTelegramHandler(container.handler, metrics),
      // بلا هذا يكونُ لكلِّ عمليةٍ قرارُ تكرارٍ خاصٌّ بها، وهو عينُ ما يقيسُه
      // `cross-process-replay`. فوصلُه ههنا شرطُ أن يقيسَ السيناريو الإصلاحَ.
      intake: instrumentUpdateIntake(createPostgresUpdateIntake(sql), metrics),
      dedup,
      rateLimits: { probes: limiter(), users: limiter() },
    },
  });

  let stopping = false;
  const server = Bun.serve({
    port: env.port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/bench/")) return app.fetch(request);

      switch (url.pathname) {
        case "/bench/messages": {
          // `since` = عددُ الرسائلِ التي سُحبت سابقاً، فيُنقل الفرقُ وحدَه.
          const since = Number.parseInt(url.searchParams.get("since") ?? "0", 10);
          const all = recorder.all();
          const from = Number.isInteger(since) && since > 0 ? since : 0;
          return Response.json({ total: all.length, messages: all.slice(from) });
        }
        case "/bench/metrics-text":
          return new Response(metrics.registry.render(), {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        case "/bench/state":
          return Response.json({
            instanceId: env.instanceId,
            pid: process.pid,
            sessionStore: config.sessionStore,
            dedupSize: dedup.size(),
            messages: recorder.all().length,
          });
        case "/bench/clear":
          recorder.clear();
          return Response.json({ ok: true });
        case "/bench/shutdown": {
          // إطفاءٌ نظيفٌ مقصودٌ: يقابله في اختبارِ الفشلِ قتلٌ بـSIGKILL بلا هذا المسار.
          stopping = true;
          queueMicrotask(() => {
            void (async () => {
              await server.stop(true);
              await container?.close();
              process.exit(0);
            })();
          });
          return Response.json({ ok: true });
        }
        default:
          return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    },
  });

  process.on("SIGTERM", () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await server.stop(true);
      await container?.close();
      process.exit(0);
    })();
  });

  // سطرُ الجهوزيّة آخرَ شيء: المُنسِّقُ الذي يقرؤه يعلم أنّ المقبسَ يستقبل والقاعدةَ متّصلة.
  console.log(
    `${READY_MARKER} ${JSON.stringify({ instanceId: env.instanceId, port: server.port, pid: process.pid, sessionStore: config.sessionStore })}`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`BENCH_GATEWAY_FAILED ${String(error)}`);
    process.exit(1);
  });
}
