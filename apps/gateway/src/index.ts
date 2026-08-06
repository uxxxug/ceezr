/**
 * الغرض: نقطة تشغيل خادم Hono الحقيقي الذي يستقبل Webhooks تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: Render (أمر التشغيل)، docker/Dockerfile.gateway
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد في container.ts.
 */

import { missingEnvKeys, tryLoadConfig } from "../../../packages/shared/config/index.ts";
import { buildContainer } from "./container.ts";
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

async function shutdown(signal: string): Promise<void> {
  log("إيقاف البوابة", { signal });
  await container.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

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
    ],
  },
  webhook: {
    webhookSecret: config.telegramWebhookSecret,
    log,
    handler: container.handler,
  },
});

log("البوابة تعمل", {
  port: config.port,
  env: config.env,
  missingEnv: missingEnvKeys(process.env),
});

export default {
  port: config.port,
  fetch: app.fetch,
};
