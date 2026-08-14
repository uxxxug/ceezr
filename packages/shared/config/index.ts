/**
 * الغرض: قراءة وتحقق متغيرات البيئة التقنية فقط (اتصالات، مفاتيح) — لا قيم تجارية.
 * الحالة: أساس تقني منفّذ فعلياً.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: ممنوع منعاً باتاً وضع سعر/مهلة/وزن مطابقة هنا — مكانها جدول platform_settings.
 */

import { err, ok, type Result } from "../result/index.ts";

export type EnvName = "development" | "test" | "production";

/**
 * تجاوزات طبقة التتبّع من البيئة. كلّها `null` تعني «لم يضبط المشغّل شيئاً،
 * فاستُعمل افتراض المجال».
 *
 * ولماذا تجاوزاتٌ لا قيمٌ كاملة؟ لأنّ الأرقام الافتراضية لها مصدرُ حقيقةٍ واحد
 * هو `DEFAULT_GPS_POLICY` في `packages/domain/geo/gps-fix.ts` مع
 * `DEFAULT_TRACKING_CONFIG`. ولو كُتبت هنا مرّةً ثانيةً لصار في النظام رقمان
 * لنفس الحدّ، ويوماً ما يُعدَّل أحدهما وحده — وهذا بالضبط الانحراف الذي يُعالجه
 * هذا الحقل لا الذي يُنشئه. والدمج يحدث في `packages/tracking/config.ts`.
 *
 * وهذه القيم **تقنيّةٌ لا تجاريّة**: حدُّ سرعةٍ فيزيائيّ ودقّةُ جهازٍ وانحرافُ
 * ساعة — لا سعرٌ ولا عمولةٌ ولا مهلةُ عرض. القيم التجارية مكانها
 * `platform_settings` كما تقول ترويسة هذا الملفّ، ولا واحدةَ منها هنا.
 */
export interface TrackingEnvOverrides {
  /** TRACKING_GPS_INTERVAL_SECONDS */
  readonly gpsIntervalSeconds: number | null;
  /** TRACKING_GPS_IDLE_INTERVAL_SECONDS */
  readonly gpsIdleIntervalSeconds: number | null;
  /** TRACKING_MIN_DISTANCE_METERS */
  readonly minDistanceMeters: number | null;
  /** TRACKING_TELEPORT_THRESHOLD_METERS */
  readonly teleportThresholdMeters: number | null;
  /** TRACKING_MAX_REASONABLE_SPEED_KMH */
  readonly maxReasonableSpeedKmh: number | null;
  /** TRACKING_MAX_ACCURACY_METERS */
  readonly maxAccuracyMeters: number | null;
  /** TRACKING_MAX_TIME_DRIFT_SECONDS */
  readonly maxTimeDriftSeconds: number | null;
}

/**
 * «لم يضبط المشغّل شيئاً» — كلّ الحدود على افتراض المجال.
 *
 * مُصدَّرٌ لا مكرَّر في كلّ اختبار: كائنٌ منسوخٌ في ستّةٍ وعشرين ملفّاً يعني أنّ
 * إضافةَ حدٍّ جديدٍ يوماً تكسر ستّةً وعشرين ملفّاً وتُغري بإصلاحها بالنسخ.
 */
export const NO_TRACKING_OVERRIDES: TrackingEnvOverrides = {
  gpsIntervalSeconds: null,
  gpsIdleIntervalSeconds: null,
  minDistanceMeters: null,
  teleportThresholdMeters: null,
  maxReasonableSpeedKmh: null,
  maxAccuracyMeters: null,
  maxTimeDriftSeconds: null,
};

/** أسماء متغيّرات التتبّع كما تُكتب في البيئة — مصدر الحقيقة للتوثيق والحرّاس. */
export const TRACKING_ENV_KEYS = [
  "TRACKING_GPS_INTERVAL_SECONDS",
  "TRACKING_GPS_IDLE_INTERVAL_SECONDS",
  "TRACKING_MIN_DISTANCE_METERS",
  "TRACKING_TELEPORT_THRESHOLD_METERS",
  "TRACKING_MAX_REASONABLE_SPEED_KMH",
  "TRACKING_MAX_ACCURACY_METERS",
  "TRACKING_MAX_TIME_DRIFT_SECONDS",
] as const;

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
  /**
   * مزوّد عرض الخريطة. الافتراضي `none`: منصّةٌ بلا خريطة تعمل كاملةً، وهي حالُها
   * قبل هذه المرحلة. جعلُه إلزامياً كان سيمنع الإقلاع لأجل واجهةٍ عرض.
   */
  readonly mapProvider: MapProviderName;
  /** رابط ملفّ نمط الخريطة (style.json) — `null` يعني غيرَ مُهيَّأ. */
  readonly mapStyleUrl: string | null;
  /**
   * مفتاح خدمة البلاطات. **عامٌّ بالتصميم**: المتصفّح هو من يطلب البلاطات فيظهر
   * المفتاح في كل طلب. الاسم يقول ذلك صراحةً حتى لا يوضع فيه مفتاحٌ بلا تقييد
   * نطاقٍ ولا سقفِ استخدام. يُنظر `MapStyleInput.publicApiKey`.
   */
  readonly mapTilesPublicKey: string | null;
  /**
   * بصمةُ سلامة (Subresource Integrity) لملفّ MapLibre بالإصدار المثبَّت.
   * `null` يعني **غيرَ محسوبة**، وحينها لا يُصيَّر وسمُ النصّ ألبتّة (ADR 0019).
   *
   * أُضيف في المرحلة ١٣: كان ADR 0019 يُعلن أن الخريطة لا تعمل حتى يحسب المشغّل
   * البصمة، لكن لم يكن في الضبط موضعٌ **يُدخِلها فيه** — فكان الإعلانُ صحيحاً
   * والنتيجةُ أن الخريطة لا تعمل أبداً بأي ضبط. هذا المفتاح هو الوصلةُ الناقصة،
   * لا سياسةٌ جديدة: القاعدة (بصمةٌ أو لا نصّ) كما هي.
   */
  readonly maplibreSri: string | null;
  /**
   * مزوّد التوجيه (Routing) — منه تُشتقّ مدّةُ الوصول في المرحلة ١٥.
   *
   * منفصلٌ عن `mapProvider` عن قصد، لأنّهما شيئان لا وجهان: `maplibre` يرسم
   * بلاطاتٍ في متصفّح، و`osrm` يحسب مساراً على خادم. وقد قيس أنّهما يُنشران
   * منفصلين فعلاً: خريطةٌ تعمل ببلاطاتٍ مُستضافةٍ بلا أيّ محرّك توجيه، ومحرّكُ
   * توجيهٍ يخدم زمنَ الوصول في تلغرام بلا أيّ خريطةٍ مرسومة. فمفتاحٌ واحدٌ
   * لهما كان يُلزم المشغّلَ بتشغيل ما لا يحتاج، أو يمنعه ممّا يحتاج.
   */
  readonly routingProvider: RoutingProviderName;
  /**
   * عنوان خادم OSRM. `null` يعني غيرَ مُهيَّأ — وحينها زمنُ الوصول **غيرُ متاح**
   * ويُقال ذلك صراحةً، لا يُقدَّر تقديراً تقريبياً (ADR 0024).
   */
  readonly osrmBaseUrl: string | null;
  /**
   * حدود طبقة التتبّع من البيئة — تجاوزاتٌ فوق افتراضات المجال.
   *
   * أُضيف لأنّ هذه المتغيّرات كانت مُعلَنةً في `render.yaml` و`.env.example`
   * ولا تُقرَأ في سطرٍ واحد من الكود: المشغّل يضبط `TRACKING_MAX_REASONABLE_SPEED_KMH`
   * فلا يتغيّر شيء، ولا رسالةَ خطأٍ تُخبره — وهمُ تحكّمٍ كامل، وهو نفس الخطر
   * (R-28) الذي أُصلح لـ`OSRM_BASE_URL` وحده وبقي هنا. وكانت الأسماء نفسها
   * مختلفةً بين الملفّين، فمن ضبط الاسم الوارد في `render.yaml` ضبط اسماً
   * لا وجود له في أيّ مكان آخر.
   */
  readonly tracking: TrackingEnvOverrides;
  /**
   * أساسُ روابط التتبّع العامّة (`TRACKING_TOKEN_BASE_URL`) — منه يُبنى
   * `<الأساس>/track/<الرمز>`. `null` يعني أنّ ميزةَ الرابط المُشارَك **مُطفأة**
   * صريحاً: لا يُصدَر رمزٌ ولا يُعرض زرٌّ، بدلاً من إرسال رابطٍ بأساسٍ مُخمَّن.
   *
   * منفصلٌ عن `PORT` وعن أيّ اشتقاقٍ من طلبٍ وارد عن قصد: البوابةُ خلف وسيطٍ في
   * Render، والرابطُ يُرسَل في رسالة تلغرام تُفتَح بعد ساعةٍ من جهازٍ آخر — فلو
   * اشتُقّ من `Host` أو `X-Forwarded-Host` صار عنوانُ الرابط رهنَ ترويسةٍ
   * يتحكّم بها الطالب، وهذا مدخلُ تصييدٍ صريح (رابطٌ يُرسله بوتُنا إلى نطاقٍ
   * يملكه المهاجم). فيُعلَن مرّةً في البيئة ولا يُشتقّ أبداً.
   */
  readonly trackingTokenBaseUrl: string | null;
}

/** مخازن الجلسات المدعومة. */
export const SESSION_STORE_NAMES = ["memory", "redis"] as const;

export type SessionStoreName = (typeof SESSION_STORE_NAMES)[number];

/**
 * مزوّدات عرض الخريطة المدعومة. `none` اختيارٌ صريح: «اعمل بلا خريطة».
 *
 * تسكن القائمة هنا لا في `packages/maps` لأن هذا موضعُ مفردات الضبط، والاتجاه
 * القائم في المستودع هو `maps → shared` (نمط `Result`). ووضعُها هناك واستيرادُها
 * هنا كان سيقلب الاتجاه فيصير أدنى الطبقات معتمداً على طبقةٍ فوقه.
 * وكتابتُها في الموضعين كانت ستُنتج ضبطاً يقبل ما لا يُحلّله المزوّد.
 */
export const MAP_PROVIDER_NAMES = ["none", "maplibre"] as const;

export type MapProviderName = (typeof MAP_PROVIDER_NAMES)[number];

/**
 * مزوّدات التوجيه المدعومة. `none` اختيارٌ صريح: «اعمل بلا زمن وصول».
 *
 * القائمةُ هنا لا في `packages/maps` لنفس سبب `MAP_PROVIDER_NAMES` أعلاه:
 * الاتجاه القائم `maps → shared`، وقلبُه يجعل أدنى الطبقات معتمداً على ما فوقه.
 */
export const ROUTING_PROVIDER_NAMES = ["none", "osrm"] as const;

export type RoutingProviderName = (typeof ROUTING_PROVIDER_NAMES)[number];

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
 * قراءة متغيّر بيئة منطقي بحالة افتراضية مُعلنة. المفهوم من التفعيل:
 * `true`/`1`/`yes`/`on`، ومن التعطيل: `false`/`0`/`no`/`off`، وما سواهما
 * والغياب يعنيان `fallback`.
 *
 * لماذا لا يُرفض المجهول بخطأ إقلاع؟ لأن هذا المتغيّر مُفعِّل ميزة لا مفتاح اتصال:
 * قيمةٌ مكتوبة خطأً تعني «لم يُفعَّل» وهو الحال الافتراضي أصلاً، لا انحرافاً صامتاً.
 * أما أسماء المزوّدات فتُرفض صريحاً لأن الخطأ فيها يعني خدمةً تعمل بنصف إعداد.
 */
function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (isBlank(value)) return fallback;
  const normalized = (value as string).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

/**
 * يقرأ عدداً موجباً من البيئة، أو `null` إن لم يُضبَط.
 *
 * والقيمةُ المكتوبةُ خطأً تُرفض عند الإقلاع ولا تُهمَل إلى الافتراض: إهمالُها
 * يعني مشغّلاً ضبط حدّاً وظنّ أنّه سرى، وهو نفس وهم التحكّم الذي نُصلحه هنا.
 */
function readPositiveNumber(
  raw: string | undefined,
  key: string,
): Result<number | null, ConfigError> {
  if (isBlank(raw)) return ok(null);
  const value = Number((raw as string).trim());
  if (!Number.isFinite(value) || value <= 0) {
    return err(new InvalidEnvVarError(key, `يجب أن يكون عدداً موجباً — وردت: ${raw as string}`));
  }
  return ok(value);
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

  // مزوّد الخريطة يُرفض إن كان مجهولاً، بخلاف `RUN_WORKER_IN_GATEWAY` المنطقي:
  // قيمةٌ مكتوبةٌ خطأً هنا تعني مشغّلاً يظنّ أنه فعّل خريطةً لم تُفعَّل، وهو
  // انحرافٌ صامت بين ما ضُبِط وما يعمل — لا حالاً افتراضياً مقبولاً.
  const rawMapProvider = (source.MAP_PROVIDER ?? "none").trim().toLowerCase();
  if (!(MAP_PROVIDER_NAMES as readonly string[]).includes(rawMapProvider)) {
    return err(
      new InvalidEnvVarError(
        "MAP_PROVIDER",
        `المتاح: ${MAP_PROVIDER_NAMES.join(", ")} — وردت: ${rawMapProvider}`,
      ),
    );
  }

  // مزوّد التوجيه — نفس منهاج `MAP_PROVIDER`: قيمةٌ مجهولةٌ تُرفض عند الإقلاع لا
  // تُهمَل، لأنّ إهمالها يعني مشغّلاً يظنّ أنّه فعّل زمنَ وصولٍ لم يُفعَّل.
  const rawRoutingProvider = (source.ROUTING_PROVIDER ?? "none").trim().toLowerCase();
  if (!(ROUTING_PROVIDER_NAMES as readonly string[]).includes(rawRoutingProvider)) {
    return err(
      new InvalidEnvVarError(
        "ROUTING_PROVIDER",
        `المتاح: ${ROUTING_PROVIDER_NAMES.join(", ")} — وردت: ${rawRoutingProvider}`,
      ),
    );
  }

  const osrmBaseUrl = isBlank(source.OSRM_BASE_URL)
    ? null
    : (source.OSRM_BASE_URL as string).trim();

  /**
   * `ROUTING_PROVIDER=osrm` بلا عنوانٍ يُرفض عند الإقلاع.
   *
   * وهذا بالضبط ما لم يكن موجوداً حتى المرحلة ١٥: `OSRM_BASE_URL` كان مُعلَناً في
   * `.env.example` و`render.yaml` ولا يُقرأ في الضبط أصلاً (الخطر R-28). فكان
   * المشغّلُ يضبطه فلا يحدث شيء، ولا رسالةَ خطأٍ تُخبره — أسوأ من غيابٍ صريح.
   * والرفضُ هنا لا في أوّل نداءٍ توجيه: خطأُ ضبطٍ يجب أن يراه المشغّل لا العميل.
   */
  if (rawRoutingProvider === "osrm" && osrmBaseUrl === null) {
    return err(new InvalidEnvVarError("OSRM_BASE_URL", "مطلوب مع ROUTING_PROVIDER=osrm"));
  }

  // عنوانٌ غيرُ صالحٍ يُرفض هنا أيضاً: `new URL` في المزوّد كان سيُلقي استثناءً في
  // أوّل نداءٍ — أي في وجه عميلٍ ينتظر، لا في سجلّ إقلاعٍ يقرؤه المشغّل.
  if (osrmBaseUrl !== null && !/^https?:\/\/.+/i.test(osrmBaseUrl)) {
    return err(
      new InvalidEnvVarError("OSRM_BASE_URL", `يجب أن يبدأ بـhttp(s):// — وردت: ${osrmBaseUrl}`),
    );
  }

  const trackingTokenBaseUrl = isBlank(source.TRACKING_TOKEN_BASE_URL)
    ? null
    : (source.TRACKING_TOKEN_BASE_URL as string).trim();

  // أساسٌ غيرُ صالح يُرفض عند الإقلاع لا عند أوّل إصدارٍ: الرابطُ يُرسَل مرّةً إلى
  // عميلٍ فلا يُصلَح بعدها، فخطأُ الشكل يجب أن يُوقف الإقلاع.
  if (trackingTokenBaseUrl !== null && !/^https?:\/\/.+/i.test(trackingTokenBaseUrl)) {
    return err(
      new InvalidEnvVarError(
        "TRACKING_TOKEN_BASE_URL",
        `يجب أن يبدأ بـhttp(s):// — وردت: ${trackingTokenBaseUrl}`,
      ),
    );
  }

  // في الإنتاج `http://` غيرُ مقبول: الرمزُ نفسُه هو كلمةُ السرّ، وإرسالُه في
  // مسارٍ غير مُشفَّر يُسلّمه لكلّ وسيطٍ على الطريق.
  if (env === "production" && trackingTokenBaseUrl !== null) {
    if (!trackingTokenBaseUrl.toLowerCase().startsWith("https://")) {
      return err(
        new InvalidEnvVarError("TRACKING_TOKEN_BASE_URL", "يجب أن يبدأ بـhttps:// في الإنتاج"),
      );
    }
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

  /**
   * حدود التتبّع. تُقرأ كلّها ويُجمَع أوّل خطأٍ فيها — والقراءة هنا لا في طبقة
   * التتبّع كي يفشل الإقلاع في وجه المشغّل لا أوّلُ إصلاحةِ GPS في وجه سائق.
   */
  const trackingReads = {
    gpsIntervalSeconds: readPositiveNumber(
      source.TRACKING_GPS_INTERVAL_SECONDS,
      "TRACKING_GPS_INTERVAL_SECONDS",
    ),
    gpsIdleIntervalSeconds: readPositiveNumber(
      source.TRACKING_GPS_IDLE_INTERVAL_SECONDS,
      "TRACKING_GPS_IDLE_INTERVAL_SECONDS",
    ),
    minDistanceMeters: readPositiveNumber(
      source.TRACKING_MIN_DISTANCE_METERS,
      "TRACKING_MIN_DISTANCE_METERS",
    ),
    teleportThresholdMeters: readPositiveNumber(
      source.TRACKING_TELEPORT_THRESHOLD_METERS,
      "TRACKING_TELEPORT_THRESHOLD_METERS",
    ),
    maxReasonableSpeedKmh: readPositiveNumber(
      source.TRACKING_MAX_REASONABLE_SPEED_KMH,
      "TRACKING_MAX_REASONABLE_SPEED_KMH",
    ),
    maxAccuracyMeters: readPositiveNumber(
      source.TRACKING_MAX_ACCURACY_METERS,
      "TRACKING_MAX_ACCURACY_METERS",
    ),
    maxTimeDriftSeconds: readPositiveNumber(
      source.TRACKING_MAX_TIME_DRIFT_SECONDS,
      "TRACKING_MAX_TIME_DRIFT_SECONDS",
    ),
  } as const;
  for (const read of Object.values(trackingReads)) {
    if (!read.ok) return err(read.error);
  }
  const tracking: TrackingEnvOverrides = {
    gpsIntervalSeconds: trackingReads.gpsIntervalSeconds.ok
      ? trackingReads.gpsIntervalSeconds.value
      : null,
    gpsIdleIntervalSeconds: trackingReads.gpsIdleIntervalSeconds.ok
      ? trackingReads.gpsIdleIntervalSeconds.value
      : null,
    minDistanceMeters: trackingReads.minDistanceMeters.ok
      ? trackingReads.minDistanceMeters.value
      : null,
    teleportThresholdMeters: trackingReads.teleportThresholdMeters.ok
      ? trackingReads.teleportThresholdMeters.value
      : null,
    maxReasonableSpeedKmh: trackingReads.maxReasonableSpeedKmh.ok
      ? trackingReads.maxReasonableSpeedKmh.value
      : null,
    maxAccuracyMeters: trackingReads.maxAccuracyMeters.ok
      ? trackingReads.maxAccuracyMeters.value
      : null,
    maxTimeDriftSeconds: trackingReads.maxTimeDriftSeconds.ok
      ? trackingReads.maxTimeDriftSeconds.value
      : null,
  };

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
    // الافتراض `true` لا `false`، وهذا قلبٌ متعمّد للافتراض القديم. وجها الخطأ ليسا
    // متكافئين: خطأ `true` مع وجود خدمة `waslah-worker` يعني أن القفل الموزّع يجعل
    // إحداهما تتخطّى بحالة `skipped_locked_elsewhere` — أي لا أذى؛ وخطأ `false` بلا تلك
    // الخدمة — وهو واقع الإنتاج المُثبَت في `docs/directive-item-0-live-diagnosis.md` §0.2
    // — يعني أن ولا مهمّة دورية تُنفَّذ أبداً: لا اشتراك ينتهي، ولا عرض يُسقَط بمهلته
    // فيبقى الطلب باحثاً للأبد، ولا توفّر بائت يُطفَأ، ولا نسخة احتياطية تُؤخَذ.
    // الأول تكرارٌ محميّ بقفل، والثاني توقّفٌ تامّ صامت. فمن أراد إطفاءه فليُعلنه
    // بـ`false` صريحة.
    runWorkerInGateway: parseBooleanEnv(source.RUN_WORKER_IN_GATEWAY, true),
    mapProvider: rawMapProvider as MapProviderName,
    mapStyleUrl: isBlank(source.MAP_STYLE_URL) ? null : (source.MAP_STYLE_URL as string).trim(),
    mapTilesPublicKey: isBlank(source.MAP_TILES_PUBLIC_KEY)
      ? null
      : (source.MAP_TILES_PUBLIC_KEY as string).trim(),
    maplibreSri: isBlank(source.MAPLIBRE_SRI) ? null : (source.MAPLIBRE_SRI as string).trim(),
    routingProvider: rawRoutingProvider as RoutingProviderName,
    osrmBaseUrl,
    tracking,
    trackingTokenBaseUrl,
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
