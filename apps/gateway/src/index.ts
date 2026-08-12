/**
 * الغرض: نقطة تشغيل خادم Hono الحقيقي الذي يستقبل Webhooks تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: Render (أمر التشغيل)، docker/Dockerfile.gateway
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد في container.ts.
 */

import {
  createPaymentRepository,
  createWebhookEventStore,
} from "../../../packages/infrastructure/financial/payment-adapters.ts";
import { resolveMapStyle } from "../../../packages/maps/index.ts";
import { missingEnvKeys, tryLoadConfig } from "../../../packages/shared/config/index.ts";
import { createAdminAuthPort } from "./admin/auth.ts";
import { grammyCommandRegistrar, registerBotCommands } from "./bots/shared/register-commands.ts";
import { buildContainer } from "./container.ts";
import { type EmbeddedWorkerHandle, startEmbeddedWorker } from "./embedded-worker.ts";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "./rate-limit/fixed-window.ts";
import { createUpstashRedis } from "./redis/upstash.ts";
import { createAdminApiRoutes } from "./routes/admin-api.ts";
import { createAdminLiveRoutes } from "./routes/admin-live.ts";
import { createAdminUiRoutes } from "./routes/admin-ui.ts";
import { createServer } from "./server.ts";

function log(message: string, meta: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...meta }));
}

const configResult = tryLoadConfig(process.env);

if (!configResult.ok) {
  const error = configResult.error;
  console.error("❌ تعذّر إقلاع البوابة:");
  console.error(`   ${error.message}`);
  if (error.code === "MISSING_ENV_VARS") {
    console.error("   أضِف هذه المتغيرات إلى بيئة التشغيل (انظر .env.example):");
    for (const key of error.keys) console.error(`   - ${key}`);
  }
  // فشل سريع ومعلَن: أفضل من خادم يعمل بنصف مفاتيح ويفشل عند أول مستخدم حقيقي.
  process.exit(1);
}

const config = configResult.value;
const startedAt = new Date();

// التركيب الحقيقي: اتصال قاعدة واحد ومحوّلات فعلية لكل منفذ.
const container = buildContainer(config, { log });

/**
 * مقبض العامل المدمج إن كان مُفعَّلاً. يُملأ بعد إعلان جاهزية المنفذ لا قبله.
 */
let embeddedWorker: EmbeddedWorkerHandle | null = null;

async function shutdown(signal: string): Promise<void> {
  log("إيقاف البوابة", { signal });
  // العامل أولاً: مهمّة جارية تستعلم القاعدة، وإغلاق التجمّع تحتها يجعلها تفشل
  // بخطأ اتصال لا معنى له بدل أن تنتهي أو تُوقَف نظيفة.
  if (embeddedWorker !== null) await embeddedWorker.stop();
  await container.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

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

/**
 * ويبهوك الدفع — اختياري: يُفعَّل فقط عند توفّر أسرار الدفع (البند 8).
 * غيابها يُعطّل المسار بصمت لا يوقف الإقلاع.
 */
const paymentWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
const paymentProviderName = process.env.PAYMENT_PROVIDER ?? null;
const paymentWebhook =
  paymentWebhookSecret !== undefined && paymentWebhookSecret !== "" && paymentProviderName !== null
    ? {
        webhookSecret: paymentWebhookSecret,
        providerName: paymentProviderName,
        confirmDeps: {
          payments: createPaymentRepository(container.sql, async (driverId) => {
            const rows = await container.sql<{ city_id: string }[]>`
              select city_id from drivers where id = ${driverId}::uuid
            `;
            return rows[0]?.city_id ?? null;
          }),
          events: createWebhookEventStore(container.sql),
        },
        log,
      }
    : undefined;

const app = createServer({
  health: {
    now: () => new Date(),
    startedAt,
    env: process.env,
    // فحص جاهزية حقيقي: استعلام فعلي على القاعدة، لا افتراض أن الرابط صحيح
    readinessChecks: [
      {
        name: "database",
        check: async () => {
          const rows = await container.sql<{ ok: number }[]>`select 1 as ok`;
          return rows[0]?.ok === 1;
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
    ],
  },
  webhook: {
    webhookSecret: config.telegramWebhookSecret,
    log,
    handler: container.handler,
    rateLimits: { probes: limiter(PROBE_LIMIT), users: limiter(USER_LIMIT) },
  },
  ...(paymentWebhook === undefined ? {} : { paymentWebhook }),
});

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
// الأخصّ أولاً: /admin/api قبل /admin، وإلا التقط حارس الصفحات نداءات JSON
/**
 * الأخصّ أولاً هنا أيضاً: /admin/api/live قبل /admin/api. ولو عُكس الترتيب لالتقط
 * موجّه الـJSON المسار ثم أجاب 404 على مجرى SSE — لأن Hono يطابق أوّل موجّه يُطابق
 * البادئة ولا يعود إلى ما بعده.
 */
app.route(
  "/admin/api/live",
  createAdminLiveRoutes({
    sql: container.sql,
    auth: adminAuth,
    bus: container.tracking.bus,
    log,
  }),
);
app.route("/admin/api", createAdminApiRoutes({ sql: container.sql, auth: adminAuth }));

app.route(
  "/admin",
  createAdminUiRoutes({
    sql: container.sql,
    auth: adminAuth,
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
  }),
);
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
    log("مخطط القاعدة مُطبَّق", {});
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    log("⚠️ القاعدة متصلة لكن المخطط غير مُطبَّق — طبّق الهجرات قبل الاستخدام", {
      detail,
      remedy: "راجع docs/render-deployment-vars.md §4 — خطوة «القاعدة أولاً»",
    });
  }
}

log("البوابة تعمل", {
  port: config.port,
  env: config.env,
  missingEnv: missingEnvKeys(process.env),
});

// بعد سطر «البوابة تعمل» لا قبله، حتى لا يؤخّر استعلامٌ بطيء إعلانَ جاهزية المنفذ.
void verifySchemaApplied();

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
  void startEmbeddedWorker(config, {
    info: (message, fields) => log(message, fields ?? {}),
    error: (message, fields) =>
      console.error(JSON.stringify({ at: new Date().toISOString(), message, ...fields })),
  })
    .then((handle) => {
      embeddedWorker = handle;
    })
    .catch((cause: unknown) => {
      // فشل إقلاع العامل لا يُسقط البوابة: بوابةٌ تعمل بلا مهامّ دورية أفضل من
      // انعدام البوتَين معاً، والسبب يظهر في السجلّ لحظته.
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          message: "embedded_worker.boot_failed",
          detail,
        }),
      );
    });
} else {
  log("العامل المدمج غير مُفعَّل", {
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

export default {
  port: config.port,
  fetch: app.fetch,
};
