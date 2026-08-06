/**
 * الغرض: نقطة تشغيل خادم Hono الحقيقي الذي يستقبل Webhooks تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: Render (أمر التشغيل)، docker/Dockerfile.gateway
 * ملاحظات مستقبلية: معالج التحديثات الحقيقي (grammY) يُركَّب في container.ts عند وصول رموز البوتين؛
 *   حتى ذلك الحين يبدأ الخادم ويجيب /health، ويسجّل كل تحديث غير معالَج بلا ادّعاء نجاح.
 */

import { missingEnvKeys, tryLoadConfig } from "../../../packages/shared/config/index.ts";
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

const app = createServer({
  health: {
    now: () => new Date(),
    startedAt,
    env: process.env,
  },
  webhook: {
    webhookSecret: config.telegramWebhookSecret,
    log,
    handler: {
      // لا يوجد معالج حقيقي بعد: نسجّل ونعيد false بلا ادّعاء معالجة.
      handle: async (bot, _update) => {
        log("تحديث وارد بلا معالج مركَّب بعد", { bot });
        return false;
      },
    },
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
