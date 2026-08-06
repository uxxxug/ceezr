/**
 * الغرض: قراءة وتحقق متغيرات البيئة التقنية فقط (اتصالات، مفاتيح) — لا قيم تجارية.
 * الحالة: أساس تقني منفّذ فعلياً.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: ممنوع منعاً باتاً وضع سعر/مهلة/وزن مطابقة هنا — مكانها جدول platform_settings.
 */

export type EnvName = "development" | "test" | "production";

export interface AppConfig {
  readonly env: EnvName;
  readonly port: number;
  readonly supabaseUrl: string;
  readonly supabaseServiceKey: string;
  readonly redisUrl: string;
  readonly redisToken: string;
  readonly driverBotToken: string;
  readonly riderBotToken: string;
  readonly telegramWebhookSecret: string;
}

export class MissingEnvVarError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = "MissingEnvVarError";
  }
}

function required(source: Record<string, string | undefined>, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === "") {
    throw new MissingEnvVarError(key);
  }
  return value;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const rawEnv = source.NODE_ENV ?? "development";
  const env: EnvName =
    rawEnv === "production" || rawEnv === "test" ? rawEnv : "development";

  return {
    env,
    port: Number.parseInt(source.PORT ?? "3000", 10),
    supabaseUrl: required(source, "SUPABASE_URL"),
    supabaseServiceKey: required(source, "SUPABASE_SERVICE_ROLE_KEY"),
    redisUrl: required(source, "UPSTASH_REDIS_REST_URL"),
    redisToken: required(source, "UPSTASH_REDIS_REST_TOKEN"),
    driverBotToken: required(source, "DRIVER_BOT_TOKEN"),
    riderBotToken: required(source, "RIDER_BOT_TOKEN"),
    telegramWebhookSecret: required(source, "TELEGRAM_WEBHOOK_SECRET"),
  };
}
