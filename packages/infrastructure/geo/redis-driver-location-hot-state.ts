/**
 * الغرض: محوّلُ **الحالةِ الساخنةِ المشتركةِ** لموقعِ السائقِ على Redis (Upstash)
 *    وقائمةِ انتظارِ الإفراغِ معه — البند `F4-02` والعائقُ `CAP-009`. وكلُّ عمليةٍ
 *    مركَّبةٍ ههنا **سكربتُ Lua واحدٌ ذرّيٌّ**، فلا تتخلَّلُ نسختانِ خطوتَي عمليةٍ.
 * الحالة: منفّذ فعلياً — 2026-09-09 · البند `F4-02`.
 * ينتمي إلى: infrastructure/geo
 * يُستخدم من: `apps/gateway/src/container.ts` (الاستقبالُ)،
 *    `apps/workers/src/container.ts` (الإفراغُ)، `tests/real-redis/*`
 * ملاحظات مستقبلية: لو صارَ لـRedis عنقودٌ (cluster) فمفاتيحُ الثلاثةِ تحتاجُ
 *    وسمَ تجزيئةٍ واحداً (`{city}`) لتقعَ في شقٍّ واحدٍ؛ وكلُّ سكربتٍ ههنا يُعلِنُ
 *    مفاتيحَه في `KEYS` سلفاً فلا يمنعُه من العنقودِ إلّا التوزيعُ.
 *
 * ## ثلاثةُ مفاتيحَ لا واحدٌ — ولماذا
 *
 * ١) **الحالةُ الساخنةُ** `…:hot:<city>:<driver>` — تجزيئةٌ لسائقٍ واحدٍ فيها
 *    الموضعُ والطابعُ والحكمُ، وعمرُها من الإعداداتِ. وهيَ **مرجعُ حارسِ التسلسلِ**:
 *    الأقدمُ لا يُزيحُ الأحدثَ. وتبقى بعدَ الإفراغِ (لا تُمحى بالسحبِ) لأنَّ
 *    غيابَها يُعيدُ الحكمَ إلى القاعدةِ فيصيرُ كلُّ إفراغٍ قراءةً.
 * ٢) **قائمةُ الانتظارِ** `…:backlog:<city>` — مجموعةٌ مُرتَّبةٌ، عضوٌ لكلِّ سائقٍ
 *    ودرجتُه طابعُ أحدثِ إصلاحةٍ. عضوٌ واحدٌ لا صفٌّ لكلِّ نبضةٍ: هوَ التجميعُ نفسُه.
 * ٣) **حِملُ الانتظارِ** `…:pending:<city>` — تجزيئةٌ حقلُها معرّفُ السائقِ وقيمتُها
 *    الإصلاحةُ مُسلسَلةً. ولماذا لا تُقرأُ الإصلاحةُ من مفتاحِ الحالةِ الساخنةِ
 *    عندَ السحبِ: قراءتُها منه تُلزِمُ السكربتَ بمفاتيحَ **لا يُعلِنُها في `KEYS`**
 *    (اسمُها يُبنى من العضوِ في زمنِ التشغيلِ)، وذلكَ يمنعُ العنقودَ ويُخفي عن
 *    Redis ما يلمسُه السكربتُ. فحِملُ الانتظارِ يجعلَ السحبَ **رحلةً واحدةً**
 *    بمفاتيحَ مُعلَنةٍ كلِّها — لا مئتَي رحلةٍ ولا مفتاحاً مبنيّاً.
 *
 * ## ما لا يفعلُه هذا المحوّلُ عن قصدٍ
 *
 * - **لا يُقيِّمُ إصلاحةً.** التقييمُ في المجالِ (`assessGpsFix`) والقرارُ في
 *   `updateDriverLocation`؛ وههنا حراسةُ تسلسلٍ وتخزينٌ لا حكمٌ على جودةٍ.
 * - **لا يخترعُ رقماً.** الأرقامُ الأربعةُ من `platform_settings`؛ وخرقُها يُرجَعُ
 *   عطلاً مُسمّىً فيرجعُ المُنادي إلى كتابةِ `F4-01` المباشرةِ.
 * - **لا يبتلعُ عطلاً.** كلُّ فشلٍ يُرجَعُ `PortFailureError` ويُسجَّلُ؛ وسياسةُ
 *   التدهوّرِ قرارُ المُنادي لا قرارُ المحوّلِ.
 */

import {
  type DriverLocationBacklogReader,
  type DriverLocationHotStateReader,
  type DriverLocationHotStateWriter,
  type HotLocationFix,
  type HotLocationLimits,
  type HotLocationRecordOutcome,
  type HotLocationSnapshot,
  resolveHotLocationLimits,
} from "../../application/geo/driver-location-hot-state.ts";
import { PortFailureError, type SettingsRepository } from "../../application/ports/index.ts";
import {
  HOT_LOCATION_PREFIX,
  hotLocationBacklogKey,
  hotLocationKey,
} from "../../shared/config/driver-location-hot-state.ts";
import type { CityId, DriverId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { RedisClient } from "../redis/upstash.ts";

const PORT = "driver-location-hot-state";

/** مفتاحُ حِملِ الانتظارِ — أخو `hotLocationBacklogKey` ويُشتَقُّ من البادئةِ نفسِها. */
function pendingKey(prefix: string, cityId: string): string {
  return `${prefix}:pending:${cityId}`;
}

/**
 * سكربتُ الكتابةِ الساخنةِ. `KEYS`: ١ الحالةُ الساخنةُ · ٢ قائمةُ الانتظارِ ·
 * ٣ حِملُ الانتظارِ. `ARGV`: ١ الطابعُ · ٢ خطُّ العرضِ · ٣ خطُّ الطولِ · ٤ الدقّةُ
 * (فارغٌ يعني مجهولةً) · ٥ الحكمُ · ٦ عمرُ الحالةِ الساخنةِ ثوانيَ · ٧ سقفُ
 * التراكمِ · ٨ معرّفُ السائقِ · ٩ طابعُ الصفِّ في القاعدةِ (أرضيّةُ الحكمِ، فارغٌ
 * يعني لا موقعَ مخزَّناً) · ١٠ الإصلاحةُ مُسلسَلةً.
 *
 * والعائدُ ثلاثيٌّ: `[الحكمُ، العددُ، أحدثُ ما نعرفُه]`.
 *
 * ولمَ خطوةً واحدةً على الخادمِ: «اقرأِ الأحدثَ ثمَّ اكتبْ إن كانَ الواصلُ أحدثَ»
 * أمرانِ، ونسختانِ تُنفِّذانِهما متزاحمتَينِ تكتبانِ **الأقدمَ آخراً** فيُرى موضعٌ
 * يتراجعُ على الخريطةِ — وهوَ انحدارُ `BUG-001` بعينِه في مخزنٍ جديدٍ.
 */
const RECORD_SCRIPT = [
  "local incoming = tonumber(ARGV[1])",
  "local newest = -1",
  "local stored = redis.call('HGET', KEYS[1], 'at')",
  "if stored then newest = tonumber(stored) end",
  "local floor_at = tonumber(ARGV[9])",
  "if floor_at and floor_at > newest then newest = floor_at end",
  // المتساويانِ يُقبَلانِ: حارسُ القاعدةِ `<=` فلا يُضيَّقُ ههنا (`ADR 0053 §٦`).
  "if newest > incoming then return {'stale', 0, newest} end",
  "redis.call('HSET', KEYS[1], 'at', ARGV[1], 'lat', ARGV[2], 'lng', ARGV[3], 'acc', ARGV[4], 'verdict', ARGV[5])",
  "redis.call('EXPIRE', KEYS[1], ARGV[6])",
  "local limit = tonumber(ARGV[7])",
  "local member = ARGV[8]",
  "local queued = redis.call('ZSCORE', KEYS[2], member)",
  "local depth = redis.call('ZCARD', KEYS[2])",
  // سقفُ التراكمِ يمنعُ **عضواً جديداً** لا تحديثَ عضوٍ قائمٍ: القائمُ لا يزيدُ العمقَ.
  "if not queued and depth >= limit then return {'direct', depth, incoming} end",
  "redis.call('ZADD', KEYS[2], ARGV[1], member)",
  "redis.call('HSET', KEYS[3], member, ARGV[10])",
  "if queued then return {'queued', depth, incoming} end",
  "return {'queued', depth + 1, incoming}",
].join("\n");

/**
 * سكربتُ السحبِ. `KEYS`: ١ قائمةُ الانتظارِ · ٢ حِملُ الانتظارِ. `ARGV[1]` السقفُ.
 * يسحبُ الأقدمَ طابعاً أوّلاً (`ZRANGE` من الصفرِ) فلا يُترَكُ سائقٌ خلفَ موجةٍ،
 * ويُزيلُ العضوَ وحِملَه معاً في الخطوةِ نفسِها فلا تسحبُ نسختانِ العضوَ نفسَه.
 */
const DRAIN_SCRIPT = [
  "local members = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)",
  "if #members == 0 then return {} end",
  "local payloads = redis.call('HMGET', KEYS[2], unpack(members))",
  "redis.call('ZREM', KEYS[1], unpack(members))",
  "redis.call('HDEL', KEYS[2], unpack(members))",
  "return payloads",
].join("\n");

/**
 * سكربتُ الإعادةِ بعدَ فشلِ الاستمرارِ. `ARGV` ثلاثيّاتٌ: عضوٌ، درجةٌ، حِملٌ.
 * ولا يُعادُ عضوٌ فوقَ أحدثَ منه: لو وصلَت نبضةٌ جديدةٌ بينَ السحبِ والفشلِ لكانَت
 * الإعادةُ إرجاعاً للموضعِ إلى الوراءِ — وهوَ ما يمنعُه الحارسُ نفسُه ههنا أيضاً.
 */
const REQUEUE_SCRIPT = [
  "for i = 1, #ARGV, 3 do",
  "  local member = ARGV[i]",
  "  local score = tonumber(ARGV[i + 1])",
  "  local payload = ARGV[i + 2]",
  "  local existing = redis.call('ZSCORE', KEYS[1], member)",
  "  if not existing or tonumber(existing) < score then",
  "    redis.call('ZADD', KEYS[1], score, member)",
  "    redis.call('HSET', KEYS[2], member, payload)",
  "  end",
  "end",
  "return 1",
].join("\n");

/** الصورةُ المُسلسَلةُ للإصلاحةِ في حِملِ الانتظارِ — عقدٌ مكتوبٌ لا شكلٌ ضمنيٌّ. */
interface WireFix {
  readonly c: string;
  readonly d: string;
  readonly lat: number;
  readonly lng: number;
  readonly at: number;
  /**
   * `F4-05`: لحظةُ قبولِ الخادمِ. **حقلٌ اختياريٌّ في السلكِ عن قصدٍ** لا تسامحاً:
   * حِملٌ كُتِبَ قبلَ هذا التغييرِ يُفكَّكُ فيُعطي `null` فيُقرأُ «مجهولاً» —
   * ولو كانَ إلزاميّاً في `decodeFix` لأُهمِلَ الحِملُ القديمُ كلُّه فسقطَ موضعُ
   * كلِّ سائقٍ في قائمةِ الانتظارِ لحظةَ النشرِ.
   */
  readonly oat?: number | null;
  readonly acc: number | null;
  readonly v: string;
}

function encodeFix(fix: HotLocationFix): string {
  const wire: WireFix = {
    c: fix.cityId,
    d: fix.driverId,
    lat: fix.latitude,
    lng: fix.longitude,
    at: fix.recordedAtMs,
    oat: fix.observedAtMs,
    acc: fix.accuracyMeters,
    v: fix.verdict,
  };
  return JSON.stringify(wire);
}

/**
 * حِملٌ معطوبٌ (نصٌّ ليسَ JSON، أو حقلٌ ناقصٌ) يُهمَلُ ولا يُسقِطُ الشوطَ: صفٌّ
 * واحدٌ فاسدٌ لا يجوزُ أن يمنعَ استمرارَ مئةِ سائقٍ. والإهمالُ يُعَدُّ في الحصيلةِ
 * (المسحوبُ أكثرُ من المُطبَّقِ) فيُرى في السجلِّ ولا يُسكَتُ عنه.
 */
function decodeFix(raw: unknown): HotLocationFix | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const wire = parsed as Partial<WireFix>;
  if (typeof wire.c !== "string" || typeof wire.d !== "string") return null;
  if (typeof wire.lat !== "number" || typeof wire.lng !== "number") return null;
  if (typeof wire.at !== "number" || typeof wire.v !== "string") return null;
  const accuracy = typeof wire.acc === "number" ? wire.acc : null;
  // غيابُ `oat` أو فسادُه يُقرأُ «مجهولاً» لا صفراً: صفرٌ كانَ سيُقرأُ 1970 فيبدو
  // الموضعُ أقدمَ من كلِّ شيءٍ، والمجهولُ يُعالَجُ في القاعدةِ بـ`now()` صريحاً.
  const observed = typeof wire.oat === "number" && Number.isFinite(wire.oat) ? wire.oat : null;
  return {
    cityId: wire.c as CityId,
    driverId: wire.d as DriverId,
    latitude: wire.lat,
    longitude: wire.lng,
    recordedAtMs: wire.at,
    observedAtMs: observed,
    accuracyMeters: accuracy,
    verdict: wire.v as HotLocationFix["verdict"],
  };
}

export interface RedisDriverLocationHotStateOptions {
  readonly redis: RedisClient;
  /** مصدرُ الأرقامِ الأربعةِ — `platform_settings` لا ثوابتُ شيفرةٍ. */
  readonly settings: SettingsRepository;
  readonly clock: { now(): Date };
  /** بادئةُ المفاتيحِ؛ الاختباراتُ تُمرِّرُ بادئةً لكلِّ شوطٍ فلا تتلامسُ الأشواطُ. */
  readonly prefix?: string;
  readonly onFailure?: (detail: { readonly operation: string; readonly detail: string }) => void;
}

export interface RedisDriverLocationHotState
  extends DriverLocationHotStateWriter,
    DriverLocationBacklogReader,
    DriverLocationHotStateReader {
  /** الأرقامُ الأربعةُ لمدينةٍ كما تُقرأُ الآنَ — يقرؤها مُشغِّلُ الإفراغِ. */
  limits(cityId: CityId): Promise<Result<HotLocationLimits, PortFailureError>>;
}

export function createRedisDriverLocationHotState(
  options: RedisDriverLocationHotStateOptions,
): RedisDriverLocationHotState {
  const prefix = options.prefix ?? HOT_LOCATION_PREFIX;
  const cache = new Map<
    CityId,
    { readonly limits: HotLocationLimits; readonly expiresAtMs: number }
  >();

  const note = (operation: string, detail: string): void => {
    options.onFailure?.({ operation, detail });
  };

  /**
   * الأرقامُ تُقرأُ من القاعدةِ وتُحفَظُ **بمقدارِ عمرِ الحالةِ الساخنةِ نفسِه**.
   * ولا رقمَ في هذه الجملةِ: مدّةُ الحفظِ هيَ الرقمُ المقروءُ لا رقمٌ ثانٍ يُخترَعُ.
   * والحدُّ المُعلَنُ صريحاً: تغييرُ إعدادٍ يسري خلالَ عمرِ حالةٍ ساخنةٍ واحدةٍ لا
   * فوراً. وقراءةُ الإعداداتِ في كلِّ نبضةِ موقعٍ كانت ستجعلَ البندَ عكسَ نفسِه —
   * استعلامٌ في القاعدةِ لكلِّ نبضةٍ هوَ العطبُ الذي وُجِدَ البندُ لرفعِه.
   */
  const limitsOf = async (cityId: CityId): Promise<Result<HotLocationLimits, PortFailureError>> => {
    const nowMs = options.clock.now().getTime();
    const cached = cache.get(cityId);
    if (cached !== undefined && cached.expiresAtMs > nowMs) return ok(cached.limits);

    const rows = await options.settings.findByCity(cityId);
    if (!rows.ok) {
      note("limits", `تعذّرَت قراءةُ الإعداداتِ: ${rows.error.detail}`);
      return err(new PortFailureError(PORT, `تعذّرَت قراءةُ إعداداتِ المسارِ الساخنِ`));
    }
    const resolved = resolveHotLocationLimits(rows.value);
    if (!resolved.ok) {
      const keys = resolved.error.keys.join(" · ");
      note("limits", `مفاتيحُ ناقصةٌ أو غيرُ موجبةٍ: ${keys}`);
      return err(new PortFailureError(PORT, `إعداداتُ المسارِ الساخنِ ناقصةٌ: ${keys}`));
    }
    cache.set(cityId, {
      limits: resolved.value,
      expiresAtMs: nowMs + resolved.value.hotTtlSeconds * 1000,
    });
    return ok(resolved.value);
  };

  return {
    limits: limitsOf,

    record: async (input): Promise<Result<HotLocationRecordOutcome, PortFailureError>> => {
      const limits = await limitsOf(input.cityId);
      if (!limits.ok) return err(limits.error);

      const result = await options.redis.command([
        "EVAL",
        RECORD_SCRIPT,
        "3",
        hotLocationKey(prefix, input.cityId, input.driverId),
        hotLocationBacklogKey(prefix, input.cityId),
        pendingKey(prefix, input.cityId),
        String(input.recordedAtMs),
        String(input.latitude),
        String(input.longitude),
        input.accuracyMeters === null ? "" : String(input.accuracyMeters),
        input.verdict,
        String(limits.value.hotTtlSeconds),
        String(limits.value.backlogLimit),
        input.driverId,
        input.previousRecordedAtMs === null ? "" : String(input.previousRecordedAtMs),
        encodeFix(input),
      ]);
      if (!result.ok) {
        note("record", `${result.error.kind}: ${result.error.detail}`);
        return err(new PortFailureError(PORT, `فشلَت الكتابةُ الساخنةُ: ${result.error.kind}`));
      }
      const value = result.value;
      if (!Array.isArray(value) || value.length < 3) {
        note("record", "جوابُ EVAL ليسَ ثلاثيّاً");
        return err(new PortFailureError(PORT, "جوابُ الكتابةِ الساخنةِ غيرُ مفهومٍ"));
      }
      const kind = String(value[0]);
      const depth = Number(value[1]);
      const newest = Number(value[2]);
      if (kind === "stale") return ok({ kind: "stale", newestKnownMs: newest });
      if (kind === "direct") return ok({ kind: "direct", backlog: depth });
      if (kind === "queued") return ok({ kind: "queued", backlog: depth });
      note("record", `حكمٌ غيرُ معروفٍ «${kind}»`);
      return err(new PortFailureError(PORT, `حكمُ الكتابةِ الساخنةِ غيرُ معروفٍ`));
    },

    drain: async (cityId, limit): Promise<Result<readonly HotLocationFix[], PortFailureError>> => {
      const result = await options.redis.command([
        "EVAL",
        DRAIN_SCRIPT,
        "2",
        hotLocationBacklogKey(prefix, cityId),
        pendingKey(prefix, cityId),
        String(Math.max(1, Math.trunc(limit))),
      ]);
      if (!result.ok) {
        note("drain", `${result.error.kind}: ${result.error.detail}`);
        return err(new PortFailureError(PORT, `فشلَ سحبُ قائمةِ الانتظارِ: ${result.error.kind}`));
      }
      const value = result.value;
      if (!Array.isArray(value)) {
        note("drain", "جوابُ EVAL ليسَ قائمةً");
        return err(new PortFailureError(PORT, "جوابُ السحبِ غيرُ مفهومٍ"));
      }
      const fixes: HotLocationFix[] = [];
      for (const raw of value) {
        const fix = decodeFix(raw);
        if (fix === null) {
          note("drain", "حِملٌ معطوبٌ أُهمِلَ");
          continue;
        }
        fixes.push(fix);
      }
      return ok(fixes);
    },

    requeue: async (fixes): Promise<Result<void, PortFailureError>> => {
      if (fixes.length === 0) return ok(undefined);
      /**
       * الجَمعُ بالمدينةِ لا بأوّلِ عضوٍ: مفاتيحُ قائمةِ الانتظارِ مدينيّةٌ، ودفعةٌ
       * مختلطةٌ لو أُعيدَت على مفتاحِ أوّلِ مدينةٍ لأضاعَت مواقعَ مدينةٍ أخرى في
       * مفتاحٍ لا يُسحَبُ منه أحدٌ. ودفعةُ اليومِ مدينةٌ واحدةٌ، والحمايةُ للبناءِ
       * لا للحالِ القائمِ.
       */
      const byCity = new Map<CityId, HotLocationFix[]>();
      for (const fix of fixes) {
        const bucket = byCity.get(fix.cityId);
        if (bucket === undefined) byCity.set(fix.cityId, [fix]);
        else bucket.push(fix);
      }
      for (const [cityId, cityFixes] of byCity) {
        const args: string[] = [];
        for (const fix of cityFixes) {
          args.push(fix.driverId, String(fix.recordedAtMs), encodeFix(fix));
        }
        const result = await options.redis.command([
          "EVAL",
          REQUEUE_SCRIPT,
          "2",
          hotLocationBacklogKey(prefix, cityId),
          pendingKey(prefix, cityId),
          ...args,
        ]);
        if (!result.ok) {
          note("requeue", `${result.error.kind}: ${result.error.detail}`);
          return err(new PortFailureError(PORT, `فشلَت إعادةُ الإصلاحاتِ: ${result.error.kind}`));
        }
      }
      return ok(undefined);
    },

    read: async (
      driverId: DriverId,
      cityId: CityId,
    ): Promise<Result<HotLocationSnapshot | null, PortFailureError>> => {
      const result = await options.redis.command([
        "HGETALL",
        hotLocationKey(prefix, cityId, driverId),
      ]);
      if (!result.ok) {
        note("read", `${result.error.kind}: ${result.error.detail}`);
        return err(new PortFailureError(PORT, `فشلَت قراءةُ الحالةِ الساخنةِ: ${result.error.kind}`));
      }
      const value = result.value;
      if (!Array.isArray(value) || value.length === 0) return ok(null);

      // HGETALL returns flat [field, value, field, value, ...]
      const map = new Map<string, string>();
      for (let i = 0; i + 1 < value.length; i += 2) {
        map.set(String(value[i]), String(value[i + 1]));
      }
      const lat = Number(map.get("lat"));
      const lng = Number(map.get("lng"));
      const at = Number(map.get("at"));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(at)) {
        return ok(null);
      }
      return ok({ lat, lng, observedAtMs: at });
    },
  };
}
