/**
 * الغرض: ذاكرةٌ قصيرةٌ أمامَ `CityDirectory.listActive` — LOAD-01 (`perf/load01-city-directory-cache`).
 *
 * لماذا: في موجاتِ C1 (التشغيل 40160348095) كانت قائمةُ المدنِ المفعَّلةِ تُقرأُ مرّةً لكلِّ طلبِ
 * `GET /v1/onboarding` ولكلِّ `POST /v1/onboarding/driver` — 24,376 حجزًا من مجمّعِ `gatewayRequest`
 * (5.2% من زمنِ الحجز) لنتيجةٍ لا تتغيّرُ إلّا بفعلٍ إداريٍّ خارجَ العملية (سكربتُ التفعيلِ أو
 * `break-glass`). والحجزُ في ذلك المقعدِ يحكمُه زمنُ حلقةِ الأحداثِ لا زمنُ القاعدة، فكلُّ نداءٍ
 * محذوفٍ مقعدٌ محرَّرٌ لطلبٍ آخر.
 *
 * العقد (قرارٌ مكتوبٌ يحتاجُ إقرارَ المالك — RESULT.md):
 * ــ حدُّ التقادمِ `ttlMs` (الافتراضيُّ 5,000ms): مدينةٌ أُطفِئَت قد تبقى مقبولةً في التسجيلِ وظاهرةً
 *   في الحوارِ حتى 5 ثوانٍ بعدَ إطفائها، ومدينةٌ فُعِّلَت قد تتأخّرُ حتى 5 ثوانٍ. لا أكثر: الذاكرةُ
 *   لا تُمدَّدُ بالقراءة، وانقضاؤها يُوجِبُ قراءةً جديدة.
 * ــ الإخفاقُ لا يُخزَّن: قراءةٌ فاشلةٌ تُعادُ كما هي ولا تمسُّ قيمةً سابقة، والنداءُ التالي يقرأُ القاعدة.
 * ــ قراءةٌ واحدةٌ في الطيران: نداءاتٌ متزامنةٌ عندَ الانقضاءِ تنتظرُ القراءةَ نفسَها ولا تتدافعُ على المجمّع.
 * ــ القيمةُ المُعادةُ مصفوفةٌ مجمَّدةٌ بعناصرَ مجمَّدة: لا مستهلكَ يغيّرُ ما يراهُ غيرُه.
 */

import type { CityDirectory, CityRef } from "../../application/bots/types.ts";
import type { PortFailureError } from "../../application/ports/index.ts";
import type { Result } from "../../shared/result/index.ts";

export const CITY_DIRECTORY_CACHE_TTL_MS = 5_000;

export interface CachedCityDirectoryOptions {
  readonly ttlMs?: number;
  readonly nowMs?: () => number;
}

type ListResult = Result<readonly CityRef[], PortFailureError>;

export function createCachedCityDirectory(
  inner: CityDirectory,
  options: CachedCityDirectoryOptions = {},
): CityDirectory {
  const ttlMs = options.ttlMs ?? CITY_DIRECTORY_CACHE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError("city cache ttlMs");
  const nowMs = options.nowMs ?? Date.now;

  let cached: { readonly value: ListResult; readonly expiresAtMs: number } | null = null;
  let inflight: Promise<ListResult> | null = null;

  const load = async (): Promise<ListResult> => {
    const result = await inner.listActive();
    if (!result.ok) return result;
    const frozen = Object.freeze(result.value.map((city) => Object.freeze({ ...city })));
    // تبدأُ المهلةُ عندَ وصولِ النتيجةِ لا عندَ الطلب: لا تُقدَّمُ قيمةٌ أقدمُ من `ttlMs` منذُ قُرِئَت.
    const value: ListResult = { ok: true, value: frozen };
    cached = { value, expiresAtMs: nowMs() + ttlMs };
    return value;
  };

  return {
    listActive: () => {
      if (cached !== null && nowMs() < cached.expiresAtMs) return Promise.resolve(cached.value);
      if (inflight !== null) return inflight;
      const pending = load().finally(() => {
        inflight = null;
      });
      inflight = pending;
      return pending;
    },
  };
}
