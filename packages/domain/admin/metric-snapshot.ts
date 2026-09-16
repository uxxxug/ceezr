/**
 * الغرض: نطاقُ **لقطةِ مقاييسِ الإدارةِ** — المتوسّطُ يُشتَقُّ من بسطٍ ومقامٍ
 *   و`null` عندَ مقامٍ صفرٍ، ومجموعُ المدنِ **جمعُ بسوطٍ ومقاماتٍ** لا متوسّطُ
 *   متوسّطاتٍ، وكلُّ رقمٍ يُنشَرُ **بعُمرِه ومصدرِه** (`F7-08` · `CAP-011`).
 * الحالة: منفَّذٌ فعليّاً — البند `F7-08` (الرِّجلانِ الأولى والثانيةُ).
 * ينتمي إلى: packages/domain/admin
 * يُستخدم من: `apps/gateway/src/admin/queries.ts` ·
 *   `packages/application/admin/refresh-metric-snapshots.ts` ·
 *   `apps/admin-dashboard/src/pages/overview.ts`
 * يحرسُه: scripts/check-admin-metric-snapshot-contract.ts ·
 *   tests/unit/admin-metric-snapshot.test.ts ·
 *   tests/integration/admin-metric-snapshots.test.ts
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ## لِمَ لا متوسّطَ مخزوناً
 *
 * مدينةٌ بعشرِ مطابقاتٍ متوسّطُها ٢٠ ثانيةً، وأخرى بألفٍ متوسّطُها ٦٠. ومتوسّطُ
 * المنصّةِ **ليسَ ٤٠**: هوَ ٥٩٫٦ تقريباً، والفرقُ ليسَ تدويراً بل حقيقةٌ أخرى.
 * فلو خُزِّنَ المتوسّطُ لكلِّ مدينةٍ استحالَ جمعُه جمعاً صحيحاً بعدَ ذلكَ — لأنَّ
 * المقامَ **أُتلِفَ عندَ الكتابةِ**. فيُخزَّنُ البسطُ والمقامُ ويُشتَقُّ المتوسّطُ
 * عندَ القراءةِ، على قاعدةِ `ADR 0120` نفسِها: «كلُّ نسبةٍ تُنشَرُ بمقامِها».
 *
 * ## ولِمَ عُمرُ المجموعِ عمرُ **أقدمِ** جزءٍ فيه
 *
 * لقطةُ مكّةَ عمرُها ثانيتانِ ولقطةُ جدّةَ عمرُها ساعةٌ: فمجموعُهما **ليسَ حديثاً
 * منذُ ثانيتَينِ**. ونشرُ الأحدثِ بوصفِه عمرَ المجموعِ كذبٌ مُريحٌ، فيُنشَرُ
 * **الأقدمُ** — وهوَ ما يجعلُ التقادُمَ يظهرُ للمُشغِّلِ بدلَ أن يستترَ خلفَ
 * مدينةٍ واحدةٍ نشِطةِ التحديثِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()`. زمنُ الملاحظةِ
 *      يُمرَّرُ صريحاً، لأنَّ ساعةَ العرضِ وساعةَ القاعدةِ ساعتانِ، وحسابُ عمرٍ
 *      بساعةِ متصفِّحٍ يُنتِجُ عمراً سالباً عندَ أوّلِ انحرافٍ.
 *   ــ **لا يستعلمُ ولا يكتبُ**: دوالُّ خالصةٌ على أرقامٍ مُمرَّرةٍ، فتُختبَرُ
 *      بلا قاعدةٍ وتُستدعى في الخادمِ وفي العرضِ بنفسِ الحكمِ.
 *   ــ **لا يُخفي غياباً**: صفٌّ ناقصٌ لمدينةٍ **ليسَ أصفاراً** بل «لم تُقَسْ»،
 *      وهذا فرقٌ يُنشَرُ لا يُطوى (`missing` ≠ `zero`).
 *   ــ **لا يُقرِّرُ سقوطاً إلى الحيِّ**: الإذنُ إعدادُ مُشغِّلٍ يُقرأُ في الخادمِ،
 *      وههنا **وَسْمُ المصدرِ** فحسبُ كي لا يُقرأَ مسحٌ حيٌّ بوصفِه لقطةً.
 */

/**
 * نافذةُ عدَّاداتِ الحصيلةِ بالساعاتِ. **موضِعٌ واحدٌ لا موضِعانِ**: الكاتبُ
 * (العاملُ) والقارئُ (البوابةُ) يقرأانِ الرقمَ من ههنا، لأنَّ رقمَينِ مختلفَينِ
 * يعنيانِ أنَّ القارئَ يطلبُ نافذةً لا يكتبُها أحدٌ — فتُقرَأُ اللوحةُ **فارغةً
 * أبداً** بلا أن يسقطَ شيءٌ ولا يُسألَ أحدٌ.
 *
 * والرقمُ **تقنيٌّ لا تجاريٌّ**: حدُّ «اليومِ» في لوحةِ مُشغِّلٍ ليسَ
 * سعراً ولا مهلةً تُفاوَضُ، ولو صارَ إعداداً لمدينةٍ لذَرَّ الجدولُ صفاً لكلِّ
 * نافذةٍ مختلفةٍ فاستحالَ جمعُ المدنِ أصلاً.
 */
export const ADMIN_METRIC_WINDOW_HOURS = 24;

/** مصدرُ الرقمِ المنشورِ. **يُنشَرُ دائماً**: لقطةٌ ومسحٌ حيٌّ حقيقتانِ مختلفتانِ. */
export const METRIC_SOURCES = ["snapshot", "live"] as const;

export type MetricSource = (typeof METRIC_SOURCES)[number];

export function isMetricSource(value: unknown): value is MetricSource {
  return typeof value === "string" && (METRIC_SOURCES as readonly string[]).includes(value);
}

/**
 * كسرٌ **بمقامِه**: `average = null` عندَ مقامٍ صفرٍ — لا صفرٌ يُقرأُ «سريعاً
 * جدّاً» ولا قسمةٌ على صفرٍ تُنتِجُ `Infinity` فتُعرَضَ رقماً.
 */
export interface MetricAverage {
  readonly sum: number;
  readonly count: number;
  readonly average: number | null;
}

/** صفُّ لقطةٍ لمدينةٍ واحدةٍ ونافذةٍ واحدةٍ، كما يُقرأُ من `admin_metric_snapshots`. */
export interface MetricSnapshotRow {
  readonly cityId: string;
  readonly windowHours: number;
  /** زمنُ **القياسِ** بصيغةِ ISO 8601 — لا زمنُ كتابةِ الصفِّ ولا زمنُ قراءتِه. */
  readonly computedAt: string;
  readonly searchingOrders: number;
  readonly matchedOrders: number;
  readonly inProgressOrders: number;
  readonly availableDrivers: number;
  readonly verifiedDrivers: number;
  readonly pendingDrivers: number;
  readonly activeSubscriptions: number;
  readonly trialSubscriptions: number;
  readonly openTickets: number;
  readonly completedOrdersWindow: number;
  readonly failedOrdersWindow: number;
  readonly cancelledOrdersWindow: number;
  readonly matchSecondsSum: number;
  readonly matchSecondsCount: number;
  readonly ratingStarsSum: number;
  readonly ratingCount: number;
}

/** عدَّاداتُ المنصّةِ مجموعةً، والمتوسّطانِ **مُشتَقّانِ** لا مخزونانِ. */
export interface MetricTotals {
  readonly searchingOrders: number;
  readonly matchedOrders: number;
  readonly inProgressOrders: number;
  readonly availableDrivers: number;
  readonly verifiedDrivers: number;
  readonly pendingDrivers: number;
  readonly activeSubscriptions: number;
  readonly trialSubscriptions: number;
  readonly openTickets: number;
  readonly completedOrdersWindow: number;
  readonly failedOrdersWindow: number;
  readonly cancelledOrdersWindow: number;
  readonly matchSeconds: MetricAverage;
  readonly driverRating: MetricAverage;
}

/**
 * وَسْمُ الصدقِ الذي يُرافقُ كلَّ رقمٍ منشورٍ. **بلا هذا الوَسْمِ لا يُنشَرُ رقمٌ**
 * — وذلكَ عينُ حكمِ `F4-05` في الموقعِ: لا موضعَ يُعرَضُ بلا عُمرِه.
 */
export interface MetricTruthStamp {
  readonly source: MetricSource;
  /** `null` **حينَ لا لقطةَ ألبتّةَ** — لا زمنٌ مُصطَنَعٌ يسدُّ الفراغَ. */
  readonly computedAt: string | null;
  /** عمرُ الرقمِ بالثواني عندَ لحظةِ الملاحظةِ. `null` حينَ لا لقطةَ. */
  readonly ageSeconds: number | null;
  /** `true` حينَ تجاوزَ العمرُ العتبةَ، و`true` أيضاً حينَ **لا لقطةَ**. */
  readonly isStale: boolean;
  readonly staleAfterSeconds: number;
  /** عددُ المدنِ التي وُجِدَ لها صفٌّ، وعددُ المدنِ المُتوقَّعةِ — غيابٌ يُقالُ. */
  readonly citiesMeasured: number;
  readonly citiesExpected: number;
}

/**
 * يشتقُّ المتوسّطَ من بسطٍ ومقامٍ. مقامٌ صفرٌ ⇒ `null`، ومقامٌ سالبٌ أو غيرُ
 * منتهٍ ⇒ `null` أيضاً: عدَدٌ فاسدٌ **لا يُقسَمُ عليهِ** ولو كتبَه الكاتبُ.
 */
export function metricAverage(sum: number, count: number): MetricAverage {
  const safeSum = Number.isFinite(sum) ? sum : 0;
  const safeCount = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
  return {
    sum: safeSum,
    count: safeCount,
    average: safeCount > 0 ? safeSum / safeCount : null,
  };
}

/**
 * يجمعُ صفوفَ المدنِ في حصيلةِ منصّةٍ. **العدَّاداتُ تُجمَعُ، والبسوطُ والمقاماتُ
 * تُجمَعُ، والمتوسّطُ يُشتَقُّ بعدَ الجمعِ** — لا قبلَه.
 */
export function sumMetricRows(rows: readonly MetricSnapshotRow[]): MetricTotals {
  let searchingOrders = 0;
  let matchedOrders = 0;
  let inProgressOrders = 0;
  let availableDrivers = 0;
  let verifiedDrivers = 0;
  let pendingDrivers = 0;
  let activeSubscriptions = 0;
  let trialSubscriptions = 0;
  let openTickets = 0;
  let completedOrdersWindow = 0;
  let failedOrdersWindow = 0;
  let cancelledOrdersWindow = 0;
  let matchSecondsSum = 0;
  let matchSecondsCount = 0;
  let ratingStarsSum = 0;
  let ratingCount = 0;

  for (const row of rows) {
    searchingOrders += row.searchingOrders;
    matchedOrders += row.matchedOrders;
    inProgressOrders += row.inProgressOrders;
    availableDrivers += row.availableDrivers;
    verifiedDrivers += row.verifiedDrivers;
    pendingDrivers += row.pendingDrivers;
    activeSubscriptions += row.activeSubscriptions;
    trialSubscriptions += row.trialSubscriptions;
    openTickets += row.openTickets;
    completedOrdersWindow += row.completedOrdersWindow;
    failedOrdersWindow += row.failedOrdersWindow;
    cancelledOrdersWindow += row.cancelledOrdersWindow;
    matchSecondsSum += row.matchSecondsSum;
    matchSecondsCount += row.matchSecondsCount;
    ratingStarsSum += row.ratingStarsSum;
    ratingCount += row.ratingCount;
  }

  return {
    searchingOrders,
    matchedOrders,
    inProgressOrders,
    availableDrivers,
    verifiedDrivers,
    pendingDrivers,
    activeSubscriptions,
    trialSubscriptions,
    openTickets,
    completedOrdersWindow,
    failedOrdersWindow,
    cancelledOrdersWindow,
    matchSeconds: metricAverage(matchSecondsSum, matchSecondsCount),
    driverRating: metricAverage(ratingStarsSum, ratingCount),
  };
}

/**
 * **أقدمُ** زمنِ قياسٍ في المجموعةِ — عمرُ المجموعِ عمرُ أضعفِ أجزائِه. و`null`
 * حينَ لا صفَّ، أو حينَ كانَ الزمنُ نصّاً لا يُقرأُ (لا يُبتكَرُ زمنٌ بديلٌ).
 */
export function oldestComputedAt(rows: readonly MetricSnapshotRow[]): string | null {
  let oldestMs: number | null = null;
  let oldestIso: string | null = null;
  for (const row of rows) {
    const ms = Date.parse(row.computedAt);
    if (!Number.isFinite(ms)) {
      continue;
    }
    if (oldestMs === null || ms < oldestMs) {
      oldestMs = ms;
      oldestIso = row.computedAt;
    }
  }
  return oldestIso;
}

/**
 * عمرُ لقطةٍ بالثواني عندَ لحظةِ ملاحظةٍ **مُمرَّرةٍ**. وانحرافُ الساعاتِ قد
 * يُنتِجُ زمناً في المستقبلِ، فيُقصَرُ العمرُ على صفرٍ ولا يُنشَرُ سالباً: عمرٌ
 * سالبٌ يُقرأُ عطباً في العرضِ، والصفرُ يُقرأُ «لحظياً» وهوَ الأصدقُ ههنا.
 */
export function ageSecondsOf(computedAt: string, observedAt: Date): number | null {
  const computedMs = Date.parse(computedAt);
  const observedMs = observedAt.getTime();
  if (!Number.isFinite(computedMs) || !Number.isFinite(observedMs)) {
    return null;
  }
  return Math.max(0, Math.round((observedMs - computedMs) / 1000));
}

export interface TruthStampInput {
  readonly source: MetricSource;
  readonly rows: readonly MetricSnapshotRow[];
  readonly observedAt: Date;
  readonly staleAfterSeconds: number;
  readonly citiesExpected: number;
}

/**
 * يبني وَسْمَ الصدقِ. وثلاثةُ أحوالٍ تُقالُ ولا تُطوى:
 *
 *   ١. **لا صفَّ ألبتّةَ** ⇒ `computedAt = null` و`isStale = true`. غيابُ اللقطةِ
 *      ليسَ لقطةً حديثةً، ولا يُعطى المُشغِّلُ أصفاراً بوصفِها قياساً.
 *   ٢. **صفوفٌ ناقصةٌ** ⇒ `citiesMeasured < citiesExpected`، فيُقرأُ النقصُ في
 *      العرضِ ولا يُخفى وراءَ مجموعٍ يبدو تامّاً.
 *   ٣. **زمنٌ لا يُقرأُ** ⇒ `ageSeconds = null` و`isStale = true`: رقمٌ لا يُعرَفُ
 *      عمرُه يُعامَلُ **مُتقادِماً**، لا حديثاً بحُسنِ الظنِّ.
 *   ٤. **عتبةٌ غيرُ صالحةٍ** (صفرٌ أو سالبٌ أو غيرُ منتهٍ) ⇒ `isStale = true`.
 *      عتبةٌ مفقودةٌ تعني **أنَّ الحكمَ لم يُضبَطْ**، فالسقوطُ إلى «سليمٌ» يُخرِجُ
 *      الحاجزَ من الخدمةِ بصمتٍ عندَ أوّلِ إعدادٍ يُحذَفُ أو يُخطَأُ في نوعِه.
 */
export function metricTruthStamp(input: TruthStampInput): MetricTruthStamp {
  const staleAfterSeconds =
    Number.isFinite(input.staleAfterSeconds) && input.staleAfterSeconds > 0
      ? input.staleAfterSeconds
      : 0;
  const citiesExpected = Math.max(0, Math.trunc(input.citiesExpected));
  const citiesMeasured = input.rows.length;
  const computedAt = oldestComputedAt(input.rows);

  if (computedAt === null) {
    return {
      source: input.source,
      computedAt: null,
      ageSeconds: null,
      isStale: true,
      staleAfterSeconds,
      citiesMeasured,
      citiesExpected,
    };
  }

  const ageSeconds = ageSecondsOf(computedAt, input.observedAt);
  return {
    source: input.source,
    computedAt,
    ageSeconds,
    isStale: ageSeconds === null || staleAfterSeconds <= 0 || ageSeconds > staleAfterSeconds,
    staleAfterSeconds,
    citiesMeasured,
    citiesExpected,
  };
}
