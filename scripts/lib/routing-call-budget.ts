/**
 * الغرض: **حَكَمٌ نقيٌّ** لميزانِ نداءاتِ مزوّدِ التوجيهِ في رحلةٍ واحدةٍ
 *   (`ECO-002` — الشقُّ المملوكُ للمستودَعِ): يحملُ شكلَ نافذةِ القياسِ المُعلَنَ،
 *   ويشتقُّ سقفَ النداءاتِ من ذلكَ الشكلِ **لا رقماً مكتوباً**، ويحكمُ على
 *   حقائقَ مقيسةٍ بقواعدَ لكلِّ واحدةٍ سالبةٌ مبذورةٌ.
 *
 * الحالة: منفّذ فعلياً — `ECO-002` (مُحرِّكُ الكمِّ وحدَه).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `tests/integration/routing-call-budget.test.ts` (القياسُ) ·
 *   `scripts/check-routing-call-budget.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0151-routing-calls-per-ride-are-counted-not-estimated.md`
 *
 * ## لماذا حَكَمٌ نقيٌّ منفصلٌ
 *
 * الرقمُ الاقتصاديُّ حاصلُ ضربِ **عددٍ** في **سعرٍ**. والسعرُ في فاتورةِ مزوّدٍ
 * لا يملكُها المستودَعُ (`REQ-09` · `[!]`)، **والعددُ** سلوكُ شيفرةٍ يُقاسُ ههنا.
 * وحَكَمٌ بلا قرصٍ ولا شبكةٍ ولا ساعةٍ يجعلُ السوالبَ مبذورةً بحقائقَ لا
 * منتظَرةً بزمنٍ.
 *
 * ## ما لا يفعلُه
 *
 * - لا يُشغِّلُ قياساً ولا يقرأُ ملفّاً — ذاكَ عملُ الحاجزِ واختبارِ التكاملِ.
 * - لا يُحوِّلُ عدداً إلى مالٍ: **لا سعرَ ههنا ألبتّةَ**، ومن أرادَ التكلفةَ
 *   ضربَ العددَ في سعرِ فاتورةٍ حقيقيّةٍ.
 * - لا يُدَّعي أنَّ شكلَ النافذةِ سلوكُ مستخدمينَ: مُعلَنٌ بسببِه (`ADR 0099`).
 */

/** ملفُّ القياسِ الوحيدُ الذي يعدُّ النداءاتِ على السِلكِ — يقرؤُه الحاجزُ. */
export const ROUTING_CALLS_TEST_FILE = "tests/integration/routing-call-budget.test.ts";

/**
 * حاجزُ سياسةِ تخزينِ المساراتِ (`CAP-012`). وهذا القياسُ يسندُ ظهرَه إليه:
 * قاعدةُ «المكرَّرُ لا يُنادي» تفترضُ وجودَ طبقةِ تخزينٍ مفروضةٍ بنيويّاً.
 */
export const ROUTE_CACHE_GUARD_FILE = "scripts/check-route-cache-policy.ts";

/** عتباتُ تخزينِ المساراتِ كما يقرؤُها الحَكَمُ من الحقائقِ المقيسةِ. */
export interface RouteCacheThresholdFacts {
  readonly minChangeMeters: number;
  readonly ttlSeconds: number;
}

/**
 * شكلُ نافذةِ القياسِ — **مُعلَنٌ بسببِه لا مقيسٌ من نشرٍ حيٍّ**.
 *
 * والنافذةُ عشرُ دقائقَ لتُطابِقَ نافذةَ الصفِّ السابعِ من القسمِ 9.9 (`F1-09`)
 * فيُقرأَ القياسانِ على المحورِ عينِه.
 */
export interface RideRoutingProfile {
  /** طولُ النافذةِ المقيسةِ بالمِلِّي ثانيةِ. */
  readonly windowMs: number;
  /**
   * عددُ نبضاتِ موقعِ السائقِ في النافذةِ. والسببُ: `DRIVER_LOCATION_MIN_INTERVAL`
   * أو ما يُماثِلُه ليسَ سقفاً على تيليجرام، والنبضةُ الحيّةُ تصلُ كلَّ ثوانٍ؛
   * فستّونَ نبضةً في عشرِ دقائقَ (كلَّ عشرِ ثوانٍ) شكلٌ محافظٌ **أقلُّ** من
   * أسوأِ حالٍ، وكلُّ زيادةٍ فيهِ تشدُّ القاعدةَ ولا تُرخيها: القاعدةُ تقولُ
   * إنَّ نصيبَ النبضاتِ من النداءاتِ **صفرٌ** كم كانَت.
   */
  readonly heartbeatCount: number;
  /**
   * عددُ قراءاتِ الراكبِ لرحلتِه النشطةِ في النافذةِ **بمواضعِ سائقٍ متغيّرةٍ**.
   * ولا استقصاءَ دوريّاً في سطحِ الراكبِ (`ADR 0035` §٤ · `ADR 0099`)، فالقراءةُ
   * تقعُ على فتحٍ وعلى حدثٍ — وثمانٍ في عشرِ دقائقَ شكلٌ مُعلَنٌ سخيٌّ.
   */
  readonly activeReadCount: number;
  /**
   * عددُ قراءاتٍ **مكرَّرةٍ بلا حركةٍ** تقعُ داخلَ مدّةِ صلاحيّةِ المخزونِ.
   * وهذا شطرُ «أثرِ الـcache» من نصِّ البندِ: يُقاسُ بعددِ نداءاتٍ **لم تُرسَل**.
   */
  readonly repeatedReadCount: number;
  /**
   * نداءاتُ التوجيهِ التي تسبقُ الرحلةَ ولا تتبعُ قراءةً نشطةً: نداءُ الاقتباسِ
   * (`POST /v1/rides/quote` · `F2-04`) — واحدٌ لكلِّ رحلةٍ.
   */
  readonly quoteCallCount: number;
}

/** شكلُ النافذةِ المُعلَنُ الذي يُقاسُ عليهِ. */
export const RIDE_ROUTING_PROFILE: RideRoutingProfile = {
  windowMs: 10 * 60 * 1000,
  heartbeatCount: 60,
  activeReadCount: 8,
  repeatedReadCount: 4,
  quoteCallCount: 1,
};

/**
 * سقفُ النداءاتِ لكلِّ رحلةٍ **مُشتَقٌّ من الشكلِ لا مكتوبٌ رقماً**.
 *
 * والدعوى الاقتصاديّةُ التي يحرسُها هذا السقفُ بعينِها: **فاتورةُ التوجيهِ تنمو
 * بعددِ قراءاتِ الراكبِ لا بترددِ نبضةِ السائقِ**. فمن جعلَ النبضةَ تُنادي
 * مزوّداً رأى الرقمَ يتجاوزُ السقفَ فوراً: ستّونَ نبضةً تُنتِجُ ستّينَ نداءً،
 * والسقفُ تسعةٌ.
 */
export function routingCallBudget(profile: RideRoutingProfile = RIDE_ROUTING_PROFILE): number {
  return profile.activeReadCount + profile.quoteCallCount;
}

/**
 * سقفُ ما يُسمَحُ للسقفِ أن يبلغَه — حاجزٌ على تليينِ الحاجزِ نفسِه.
 *
 * ولِمَ يُحسَبُ من الشكلِ: لو صارَ السقفُ يُشتَقُّ من عددِ النبضاتِ لصارَ كلُّ
 * نداءٍ لكلِّ نبضةٍ مقبولاً باسمِ «الميزانِ» — وهذا عينُ ما يمنعُه.
 */
export function maxAllowedBudget(profile: RideRoutingProfile = RIDE_ROUTING_PROFILE): number {
  return profile.activeReadCount + profile.quoteCallCount;
}

/** حقائقُ النداءاتِ كما تُقاسُ على السِلكِ — بلا تقديرٍ ولا اشتقاقٍ. */
export interface RoutingCallFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرأُ «صفرَ نداءاتٍ». */
  readonly measured: boolean;
  /** نبضاتُ موقعِ سائقٍ أُرسِلَت فعلاً وردَّت البوّابةُ عليها. */
  readonly heartbeatCount: number;
  /** قراءاتُ رحلةٍ نشطةٍ بمواضعَ متغيّرةٍ. */
  readonly activeReadCount: number;
  /** قراءاتٌ مكرَّرةٌ بلا حركةٍ داخلَ مدّةِ الصلاحيّةِ. */
  readonly repeatedReadCount: number;
  /** طلباتُ `HTTP` التي وصلَت خادمَ التوجيهِ في مرحلةِ النبضاتِ وحدَها. */
  readonly callsDuringHeartbeats: number;
  /** طلباتُ `HTTP` التي وصلَت خادمَ التوجيهِ في مرحلةِ القراءاتِ المكرَّرةِ وحدَها. */
  readonly callsDuringRepeatedReads: number;
  /** مجموعُ طلباتِ `HTTP` التي وصلَت خادمَ التوجيهِ في النافذةِ كلِّها. */
  readonly totalCalls: number;
  /** طولُ النافذةِ التي جرى فيها القياسُ. */
  readonly windowMs: number;
  /** العتباتُ المقروءةُ من مصدرِها الواحدِ في الشيفرةِ لا مكتوبةً ههنا. */
  readonly thresholds: RouteCacheThresholdFacts;
}

/** مخالفةٌ واحدةٌ: اسمُ قاعدةٍ وتفصيلُها. */
export interface RoutingCallViolation {
  readonly rule: string;
  readonly detail: string;
}

/** أسماءُ قواعدِ الحَكَمِ — لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "facts.measured",
  "counts.sane",
  "calls.consistent",
  "heartbeat.no-route",
  "cache.suppresses-repeats",
  "ride.within-budget",
  "budget.derived",
  "thresholds.single-source",
  "window.declared",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

/** مدخلاتُ الحُكمِ — كلُّها محقونةٌ، ولا ساعةَ ولا قرصَ. */
export interface JudgeInputs {
  readonly facts: RoutingCallFacts;
  readonly profile: RideRoutingProfile;
  /** السقفُ المُستعمَلُ فعلاً — يُقارَنُ بالمُشتَقِّ فلا يُنسَخُ رقماً. */
  readonly budget: number;
  /** العتباتُ الحقيقيّةُ من `DEFAULT_ROUTE_CACHE_THRESHOLDS` — مصدرٌ واحدٌ. */
  readonly declaredThresholds: RouteCacheThresholdFacts;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ،
 * **ولا تعني أنَّ التكلفةَ محسوبةٌ**.
 */
export function judgeRoutingCalls(inputs: JudgeInputs): readonly RoutingCallViolation[] {
  const violations: RoutingCallViolation[] = [];
  const { facts, profile, budget, declaredThresholds } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ. والأخضرُ الفارغُ أخطرُ من الأحمرِ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا صفرُ نداءاتٍ.",
    });
  } else if (
    facts.heartbeatCount === 0 ||
    facts.activeReadCount === 0 ||
    facts.repeatedReadCount === 0
  ) {
    violations.push({
      rule: "facts.measured",
      detail: `قياسٌ بلا مرحلةٍ من مراحلِه الثلاثِ: نبضاتٌ=${facts.heartbeatCount} · قراءاتٌ=${facts.activeReadCount} · مكرَّرةٌ=${facts.repeatedReadCount}.`,
    });
  }

  // ٢) أعدادٌ غيرُ صحيحةٍ أو سالبةٌ تُبطِلُ كلَّ ما بعدَها.
  for (const [name, value] of [
    ["heartbeatCount", facts.heartbeatCount],
    ["activeReadCount", facts.activeReadCount],
    ["repeatedReadCount", facts.repeatedReadCount],
    ["callsDuringHeartbeats", facts.callsDuringHeartbeats],
    ["callsDuringRepeatedReads", facts.callsDuringRepeatedReads],
    ["totalCalls", facts.totalCalls],
  ] as const) {
    if (!isCount(value)) {
      violations.push({
        rule: "counts.sane",
        detail: `«${name}» ليسَ عدداً صحيحاً غيرَ سالبٍ: ${String(value)}.`,
      });
    }
  }

  // ٣) جزءٌ أكبرُ من كُلِّه يعني عدّاداً معطوباً — لا نجاحاً.
  if (facts.callsDuringHeartbeats + facts.callsDuringRepeatedReads > facts.totalCalls) {
    violations.push({
      rule: "calls.consistent",
      detail: `مجموعُ المرحلتَينِ (${facts.callsDuringHeartbeats} + ${facts.callsDuringRepeatedReads}) يتجاوزُ الكلَّ (${facts.totalCalls}) — العدّادُ معطوبٌ.`,
    });
  }

  // ٤) القاعدةُ الحاكمةُ: «لا مسارَ لكلِّ نبضةٍ» — ونصيبُ النبضاتِ صفرٌ لا «قليلٌ».
  if (facts.callsDuringHeartbeats !== 0) {
    violations.push({
      rule: "heartbeat.no-route",
      detail: `${facts.callsDuringHeartbeats} نداءَ توجيهٍ وقعَ في مرحلةِ النبضاتِ — وقاعدةُ «لا مسارَ لكلِّ نبضةٍ» تقولُ صفراً: الفاتورةُ تنمو بقراءاتِ الراكبِ لا بترددِ النبضةِ.`,
    });
  }

  // ٥) أثرُ التخزينِ يُقاسُ بنداءاتٍ لم تُرسَل: قراءةٌ مكرَّرةٌ بلا حركةٍ لا تُنادي.
  if (facts.callsDuringRepeatedReads !== 0) {
    violations.push({
      rule: "cache.suppresses-repeats",
      detail: `${facts.callsDuringRepeatedReads} نداءً وقعَ في ${facts.repeatedReadCount} قراءةٍ مكرَّرةٍ بلا حركةٍ — وطبقةُ التخزينِ (CAP-012) تعني أنَّ العددَ صفرٌ داخلَ مدّةِ الصلاحيّةِ.`,
    });
  }

  // ٦) السقفُ.
  if (facts.totalCalls > budget) {
    violations.push({
      rule: "ride.within-budget",
      detail: `${facts.totalCalls} نداءً في الرحلةِ يتجاوزُ السقفَ ${budget}.`,
    });
  }

  // ٧) السقفُ مُشتَقٌّ لا مكتوبٌ: من كتبَهُ رقماً أكبرَ سقطَ.
  const derived = routingCallBudget(profile);
  const ceiling = maxAllowedBudget(profile);
  if (budget !== derived) {
    violations.push({
      rule: "budget.derived",
      detail: `السقفُ المُستعمَلُ ${budget} لا يُطابِقُ المُشتَقَّ من الشكلِ ${derived} (قراءاتٌ ${profile.activeReadCount} + اقتباسٌ ${profile.quoteCallCount}).`,
    });
  }
  if (budget > ceiling) {
    violations.push({
      rule: "budget.derived",
      detail: `السقفُ ${budget} فوقَ أقصى المسموحِ ${ceiling} — ورفعُ السقفِ لاستيعابِ نداءٍ لكلِّ نبضةٍ تليينٌ للبوّابةِ.`,
    });
  }

  // ٨) العتباتُ من مصدرٍ واحدٍ: رقمٌ مكتوبٌ في القياسِ يُنسى تحديثُه.
  if (
    facts.thresholds.minChangeMeters !== declaredThresholds.minChangeMeters ||
    facts.thresholds.ttlSeconds !== declaredThresholds.ttlSeconds
  ) {
    violations.push({
      rule: "thresholds.single-source",
      detail: `عتباتُ القياسِ (${facts.thresholds.minChangeMeters} م · ${facts.thresholds.ttlSeconds} ث) تُخالِفُ المصدرَ الواحدَ (${declaredThresholds.minChangeMeters} م · ${declaredThresholds.ttlSeconds} ث).`,
    });
  }

  // ٩) نافذةُ القياسِ هيَ النافذةُ المُعلَنةُ — لا أقصرَ تُخفي نمواً.
  if (facts.windowMs !== profile.windowMs) {
    violations.push({
      rule: "window.declared",
      detail: `نافذةُ القياسِ ${facts.windowMs} مِلِّي ثانيةٍ تُخالِفُ المُعلَنةَ ${profile.windowMs}.`,
    });
  }

  return violations;
}

/** وصفُ مخالفةٍ سطراً واحداً — للحاجزِ وللدليلِ. */
export function describeRoutingViolation(violation: RoutingCallViolation): string {
  return `${violation.rule}: ${violation.detail}`;
}

/**
 * وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**: العددُ ليسَ تكلفةً.
 */
export function summarizeRoutingCalls(facts: RoutingCallFacts, budget: number): string {
  const savedByCache = facts.repeatedReadCount - facts.callsDuringRepeatedReads;
  return (
    `${facts.totalCalls} نداءَ توجيهٍ في رحلةٍ واحدةٍ من سقفِ ${budget} — ` +
    `${facts.callsDuringHeartbeats} منها في ${facts.heartbeatCount} نبضةً · ` +
    `${savedByCache} نداءً منعَهُ التخزينُ في ${facts.repeatedReadCount} قراءةٍ مكرَّرةٍ. ` +
    "ولا يُدَّعى أنَّ هذا تكلفةٌ: العددُ مقيسٌ والسعرُ في فاتورةِ مزوّدٍ (REQ-09)."
  );
}
