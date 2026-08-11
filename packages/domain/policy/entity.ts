/**
 * الغرض: سجل مفاتيح platform_settings والتحقّق منها وتحويلها إلى أنواع مُحكمة.
 *   هذا الملف هو البوابة الوحيدة التي تدخل منها القيم التجارية إلى الكود، فلا يُرمَّز أي رقم بعده.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (القاعدة 0.3 من الأمر الحاكم).
 * ينتمي إلى: domain/policy
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/match-order، application/subscription/*، apps/workers
 * ملاحظات مستقبلية: أي مفتاح جديد يُضاف إلى SETTING_SPECS وإلى مخطط البذر معاً، وإلا رفض التحقّق.
 */

import type { CityId, ServiceType } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MatchingParameters } from "../dispatch/entity.ts";

export type SettingValueType = "number" | "string" | "json";

/** صفّ خام كما يعود من جدول platform_settings بلا أي تفسير. */
export interface RawSetting {
  readonly cityId: CityId;
  readonly key: string;
  /** القيمة كما هي مخزَّنة jsonb (رقم أو نص أو مصفوفة). */
  readonly value: unknown;
  readonly valueType: SettingValueType;
}

interface NumberSpec {
  readonly kind: "number";
  /** الحد الأدنى المسموح — قيد سلامة تقني، لا قرار تجاري. */
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
}
interface StringSpec {
  readonly kind: "string";
  readonly nonEmpty: true;
}
interface StringArraySpec {
  readonly kind: "string[]";
  readonly minLength: number;
}

type SettingSpec = NumberSpec | StringSpec | StringArraySpec;

/**
 * المفاتيح الثلاثة عشر المبذورة في المخطط.
 * الحدود أدناه حدود سلامة (لا يمكن أن يكون نصف قطر البحث سالباً) وليست قيماً تجارية.
 */
export const SETTING_SPECS = {
  subscription_price_transport: { kind: "number", min: 0, max: 1_000_000, integer: false },
  subscription_price_delivery: { kind: "number", min: 0, max: 1_000_000, integer: false },
  subscription_price_both: { kind: "number", min: 0, max: 1_000_000, integer: false },
  currency: { kind: "string", nonEmpty: true },
  trial_days: { kind: "number", min: 0, max: 3650, integer: true },
  search_radius_km: { kind: "number", min: 0.1, max: 500, integer: false },
  offer_timeout_seconds: { kind: "number", min: 1, max: 3600, integer: true },
  broadcast_batch_size: { kind: "number", min: 1, max: 1000, integer: true },
  max_broadcast_rounds: { kind: "number", min: 1, max: 100, integer: true },
  match_weight_proximity: { kind: "number", min: 0, max: 1, integer: false },
  match_weight_rating: { kind: "number", min: 0, max: 1, integer: false },
  /**
   * البند 2.4 — وزن المنطقة المفضّلة. مبذور بصفر في كل مدينة، فمعادلة الترتيب
   * لا تتغيّر بمجرّد الهجرة؛ وتفعيله خصمٌ صريح من أحد الوزنين لا زيادةٌ عليهما.
   */
  match_weight_preferred_area: { kind: "number", min: 0, max: 1, integer: false },
  default_rating_for_new_driver: { kind: "number", min: 0, max: 5, integer: false },
  rating_min_count_for_trust: { kind: "number", min: 1, max: 100, integer: true },
  rating_prompt_window_hours: { kind: "number", min: 1, max: 720, integer: true },
  supported_languages: { kind: "string[]", minLength: 1 },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTING_SPECS;

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as readonly SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SPECS, key);
}

export class MissingSettingError {
  readonly code = "MISSING_SETTING" as const;
  constructor(
    readonly cityId: CityId,
    readonly key: SettingKey,
  ) {}
}

export class InvalidSettingError {
  readonly code = "INVALID_SETTING" as const;
  constructor(
    readonly cityId: CityId,
    readonly key: string,
    readonly reason: string,
  ) {}
}

export class InconsistentWeightsError {
  readonly code = "INCONSISTENT_WEIGHTS" as const;
  constructor(readonly sum: number) {}
}

export type SettingsError = MissingSettingError | InvalidSettingError | InconsistentWeightsError;

/** لقطة إعدادات مدينة واحدة، مُتحقَّق منها بالكامل. */
export interface CitySettings {
  readonly cityId: CityId;
  readonly subscriptionPriceTransport: number;
  readonly subscriptionPriceDelivery: number;
  readonly subscriptionPriceBoth: number;
  readonly currency: string;
  readonly trialDays: number;
  readonly searchRadiusKm: number;
  readonly offerTimeoutSeconds: number;
  readonly broadcastBatchSize: number;
  readonly maxBroadcastRounds: number;
  readonly matchWeightProximity: number;
  readonly matchWeightRating: number;
  readonly matchWeightPreferredArea: number;
  readonly defaultRatingForNewDriver: number;
  readonly ratingMinCountForTrust: number;
  readonly ratingPromptWindowHours: number;
  readonly supportedLanguages: readonly string[];
}

/** مجموع الوزنين المطلوب — قيد رياضي لبقاء النقاط في المدى [0,1]. */
const WEIGHTS_SUM = 1;
const WEIGHTS_TOLERANCE = 1e-9;

function validateOne(
  cityId: CityId,
  key: SettingKey,
  raw: unknown,
): Result<number | string | readonly string[], SettingsError> {
  const spec: SettingSpec = SETTING_SPECS[key];

  if (spec.kind === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n)) {
      return err(new InvalidSettingError(cityId, key, "ليست رقماً صالحاً"));
    }
    if (spec.integer && !Number.isInteger(n)) {
      return err(new InvalidSettingError(cityId, key, "يجب أن تكون عدداً صحيحاً"));
    }
    if (n < spec.min || n > spec.max) {
      return err(
        new InvalidSettingError(cityId, key, `خارج المدى المسموح [${spec.min}, ${spec.max}]`),
      );
    }
    return ok(n);
  }

  if (spec.kind === "string") {
    if (typeof raw !== "string" || raw.trim() === "") {
      return err(new InvalidSettingError(cityId, key, "يجب أن تكون نصاً غير فارغ"));
    }
    return ok(raw);
  }

  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || v.trim() === "")) {
    return err(new InvalidSettingError(cityId, key, "يجب أن تكون مصفوفة نصوص غير فارغة"));
  }
  if (raw.length < spec.minLength) {
    return err(
      new InvalidSettingError(cityId, key, `يجب أن تحتوي ${spec.minLength} عنصراً على الأقل`),
    );
  }
  return ok(raw as readonly string[]);
}

/**
 * يحوّل صفوف platform_settings الخام إلى لقطة مُحكمة، أو يعيد أول خطأ.
 * يرفض: مفتاحاً ناقصاً، قيمة من نوع خاطئ، صفّاً لمدينة أخرى، ووزنين لا يجمعان 1.
 */
export function parseCitySettings(
  cityId: CityId,
  rows: readonly RawSetting[],
): Result<CitySettings, SettingsError> {
  const values = new Map<SettingKey, number | string | readonly string[]>();

  for (const row of rows) {
    if (row.cityId !== cityId) {
      return err(new InvalidSettingError(cityId, row.key, "الصفّ ينتمي إلى مدينة أخرى"));
    }
    if (!isSettingKey(row.key)) continue; // مفاتيح مستقبلية لا تُسقط اللقطة
    const parsed = validateOne(cityId, row.key, row.value);
    if (!parsed.ok) return parsed;
    values.set(row.key, parsed.value);
  }

  for (const key of SETTING_KEYS) {
    if (!values.has(key)) return err(new MissingSettingError(cityId, key));
  }

  const num = (key: SettingKey): number => values.get(key) as number;

  const proximity = num("match_weight_proximity");
  const rating = num("match_weight_rating");
  /**
   * البند 2.4: الوزن الثالث يدخل نفس القيد لا قيداً موازياً. لو استُثني لكان
   * بوسع المشغّل أن يضع 0.5 لمنطقةٍ فوق وزنين يجمعان 1، فتخرج النقاط من [0,1]
   * وتصير غير قابلة للمقارنة بين مدينتين — وهو انحراف صامت لا رسالة خطأ له.
   */
  const preferredArea = num("match_weight_preferred_area");
  const sum = proximity + rating + preferredArea;
  if (Math.abs(sum - WEIGHTS_SUM) > WEIGHTS_TOLERANCE) {
    return err(new InconsistentWeightsError(sum));
  }

  return ok({
    cityId,
    subscriptionPriceTransport: num("subscription_price_transport"),
    subscriptionPriceDelivery: num("subscription_price_delivery"),
    subscriptionPriceBoth: num("subscription_price_both"),
    currency: values.get("currency") as string,
    trialDays: num("trial_days"),
    searchRadiusKm: num("search_radius_km"),
    offerTimeoutSeconds: num("offer_timeout_seconds"),
    broadcastBatchSize: num("broadcast_batch_size"),
    maxBroadcastRounds: num("max_broadcast_rounds"),
    matchWeightProximity: proximity,
    matchWeightRating: rating,
    matchWeightPreferredArea: preferredArea,
    defaultRatingForNewDriver: num("default_rating_for_new_driver"),
    ratingMinCountForTrust: num("rating_min_count_for_trust"),
    ratingPromptWindowHours: num("rating_prompt_window_hours"),
    supportedLanguages: values.get("supported_languages") as readonly string[],
  });
}

/** يستخرج معاملات المطابقة من اللقطة — لا وسيط آخر بين الإعدادات ومحرك المطابقة. */
export function toMatchingParameters(settings: CitySettings): MatchingParameters {
  return {
    searchRadiusKm: settings.searchRadiusKm,
    weightProximity: settings.matchWeightProximity,
    weightRating: settings.matchWeightRating,
    weightPreferredArea: settings.matchWeightPreferredArea,
    broadcastBatchSize: settings.broadcastBatchSize,
    defaultRating: settings.defaultRatingForNewDriver,
    ratingMinCountForTrust: settings.ratingMinCountForTrust,
  };
}

/** سعر خطة الاشتراك حسب الخدمات المطلوبة — لا رقم مرمَّز، القيم كلها من اللقطة. */
export function subscriptionPriceFor(settings: CitySettings, plan: ServiceType | "both"): number {
  if (plan === "both") return settings.subscriptionPriceBoth;
  if (plan === "transport") return settings.subscriptionPriceTransport;
  return settings.subscriptionPriceDelivery;
}
