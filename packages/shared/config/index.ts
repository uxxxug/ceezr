/**
 * الغرض: قراءة وتحقق متغيرات البيئة التقنية فقط (اتصالات، مفاتيح) — لا قيم تجارية.
 * الحالة: أساس تقني منفّذ فعلياً.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: ممنوع منعاً باتاً وضع سعر/مهلة/وزن مطابقة هنا — مكانها جدول platform_settings.
 */

import { err, ok, type Result } from "../result/index.ts";

export type EnvName = "development" | "test" | "production";

export interface AppConfig {
  readonly env: EnvName;
  readonly port: number;
  readonly supabaseUrl: string;
  /** رابط اتصال Postgres المباشر بقاعدة Supabase — عليه تعمل كل المحوّلات. */
  readonly databaseUrl: string;
  readonly supabaseServiceKey: string;
  readonly redisUrl: string;
  readonly redisToken: string;
  readonly driverBotToken: string;
  readonly riderBotToken: string;
  readonly telegramWebhookSecret: string;
  /**
   * معرّف تلغرام لأول مسؤول. بدونه لا يوجد أي مسار لتعيين مسؤول في نظام
   * كل صلاحياته في القاعدة: تعديل الصفّ يدوياً في الإنتاج ليس مساراً بل التفاف عليه.
   */
  readonly bootstrapAdminTelegramId: string;
  /**
   * مزوّد الترجمة الآلية (المرحلة 2.6). ليس في REQUIRED_ENV_KEYS عن قصد:
   * `none` قيمة صالحة تعني «شغّل بلا ترجمة»، والنظام يعمل كاملاً بدونها.
   * جعله إلزامياً كان سيمنع الإقلاع لغياب خدمة مساعِدة.
   */
  readonly translationProvider: TranslationProviderName;
  /** مفتاح المزوّد — مطلوب لـ deepl و google، وغير مطلوب لـ mymemory. */
  readonly translationApiKey: string | null;
  /** بريد تواصل يرفع الحصّة المجانية عند مزوّدات تشترطه في شروطها. */
  readonly translationContactEmail: string | null;
  /**
   * أين تُحفظ جلسات الحوار. ليست في REQUIRED_ENV_KEYS: الافتراضي `memory` يعمل
   * كاملاً لنسخة واحدة، و`redis` شرطٌ عند تعدّد النسخ لا تحسين (ADR 0011).
   */
  readonly sessionStore: SessionStoreName;
  /**
   * هل تُشغَّل المهامّ الدورية داخل عملية البوابة نفسها.
   *
   * الأصل أن العامل خدمةٌ مستقلّة (`render.yaml` قسم `waslah-worker`)، وهو الأنظف:
   * إقلاعه وسجلّه ومقياسه منفصلة عن البوابة. لكن الفحص الحيّ للإنتاج أثبت أن تلك
   * الخدمة **غير موجودة أصلاً**، فلم تُنفَّذ مهمّة دورية واحدة قطّ: لا إشعار «لا يوجد
   * سائق»، ولا تصعيد إلى قروب الإسناد، ولا انتهاء مهلة عرض، ولا دوران تفاوض.
   * راجع `docs/directive-item-0-live-diagnosis.md` القسم 0.2.
   *
   * فهذا المتغيّر مخرجٌ صريح لا افتراضي: من يملك خدمة عامل مستقلّة يتركه `false`
   * فلا يتغيّر عليه شيء، ومن لا يملكها يضبطه `true` فتعمل المهامّ في نفس العملية.
   * القفل الموزَّع في المشغّل هو ما يجعل هذا آمناً: لو أُقلعت الخدمتان معاً بالخطأ
   * لما نُفِّذت مهمّة مرّتين، بل تخطّت إحداهما بحالة `skipped_locked_elsewhere`.
   *
   * الافتراضي `false` عن قصد: تشغيل مهامّ دورية داخل خادم ويب أثرٌ جانبي لا يجوز
   * أن يحدث لمن لم يطلبه.
   */
  readonly runWorkerInGateway: boolean;
}

/** مخازن الجلسات المدعومة. */
export const SESSION_STORE_NAMES = ["memory", "redis"] as const;

export type SessionStoreName = (typeof SESSION_STORE_NAMES)[number];

/** أسماء المزوّدات المدعومة. `none` ليست غياباً بل اختياراً صريحاً. */
export const TRANSLATION_PROVIDER_NAMES = [
  "none",
  "deepl",
  "google",
  "google-web",
  "mymemory",
] as const;

export type TranslationProviderName = (typeof TRANSLATION_PROVIDER_NAMES)[number];

/** المتغيرات التي بلا قيمة صالحة لها لا يمكن للنظام أن يعمل إطلاقاً. */
export const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "DRIVER_BOT_TOKEN",
  "RIDER_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "BOOTSTRAP_ADMIN_TELEGRAM_ID",
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

export class MissingEnvVarError extends Error {
  readonly code = "MISSING_ENV_VARS" as const;
  constructor(public readonly keys: readonly string[]) {
    super(`متغيرات بيئة ناقصة: ${keys.join(", ")}`);
    this.name = "MissingEnvVarError";
  }
}

export class InvalidEnvVarError extends Error {
  readonly code = "INVALID_ENV_VAR" as const;
  constructor(
    public readonly key: string,
    public readonly reason: string,
  ) {
    super(`متغير بيئة غير صالح ${key}: ${reason}`);
    this.name = "InvalidEnvVarError";
  }
}

export type ConfigError = MissingEnvVarError | InvalidEnvVarError;

/** الحدّ الأدنى لطول سرّ الويبهوك في الإنتاج — مطابق لما تشترطه وثيقة النشر. */
export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** مجموعة المحارف التي يقبلها تلغرام في ترويسة secret_token. */
const TELEGRAM_SECRET_CHARSET = /^[A-Za-z0-9_-]+$/;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * قراءة متغيّر بيئة منطقي. الغياب يعني `false`، و`true`/`1`/`yes`/`on` تعني `true`،
 * وأي شيء آخر يعني `false`.
 *
 * لماذا لا يُرفض المجهول بخطأ إقلاع؟ لأن هذا المتغيّر مُفعِّل ميزة لا مفتاح اتصال:
 * قيمةٌ مكتوبة خطأً تعني «لم يُفعَّل» وهو الحال الافتراضي أصلاً، لا انحرافاً صامتاً.
 * أما أسماء المزوّدات فتُرفض صريحاً لأن الخطأ فيها يعني خدمةً تعمل بنصف إعداد.
 */
function parseBooleanEnv(value: string | undefined): boolean {
  if (isBlank(value)) return false;
  const normalized = (value as string).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/** كل المتغيرات الناقصة، لا أولها فقط — ليعرف المشغّل ما ينقصه في نظرة واحدة. */
export function missingEnvKeys(
  source: Record<string, string | undefined> = process.env,
): readonly RequiredEnvKey[] {
  return REQUIRED_ENV_KEYS.filter((key) => isBlank(source[key]));
}

/**
 * يقرأ الإعدادات ويعيد Result — بلا throw، ويجمع كل النواقص معاً.
 * لا يقرأ أي قيمة تجارية: تلك مكانها platform_settings.
 */
export function tryLoadConfig(
  source: Record<string, string | undefined> = process.env,
): Result<AppConfig, ConfigError> {
  const missing = missingEnvKeys(source);
  if (missing.length > 0) return err(new MissingEnvVarError(missing));

  const rawPort = source.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err(new InvalidEnvVarError("PORT", `ليس منفذاً صالحاً: ${rawPort}`));
  }

  const rawEnv = source.NODE_ENV ?? "development";
  const env: EnvName = rawEnv === "production" || rawEnv === "test" ? rawEnv : "development";

  const supabaseUrl = source.SUPABASE_URL as string;
  if (!supabaseUrl.startsWith("https://")) {
    return err(new InvalidEnvVarError("SUPABASE_URL", "يجب أن يبدأ بـ https://"));
  }

  const databaseUrl = source.DATABASE_URL as string;
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    return err(
      new InvalidEnvVarError("DATABASE_URL", "يجب أن يبدأ بـ postgres:// أو postgresql://"),
    );
  }

  // سرّ الويبهوك هو الشيء الوحيد الذي يفصل بين تحديث تلغرام حقيقي وتحديث
  // مزوَّر. ونموذج الهوية كله يثق بـ `update.message.from.id` بعد اجتيازه، أي
  // أن تخمين هذا السرّ = انتحال أي سائق أو راكب. الوثائق تشترط ≥٣٢ محرفاً منذ
  // البداية (docs/render-deployment-vars.md) لكن لم يُفرض ذلك في أي مكان، فبقي
  // الشرط توصيةً تُخالَف بلا إنذار. الفرض هنا في الإنتاج وحده كي لا تُكسر
  // اختبارات الوحدة التي تستعمل أسراراً قصيرة عمداً.
  // المحارف المسموحة هي ما يقبله تلغرام نفسه في secret_token.
  const telegramWebhookSecret = source.TELEGRAM_WEBHOOK_SECRET as string;
  if (env === "production") {
    if (telegramWebhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
      return err(
        new InvalidEnvVarError(
          "TELEGRAM_WEBHOOK_SECRET",
          `يجب ألا يقلّ عن ${MIN_WEBHOOK_SECRET_LENGTH} محرفاً في الإنتاج — وردت ${telegramWebhookSecret.length}`,
        ),
      );
    }
    if (!TELEGRAM_SECRET_CHARSET.test(telegramWebhookSecret)) {
      return err(
        new InvalidEnvVarError(
          "TELEGRAM_WEBHOOK_SECRET",
          "يقبل تلغرام في secret_token المحارف A-Z a-z 0-9 _ - فقط",
        ),
      );
    }
  }

  const bootstrapAdminTelegramId = (source.BOOTSTRAP_ADMIN_TELEGRAM_ID as string).trim();
  if (!/^\d+$/.test(bootstrapAdminTelegramId)) {
    return err(
      new InvalidEnvVarError("BOOTSTRAP_ADMIN_TELEGRAM_ID", "يجب أن يكون معرّف تلغرام رقمياً"),
    );
  }

  const rawProvider = (source.TRANSLATION_PROVIDER ?? "none").trim().toLowerCase();
  if (!(TRANSLATION_PROVIDER_NAMES as readonly string[]).includes(rawProvider)) {
    return err(
      new InvalidEnvVarError(
        "TRANSLATION_PROVIDER",
        `المتاح: ${TRANSLATION_PROVIDER_NAMES.join(", ")} — وردت: ${rawProvider}`,
      ),
    );
  }
  const translationProvider = rawProvider as TranslationProviderName;

  const rawSessionStore = (source.SESSION_STORE ?? "memory").trim().toLowerCase();
  if (!(SESSION_STORE_NAMES as readonly string[]).includes(rawSessionStore)) {
    return err(
      new InvalidEnvVarError(
        "SESSION_STORE",
        `المتاح: ${SESSION_STORE_NAMES.join(", ")} — وردت: ${rawSessionStore}`,
      ),
    );
  }

  const translationApiKey = isBlank(source.TRANSLATION_API_KEY)
    ? null
    : (source.TRANSLATION_API_KEY as string).trim();

  // المزوّد المضبوط بلا مفتاحه يفشل عند أول رسالة لا عند الإقلاع، وهذا أسوأ
  // أنواع الفشل: يظهر للمستخدم لا للمشغّل. فيُرفض هنا صريحاً.
  if (
    (translationProvider === "deepl" || translationProvider === "google") &&
    translationApiKey === null
  ) {
    return err(
      new InvalidEnvVarError(
        "TRANSLATION_API_KEY",
        `مطلوب مع TRANSLATION_PROVIDER=${translationProvider}`,
      ),
    );
  }

  return ok({
    env,
    port,
    supabaseUrl,
    databaseUrl,
    supabaseServiceKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    redisUrl: source.UPSTASH_REDIS_REST_URL as string,
    redisToken: source.UPSTASH_REDIS_REST_TOKEN as string,
    driverBotToken: source.DRIVER_BOT_TOKEN as string,
    riderBotToken: source.RIDER_BOT_TOKEN as string,
    telegramWebhookSecret,
    bootstrapAdminTelegramId,
    translationProvider,
    translationApiKey,
    translationContactEmail: isBlank(source.TRANSLATION_CONTACT_EMAIL)
      ? null
      : (source.TRANSLATION_CONTACT_EMAIL as string).trim(),
    sessionStore: rawSessionStore as SessionStoreName,
    runWorkerInGateway: parseBooleanEnv(source.RUN_WORKER_IN_GATEWAY),
  });
}

/**
 * نسخة تُوقف الإقلاع فوراً — تُستخدم في نقطة تشغيل التطبيق فقط،
 * حيث الفشل السريع مطلوب ولا يوجد مستخدم ليتلقى Result.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const result = tryLoadConfig(source);
  if (!result.ok) throw result.error;
  return result.value;
}
