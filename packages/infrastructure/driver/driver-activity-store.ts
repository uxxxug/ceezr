/**
 * الغرض: محوّلُ حصيلةِ السائقِ على PostgreSQL — نداءُ دالّتَي `F3-05` وقراءةُ
 *   حمولتِهما **بلا افتراضٍ ولا حسابٍ** (`F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` — الاشتراكُ محوِّلٌ يُضافُ، ولا تُوسَّعُ
 *   هاتانِ الطريقتانِ لتقرآ فاتورةً.
 * يحرسُه: tests/integration/driver-activity.test.ts ·
 *   scripts/check-driver-activity-contract.ts
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ **مقامٌ صفرٌ يمرُّ** ومُعامَلٌ ناقصٌ لا يمرُّ
 *
 * `{numerator: 0, denominator: 0, rate: null}` **حالٌ سويّةٌ**: سائقٌ لم يُعرَضْ
 * عليه شيءٌ في المُدّةِ. أمّا كتلةُ نسبةٍ بلا مقامٍ مقروءٍ فعطبُ عقدٍ: الشاشةُ
 * تحتاجُ المقامَ لتقولَ «غيرُ مقيسةٍ» بدلَ «صفرٍ»، فبلا مقامٍ **تُخترَعُ
 * حقيقةٌ**. فتُردُّ `MALFORMED_RESULT` ويُقرأُ `503`.
 *
 * ## ولِمَ الوزنُ `null` يُقبَلُ ولا يُقرأُ صفراً
 *
 * «لم يُضبَطْ» و«ضُبِطَ صفراً» حالانِ مختلفتانِ: الثانيةُ قرارُ مُشغِّلٍ بتعطيلِ
 * عاملٍ (وهيَ المبذورةُ للمنطقةِ المفضّلةِ)، والأولى إعدادٌ ناقصٌ يُقالُ للسائقِ
 * «غيرُ معروفٍ» ولا يُزعَمُ له تعطيلاً.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يكتبُ ألبتّةَ**: لا `insert` ولا `update` ولا `delete` — ولا حتّى
 *      عدَّادَ قراءةٍ.
 *   ــ **لا يحسبُ نسبةً ولا يجمعُ ثوانيَ**: القاعدةُ حسبَت، والمحوِّلُ **يقرأُ
 *      ويتحقّقُ**. وحسابٌ ثانٍ ههنا مصدرُ حقيقةٍ ثانٍ يفترقُ في التدويرِ.
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ، والمعرّفُ يُفحَصُ رقميّاً
 *      قبلَ `bigint`.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يقرأُ هويّةَ راكبٍ**: لا حقلَ لاسمٍ ولا لهاتفٍ ههنا، ولو أعادَتهما
 *      دالّةٌ لَما وُجِدَ لهما موضعٌ يُقرآنِ فيه.
 */

import type {
  DriverActivityStore,
  DriverActivityStoreError,
  DriverActivityStoreRejection,
} from "../../application/driver/activity-ports.ts";
import {
  type ActivityAttendance,
  type ActivityMoney,
  type ActivityRating,
  type ActivityRatio,
  type ActivityWindow,
  type DriverActivityEntry,
  type DriverActivityLog,
  type DriverActivitySummary,
  isActivityPeriod,
  isDistanceBasis,
  isMoneyBasis,
  isRankingFactorKey,
  type RankingFactor,
} from "../../domain/driver/activity.ts";
import { isServiceType } from "../../domain/driver/driver-offers.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

/** مجالُ الرفضِ المغلقُ — يُقابِلُ رموزَ دالّتَي `F3-05` حرفاً. */
const REJECTIONS: readonly DriverActivityStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "WINDOW_UNRESOLVED",
];

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): DriverActivityStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** عدَدٌ صحيحٌ غيرُ سالبٍ — عدَّادٌ سالبٌ عطبُ عقدٍ لا رقمٌ يُعرَضُ. */
function readCount(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): DriverActivityStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  return { rejection: code as DriverActivityStoreRejection };
}

/**
 * النافذةُ. و**الترتيبُ يُفحَصُ**: `to <= from` نافذةٌ محالٌ تجعلُ كلَّ رقمٍ
 * بعدَها صفراً بصمتٍ — وصفرٌ من نافذةٍ مقلوبةٍ يُقرأُ «لم تعملْ» في وجهِ سائقٍ
 * عملَ نهارَه.
 */
function readWindow(value: unknown): ActivityWindow | null {
  if (!isRecord(value)) return null;
  const period = value.period;
  const timezone = readText(value.timezone);
  const from = readInstant(value.from);
  const to = readInstant(value.to);
  if (!isActivityPeriod(period) || timezone === null || from === null || to === null) return null;
  if (new Date(to).getTime() <= new Date(from).getTime()) return null;
  return { period, timezone, from, to };
}

/**
 * كسرٌ. و**الاتّساقُ يُفحَصُ لا الحقولُ منفصلةً**: بَسْطٌ أكبرُ من مقامِه، أو
 * `rate` موجودةٌ ومقامُها صفرٌ، أو مقامٌ موجبٌ و`rate` معدومةٌ — كلُّها عطبُ
 * عقدٍ لا رقمٌ يُعرَضُ. وسائقٌ يرى «١٢ من ٧» يفقدُ الثقةَ في كلِّ رقمٍ بعدَه.
 */
function readRatio(value: unknown): ActivityRatio | null {
  if (!isRecord(value)) return null;
  const numerator = readCount(value.numerator);
  const denominator = readCount(value.denominator);
  if (numerator === null || denominator === null) return null;
  if (numerator > denominator) return null;

  const rawRate = value.rate;
  if (rawRate === null || rawRate === undefined) {
    // مقامٌ موجبٌ **يُوجِبُ** نسبةً: غيابُها معَ وجودِه عطبٌ لا حالٌ.
    return denominator === 0 ? { numerator, denominator, rate: null } : null;
  }
  const rate = readNumber(rawRate);
  if (rate === null || rate < 0 || rate > 1) return null;
  if (denominator === 0) return null;
  return { numerator, denominator, rate };
}

function readAttendance(value: unknown): ActivityAttendance | null {
  if (!isRecord(value)) return null;
  const availableSeconds = readCount(value.available_seconds);
  if (availableSeconds === null || typeof value.open !== "boolean") return null;
  return { availableSeconds, open: value.open };
}

/**
 * التقييمُ. و`average` تُقبَلُ في `[1, 5]` وحدَها: متوسّطٌ خارجَ مجالِ النجومِ
 * عطبُ حسابٍ، وعرضُه يُفسِدُ كلَّ قراءةٍ بعدَه.
 */
function readRating(value: unknown): ActivityRating | null {
  if (!isRecord(value)) return null;
  const count = readCount(value.count);
  if (count === null) return null;

  const rawAverage = value.average;
  let average: number | null = null;
  if (rawAverage !== null && rawAverage !== undefined) {
    const parsed = readNumber(rawAverage);
    if (parsed === null || parsed < 1 || parsed > 5) return null;
    average = parsed;
  }
  // عدَدٌ موجبٌ بلا متوسّطٍ، أو متوسّطٌ بلا عدَدٍ — **مُحالانِ** يُقرآنِ عطباً.
  if ((count === 0) !== (average === null)) return null;

  const rawTrust = value.trust_min_count;
  let trustMinCount: number | null = null;
  if (rawTrust !== null && rawTrust !== undefined) {
    const parsed = readNumber(rawTrust);
    if (parsed === null || parsed < 0) return null;
    trustMinCount = parsed;
  }

  const rawBelow = value.below_trust;
  if (rawBelow !== null && rawBelow !== undefined && typeof rawBelow !== "boolean") return null;
  // حكمٌ بلا حدٍّ، أو حدٌّ بلا حكمٍ — اقترانٌ يُفحَصُ لا حقلانِ.
  const belowTrust = typeof rawBelow === "boolean" ? rawBelow : null;
  if ((trustMinCount === null) !== (belowTrust === null)) return null;

  return { average, count, trustMinCount, belowTrust };
}

/**
 * عواملُ الترتيبِ. و**الاستيفاءُ يُفحَصُ**: عاملٌ ناقصٌ في الحمولةِ يجعلُ
 * الشفافيّةَ **جزئيّةً وهيَ تُقدَّمُ كامِلةً** — وذاكَ أسوأُ من غيابِها كلِّه.
 */
function readRankingFactors(value: unknown): readonly RankingFactor[] | null {
  if (!Array.isArray(value)) return null;
  const factors: RankingFactor[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !isRankingFactorKey(raw.key)) return null;
    const rawWeight = raw.weight;
    let weight: number | null = null;
    if (rawWeight !== null && rawWeight !== undefined) {
      const parsed = readNumber(rawWeight);
      if (parsed === null || parsed < 0) return null;
      weight = parsed;
    }
    if (factors.some((factor) => factor.key === raw.key)) return null;
    factors.push({ key: raw.key, weight });
  }
  return factors.length === 0 ? null : factors;
}

/**
 * المالُ. و**مبلغٌ منشورٌ يُسقِطُ القراءةَ**: يومَ يُنشَرُ مبلغٌ يجبُ أن يُحرَّرَ
 * النطاقُ والشاشةُ والحاجزُ معاً — لا أن يظهرَ رقمٌ في واجهةٍ بلا قرارٍ.
 */
function readMoney(value: unknown): ActivityMoney | null {
  if (!isRecord(value)) return null;
  if (value.amount !== null && value.amount !== undefined) return null;
  if (!isMoneyBasis(value.basis)) return null;
  return { amount: null, basis: value.basis };
}

function readEntry(value: unknown): DriverActivityEntry | null {
  if (!isRecord(value)) return null;
  const orderId = readText(value.order_id);
  const completedAt = readInstant(value.completed_at);
  if (orderId === null || completedAt === null || !isServiceType(value.service)) return null;

  const rawDuration = value.duration_seconds;
  let durationSeconds: number | null = null;
  if (rawDuration !== null && rawDuration !== undefined) {
    const parsed = readCount(rawDuration);
    if (parsed === null) return null;
    durationSeconds = parsed;
  }

  const rawDistance = value.distance;
  let distance: DriverActivityEntry["distance"] = null;
  if (rawDistance !== null && rawDistance !== undefined) {
    if (!isRecord(rawDistance)) return null;
    const km = readNumber(rawDistance.km);
    // **الأساسُ إلزاميٌّ معَ الرقمِ**: مسافةٌ بلا وَسْمٍ تُقرأُ طريقاً مقطوعاً.
    if (km === null || km < 0 || !isDistanceBasis(rawDistance.basis)) return null;
    distance = { km, basis: rawDistance.basis };
  }

  return {
    orderId,
    service: value.service,
    matchedAt: readInstant(value.matched_at),
    startedAt: readInstant(value.started_at),
    completedAt,
    durationSeconds,
    distance,
  };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresDriverActivityStore implements DriverActivityStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async readSummary(input: {
    readonly telegramUserId: string;
    readonly period: "day" | "week" | "month";
  }): Promise<Result<DriverActivitySummary, DriverActivityStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_activity_summary(${telegramId}::bigint, ${input.period}::text) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const serverTime = readInstant(payload.server_time);
    const window = readWindow(payload.window);
    const rides = isRecord(payload.rides) ? readCount(payload.rides.completed) : null;
    const attendance = readAttendance(payload.attendance);
    const acceptance = readRatio(payload.acceptance);
    const cancellation = readRatio(payload.cancellation);
    const rating = readRating(payload.rating);
    const ranking = isRecord(payload.ranking) ? payload.ranking : null;
    const rankingFactors = ranking === null ? null : readRankingFactors(ranking.factors);
    const money = readMoney(payload.money);

    if (
      serverTime === null ||
      window === null ||
      rides === null ||
      attendance === null ||
      acceptance === null ||
      cancellation === null ||
      rating === null ||
      ranking === null ||
      rankingFactors === null ||
      money === null ||
      // **الإعلانُ إلزاميٌّ ومنطقيٌّ**: مفتاحٌ غائبٌ أو غيرُ منطقيٍّ يجعلُ الشاشةَ
      // تختارُ نصّاً عن الترتيبِ بنفسِها — وذاكَ نصٌّ يُوعِدُ أو يُهدِّدُ بلا سندٍ.
      typeof ranking.behaviour_affects_ranking !== "boolean" ||
      // المُدّةُ المُعادةُ **هيَ المطلوبةُ**: نافذةٌ لمُدّةٍ أُخرى تُعرَضُ بعنوانٍ
      // خاطئٍ، وهوَ عطبٌ لا يُلاحَظُ أبداً في نظرِ القارئِ.
      window.period !== input.period
    ) {
      return err(failed("MALFORMED_RESULT"));
    }

    return ok({
      serverTime,
      window,
      ridesCompleted: rides,
      attendance,
      acceptance,
      cancellation,
      rating,
      rankingFactors,
      behaviourAffectsRanking: ranking.behaviour_affects_ranking,
      money,
    });
  }

  async readEntries(input: {
    readonly telegramUserId: string;
    readonly period: "day" | "week" | "month";
    readonly limit: number;
  }): Promise<Result<DriverActivityLog, DriverActivityStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_activity_entries(
          ${telegramId}::bigint, ${input.period}::text, ${input.limit}::int) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const serverTime = readInstant(payload.server_time);
    const window = readWindow(payload.window);
    const limit = readCount(payload.limit);
    if (
      serverTime === null ||
      window === null ||
      limit === null ||
      limit <= 0 ||
      window.period !== input.period ||
      !Array.isArray(payload.entries)
    ) {
      return err(failed("MALFORMED_RESULT"));
    }

    const entries: DriverActivityEntry[] = [];
    for (const raw of payload.entries) {
      const entry = readEntry(raw);
      // **صفٌّ لا يُقرأُ يُسقِطُ الجدولَ كلَّه** ولا يُحذَفُ صامتاً: جدولٌ ناقصٌ
      // بلا علامةٍ يُقرأُ حصيلةً كامِلةً، فتضيعُ رحلةٌ من عينِ صاحبِها.
      if (entry === null) return err(failed("MALFORMED_RESULT"));
      entries.push(entry);
    }
    // والسقفُ **يُنفَذُ لا يُصدَّقُ**: حمولةٌ أطولُ من سقفِها عطبُ عقدٍ.
    if (entries.length > limit) return err(failed("MALFORMED_RESULT"));

    return ok({ serverTime, window, limit, entries });
  }
}
