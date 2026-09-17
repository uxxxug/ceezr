/**
 * الغرض: مزدوجات اختبار (Test Doubles) للمنافذ — تعيد بيانات يحدّدها الاختبار نفسه.
 * الحالة: أداة اختبار فقط. لا تُستورد من apps ولا من packages إطلاقاً، وليست بديلاً عن محوّل حقيقي.
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: tests/unit/*
 * ملاحظات مستقبلية: عند وصول مفاتيح Supabase تُكتب المحوّلات الحقيقية في packages/infrastructure،
 *   وتبقى هذه المزدوجات للاختبار الوحدوي فقط.
 */

import {
  type DriverCandidateRepository,
  type OfferRepository,
  type OrderRepository,
  PortFailureError,
  type SettingsRepository,
} from "../../packages/application/ports/index.ts";
import type { DriverCandidate } from "../../packages/domain/dispatch/entity.ts";
import type { Offer } from "../../packages/domain/dispatch/value-objects.ts";
import { haversineKm } from "../../packages/domain/geo/index.ts";
import type { RawSetting, SettingKey } from "../../packages/domain/policy/entity.ts";
import { SETTING_KEYS } from "../../packages/domain/policy/entity.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import type { CityId, Clock, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

/** القيم المبذورة فعلياً في المخطط (20260917140000_d02_dec11_subscription_prices.sql). */
export const SEEDED_SETTINGS: Readonly<Record<SettingKey, unknown>> = {
  subscription_price_transport: 150,
  subscription_price_delivery: 150,
  subscription_price_both: 300,
  currency: "SAR",
  trial_days: 30,
  rating_min_count_for_trust: 3,
  rating_prompt_window_hours: 48,
  search_radius_km: 10,
  offer_timeout_seconds: 45,
  broadcast_batch_size: 5,
  max_broadcast_rounds: 3,
  match_weight_proximity: 0.7,
  match_weight_rating: 0.3,
  // البند 2.4: صفرٌ هو المبذور فعلاً في الهجرة، فالمعادلة كما كانت
  match_weight_preferred_area: 0,
  // المرحلة ٨: صفرٌ هو المبذور فعلاً — الحَرَس يُسلَّم معطّلاً، فالخطّ الأساسي بلا فحص عمر
  driver_location_max_age_seconds: 0,
  default_rating_for_new_driver: 4.5,
  // CAP-003: المبذور ٥٠ — أوسعُ من دفعة البثّ (٥) عمداً كي لا يفوتَ مؤهَّلٌ أبعد.
  matching_candidate_limit: 50,
  supported_languages: ["ar"],
};

/** يبني صفوف platform_settings الخام لمدينة، مع إمكان تجاوز مفاتيح محدّدة. */
export function seededRows(
  cityId: CityId,
  overrides: Partial<Record<SettingKey, unknown>> = {},
): readonly RawSetting[] {
  return SETTING_KEYS.map((key) => {
    const value = key in overrides ? overrides[key] : SEEDED_SETTINGS[key];
    const valueType =
      typeof value === "number" ? "number" : typeof value === "string" ? "string" : "json";
    return { cityId, key, value, valueType } as const;
  });
}

export function fixedClock(now: Date): Clock {
  return { now: () => now };
}

export function settingsRepo(rows: readonly RawSetting[]): SettingsRepository {
  return {
    findByCity: async (cityId) => ok(rows.filter((r) => r.cityId === cityId)),
  };
}

export function orderRepo(orders: readonly Order[]): OrderRepository {
  return {
    findById: async (orderId) => ok(orders.find((o) => o.id === orderId) ?? null),
  };
}

export function offerRepo(offers: readonly Offer[]): OfferRepository {
  return {
    findByOrder: async (orderId) => ok(offers.filter((o) => o.orderId === orderId)),
  };
}

export function candidateRepo(candidates: readonly DriverCandidate[]): DriverCandidateRepository {
  return {
    findAvailableInCity: async (cityId) => ok(candidates.filter((c) => c.cityId === cityId)),
    /**
     * مزدوجٌ في الذاكرة للاختبار الوحدوي يطابقُ سلوكَ استعلام PostGIS: يُفلترُ
     * بالبوابات الصلبة (المدينة، غيرُ محجوبٍ، موثَّقٌ، متاحٌ، داخلُ نصف القطر،
     * موقعُه غيرُ قديمٍ إن فُعّل، ليسَ من المستبعدين)، مرتّباً بالمسافة، محدوداً بـ`limit`.
     * سائقٌ بلا موقع لا يدخلُ (كما يُستبعدُه `ST_DWithin` على NULL في القاعدة).
     */
    findNearbyAvailableForDispatch: async (args) => {
      const { cityId, pickup, searchRadiusKm, driverLocationMaxAgeSeconds, limit, now } = args;
      const maxAge = driverLocationMaxAgeSeconds ?? 0;
      const within = candidates
        .filter((c) => c.cityId === cityId)
        .filter((c) => !c.isBlocked)
        .filter((c) => c.isVerified)
        .filter((c) => c.isAvailable)
        .map((c) => {
          // null-location يُستبعدُ لاحقاً ببُعدٍ لا نهائي (كما يُستبعدُه ST_DWithin
          // على NULL في القاعدة)، وعمرُ الموقع يُفحصُ بعدَ تأكّدِ وجودِه.
          if (c.location === null) return { candidate: c, distance: Infinity };
          if (maxAge > 0) {
            const atMs = c.locationAtMs;
            if (atMs === null || atMs === undefined || !Number.isFinite(atMs)) {
              return { candidate: c, distance: Infinity };
            }
            if ((now.getTime() - atMs) / 1000 > maxAge) {
              return { candidate: c, distance: Infinity };
            }
          }
          return { candidate: c, distance: haversineKm(pickup, c.location) };
        })
        .filter((x) => x.distance <= searchRadiusKm)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((x) => x.candidate);
      return ok(within);
    },
  };
}

/** منفذ يفشل دائماً — لاختبار أن الفشل التقني يُنقل كـ Result لا كاستثناء. */
export function failingSettingsRepo(detail: string): SettingsRepository {
  return {
    findByCity: async () => err(new PortFailureError("SettingsRepository", detail)),
  };
}

export function failingOrderRepo(detail: string): OrderRepository {
  return {
    findById: async () => err(new PortFailureError("OrderRepository", detail)),
  };
}

/** نوع مساعد لتأكيد أن معرّف الطلب موسوم في الاختبارات. */
export function asOrderId(value: string): OrderId {
  return value as OrderId;
}

export type { Result };
