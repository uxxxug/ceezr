/**
 * الغرض: بيئةُ تشغيلِ سيناريوهات العمل — البوّابةُ الحقيقيةُ على قاعدةِ القياس،
 *        بضبطٍ مُعلَنٍ كاملاً، وناقلٍ ملتقطٍ مُصرَّحٍ بأنه مزدوج.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: مشغّلُ السيناريوهات، وأيُّ قياسِ حملٍ يبنى على مسارٍ حقيقيّ.
 * ملاحظات مستقبلية: أيُّ مُوجَّهٍ جديدٍ في `createServer` يُضاف هنا لا في السيناريوهات،
 *                   وإلّا صار لكلِّ سيناريو بوّابتُه فاختلفت أرقامُه بلا سبب.
 *
 * ولماذا لا نستدعي طبقةَ التطبيق مباشرةً: لأن السيناريو الذي يستدعي `useCase`
 * يقيس دالّةً، لا نظاماً. المطلوبُ هو ما يمرّ به المستخدم فعلاً: HTTP → تحقّقُ
 * سرِّ الويبهوك → حدُّ المعدّل → مُوجِّهُ التحديث → الحوار → الحالة → RPC → القاعدة.
 */

import { buildContainer, type Container } from "../../apps/gateway/src/container.ts";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createOperationalMetrics,
  type OperationalMetrics,
} from "../../packages/infrastructure/observability/index.ts";
import { loadConfig } from "../../packages/shared/config/index.ts";
import { assertConnectedToBenchDatabase } from "../isolation.ts";
import { provision } from "../provision.ts";
import { resetToMigratedState } from "../reset.ts";
import { type SeedPlan, type SeedResult, seed } from "../seed.ts";
import type { MockDeclaration, RecordedMessage } from "./contract.ts";
import type { MeasurementScope, ScenarioEnvironment } from "./env.ts";
import { createRecorder } from "./recorder.ts";

/** طولُه فوق الحدّ الإنتاجي ومن محارف تلغرام، لأن مُحمّلَ الضبط يفحص الاثنين. */
const WEBHOOK_SECRET = "bench-scenarios-secret-bench-scenarios-01";

/**
 * المزدوجاتُ المُعلَنةُ لهذه البيئة. تُنسخ إلى تقريرِ كلِّ سيناريو، فلا يُقرأ رقمٌ
 * منها بلا حدودِه (§7 و§9 من الأمر الحاكم).
 */
export const HARNESS_MOCKS: readonly MockDeclaration[] = [
  {
    what: "ناقلُ تلغرام (sendMessage/sendPhoto/sendLocation) مُستبدَلٌ بملتقطٍ في الذاكرة.",
    why: "لا مفاتيحَ إنتاجية في القياس، ولا استدعاءَ خدمةٍ خارجيةٍ مقيّدةٍ بحدّ معدّل (≈30 رسالة/ث للبوت).",
    proves:
      "أنّ النظام صاغ الرسالةَ الصحيحةَ للمستخدَمِ الصحيح في اللحظةِ الصحيحة — نيّةُ الإرسالِ ومحتواها.",
    doesNotProve:
      "أنّ تلغرام سلّمها. ولا يُقاس منها زمنُ تلغرام ولا حدُّه ولا نجاحُ التسليم. " +
      "ولأن الملتقطَ يتقدّم على لافِّ العدّاد في الحاوية، فعدّادُ " +
      "`waslah_telegram_messages_sent_total` **لا يتحرّك** في هذه البيئة ولا يُستدَلّ به هنا.",
  },
  {
    what: "حدُّ المعدّل مرفوعٌ عملياً (10^9 لكلِّ نافذة).",
    why: "المقصودُ قياسُ سعةِ المعالجة والسلوكِ التجاري، لا قياسُ متى يُقال 429.",
    proves: "أنّ المسارَ يعمل بلا خنقٍ مصطنع.",
    doesNotProve: "سلوكَ النظام تحت الحدِّ الإنتاجي للمعدّل — ذاك قياسٌ منفصلٌ واجب.",
  },
  {
    what: "العاملُ الدوريُّ داخل البوّابة مُطفأ (`RUN_WORKER_IN_GATEWAY=false`).",
    why: "عزلُ مسارِ الطلب عن المهامِّ الدورية كي يكون المقيسُ مسارَ المستخدم وحده.",
    proves: "زمنَ مسارِ الطلب معزولاً.",
    doesNotProve:
      "زمنَه في الإنتاج حيث العاملُ مُشتغِلٌ ويزاحمُ على نفس بِركةِ الاتصالات. الأرقامُ متفائلةٌ مقابل الإنتاج.",
  },
] as const;

export interface ScenarioEnvOptions {
  /** رمزُ المدينةِ التي تجري عليها السيناريوهات. */
  readonly cityCode?: string;
  readonly port?: number;
}

/**
 * طبولوجيا هذه البيئة: عمليةٌ واحدةٌ لكلِّ شيء. تُعلَن صريحةً لأنّ وحدة 2-6 أضافت
 * بيئةً ثانيةً موزَّعة، فصار «في أيّ طبولوجيا جرى هذا الرقم؟» سؤالاً مشروعاً في
 * كلِّ تقرير.
 */
export const SINGLE_PROCESS_TOPOLOGY: readonly string[] = [
  "بوّابةٌ واحدةٌ داخل عمليةِ الاختبار نفسِها (`app.fetch`، بلا مقبسِ شبكة).",
  "عاملٌ دوريّ: مُطفأ.",
  "قاعدةٌ واحدة: `waslah_bench` على نفس المُضيف.",
  "مخزنُ الجلسات: ذاكرةُ العملية. حدُّ المعدّل: ذاكرةُ العملية. مانعُ التكرار: ذاكرةُ العملية.",
] as const;

export const SINGLE_PROCESS_SCOPE: MeasurementScope = {
  measures: [
    "سلوكَ العمل على المسار الحقيقي: HTTP → سرُّ الويبهوك → المُوجِّه → الحوار → الحالة → RPC → PostgreSQL.",
    "زمنَ رحلةِ الفاعل الكاملة داخل هذه العملية (لا زمنَ الشبكة ولا زمنَ تلغرام).",
    "فرقَ العدّادات المُعلَنة قبل التشغيل وبعده.",
  ],
  doesNotMeasure: [
    "التسليمَ الحقيقيَّ عبر تلغرام ولا حدودَه (الناقلُ مزدوج).",
    "سعةَ الإنتاج: قاعدةٌ محلّيةٌ على نفس المُضيف، وعاملٌ دوريٌّ مُطفأ، وحدُّ معدّلٍ مرفوع.",
    "زمنَ الشبكة بين العميل والخادم: الطلبُ يُمرَّر إلى `app.fetch` في العملية نفسها.",
    "أيَّ سلوكٍ يظهر عند تعدّدِ العمليات: الحالةُ المشتركةُ كلُّها في ذاكرةِ عمليةٍ واحدة (وحدة 2-6).",
  ],
};

export interface ScenarioEnv extends ScenarioEnvironment {
  readonly sql: Sql;
  readonly metrics: OperationalMetrics;
  readonly post: (bot: "driver" | "rider", update: unknown) => Promise<Response>;
  readonly cityId: string;
  readonly cityCode: string;
  readonly messagesTo: (chatId: number) => readonly RecordedMessage[];
  readonly allMessages: () => readonly RecordedMessage[];
  readonly clearMessages: () => void;
  readonly settingNumber: (key: string) => Promise<number>;
  /**
   * يُفرِغ الجداولَ التشغيليةَ ويُعيد تفعيلَ المدن — بين سيناريو وآخَر.
   *
   * وقائمةُ الجداول لا تُكتب هنا: `bench/reset.ts` يملكها، ونسخُها في ملفٍّ ثانٍ
   * كان سيتعفّن عند إضافةِ جدولٍ فيبقى صفٌّ من سيناريو في سيناريو بعده.
   */
  readonly resetOperational: () => Promise<void>;
  /** يبذر أساسَ وحدة 2-4 (سائقون موثَّقون بمشتركاتٍ نشطة) على قاعدةٍ نظيفة. */
  readonly seedFoundation: (plan: SeedPlan) => Promise<SeedResult>;
  readonly close: () => Promise<void>;
}

/**
 * البيئةُ كاملةً. تفشل مبكّراً وبصوتٍ عالٍ إن لم تكن القاعدةُ قاعدةَ قياس:
 * سيناريوهاتٌ تُفرِغ الجداولَ لا يجوز أن تُشغَّل على قاعدةٍ فيها بياناتُ أحد.
 */
export async function createScenarioEnv(options: ScenarioEnvOptions = {}): Promise<ScenarioEnv> {
  const databaseUrl = process.env.BENCH_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "[bench/scenarios] عيّن BENCH_DATABASE_URL لقاعدةِ قياسٍ مطبَّقٍ عليها كلُّ الترحيلات.",
    );
  }

  const port = options.port ?? 4331;
  const recorder = createRecorder();
  const metrics = createOperationalMetrics();

  /**
   * البيئةُ مُعلَنةٌ بالكامل ولا تُقرأ من `process.env`: متغيّرٌ متروكٌ في صدفةِ
   * المشغّل لا يجوز أن يغيّر ما يقيسه القياس من حيث لا يدري (نفسُ قاعدةِ
   * `scripts/load-test.ts`، ولنفسِ السبب).
   */
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: String(port),
    SUPABASE_URL: "https://local.bench.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "bench-scenarios",
    DATABASE_URL: databaseUrl,
    UPSTASH_REDIS_REST_URL: "http://localhost",
    UPSTASH_REDIS_REST_TOKEN: "bench-scenarios",
    DRIVER_BOT_TOKEN: "bench-scenarios-driver",
    RIDER_BOT_TOKEN: "bench-scenarios-rider",
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
    SESSION_STORE: "memory",
    TRANSLATION_PROVIDER: "none",
    RUN_WORKER_IN_GATEWAY: "false",
  });

  let container: Container | null = buildContainer(config, {
    driverSender: recorder.sender,
    riderSender: recorder.sender,
    metrics,
  });
  const sql = container.sql;

  try {
    await assertConnectedToBenchDatabase(sql);
  } catch (error) {
    await container.close();
    container = null;
    throw error;
  }

  const permissive = (): RateLimiter =>
    createMemoryRateLimiter({ limit: 10 ** 9, windowSeconds: 60 });

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
      webhookSecret: WEBHOOK_SECRET,
      handler: container.handler,
      rateLimits: { probes: permissive(), users: permissive() },
    },
  });

  const post = async (bot: "driver" | "rider", update: unknown): Promise<Response> =>
    app.fetch(
      new Request(`http://localhost:${port}/webhook/telegram/${bot}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
        },
        body: JSON.stringify(update),
      }),
    );

  const resetOperational = async (): Promise<void> => {
    await resetToMigratedState(sql, { databaseUrl, nodeEnv: "test" });
    await provision(sql);
    recorder.clear();
  };

  await resetOperational();

  const cityCode = options.cityCode ?? "JED";
  const [city] = await sql<{ id: string }[]>`
    select id from public.cities where code = ${cityCode} and is_active = true
  `;
  if (city === undefined) {
    await container.close();
    throw new Error(`[bench/scenarios] المدينة «${cityCode}» غير موجودةٍ أو غير مُفعَّلة.`);
  }

  const settingNumber = async (key: string): Promise<number> => {
    const [row] = await sql<{ value: number | null }[]>`
      select public.get_setting_number(${city.id}::uuid, ${key}) as value
    `;
    if (row === undefined || row.value === null) {
      throw new Error(`[bench/scenarios] الإعداد «${key}» غير موجودٍ للمدينة ${cityCode}.`);
    }
    return Number(row.value);
  };

  return {
    sql,
    metrics,
    post,
    cityId: city.id,
    cityCode,
    messagesTo: recorder.to,
    allMessages: recorder.all,
    clearMessages: recorder.clear,
    settingNumber,
    resetOperational,
    renderMetrics: async () => metrics.registry.render(),
    mocks: HARNESS_MOCKS,
    topology: SINGLE_PROCESS_TOPOLOGY,
    measurementScope: SINGLE_PROCESS_SCOPE,
    seedFoundation: async (plan: SeedPlan) => seed(sql, plan),
    close: async () => {
      if (container !== null) {
        await container.close();
        container = null;
      }
    },
  };
}
