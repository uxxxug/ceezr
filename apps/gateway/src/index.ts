/**
 * الغرض: نقطة تشغيل خادم Hono الحقيقي الذي يستقبل Webhooks تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: Render (أمر التشغيل)، docker/Dockerfile.gateway
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد في container.ts.
 */

import { createFulfillmentLifecycle } from "../../../packages/application/wasla/fulfillment-lifecycle.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../../../packages/infrastructure/consent/consent-store.ts";
import { verifySchemaContract } from "../../../packages/infrastructure/db/schema-guard.ts";
import { createPostgresTelegramUpdateQueue } from "../../../packages/infrastructure/db/telegram-update-queue.ts";
import {
  createDestinationResolver,
  createDestinationSearcher,
} from "../../../packages/infrastructure/destinations/destinations-store.ts";
import { PostgresDriverDocumentStore } from "../../../packages/infrastructure/driver/driver-documents-store.ts";
import {
  createPaymentProvider,
  createPaymentRepository,
  createWebhookEventStore,
} from "../../../packages/infrastructure/financial/index.ts";
import { createMiniAppRefreshTokens } from "../../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../../packages/infrastructure/identity/miniapp-session.ts";
import { createTelegramInitDataVerifier } from "../../../packages/infrastructure/identity/telegram-init-data.ts";
import { createViewerAccountReader } from "../../../packages/infrastructure/identity/viewer-account.ts";
import { createUserNotificationCenter } from "../../../packages/infrastructure/notification/user-notification-center.ts";
import {
  createConfiguredMetricsExporter,
  createDatabaseGaugeCollector,
  createOperationalMetrics,
  createStructuredLogger,
} from "../../../packages/infrastructure/observability/index.ts";
import {
  createRecentDestinationReader,
  createSavedPlaceReader,
  createSavedPlaceWriter,
} from "../../../packages/infrastructure/places/places-store.ts";
import { PostgresDataRightsStore } from "../../../packages/infrastructure/privacy/data-rights-store.ts";
import { createQuoteJudge } from "../../../packages/infrastructure/quote/quote-store.ts";
import { createSosSurfaceReader } from "../../../packages/infrastructure/safety/sos-surface-store.ts";
import { createJobHeartbeatReader } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import {
  HttpUploadSigner,
  readSignedUploadConfig,
  UnconfiguredUploadSigner,
} from "../../../packages/infrastructure/storage/signed-upload.ts";
import { PostgresRiderSupportStore } from "../../../packages/infrastructure/support/rider-support-store.ts";
import { createActiveRideReader } from "../../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideDetailReader,
  createRideHistoryReader,
} from "../../../packages/infrastructure/transport/ride-history-store.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
  createRideSearchReader,
} from "../../../packages/infrastructure/transport/ride-request-store.ts";
import { createRideShareReader } from "../../../packages/infrastructure/transport/ride-share-store.ts";
import {
  createRideRatingCommand,
  createRideSummaryReader,
} from "../../../packages/infrastructure/transport/ride-summary-store.ts";
import { createOperationalJobRepository } from "../../../packages/infrastructure/wasla/operational-job-repository.ts";
import {
  MAPLIBRE_CDN_ORIGIN,
  MAPLIBRE_SRI_UNSET,
  maplibreScriptUrl,
  maplibreStylesheetUrl,
  resolveMapStyle,
} from "../../../packages/maps/index.ts";
import {
  computeConnectionBudget,
  DECLARED_TOPOLOGY,
  describeConnectionBudget,
} from "../../../packages/shared/config/connection-budget.ts";
import { CORE_EVENT_TRANSPORT_ENV } from "../../../packages/shared/config/core-event-transport.ts";
import { missingEnvKeys, tryLoadConfig } from "../../../packages/shared/config/index.ts";
import {
  DECIDED_EVENT_DISTRIBUTION,
  singleInstanceInvariantViolation,
} from "../../../packages/shared/config/single-instance.ts";
import type { CityId } from "../../../packages/shared/kernel/index.ts";
import { assertEgressEnvironment } from "../../../packages/shared/wasla/egress-gate.ts";
import { jobHealthExpectations } from "../../workers/src/container.ts";
import { createAdminAuthPort } from "./admin/auth.ts";
import { mountAdminSurface } from "./admin/mount.ts";
import {
  startTelegramUpdateDrainer,
  type TelegramUpdateDrainer,
} from "./background/telegram-update-drainer.ts";
import { grammyCommandRegistrar, registerBotCommands } from "./bots/shared/register-commands.ts";
import { buildContainer } from "./container.ts";
import { type EmbeddedWorkerHandle, startEmbeddedWorker } from "./embedded-worker.ts";
import { createJobHealthProbes } from "./job-health.ts";
import { createLifecycle } from "./lifecycle.ts";
import { instrumentPaymentConfirmationDeps } from "./observability/payment.ts";
import {
  instrumentTelegramHandler,
  instrumentUpdateDeduplicator,
  instrumentUpdateIntake,
} from "./observability/telegram.ts";
import { createObservabilityJobLogger } from "./observability/worker.ts";
import { createPublicSecurityHeaders } from "./public/security-headers.ts";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "./rate-limit/fixed-window.ts";
import { createUpstashRedis } from "./redis/upstash.ts";
import { createMetricsRoutes } from "./routes/metrics.ts";
import { createPublicTrackingRoutes } from "./routes/public-tracking.ts";
import { createUpdateDeduplicator } from "./routes/update-dedup.ts";
import { createPostgresUpdateIntake } from "./routes/update-intake.ts";
import { createServer } from "./server.ts";

/**
 * سجلُّ البوابةِ — من المُصدِرِ الوحيدِ لا من دالّةٍ محليّةٍ (`F8-03` · ADR 0078).
 * وقبلَ اليومَ كان هذا الموضعُ يكتبُ `{at, message, ...meta}` **بلا شدّةٍ**، وكانَ
 * العاملُ يكتبُ `{level, message}` **بلا زمنٍ**، فلم يكنْ ترتيبُ حدثٍ بينَ الخدمتَينِ
 * ممكناً ولا تصفيةُ خطأٍ في البوابةِ ممكنةً.
 */
const log = createStructuredLogger({ service: "gateway" });

const configResult = tryLoadConfig(process.env);

if (!configResult.ok) {
  const error = configResult.error;
  // «تعذّر إقلاع البوابة» — نصّاً كانَ على `console.error` بلا بنيةٍ، فلا يُقرأُ آلياً.
  if (error.code === "MISSING_ENV_VARS") {
    log.error("gateway.boot_missing_env", {
      detail: error.message,
      missing_keys: error.keys,
      hint: "أضِف هذه المتغيرات إلى بيئة التشغيل (انظر .env.example)",
    });
  } else {
    log.error("gateway.boot_config_invalid", { reason: error.code, detail: error.message });
  }
  // فشل سريع ومعلَن: أفضل من خادم يعمل بنصف مفاتيح ويفشل عند أول مستخدم حقيقي.
  process.exit(1);
}

const config = configResult.value;

/**
 * حاجزُ تشابكِ الأبوابِ عندَ الإقلاعِ — البندُ `W-6` · `ADR 0086`.
 *
 * وموضعُه بعدَ تحميلِ الضبطِ وقبلَ تركيبِ الحاويةِ: يقرأُ مفاتيحَ البيئةِ التي
 * تُعيِّنُ المقاصدَ، فيسقطُ الإقلاعُ إن كانَ مفتاحُ مقصدٍ مضبوطاً على **بابِ مقصدٍ
 * آخرَ** — كأن يُوجَّهَ `CORE_EVENTS_BASE_URL` إلى بوّابةِ دفعٍ. والبوّابةُ وقتَ
 * النداءِ ترفضُ ذلكَ أيضاً، لكن رفضاً عندَ أوّلِ حدثٍ حقيقيٍّ متأخّرٌ: خدمةٌ قامَت
 * ثمَّ تُخفِقُ نداءً نداءً. وما **لا** يُقاسُ ههنا: أنَّ المضيفَ المضبوطَ هوَ CORE
 * حقّاً — عنوانُه بيئيٌّ لا يعرفُه المستودعُ (`DEP-CORE-005`).
 */
try {
  assertEgressEnvironment(process.env);
} catch (error) {
  log.error("gateway.boot_egress_env_invalid", {
    detail: error instanceof Error ? error.message : String(error),
    hint: "مفتاحُ مقصدٍ مضبوطٌ على بابِ مقصدٍ آخرَ — راجعْ docs/wasla/egress-boundary.md",
  });
  process.exit(1);
}

/**
 * شرطُ صحّةِ النسخةِ الواحدةِ — يُفحَص قبلَ تركيبِ شيءٍ (`R-17` · ADR 0050).
 *
 * وموضعُه ههنا لا في آخرِ الإقلاعِ: خدمةٌ تُنشئ اتّصالاتِ قاعدةٍ وتُسجِّل مسالكَ ثمّ
 * تسقط ليست «فشلاً سريعاً». والفحصُ **بعدَ** تحميلِ الضبطِ لأنّه يقرأ `processTopology`
 * منه، و**قبلَ** الحاوية لأنّ الناقلَ داخلَ العمليةِ يُركَّب فيها.
 *
 * وما يُرفَض ههنا **تنافرٌ مُعلَنٌ** بين الطوبولوجيا وآليةِ التوزيعِ: أكثرُ من
 * عمليةٍ مع ناقلِ أحداثٍ لا يعبر العمليةَ. وليس `SESSION_STORE=redis` مرفوضاً ولا
 * دليلاً على طوبولوجيا — ذاك استدلالٌ معكوسٌ نسخَه `ADR 0051` §١: نسخةٌ واحدةٌ
 * بجلساتٍ في Redis حالةٌ إنتاجيةٌ مشروعةٌ ويجب ألّا يمنعَها النظامُ. وذلك ما
 * يصفه `R-17` بالكسرِ الصامتِ، فصار صاخباً في موضعِه الصحيحِ وحدَه. ولا تجاوزَ
 * بمتغيّرِ بيئةٍ: راجع الترويسةَ في `single-instance.ts`.
 */
const topologyViolation = singleInstanceInvariantViolation({
  topology: config.processTopology,
  sessionStore: config.sessionStore,
  distribution: DECIDED_EVENT_DISTRIBUTION,
});

if (topologyViolation !== null) {
  // «تعذّر إقلاع البوابة» — خرقُ طوبولوجيا العملياتِ.
  log.error("gateway.boot_topology_violation", {
    reason: topologyViolation.code,
    detail: topologyViolation.message,
  });
  process.exit(1);
}

const startedAt = new Date();

/**
 * سجل المقاييس يُنشأ قبل الحاوية لأن `observabilityLog` يُمرَّر إليها. قبل اليوم كانت
 * البوابة عمياء تماماً: لا `/metrics` ولا عدّاد واحد في المستودع كلّه، ومنصّةُ نقلٍ
 * لا تعرف كم طلباً لم يجد سائقاً تُدار بالشكوى لا بالقياس.
 */
const operationalMetrics = createOperationalMetrics();

function observabilityLog(event: string, meta: Record<string, unknown> = {}): void {
  if (event === "dispatch.no_eligible_driver") operationalMetrics.recordDispatchNoDriver();
  log(event, meta);
}

/**
 * مزوّد الدفع الحقيقي — اختياري: يُفعَّل عند توفّر أسراره (البند 8)، وغيابها يُعطّل
 * المسار لا يوقف الإقلاع. لكنّ إعداداً **خاطئاً** لا يُمرّ صامتاً: من كتب
 * `PAYMENT_PROVIDER` وأخطأ في مفاتيحه يظنّ أن الدفع يعمل، فيُعلَن السبب في السجلّ.
 *
 * ولا يُقرأ `PAYMENT_WEBHOOK_SECRET` بعد اليوم: التحقّق صار من اختصاص المحوّل
 * (Moyasar يُثبِت `secret_token` داخل الجسم)، ومقارنةُ سرٍّ مشترك في ترويسة مخترعة
 * كانت تجعل معرفةَ السرّ وحدها كافيةً لتفعيل أي اشتراك بأي مبلغ.
 */
const paymentProviderName = process.env.PAYMENT_PROVIDER ?? "";
const paymentProviderResult =
  paymentProviderName === ""
    ? null
    : createPaymentProvider(paymentProviderName, {
        moyasar: {
          secretKey: process.env.MOYASAR_SECRET_KEY ?? "",
          webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET ?? "",
          callbackUrl: process.env.MOYASAR_CALLBACK_URL ?? "",
          ...(process.env.MOYASAR_SUCCESS_URL === undefined
            ? {}
            : { successUrl: process.env.MOYASAR_SUCCESS_URL }),
          ...(process.env.MOYASAR_BACK_URL === undefined
            ? {}
            : { backUrl: process.env.MOYASAR_BACK_URL }),
        },
        tap: {
          secretKey: process.env.TAP_SECRET_KEY ?? "",
          redirectUrl: process.env.TAP_REDIRECT_URL ?? "",
          ...(process.env.TAP_POST_URL === undefined ? {} : { postUrl: process.env.TAP_POST_URL }),
        },
      });

if (paymentProviderResult === null) {
  // «مزوّد الدفع غير مُعدّ»
  log("payment_provider.not_configured", {
    hint: "اضبط PAYMENT_PROVIDER=tap أو moyasar مع مفاتيحه، أو manual للتفعيل اليدوي عبر الدعم",
  });
} else if (!paymentProviderResult.ok) {
  // لا يُسقِط البوابة: إسقاطها يُفقد البوتَين والرحلات كلّها لأجل الاشتراك وحده،
  // والرحلات لا تتوقّف على مزوّد دفع. ولكنّ الفشل مُعلَن لا مكتوم.
  log.error("payment_provider.config_invalid", {
    provider: paymentProviderName,
    detail: paymentProviderResult.error.detail,
  });
}

const paymentProvider = paymentProviderResult?.ok === true ? paymentProviderResult.value : null;

// التركيب الحقيقي: اتصال قاعدة واحد ومحوّلات فعلية لكل منفذ.
const container = buildContainer(config, {
  log: observabilityLog,
  paymentProvider,
  metrics: operationalMetrics,
});
const databaseGauges = createDatabaseGaugeCollector(container.sql, operationalMetrics);

/**
 * دفعُ المقاييس إلى مُجمِّعٍ مركزيّ — `F5-07` / `SCL-006` (ADR 0062).
 *
 * `GET /metrics` يعرض **العمليّةَ التي أجابت** لا النظام. فما دامت نسخةٌ واحدةٌ فلا
 * فرق؛ فإذا صار خلفَ المُوجِّهِ ثلاثُ نسخٍ (`F5-06`) أو انفصل العاملُ (`F5-04`) صار
 * كلُّ كشطٍ يقرأ عمليّةً عشوائيّةً ولا يُقرأ مجموعُ النظامِ من أيِّ موضع. فالدفعُ
 * هنا هو ما يجعل تينك الخطوتَين ممكنتَين لا مُعمِيتَين.
 *
 * و`null` تعني «لا مُجمِّعَ مضبوطاً» — وهو حالُ الإنتاجِ اليومَ — فلا يعمل شيءٌ ولا
 * يُسجَّل خطأ. و`GET /metrics` يبقى كما هو في الحالَين: هذا مسارُ قراءةٍ ثانٍ لا بديل.
 */
const metricsExporter = createConfiguredMetricsExporter({
  registry: operationalMetrics.registry,
  serviceName: "waslah-gateway",
  deploymentEnvironment: config.env,
  processTopology: config.processTopology,
  metricsExport: config.metricsExport,
  log,
  // نفسُ ما يفعله `GET /metrics` قبل العرض: `collect` تكتب المقاييسَ اللحظيّةَ في
  // المسجِّل بنفسها، وفشلُها مُحصىً في عدّادٍ داخلَها لا مبتلَعٌ هنا.
  beforeSnapshot: async () => {
    await databaseGauges.collect();
  },
});
if (metricsExporter === null) {
  log("metrics_export.disabled", { reason: "METRICS_EXPORT_ENDPOINT غير مضبوط" });
} else {
  metricsExporter.start();
}

/**
 * مقبض العامل المدمج إن كان مُفعَّلاً. يُملأ بعد إعلان جاهزية المنفذ لا قبله.
 */
let embeddedWorker: EmbeddedWorkerHandle | null = null;

/**
 * الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يلتقطُ ما أودعَه الويبهوكُ ويُعالجُه
 * خارجَ مسارِ HTTP (ADR 0057). يعملُ في عمليةِ البوابةِ لا في `apps/workers`؛
 * نقلُهُ إلى خدمةٍ منفصلةٍ (`SCL-007` / `F5-04`) لم يُغلَقْ بعد. يُوقفُ نظيفاً عند
 * التصريفِ بعدَ انتظارِ الشوطِ الجاري.
 */
let updateDrainer: TelegramUpdateDrainer | null = null;

/**
 * مقبضُ خادمِ `Bun.serve` — يُملأ آخرَ الإقلاع. التصريفُ الرشيقُ يقرؤه عبر الإغلاقِ
 * لا مباشرةً، لأنّ الإشارةَ قد تصل قبلَ اكتمالِ التركيبِ (F5-05).
 */
type GatewayServer = ReturnType<typeof Bun.serve>;
let serverHandle: GatewayServer | null = null;

/**
 * عددُ الطلباتِ الجاريةِ لحظةً بلحظة. يُزادُ عند الاستلامِ ويُنقصُ عند الفراغِ،
 * فيعرفُ التصريفُ متى يفرغُ الجاري بلا انتظارٍ أعمى (F5-05 / CAP-008).
 */
let inFlightRequests = 0;

/**
 * دورةُ حياةِ التصريفِ الرشيقِ. تُنشأ قبلَ تركيبِ المساراتِ لأنّ `/ready`
 * يقرأُ `isDraining()`، والمواردُ تُملأُ عبر إغلاقٍ يُقرأُ عند الإشارةِ لا عند الإنشاء.
 */
const lifecycle = createLifecycle({
  resources: {
    inFlight: () => inFlightRequests,
    forceClose: () => {
      // بعدَ انقضاءِ المهلةِ: إغلاقٌ قسريٌّ لما تبقّى من جارٍ.
      serverHandle?.stop(true);
    },
    close: async () => {
      // الدرينرُ قبلَ القاعدةِ: شوطٌ جارٍ يحجزُ وظيفةً بإيجارٍ، وإغلاقُ القاعدةِ
      // تحته يُتركُها محجوزةً حتى ينتهي الإيجارُ. فنتوقفُه أوّلاً وينتظرُ الجاري.
      if (updateDrainer !== null) {
        await updateDrainer.stop();
        updateDrainer = null;
      }
      // العاملُ أولاً: مهمّةٌ جاريةٌ تستعلمُ القاعدةَ، وإغلاقُ التجمّعِ تحتها يجعلها
      // تفشلُ بخطأِ اتصالٍ لا معنىً له بدلَ أن تنتهي أو تُوقَفَ نظيفة.
      if (embeddedWorker !== null) await embeddedWorker.stop();
      // **بعدَ** توقّفِ الدرينرِ والعاملِ وقبلَ إغلاقِ القاعدة: دفعةٌ أخيرةٌ تحمل ما
      // تراكم منذ آخرِ دورٍ. بدونها تخسر كلُّ إعادةِ نشرٍ حتى `intervalSeconds` من
      // العدِّ، فيصير مجموعُ النظامِ ناقصاً بمقدارِ عددِ إعاداتِ النشرِ في اليوم.
      // وقبلَ القاعدةِ لأنّ `beforeSnapshot` يستعلمها.
      if (metricsExporter !== null) await metricsExporter.stop();
      await container.close();
      // الخادمُ أخيراً — بقيَ يستقبلُ طوالَ التصريفِ حتى يُجيبَ `/ready` بـ«مُصرِّف».
      serverHandle?.stop(true);
    },
  },
  graceMs: 10_000,
  /**
   * نصفُ ثانيةٍ يراها المُوجّهُ. وبدونِها، إذا جاءَت الإشارةُ ولا طلبَ جارٍ — وهو
   * الغالبُ في إعادةِ النشرِ — أُغلِقَ المقبسُ في دورةِ حدثٍ واحدةٍ فرأى المُوجّهُ
   * رفضَ اتصالٍ لا «مُصرِّف». وليست مهلةَ سياسةٍ بل زمنُ انتشارِ حالةٍ في مُوجّهٍ
   * (القاعدةُ 0.3 لا تشملُ هذا كما لا تشملُ `graceMs` فوقَه).
   */
  announceMs: 500,
  log,
});

process.on("SIGTERM", () => {
  void lifecycle.requestShutdown("SIGTERM").then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void lifecycle.requestShutdown("SIGINT").then(() => process.exit(0));
});

/**
 * حدود تقنية لا تجارية: لا مكان لها في platform_settings.
 *
 * - محاولات السرّ الخاطئ: من يجرّب أكثر من عشرين سرّاً في الدقيقة لا يُخطئ بل يُخمّن.
 * - تحديثات المستخدم الواحد: ثلاثون في عشر ثوانٍ — ثلاث ضغطات في الثانية بلا توقّف،
 *   وهو فوق ما تبلغه يد إنسان وتحت ما يزعج مستخدماً سريعاً.
 */
const PROBE_LIMIT = { limit: 20, windowSeconds: 60 } as const;
const USER_LIMIT = { limit: 30, windowSeconds: 10 } as const;

/**
 * الحدّ على Redis عند تعدّد النسخ، وفي الذاكرة عند نسخة واحدة: حدٌّ يعدّ كل نسخة
 * وحدها ليس حدّاً بل قسمةً له على عددها. يُربَط بنفس مفتاح SESSION_STORE لأن كليهما
 * يجيب سؤالاً واحداً: هل نحن أكثر من عملية؟ (ADR 0011)
 */
const rateRedis =
  config.sessionStore === "redis"
    ? createUpstashRedis({
        url: config.redisUrl,
        token: config.redisToken,
      })
    : null;

function limiter(options: { readonly limit: number; readonly windowSeconds: number }): RateLimiter {
  return rateRedis === null
    ? createMemoryRateLimiter(options)
    : createRedisRateLimiter(rateRedis, {
        ...options,
        onFailure: (detail) => log("rate_limit.redis_failed", { detail }),
      });
}

const paymentWebhook =
  paymentProvider === null
    ? undefined
    : {
        provider: paymentProvider,
        confirmDeps: instrumentPaymentConfirmationDeps(
          {
            payments: createPaymentRepository(container.sql, async (driverId) => {
              const rows = await container.sql<{ city_id: string }[]>`
                select city_id from drivers where id = ${driverId}::uuid
              `;
              return rows[0]?.city_id ?? null;
            }),
            events: createWebhookEventStore(container.sql),
          },
          operationalMetrics,
        ),
        log,
      };

/**
 * تبعياتُ مسارِ الجلسة (`F1-03`). تُبنى فقط عند توفّرِ سرِّ التوقيع: بلا سرٍّ
 * لا يُركَّب المسارُ أصلاً، فلا يوجد طريقٌ يُصدِر جلسةً بتوقيعٍ ضعيف. والبوتان
 * كلاهما موقِّعٌ مقبول: التطبيقُ المصغَّر يُفتَح من بوتِ السائقِ وبوتِ الراكب،
 * فردُّ إثباتٍ صحيحٍ لأنّه جاء من البوتِ الآخر خطأٌ لا صرامة.
 */
const miniappSessionIssuer =
  config.miniappSessionSecret === null
    ? null
    : createMiniAppSessionIssuer({ secret: config.miniappSessionSecret });

/**
 * سلسلةُ التجديد (`F1-04`): رموزُ التجديدِ بمفتاحٍ **مشتقٍّ** من سرِّ الجلسةِ بفصلِ
 * نطاق، ومُصدِرُ رمزِ الوصولِ هو نفسُه المُصدِرُ من إذنِ التجديدِ — فمعرّفُ الجلسةِ
 * واحدٌ في الرمزَين. ولا متغيّرَ بيئةٍ ثانياً: انظر تعليلَ الاشتقاقِ وحدودَه في
 * `packages/infrastructure/identity/miniapp-refresh.ts`.
 */
const refreshChain =
  config.miniappSessionSecret === null || miniappSessionIssuer === null
    ? undefined
    : {
        refresh: createMiniAppRefreshTokens({ secret: config.miniappSessionSecret }),
        grantIssuer: miniappSessionIssuer,
      };

const sessionTelegram =
  miniappSessionIssuer === null
    ? undefined
    : {
        exchange: {
          verifier: createTelegramInitDataVerifier({
            bots: [
              { name: "driver", token: config.driverBotToken },
              { name: "rider", token: config.riderBotToken },
            ],
          }),
          issuer: miniappSessionIssuer,
          ...(refreshChain === undefined ? {} : { refreshChain }),
          now: () => new Date(),
          log,
        },
        log,
      };

/**
 * مسارُ التجديد (`F1-04`) — يُركَّب مع سلسلةِ التجديدِ وحدَها. ولا يلمس تيليجرامَ:
 * التحقّقُ من تيليجرامَ يقع عندَ إنشاءِ الجلسةِ وحدَه (`F1-03` · ADR 0035).
 */
const sessionRefresh =
  refreshChain === undefined
    ? undefined
    : {
        renew: {
          refresh: refreshChain.refresh,
          issuer: refreshChain.grantIssuer,
          now: () => new Date(),
          log,
        },
        log,
      };

/**
 * مسارُ الدورِ والحالة (`F1-05`) — يُركَّب مع سرِّ الجلسةِ وحدَه، ويقرأ `users`
 * قراءةً فقط. ولا يلمس تيليجرامَ ولا يُنشئ حساباً: غيابُ الصفِّ حالةٌ تُعاد
 * («غير مسجَّل») لا صفٌّ يُكتَب — قرارُ مالكِ المنتجِ في `F1-05`.
 */
const me =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        log,
      };

/**
 * مركزُ الإشعاراتِ داخلَ التطبيقِ (`F6-05` / `SS-07`) — سطحُ قراءةٍ ووسمٍ فقط،
 * يعيدُ استخدامَ **نفسَ** مصادقةِ `F1-05` بلا مسارِ مصادقةٍ ثانٍ يتخلّفُ عن الأوّل.
 * وتحويلُ معرّفِ تيليجرام إلى `users.id` يقعُ داخلَ دالّةِ القاعدةِ لا ههنا،
 * فالتفويضُ على مستوى الكائنِ خاصّيّةُ مخطَّطٍ لا انتباهُ مُراجعٍ. وغيابُ سرِّ
 * الجلسةِ يُسقِطُ السطحَ بلا أن يُعطِّلَ التصنيفَ: التصنيفُ في القاعدةِ لا ههنا.
 */
const notifications =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        center: createUserNotificationCenter(container.sql),
        log,
      };

/**
 * `F4-01` — سطحُ استقبالِ الموقعِ للتطبيقِ المصغَّرِ. يُركَّبُ مع سرِّ الجلسةِ
 * وحدَه كأخويهِ، **ويعيدُ استخدامَ تبعياتِ الحاويةِ نفسِها** التي يكتبُ بها مسارُ
 * البوتِ — لا دليلَ سائقينَ ثانياً ولا سياسةَ مجالٍ ثانيةً.
 *
 * وحدُّ المعدّلِ رقمُه ههنا لا في المسارِ: نبضةُ موقعٍ كلَّ ثانيةٍ هيَ المعتادُ في
 * تطبيقٍ حيٍّ، فحدُّ المستخدمِ العامُّ (`USER_LIMIT`) هوَ عينُ ما يَسَعُها ولا
 * يُخترَعُ له رقمٌ ثالثٌ يُصانُ في موضعينِ.
 */
const driverLocation =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        drivers: container.driverLocation.drivers,
        ingest: container.driverLocation.ingest,
        limits: { perDriver: limiter(USER_LIMIT) },
        log,
      };

/**
 * `W-5` — بابُ استقبالِ أحداثِ CORE. يُركَّبُ حينَ يزرعُ المُشغِّلُ سرَّ الاشتراكِ
 * الذي سجَّلَه في CORE؛ وغيابُه لا يُسقِطُ الخدمةَ ولا يفتحُ باباً بلا توقيعٍ: لا
 * يُركَّبُ المسارُ أصلاً، فيَظهرُ الغيابُ `404` لا قَبولاً كاذباً. والسرُّ يُقرأُ
 * من البيئةِ لا من `platform_settings`: سرٌّ في قاعدةٍ تقرؤها أدواتُ الإدارةِ
 * أوسعُ انتشاراً من سرٍّ في بيئةِ عمليّةٍ واحدةٍ.
 */
const coreInboundSigningSecret = process.env[CORE_EVENT_TRANSPORT_ENV.inboundSigningSecret];
const coreEventIntake =
  coreInboundSigningSecret === undefined
    ? undefined
    : {
        signingSecret: coreInboundSigningSecret,
        lifecycle: createFulfillmentLifecycle(createOperationalJobRepository(container.sql)),
      };

/**
 * مسارا الموافقاتِ (`F2-01`) — يُركَّبانِ مع سرِّ الجلسةِ وحدَه كأخويهِما، ويكتبانِ
 * عبرَ دالّةٍ ذرّيّةٍ واحدةٍ تستنبطُ المدينةَ من صفِّ المستخدمِ داخلَ القاعدةِ
 * (القاعدتانِ 0.4 و0.5). ولا يُمرَّرُ `city_id` من هنا أصلاً: لا موضعَ في البابِ
 * يستقبلُه، فلا يستطيعُ خطأُ تركيبٍ أن يكتبَ موافقةً في مدينةٍ ليست مدينةَ صاحبِها.
 *
 * وغيابُ السرِّ يُسقِطُ المسارَينِ (`404`) ولا يُعطِّلُهما (`503`): مسارٌ معلَنٌ بلا
 * مصادقةٍ يدعو إلى إرسالِ إقرارٍ لا هويّةَ له.
 */
const consents =
  config.miniappSessionSecret === null
    ? undefined
    : {
        consent: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          reader: createConsentRecordReader(container.sql),
          writer: createConsentRecordWriter(container.sql),
          now: () => new Date(),
          log,
        },
        log,
      };

/**
 * مساراتُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ (`F2-02`) — تُركَّبُ مع سرِّ الجلسةِ
 * وحدَه كأخواتِها، والمدينةُ تُستنبَطُ من صفِّ المستخدمِ داخلَ القاعدةِ فلا موضعَ
 * ههنا يستقبلُ `city_id` أصلاً (القاعدتانِ 0.4 و0.5).
 *
 * والوجهاتُ الأخيرةُ **قارئٌ ثالثٌ** لا امتدادٌ للأوّلِ: مصدرُها `orders` لا
 * `saved_places`، وفصلُها في التركيبِ يمنعُ أن يُظنَّ يوماً أنَّها تُكتَبُ.
 */
const places =
  config.miniappSessionSecret === null
    ? undefined
    : {
        places: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          reader: createSavedPlaceReader(container.sql),
          writer: createSavedPlaceWriter(container.sql),
          recent: createRecentDestinationReader(container.sql),
          now: () => new Date(),
        },
        log,
      };

/**
 * مساراتُ اختيارِ الوجهةِ (`F2-03`) — تُركَّبُ مع سرِّ الجلسةِ وحدَه، ولا مزوِّدَ
 * خارجيَّ ههنا: لا مُرمِّزَ جغرافيّاً ولا مفتاحَ خرائطَ (استقلالُ المشروعِ `O-7`
 * ويفرضُه `check-egress-boundary`). والبحثُ والمصادقةُ كلاهما نداءُ دالّةٍ
 * واحدةٍ في القاعدةِ يقرأُ مدينةَ صاحبِ الجلسةِ وحدَّها (القاعدتانِ 0.4 و0.5).
 */
const destinations =
  config.miniappSessionSecret === null
    ? undefined
    : {
        destinations: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          searcher: createDestinationSearcher(container.sql),
          resolver: createDestinationResolver(container.sql),
          now: () => new Date(),
        },
        log,
      };

/**
 * مسارُ الاقتباسِ (`F2-04`) — يُركَّبُ مع سرِّ الجلسةِ وحدَه. ولا مفتاحَ خرائطَ
 * ههنا: المسافةُ من PostGIS والمدّةُ من مزوِّدِ التوجيهِ المُهيَّأِ إن وُجِدَ،
 * و`null` منه امتناعٌ مُعلَنٌ لا رقمٌ مخترَعٌ (`ADR 0024` · استقلالُ المشروعِ
 * `O-7`). و`container.routing` هوَ **نفسُه** الذي تستعملُه بطاقةُ السائقِ، فلا
 * قرارُ تهيئةٍ ثانٍ.
 */
const quote =
  config.miniappSessionSecret === null
    ? undefined
    : {
        quote: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          judge: createQuoteJudge(container.sql),
          routing: container.routing,
          now: () => new Date(),
        },
        log,
      };

/**
 * مساراتُ الرحلةِ (`F2-05`) — سرُّ الجلسةِ وحدَه شرطُ تركيبِها، كالاقتباسِ. ولا
 * مفتاحَ خرائطَ ههنا ولا مزوِّدَ توجيهٍ: الإنشاءُ حكمٌ في القاعدةِ، وحالةُ البحثِ
 * قراءةٌ منها. والقارئُ والآمرُ والمُلغي **ثلاثةُ كائناتٍ** لا واحدٌ: مسارُ
 * القراءةِ لا يجبُ أن يملكَ حقَّ الكتابةِ ولا حقَّ الإلغاءِ.
 */
const rides =
  config.miniappSessionSecret === null
    ? undefined
    : {
        request: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          rides: createRideRequestCommand(container.sql),
          now: () => new Date(),
        },
        search: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          search: createRideSearchReader(container.sql),
          now: () => new Date(),
        },
        // الرحلةُ النشطةُ (`F2-06`) **تملكُ مزوِّدَ التوجيهِ** خلافاً لأخواتِها:
        // مدّةُ وصولِ السائقِ سؤالُها. و`container.routing` قد يكونُ `null` بقرارِ
        // مشغِّلٍ مُعلَنٍ، فتعودُ المدّةُ `NOT_CONFIGURED` امتناعاً مُصنَّفاً — ولا
        // يُعطَّلُ المسارُ كلُّه لأجلِ حقلٍ تكميليٍّ.
        active: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          rides: createActiveRideReader(container.sql),
          now: () => new Date(),
          routing: { routing: container.routing },
        },
        cancel: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          canceller: createRideCancelCommand(container.sql),
          now: () => new Date(),
        },
        // الملخَّصُ والتقييمُ (`F2-07`) **كائنانِ منفصلانِ** كسابقَيهما: قارئُ
        // الملخَّصِ لا يملكُ حقَّ كتابةِ تقييمٍ، وآمرُ التقييمِ لا يملكُ قراءةَ
        // ملخَّصٍ. **ولا مزوِّدَ توجيهٍ ههنا**: لا مدّةَ وصولٍ لرحلةٍ انتهت.
        summary: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          rides: createRideSummaryReader(container.sql),
          now: () => new Date(),
        },
        rating: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          ratings: createRideRatingCommand(container.sql),
          now: () => new Date(),
        },
        // السجلُّ والتفاصيلُ (`F2-08`) **كائنانِ منفصلانِ** كسوابقِهما، وكلاهما
        // **قارئٌ محضٌ**: لا حقَّ كتابةٍ في سجلٍّ ولا في تفاصيلَ.
        // **ولا مزوِّدَ توجيهٍ ولا خرائطَ**: الماضي لا يُتابَعُ (`ADR 0007`).
        history: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          history: createRideHistoryReader(container.sql),
          now: () => new Date(),
        },
        detail: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          details: createRideDetailReader(container.sql),
          now: () => new Date(),
        },
        // المشاركةُ (`F2-09`) **ثلاثةُ كائناتٍ** لا واحدٌ: قارئُ الحالِ لا يملكُ
        // حقَّ إصدارِ رابطٍ، والمُصدِرُ لا يملكُ حقَّ الإلغاءِ. والإصدارُ وحدَه
        // يحملُ الأساسَ العامَّ — و`issuing: undefined` حينَ يغيبُ
        // `TRACKING_TOKEN_BASE_URL`: **قرارُ مشغِّلٍ مُعلَنٌ** يُقرأُ
        // `SHARING_NOT_CONFIGURED`، لا رابطٌ يُبنى بأساسٍ مُخمَّنٍ.
        share: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          shares: createRideShareReader(container.sql),
          now: () => new Date(),
        },
        shareStart: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          issuing:
            config.trackingTokenBaseUrl === null
              ? undefined
              : {
                  tokens: container.tracking.tokens,
                  mint: container.tracking.tokenMint,
                  baseUrl: config.trackingTokenBaseUrl,
                },
        },
        // الإيقافُ **لا يشترطُ الأساسَ العامَّ**: إلغاءُ رابطٍ قائمٍ لا يحتاجُ أن
        // يُبنى رابطٌ — ولو رُبِطَ بالأساسِ لَبقيَت روابطُ حيّةٌ بلا زرٍّ يُغلقُها
        // يومَ يُسحَبُ الإعدادُ.
        shareStop: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          revoking: { tokens: container.tracking.tokens },
        },
        log,
      };

/**
 * سطحُ الاستغاثةِ (`F2-10`) — **كائنانِ** كسوابقِه: قارئُ الحكمِ لا يملكُ حقَّ
 * تقييدِ حادثٍ، وآمرُ الضغطةِ لا يقرأُ حكماً. والدورُ `"rider"` **مُركَّبٌ ههنا**
 * لا مقروءٌ من الطلبِ: لو قُرِئَ من الجسمِ لَأمكنَ لراكبٍ أن يُبلِّغَ بصفةِ سائقٍ.
 *
 * **والمنفذُ هوَ منفذُ البوتَينِ نفسُه** (`container.safety.trigger.incidents`):
 * مسارانِ للسطحِ وحاكمٌ واحدٌ، لا حاكمانِ يفترقانِ يومَ يتغيَّرُ شرطٌ في القاعدةِ.
 */
const safety =
  config.miniappSessionSecret === null
    ? undefined
    : {
        surface: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          surface: createSosSurfaceReader(container.sql),
          role: "rider" as const,
        },
        trigger: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          incidents: container.safety.trigger.incidents,
          role: "rider" as const,
        },
        log,
      };

/**
 * حقّا البيانةِ (`F2-11`) — **تبعيةٌ واحدةٌ لحقَّينِ**: مصدرُ حقيقةِ ما يُنزَّلُ
 * وما يُمحى سجلٌّ واحدٌ (`erasure-policy.ts`)، فمنفذٌ واحدٌ يقرؤه. ولا دورَ
 * مُركَّبٌ ههنا: الدالّتانِ في القاعدةِ تقرآنِ دورَ الصفِّ وترفضانِ غيرَ الراكبِ
 * برمزٍ مُصنَّفٍ — فحقُّ السائقِ (`SD-12`) يُفتَحُ في القاعدةِ لا بسطرٍ ههنا.
 */
const dataRights =
  config.miniappSessionSecret === null
    ? undefined
    : {
        dataRights: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          store: new PostgresDataRightsStore(container.sql),
        },
        log,
      };

/**
 * الدعمُ من داخلِ التطبيقِ (`F2-12`) — **منفذٌ واحدٌ لمسارَينِ**: الفتحُ
 * والقراءةُ يمسّانِ جدولاً واحداً بحكمٍ واحدٍ، فمخزنٌ واحدٌ يقرؤهما. ولا دورَ
 * مُركَّبٌ ههنا: `open_support_ticket` تقرأُ دورَ الصفِّ وتردُّ غيرَ صاحبِه
 * برمزٍ مُصنَّفٍ — فشكوى السائقِ (`SD-10`) تُفتَحُ في القاعدةِ لا بسطرٍ ههنا.
 */
const support =
  config.miniappSessionSecret === null
    ? undefined
    : {
        support: {
          sessions: createMiniAppSessionReader(config.miniappSessionSecret),
          now: () => new Date(),
          store: new PostgresRiderSupportStore(container.sql),
        },
        log,
      };

/**
 * وثائقُ السائقِ (`F3-01`) — **مخزنٌ واحدٌ لأربعةِ مساراتٍ**، ومُوقِّعٌ يُقرأُ من
 * البيئةِ. وغيابُ مفتاحِ التخزينِ **لا يُسقِطُ السطحَ**: يُركَّبُ مُوقِّعٌ غيرُ
 * مُهيَّأٍ يردُّ رفضاً مُصنَّفاً، فيبقى لوحُ الحالاتِ يقولُ للسائقِ سببَ حجبِه —
 * وذاكَ أنفعُ من بابٍ مُغلَقٍ بالكامِلِ لأنَّ الرفعَ متعذِّرٌ.
 */
const driverDocuments =
  config.miniappSessionSecret === null
    ? undefined
    : (() => {
        const storage = readSignedUploadConfig(process.env);
        if (storage === null) {
          log("driver_documents.signer_not_configured", {
            hint: "OBJECT_STORAGE_URL + OBJECT_STORAGE_SECRET_KEY",
          });
        }
        return {
          documents: {
            sessions: createMiniAppSessionReader(config.miniappSessionSecret),
            now: () => new Date(),
            store: new PostgresDriverDocumentStore(container.sql),
            signer:
              storage === null ? new UnconfiguredUploadSigner() : new HttpUploadSigner(storage),
          },
          log,
        };
      })();

const app = createServer({
  health: {
    now: () => new Date(),
    startedAt,
    env: process.env,
    isDraining: lifecycle.isDraining,
    probeTimeoutMs: 2_000,
    // فحص جاهزية حقيقي: استعلام فعلي على القاعدة، لا افتراض أن الرابط صحيح
    readinessChecks: [
      {
        name: "database",
        check: async () => {
          const rows = await container.sql<{ ok: number }[]>`select 1 as ok`;
          return rows[0]?.ok === 1;
        },
      },
      /**
       * الاتّصالُ الناجح لا يعني قاعدةً صالحة. قاعدةُ الإنتاج بقيت متأخّرةً سبعَ
       * عشرةَ ترحيلةً عن المستودع بينما `/ready` يقول «جاهز»: الجداولُ والدوالُّ
       * التي يناديها الكودُ غائبة، والإخفاقُ يظهر أوّلَ ما يضغط سائقٌ زرّاً — أي
       * على المستخدم لا على المراقبة. فهذا الفحصُ يُقدّم الإخفاقَ إلى النشر.
       *
       * وهو `critical`: خدمةٌ تعمل على مخطّطٍ ناقصٍ تكتب بياناتٍ نصفَ متّسقة،
       * وذلك أسوأُ من رفضِ الحركة حتى تُطبَّق الترحيلات.
       */
      {
        name: "database_schema",
        check: async () => {
          const report = await verifySchemaContract(container.sql);
          if (report.complete) return { ok: true };
          const missing = [
            report.missingFunctions.length > 0
              ? `دوالّ: ${report.missingFunctions.join(", ")}`
              : null,
            report.missingTables.length > 0 ? `جداول: ${report.missingTables.join(", ")}` : null,
          ]
            .filter((line): line is string => line !== null)
            .join(" | ");
          return { ok: false, detail: `ترحيلات غير مطبّقة — ${missing}` };
        },
      },
      // Redis يُفحَص فقط حين يكون في المسار الحرج فعلاً. فحصه دائماً كان سيُسقط
      // الجهوزية في بيئةٍ لا تستعمله أصلاً، فيصير الفحص كذباً في الاتجاه المعاكس.
      //
      // وهو `critical: false` عن قصد: انقطاع Redis يُضعف ولا يُعطّل — حدّ المعدّل
      // يفشل مفتوحاً (fixed-window.ts: allowOnFailure)، والحوارات تعود إلى بدايتها
      // ولا تفسد، والرحلات ولوحة الإدارة على القاعدة لا على Redis. وإعادة تشغيل
      // النسخة لا تُعيد Redis. فإسقاط الجهوزية هنا كان سيجعل Render يقطع الحركة
      // بعد 15 ثانية ثم يُعيد التشغيل بعد 60 — فيصير عطل Upstash انقطاعاً كاملاً
      // للمنصّة كلها. العطل يبقى مرئياً في `degradedChecks` لا مكتوماً.
      ...(rateRedis === null
        ? []
        : [
            {
              name: "redis",
              critical: false,
              check: async (): Promise<boolean> => {
                const result = await rateRedis.command(["PING"]);
                return result.ok;
              },
            },
          ]),
      /**
       * نبضةُ المهامّ (§4.3). الفجوةُ التي تُغلَق هنا: إقلاعُ العامل المضمَّن لا
       * يُسقط البوابة عند فشله — وهو قرارٌ صحيح — لكنّ ثمنَه أنّ `/ready` كان يقول
       * `ready` والمهامّ ميّتة: العروضُ لا تنتهي، والطلبُ لا يُعاد توزيعُه، والسائقُ
       * يدفع ولا يُشعَر — ولا مؤشّر واحد يُرى من خارج السجلّ.
       *
       * والتوقّعاتُ تُقرأ من حاوية العامل (`jobHealthExpectations`) لا تُكتب هنا:
       * تواترٌ يُعدّل في `JOB_INTERVALS` وعتبةُ بياتٍ منسوخة في البوابة ينزلقان حتماً.
       */
      ...createJobHealthProbes({
        heartbeats: createJobHeartbeatReader(container.sql),
        expectations: async () => {
          const rows = await container.sql<{ id: string }[]>`
            select id from cities where is_active = true
          `;
          return jobHealthExpectations(rows.map((row) => row.id as CityId));
        },
        now: () => new Date(),
        startedAt,
      }),
    ],
  },
  webhook: {
    webhookSecret: config.telegramWebhookSecret,
    log,
    handler: instrumentTelegramHandler(container.handler, operationalMetrics, { log }),
    // مصدرُ قرارِ منعِ التكرارِ في الإنتاج: القاعدةُ لا الذاكرةُ (ADR 0054 §٣-أ).
    // ويبقى `dedup` موصولاً للمقاييسِ وللتدهورِ المُعلَنِ حينَ يغيبُ `intake`.
    intake: instrumentUpdateIntake(createPostgresUpdateIntake(container.sql), operationalMetrics),
    // **SCL-001**: في الإنتاجِ يُحظَرُ العملُ بلا إيداعٍ صامدٍ فيُرمي المصنعُ عند الإقلاع،
    // فلا يصيرَ dedup الذاكرةُ مساراً صامتاً (ADR 0059).
    requireDurableIntake: config.env === "production",
    dedup: instrumentUpdateDeduplicator(createUpdateDeduplicator(), operationalMetrics),
    rateLimits: { probes: limiter(PROBE_LIMIT), users: limiter(USER_LIMIT) },
  },
  ...(paymentWebhook === undefined ? {} : { paymentWebhook }),
  ...(sessionTelegram === undefined ? {} : { sessionTelegram }),
  ...(sessionRefresh === undefined ? {} : { sessionRefresh }),
  ...(me === undefined ? {} : { me }),
  ...(consents === undefined ? {} : { consents }),
  ...(places === undefined ? {} : { places }),
  ...(destinations === undefined ? {} : { destinations }),
  ...(quote === undefined ? {} : { quote }),
  ...(rides === undefined ? {} : { rides }),
  ...(safety === undefined ? {} : { safety }),
  ...(dataRights === undefined ? {} : { dataRights }),
  ...(support === undefined ? {} : { support }),
  ...(driverDocuments === undefined ? {} : { driverDocuments }),
  ...(notifications === undefined ? {} : { notifications }),
  ...(driverLocation === undefined ? {} : { driverLocation }),
  ...(coreEventIntake === undefined ? {} : { coreEventIntake }),
});

/**
 * مسار المقاييس — يُركَّب هنا وليس في `server.ts` لنفس سبب موجّهي الإدارة
 * (ADR 0007): قراءة مقاييس القاعدة تستعلم فعلاً، و`server.ts` يُستورد في اختبارات
 * المسارات بلا قاعدة. والمسار يفشل مغلقاً عند غياب `METRICS_TOKEN`: مقاييسُ
 * منصّةٍ مفتوحةٌ للعالم تكشف أحجام الأعمال وأوقات الذروة لمن طلب الرابط.
 */
app.route(
  "/",
  createMetricsRoutes({
    metrics: operationalMetrics,
    metricsToken: process.env.METRICS_TOKEN,
    databaseGauges,
    log,
  }),
);

// لوحة الإدارة: موجّهان منفصلان يُركَّبان هنا لا في server.ts (ADR 0007).
const adminAuth = createAdminAuthPort(container.sql);

/**
 * نمطُ الخريطة يُحلَّل مرّةً عند الإقلاع لا في كل طلب: الضبط ثابتٌ في عمر العملية،
 * وتحليلُه في كل طلب كان سيدفع ثمنَ تفكيك روابطٍ بلا فائدةٍ ويُخفي خطأَ ضبطٍ إلى
 * أول زيارةٍ للصفحة بدل أن يظهر في السجل عند الإقلاع.
 *
 * وضبطٌ خاطئ (نمطٌ على http، أو مفتاحٌ في موضعين) **لا يُسقط البوابة**: الخريطة
 * زينةُ لوحةٍ إدارية، وإسقاطُ استقبال طلبات تلغرام لأجلها كان سيُوقف الخدمةَ كلَّها
 * بسبب ميزةٍ ثانوية. يُسجَّل بوضوح، وتبقى السياسة أضيقَ ما يمكن (لا أصلَ خارجي).
 */
const mapStyle = resolveMapStyle({
  provider: config.mapProvider,
  styleUrl: config.mapStyleUrl,
  publicApiKey: config.mapTilesPublicKey,
});
if (!mapStyle.ok) {
  log("map.config.invalid", { key: mapStyle.error.key, detail: mapStyle.error.detail });
} else if (!mapStyle.value.configured) {
  log("map.disabled", { reason: mapStyle.value.reason });
} else {
  log("map.enabled", { origins: mapStyle.value.origins });
}
const mapOrigins: readonly string[] =
  mapStyle.ok && mapStyle.value.configured ? mapStyle.value.origins : [];
/**
 * سطحُ اللوحةِ — `F5-08` / `ARCH-011` · ADR 0064.
 *
 * التركيبُ **مشروطٌ بإعلانٍ** لا دائمٌ: حين تُعلَنُ `RUN_ADMIN_IN_GATEWAY=false`
 * تكونُ خدمةُ `waslah-admin` هي موضعَ اللوحةِ الوحيدَ، وتركيبُها ههنا كذلك يعني
 * سطحاً إداريّاً مكشوفاً على الأصلِ الذي يستقبلُ ويبهوكَ تلغرام، وتقاريرَ ثقيلةً
 * تسحبُ من بِركةِ الاتّصالاتِ التي يجبُ أن تُجيبَ الويبهوكَ في ثوانٍ — أي إبطالُ
 * العزلِ الذي أُنشئت الخدمةُ لأجلِهِ، بلا طلبٍ يُخفِقُ ولا حرفٍ يشكو.
 *
 * والترتيبُ الحرجُ (الأخصُّ أوّلاً) انتقلَ إلى `admin/mount.ts`: هو الموضعُ الوحيدُ
 * الذي يعرفُهُ، وتستدعيهِ عمليةُ `apps/admin` نفسُها — فلا ينحرفُ الترتيبُ بين
 * موضعَي تشغيلٍ. والتعليلُ الكاملُ في رأسِ ذلك الملفِّ.
 *
 * ومُرسِلُ رمزِ الدخولِ يُغلَّفُ ههنا لا في `mount.ts`: البوّابةُ تملكُ مُرسِلَ بوتِ
 * السائقِ أصلاً من حاويتِها، وعمليةُ اللوحةِ تبنيه بنفسِها من الرمزِ وحدَه.
 */
if (config.runAdminInGateway) {
  mountAdminSurface(app, {
    sql: container.sql,
    auth: adminAuth,
    bus: container.tracking.bus,
    mapOrigins,
    ...(mapStyle.ok ? { mapStyle: mapStyle.value } : {}),
    maplibreSri: config.maplibreSri,
    codeSender: {
      send: async (telegramId, text) => {
        try {
          await container.driverSender.sendMessage(telegramId, text, undefined);
          return true;
        } catch {
          return false;
        }
      },
    },
    log,
  });
} else {
  log("admin_surface.not_mounted", {
    hint: "RUN_ADMIN_IN_GATEWAY=false — اللوحةُ في خدمةِ waslah-admin وحدَها (ADR 0064)",
  });
}

/**
 * صفحةُ التتبّع العامّة (§4.2). تُركَّب هنا لا في `server.ts` لنفس سبب موجّهي
 * الإدارة (ADR 0007): تقرأ من القاعدة، و`server.ts` يُستورد في اختبارات المسارات
 * بلا قاعدة.
 *
 * والوسيطُ الأمنيّ يُركَّب على الموجّه نفسه لا على التطبيق كلّه: سياسةُ
 * `default-src 'none'` كانت ستكسر لوحةَ الإدارة، ومسارُ الويبهوك لا يحتاج ترويسةَ
 * صفحةٍ أصلاً. فيُحصر الوسيطُ في صاحبه.
 *
 * وترتيبُ التركيب: بعد سطحِ الإدارةِ كلِّه. وكان قبلَ `F5-08` بينَ `/admin/api`
 * و`/admin`؛ فلمّا صار السطحُ يُركَّب دفعةً واحدةً في `mountAdminSurface` انتقلَ
 * هذا السطرُ إلى ما بعدَهم جميعاً. **والانتقالُ بلا أثرٍ** لا لأنّ الترتيبَ لا
 * يُهمُّ بل لأنّ `/track` و`/api/track` لا يتشابهان مع أيِّ بادئةٍ إداريّةٍ في أيِّ
 * اتجاهٍ — لا هما بادئةٌ لها ولا هي بادئةٌ لهما. ولو تشابهت لكان النقلُ عطلاً
 * صامتاً، ولذلك تُقال عدمُ التشابهِ صريحاً ولا يُقال «الترتيبُ محفوظٌ».
 * (ولا تعارضَ مع `routes/tracking.ts` لأنّه غيرُ مركَّب أصلاً — الفرقُ موثَّقٌ في
 * رأس `routes/public-tracking.ts`.)
 */
const publicTracking = createPublicTrackingRoutes({
  tokens: container.tracking.tokens,
  mapStyle: mapStyle.ok ? mapStyle.value : { configured: false, reason: "ضبطُ الخريطة غير صالح" },
  scriptUrl: maplibreScriptUrl(),
  stylesheetUrl: maplibreStylesheetUrl(),
  integrity: config.maplibreSri ?? MAPLIBRE_SRI_UNSET,
  securityHeaders: createPublicSecurityHeaders({
    mapOrigins,
    scriptOrigin: MAPLIBRE_CDN_ORIGIN,
  }),
  log,
});
app.route("/", publicTracking);

/**
 * فحص مخطط استباقي: الاتصال بالقاعدة ينجح تماماً ولو كانت فارغة بلا هجرات،
 * فتقلع الخدمة سليمة ظاهراً ثم يكتشف العطلَ أولُ مستخدم حقيقي يضغط /start.
 * هذا ما حدث فعلاً في أول نشر على Render.
 *
 * لا يمنع الإقلاع عمداً: الخدمة تبقى حيّة لـ /health ولتطبيق الهجرات عليها
 * دون دورة إعادة تشغيل خانقة، لكن السبب يظهر في السجلّ لحظة الإقلاع لا بعد ساعات.
 */
async function verifySchemaApplied(): Promise<void> {
  try {
    await container.sql`select 1 from cities limit 1`;
    log("gateway.schema_applied", {});
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    log("gateway.schema_not_applied", {
      detail,
      remedy: "راجع docs/render-deployment-vars.md §4 — خطوة «القاعدة أولاً»",
    });
  }
}

log("gateway.started", {
  port: config.port,
  env: config.env,
  missingEnv: missingEnvKeys(process.env),
});

// بعد سطر «البوابة تعمل» لا قبله، حتى لا يؤخّر استعلامٌ بطيء إعلانَ جاهزية المنفذ.
void verifySchemaApplied();

/**
 * `F7-04` — سطرُ ميزانيّةِ الاتّصالاتِ عندَ الإقلاعِ.
 *
 * ولمَ يُسجَّلُ أصلاً: يومَ تضيقُ القاعدةُ باتّصالاتِها يكونُ أوّلَ سؤالٍ «كم
 * اتّصالاً تفتحُ المنظومةُ عن نفسِها؟» — وأسوأُ جوابٍ عنه تخمينٌ يُجمَعُ بيدٍ من
 * أربعةِ ملفّاتٍ تحتَ ضغطِ عطلٍ. والرقمُ ههنا **محسوبٌ من الثوابتِ التي أقلعَت
 * عليها هذه العمليةُ نفسُها**، و`workerRunsInGateway` تُقرأُ من الإعدادِ الفعليِّ لا
 * من المُعلَنِ: بوّابةٌ تحملُ المهامَّ تحملُ تجمُّعَيها معها، وهو الفرقُ الذي كانت
 * صيغةُ `5N + 10M` تُسقِطُه.
 *
 * ولا يُقارَنُ بسقفِ المزوِّدِ ولا يُسقِطُ إقلاعاً: السقفُ مُدخَلٌ من خارجِ
 * المستودعِ (خطّةُ الحسابِ · إعدادُ pooler)، وحاجزٌ يحكمُ على رقمٍ لا يعرفُه
 * يُطمئنُ زوراً (`ح-5`).
 */
log("connection_budget.declared", {
  summary: describeConnectionBudget(
    computeConnectionBudget({
      ...DECLARED_TOPOLOGY,
      workerRunsInGateway: config.runWorkerInGateway,
    }),
  ),
});

/**
 * المهامّ الدورية داخل نفس العملية — خلف متغيّر بيئة صريح.
 *
 * لماذا هنا وليس في `server.ts`؟ لأن `server.ts` يُستدعى في اختبارات المسارات، وبدء
 * مؤقّتات حقيقية وتجمّعات اتصال هناك كان سيجعل كل اختبار مسار يعلّق على القاعدة.
 * هذا الموضع — نقطة التشغيل وحدها — لا يُستورد في أي اختبار.
 *
 * الإقلاع غير حاجز: بناء قائمة المهامّ يستعلم جدول المدن، ولا يجوز أن يؤخّر ذلك
 * استجابة المنفذ فيقرأها Render فشلاً في فحص الجاهزية.
 */
if (config.runWorkerInGateway) {
  void startEmbeddedWorker(
    config,
    createObservabilityJobLogger(operationalMetrics, { info: log.info, error: log.error }),
    // نفسُ سجلّ المقاييس الذي يخدمه `/metrics`: العامل المدمج يعيش في هذه العملية،
    // فعدّاداتُه — وأهمُّها عرضٌ سقط بمهلته — تُقرأ من المنفذ نفسه بلا خدمةٍ ثانية.
    { metrics: operationalMetrics },
  )
    .then((handle) => {
      embeddedWorker = handle;
    })
    .catch((cause: unknown) => {
      // فشل إقلاع العامل لا يُسقط البوابة: بوابةٌ تعمل بلا مهامّ دورية أفضل من
      // انعدام البوتَين معاً، والسبب يظهر في السجلّ لحظته.
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.error("embedded_worker.boot_failed", { detail });
    });
} else {
  // «العامل المدمج غير مُفعَّل»
  log("embedded_worker.disabled", {
    hint: "اضبط RUN_WORKER_IN_GATEWAY=true إن لم توجد خدمة waslah-worker مستقلّة",
  });
}

/**
 * تسجيل قائمة الأوامر عند تلغرام — غير حاجز ولا مُسقِط.
 *
 * لماذا هنا وليس في `server.ts`: لنفس السبب في العامل المدمج — `server.ts`
 * يُستورد في اختبارات المسارات، ونداء شبكة حقيقيّ إلى api.telegram.org هناك كان
 * سيجعل كل اختبار مسار يخرج إلى الشبكة.
 *
 * وفشله لا يمسّ الخدمة: القائمة زينة في واجهة تلغرام، والأوامر نفسها تعمل
 * مكتوبةً بلا تسجيل، والقائمة الدائمة أسفل الشاشة تعمل من داخل الحوار لا من هنا.
 * فلا يجوز أن يمنع عجزٌ عن تزيين الواجهة إقلاعَ البوتَين.
 */
for (const [audience, token] of [
  ["driver", config.driverBotToken],
  ["rider", config.riderBotToken],
] as const) {
  void registerBotCommands(audience, grammyCommandRegistrar(token))
    .then(() => log("bot_commands.registered", { audience }))
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      log("bot_commands.register_failed", { audience, detail });
    });
}

/**
 * الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يُقلعُ بعدَ اكتمالِ تركيبِ الويبهوكِ
 * والحاويةِ، فإيصالُه إلى `handler` ممكنٌ هنا وحدَه. فشلُ إقلاعِه لا يُسقطُ البوابةَ:
 * وظائفُ تتراكمُ في الطابورِ (دائمةٌ في القاعدةِ) حتى يُقلعَ درينرٌ تالٍ، فلا يُفقَدُ
 * تحديثٌ. والسببُ يظهرُ في السجلّ.
 *
 * لماذا فترةُ نصفِ ثانيةٍ: تيليجرام لا يُرسلُ دفعةً واحدةً ضخمةً، بل وصولٌ متفرّقٌ.
 * فالمؤقّتُ القصيرُ يلتقطُ الوصولَ الحديثَ قبلَ أن يتراكمَ، ومانعُ التداخلِ يمنعُ
 * تراكُمَ الأشواطِ إن طالت معالجةٌ واحدةٌ. والدرينرُ نفسُه يفرغُ الطابورَ كاملاً في
 * كلِّ شوطٍ (claim حتى null)، فلا حاجةَ لفترةٍ أقصرَ.
 */
updateDrainer = startTelegramUpdateDrainer(
  {
    queue: createPostgresTelegramUpdateQueue(container.sql),
    handler: container.handler,
    log,
  },
  { intervalMs: 500 },
);

/**
 * خادمُ `Bun.serve` الفعليُّ — يُنشأ بعدَ اكتمالِ تركيبِ المسارات. الـ`fetch`
 * يُغلِّفُ `app.fetch` بثلاثةِ أمورٍ: (١) عدَّادُ الطلباتِ التجاريّةِ الجاريةِ لا فحوصِ
 * الصحةِ؛ (٢) بوّابةُ التصريفِ: عندَ `isDraining` يُسمَحُ لـ`/health` و`/ready`
 * فقط (حتى يرى المُوجِّهُ حالةَ «مُصرِّف») ويُرفَضُ ما عداهما بـ`503 draining`؛
 * (٣) و`serverHandle` يُملأ هنا فيقرؤهُ `lifecycle` عند الإشارةِ عبر الإغلاقِ.
 */
serverHandle = Bun.serve({
  port: config.port,
  fetch: async (request, server) => {
    const { pathname } = new URL(request.url);
    const isProbe = pathname === "/health" || pathname === "/ready";

    // أثناءَ التصريفِ: نرفضُ الجديدَ من الطلباتِ التجاريّةِ، لكنّنا نبقى نُجيبُ
    // فحوصَ الصحةِ حتى يرى المُوجِّهُ «مُصرِّف» لا «مرفوضُ اتصال».
    if (lifecycle.isDraining() && !isProbe) {
      return Response.json({ status: "draining" }, { status: 503 });
    }

    // فحوصُ الصحةِ لا تُعدُّ جاريةً — لا تُؤخِّرُ التصريفَ.
    if (isProbe) {
      return app.fetch(request, server);
    }

    inFlightRequests += 1;
    try {
      return await app.fetch(request, server);
    } finally {
      inFlightRequests -= 1;
    }
  },
});
