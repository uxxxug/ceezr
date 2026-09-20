/**
 * الغرض: **حَكَمٌ نقيٌّ** لميزانِ التكلفةِ الإجماليّةِ لكلِّ مستخدمٍ نشطٍ شهريّاً،
 *   ولكلِّ رحلةٍ (`ECO-001` — الزيادةُ الأولى، الشقُّ المملوكُ للمستودَعِ):
 *   يحسبُ المقاماتِ (المستخدمونَ النشطونَ والرحلاتُ في نافذةٍ مُحقونةٍ) والكميّاتِ
 *   الشهريّةَ والنِسبَيّةَ (لكلِّ مستخدمٍ ولكلِّ رحلةٍ) من كميّاتِ الرحلةِ الواحدةِ،
 *   ويحسبُ التكلفةَ النقديّةَ **إن وُفِّرَ جدولُ أسعارٍ كاملٌ محقونٌ** — وإلّا نشرَ
 *   أنَّ السعرَ محجوبٌ بقرارٍ خارجيٍّ (`REQ-09`)، فلا يُقدَّرُ ولا يُخمَّنُ.
 *
 * الحالة: منفّذ فعلياً — `ECO-001` (محرّكُ المقامِ والكميّاتِ وحدَه — الزيادةُ الأولى).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `tests/integration/eco-user-cost.test.ts` (القياسُ) ·
 *   `scripts/check-eco-user-cost.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0154-eco-001-first-increment-active-user-and-ride-denominators.md`
 *
 * ## لماذا حَكَمٌ نقيٌّ منفصلٌ
 *
 * `ECO-004` يقيسُ كميّاتِ الرحلةِ الواحدةِ. أمّا `ECO-001` فيسألُ: ماذا تُكلِّفُ هذه
 * الكميّاتُ عند تجميعِها على شهرٍ وتقسيمِها على المستخدمينَ النشطينَ؟ والجوابُ
 * رقمٌ محسوبٌ من **عددٍ** (مقاسٍ) و**سعرٍ** (خارجيٍّ). فالحَكَمُ النقيُّ يفصلُ الحسابَ
 * عن القياسِ وعن التسعيرِ: يأخذُ المقاماتِ والكميّاتِ مدخلاتٍ ويُخرجُ النِسبَ والتكلفة.
 *
 * ## ما يحسبُه هذان المُحرِّكانِ (الزيادةُ الأولى)
 *
 * ١) **المقامات**: عددُ المستخدمينَ النشطينَ (ركّابٌ + سائقونَ) وعددُ الرحلاتِ في
 *    نافذةٍ `[from, to)` محقونةٍ. والسائقُ يُعَدُّ نشطاً إن أُسنِدَ إليهِ طلبٌ أو
 *    بَثَّ عرضاً — لا إن كانَ مسجَّلاً فقط.
 *
 * ٢) **الكميّاتُ الشهريّةُ**: كميّاتُ الرحلةِ الواحدةِ × عددُ الرحلاتِ في النافذةِ.
 *    وهذه **مشتقّةٌ من حدٍّ أعلى** (`ECO-004`) لا مقيسةٌ على نشرٍ حيٍّ — فالقياسُ على
 *    السِلكِ في اختبارِ التكاملِ.
 *
 * ٣) **النِسبُ لكلِّ مستخدمٍ**: الكميّاتُ الشهريّةُ ÷ عددُ المستخدمينَ النشطينَ.
 *
 * ٤) **التكلفةُ النقديّةُ**: كميّاتٌ × أسعارٌ مُحقونةٌ. إن نقصَ سعرٌ واحدٌ يُنشَرُ
 *    `status: "blocked"` مع سببِ `REQ-09` — ولا يُقدَّرُ ولا يُخمَّنُ.
 *
 * ## ما لا يحسبُه هذان المُحرِّكانِ عن قصدٍ — ويُعلَنُ في الدليلِ
 *
 * - **لا يخترعُ سقفاً لِعددِ الرحلاتِ لكلِّ مستخدمٍ شهريّاً**: ذاك قرارُ منتجٍ/اقتصادٍ
 *   غيرُ موجودٍ في الخارطةِ. فالحَكَمُ يحسبُ ويَنشرُ، ولا يُحكمُ على ميزانيةٍ جديدةٍ
 *   غيرِ معتمدةٍ.
 * - **لا يستعملُ أسعاراً وهميّةً**: جدولُ الأسعارِ محقونٌ أو غائبٌ؛ وغيابُه حالةٌ
 *   صريحةٌ (`blocked`) لا صفرٌ.
 * - **لا يستعملُ `now()`**: النافذةُ `[from, to)` محقونةٌ، واختبارُ التكاملِ يزرعُ
 *   بياناتٍ بتواريخَ ثابتةٍ — فلا يعتمدُ على قاعدةٍ حيّةٍ ولا يوثّقُ أرقامَها كدليلِ
 *   إنتاجٍ.
 * - **لا يخلطُ المقاماتِ**: الرحلاتُ المُنشأةُ والمُكمَّلةُ تُنشَرُ منفصلةً إن اختلفَ
 *   المعنى — ولا يُسمَّى أحدُهما «الحقيقةَ الكاملةَ» دونَ سندٍ.
 */

// ═══════════════════════════════════════════════════════════════════════════
// الأنواع
// ═══════════════════════════════════════════════════════════════════════════

/** نافذةُ القياسِ `[from, to)` — محقونةٌ لا من `now()`. */
export interface MonthlyWindow {
  /** بدايةُ النافذةِ (مُضمَّنةٌ). */
  readonly from: Date;
  /** نهايةُ النافذةِ (مُستثناةٌ). */
  readonly to: Date;
}

/** مقاماتُ المستخدمينَ النشطينَ والرحلاتِ — مقيسةٌ من القاعدةِ. */
export interface ActiveUserCounts {
  /** عددُ الراكبينَ الذينَ أنشؤوا طلباً واحداً على الأقلِّ في النافذةِ. */
  readonly activeRiders: number;
  /** عددُ السائقينَ الذينَ أُسنِدَ إليهم طلبٌ أو بثُّوا عرضاً في النافذةِ. */
  readonly activeDrivers: number;
  /** مجموعُ النشطينَ = ركّابٌ + سائقونَ. */
  readonly totalActiveUsers: number;
  /** عددُ الطلباتِ المُنشأةِ في النافذةِ (`created_at`). */
  readonly ordersCreated: number;
  /** عددُ الرحلاتِ المُكمَّلةِ في النافذةِ (`completed_at`). */
  readonly completedRides: number;
}

/** كميّاتُ الرحلةِ الواحدةِ — من `ECO-004` أو مدخلاتٌ مُحقونةٌ. */
export interface PerRideQuantities {
  readonly databaseRows: number;
  readonly databaseBlocks: number;
  readonly queueMessages: number;
  readonly redisCommands: number;
  readonly networkBytes: number;
  readonly storageRows: number;
}

/** جدولُ أسعارِ الوحدةِ — محقونٌ أو غائبٌ. كلُّ سعرٍ اختياريٌّ. */
export interface UnitPrices {
  readonly dbRowPrice?: number;
  readonly dbBlockPrice?: number;
  readonly queueMessagePrice?: number;
  readonly redisCommandPrice?: number;
  readonly networkBytePrice?: number;
  readonly storageRowPrice?: number;
}

/** حالةُ التكلفةِ النقديّةِ. */
export type MonetaryCostStatus =
  | { readonly status: "calculated" }
  | { readonly status: "blocked"; readonly reason: string };

/** نتيجةُ التكلفةِ النقديّةِ. */
export interface MonetaryCost {
  readonly status: MonetaryCostStatus;
  /** تكلفةُ البنية لكلِّ مستخدمٍ نشطٍ في الشهر — `null` إن كانت محجوبةً. */
  readonly perUserCost: number | null;
  /** تكلفةُ البنية لكلِّ رحلةٍ — `null` إن كانت محجوبةً. */
  readonly perRideCost: number | null;
  /** تكلفةُ البنية الإجماليّةُ في النافذةِ — `null` إن كانت محجوبةً. */
  readonly totalMonthlyCost: number | null;
}

/** الكميّاتُ الشهريّةُ المُشتقّةُ من كميّاتِ الرحلةِ × عددِ الرحلاتِ. */
export interface MonthlyResourceUsage {
  /** الكميّاتُ الشهريّةُ الإجماليّةُ = كميّةُ الرحلةِ × عددُ الرحلاتِ. */
  readonly monthlyDatabaseRows: number;
  readonly monthlyDatabaseBlocks: number;
  readonly monthlyQueueMessages: number;
  readonly monthlyRedisCommands: number;
  readonly monthlyNetworkBytes: number;
  readonly monthlyStorageRows: number;
  /** النِسبُ لكلِّ مستخدمٍ نشطٍ = الإجماليُّ ÷ عددُ المستخدمينَ النشطينَ. */
  readonly perUserDatabaseRows: number;
  readonly perUserDatabaseBlocks: number;
  readonly perUserQueueMessages: number;
  readonly perUserRedisCommands: number;
  readonly perUserNetworkBytes: number;
  readonly perUserStorageRows: number;
}

/** نتيجةُ `ECO-001` الكاملةُ. */
export interface EcoUserCostResult {
  readonly window: MonthlyWindow;
  readonly activeUsers: ActiveUserCounts;
  readonly perRideQuantities: PerRideQuantities;
  readonly monthlyUsage: MonthlyResourceUsage;
  readonly monetaryCost: MonetaryCost;
}

/** اسمُ ملفِّ القياسِ الوحيدِ — يقرؤُه الحاجزُ. */
export const ECO_USER_COST_TEST_FILE = "tests/integration/eco-user-cost.test.ts";

/** أسماءُ قواعدِ الحكمِ — مُصدَّرةٌ كي تُبذَرَ سالبةٌ لكلِّ واحدةٍ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "judge.window-injected",
  "judge.riders-counted",
  "judge.drivers-counted",
  "judge.total-active-users",
  "judge.orders-separated",
  "judge.monthly-derived-from-ride",
  "judge.per-user-divided",
  "judge.prices-optional",
  "judge.blocked-when-price-missing",
  "judge.no-now-in-logic",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

// ═══════════════════════════════════════════════════════════════════════════
// الدوالُ النقيّةُ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * يحسبُ الكميّاتِ الشهريّةَ من كميّاتِ الرحلةِ × عددِ الرحلاتِ، والنِسبَ لكلِّ
 * مستخدمٍ نشطٍ بقسمةِ الإجماليِّ على عددِ المستخدمينَ النشطينَ.
 *
 * **الكميّاتُ الشهريّةُ مشتقّةٌ من حدٍّ أعلى** — لا مقيسةٌ على نشرٍ حيٍّ. فالقياسُ
 * على السِلكِ في اختبارِ التكاملِ.
 */
export function calculateMonthlyUsage(
  activeUsers: ActiveUserCounts,
  perRideQuantities: PerRideQuantities,
): MonthlyResourceUsage {
  const rides = activeUsers.ordersCreated;

  const monthlyDatabaseRows = perRideQuantities.databaseRows * rides;
  const monthlyDatabaseBlocks = perRideQuantities.databaseBlocks * rides;
  const monthlyQueueMessages = perRideQuantities.queueMessages * rides;
  const monthlyRedisCommands = perRideQuantities.redisCommands * rides;
  const monthlyNetworkBytes = perRideQuantities.networkBytes * rides;
  const monthlyStorageRows = perRideQuantities.storageRows * rides;

  const users = Math.max(activeUsers.totalActiveUsers, 1);

  return {
    monthlyDatabaseRows,
    monthlyDatabaseBlocks,
    monthlyQueueMessages,
    monthlyRedisCommands,
    monthlyNetworkBytes,
    monthlyStorageRows,
    perUserDatabaseRows: monthlyDatabaseRows / users,
    perUserDatabaseBlocks: monthlyDatabaseBlocks / users,
    perUserQueueMessages: monthlyQueueMessages / users,
    perUserRedisCommands: monthlyRedisCommands / users,
    perUserNetworkBytes: monthlyNetworkBytes / users,
    perUserStorageRows: monthlyStorageRows / users,
  };
}

/**
 * يحسبُ التكلفةَ النقديّةَ من الكميّاتِ الشهريّةِ × الأسعارِ المُحقونةِ. إن نقصَ
 * سعرٌ واحدٌ يُنشَرُ `status: "blocked"` مع سببِ `REQ-09` — ولا يُقدَّرُ ولا يُخمَّنُ.
 *
 * يقبلُ `activeUsers` و`perRideQuantities` لاستنتاجِ عددِ المستخدمينَ والرحلاتِ
 * من المدخلاتِ الأصليّةِ — لا من الكميّاتِ المُشتقّةِ — فالقسمةُ تكونُ على
 * المقاماتِ الحقيقيّةِ لا على ما يُستنتَجُ من النِسبِ.
 */
export function calculateMonetaryCost(
  usage: MonthlyResourceUsage,
  prices: UnitPrices,
  activeUsers: ActiveUserCounts,
  _perRideQuantities: PerRideQuantities,
): MonetaryCost {
  const allPricesProvided =
    prices.dbRowPrice !== undefined &&
    prices.dbBlockPrice !== undefined &&
    prices.queueMessagePrice !== undefined &&
    prices.redisCommandPrice !== undefined &&
    prices.networkBytePrice !== undefined &&
    prices.storageRowPrice !== undefined;

  if (!allPricesProvided) {
    return {
      status: { status: "blocked", reason: "REQ-09" },
      perUserCost: null,
      perRideCost: null,
      totalMonthlyCost: null,
    };
  }

  const totalMonthlyCost =
    usage.monthlyDatabaseRows * (prices.dbRowPrice ?? 0) +
    usage.monthlyDatabaseBlocks * (prices.dbBlockPrice ?? 0) +
    usage.monthlyQueueMessages * (prices.queueMessagePrice ?? 0) +
    usage.monthlyRedisCommands * (prices.redisCommandPrice ?? 0) +
    usage.monthlyNetworkBytes * (prices.networkBytePrice ?? 0) +
    usage.monthlyStorageRows * (prices.storageRowPrice ?? 0);

  const users = Math.max(activeUsers.totalActiveUsers, 1);
  const rides = Math.max(activeUsers.ordersCreated, 1);

  return {
    status: { status: "calculated" },
    perUserCost: totalMonthlyCost / users,
    perRideCost: totalMonthlyCost / rides,
    totalMonthlyCost,
  };
}

/**
 * الدالةُ الرئيسةُ: تأخذُ النافذةَ والمقاماتِ والكميّاتِ والأسعارَ، وتُخرجُ
 * النتيجةَ الكاملةَ.
 */
export function judgeEcoUserCost(
  window: MonthlyWindow,
  activeUsers: ActiveUserCounts,
  perRideQuantities: PerRideQuantities,
  prices: UnitPrices,
): EcoUserCostResult {
  const monthlyUsage = calculateMonthlyUsage(activeUsers, perRideQuantities);
  const monetaryCost = calculateMonetaryCost(monthlyUsage, prices, activeUsers, perRideQuantities);

  return {
    window,
    activeUsers,
    perRideQuantities,
    monthlyUsage,
    monetaryCost,
  };
}

/**
 * يُلخِّصُ النتيجةَ في نصٍّ واحدٍ للطباعةِ — يُستعملُ في الحاجزِ وفي الاختبارِ.
 */
export function summarizeEcoUserCost(result: EcoUserCostResult): string {
  const u = result.monthlyUsage;
  const a = result.activeUsers;
  const mc = result.monetaryCost;

  const costLine =
    mc.status.status === "calculated"
      ? `التكلفةُ: ${mc.totalMonthlyCost?.toFixed(2)} إجماليّاً · ${mc.perUserCost?.toFixed(2)}/مستخدم · ${mc.perRideCost?.toFixed(2)}/رحلة`
      : `التكلفةُ: محجوبةٌ (${mc.status.reason}) — السعرُ في فاتورةِ مزوّدِ سحابةٍ`;

  return (
    `ECO-001 (الزيادةُ الأولى): ${a.totalActiveUsers} مستخدمٌ نشط ` +
    `(${a.activeRiders} راكب · ${a.activeDrivers} سائق) · ` +
    `${a.ordersCreated} طلب · ${a.completedRides} رحلة مُكمَّلة. ` +
    `شهريّاً: ${u.monthlyDatabaseRows} صف قاعدة · ${u.monthlyRedisCommands} أمر Redis · ` +
    `${u.monthlyNetworkBytes} بايت شبكة. ` +
    `لكلِّ مستخدم: ${Math.round(u.perUserDatabaseRows)} صف · ${Math.round(u.perUserRedisCommands)} أمر. ` +
    costLine +
    `. الكميّاتُ الشهريّةُ مشتقّةٌ من حدٍّ أعلى — لا مقيسةٌ على نشرٍ حيٍّ.`
  );
}
