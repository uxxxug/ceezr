/**
 * الغرض: **حَكَمٌ نقيٌّ** لميزانِ المواردِ المُستهلَكةِ في رحلةٍ واحدةٍ
 *   (`ECO-004` — الزيادةُ الأولى، الشقُّ المملوكُ للمستودَعِ): يحملُ شكلَ
 *   نافذةِ القياسِ المُعلَنَ، ويشتقُّ سقفَ كلِّ سطحٍ موردٍ من ذلكَ الشكلِ **لا
 *   رقماً مكتوباً**، ويحكمُ على حقائقَ مقيسةٍ بقواعدَ لكلِّ واحدةٍ سالبةٌ
 *   مبذورةٌ.
 *
 * الحالة: منفّذ فعلياً — `ECO-004` (مُحرِّكُ الكمِّ وحدَه — الزيادةُ الأولى).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `tests/integration/resource-usage-budget.test.ts` (القياسُ) ·
 *   `scripts/check-resource-usage-budget.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0153-resource-quantities-per-ride-are-counted-not-estimated.md`
 *
 * ## لماذا حَكَمٌ نقيٌّ منفصلٌ
 *
 * الرقمُ الاقتصاديُّ حاصلُ ضربِ **عددٍ** في **سعرٍ**. وسعرُ القاعدةِ والنسخِ
 * والطابورِ و`Redis` والتخزينِ والنقلِ الشبكيِّ **لا يملكُه المستودَعُ**:
 * التسعيرُ بيدِ مزوّدِ السحابةِ والمالكِ. **والعددُ** سلوكُ شيفرةٍ يُقاسُ ههنا.
 *
 * ## ما يقيسُه هذان المُحرِّكانِ (الزيادةُ الأولى)
 *
 * خمسةُ أسطحِ مواردَ تُقاسُ في رحلةٍ واحدةٍ على السِلكِ:
 *
 * ١) **القاعدةُ (PostgreSQL)**: صفوفٌ ممسوحةٌ (`tup_returned + tup_fetched`)
 *    وكُتَلٌ ملموسةٌ (`blks_read + blks_hit`) من `pg_stat_database` — وحدّةُ
 *    القياسِ عينُها التي اختارها `DEC-18` لأنَّها لا تتأثّرُ بجارِ المُنفِّذِ.
 *
 * ٢) **الطابورُ (Outbox)**: رسائلُ مُنتَجةٌ في `notification_outbox` + عروضٌ
 *    في `order_offers` — وكلُّ رسالةٍ في الطابورِ تكلفةُ نقلٍ وتخزينٍ مُؤجَّلةٌ.
 *
 * ٣) **Redis**: أوامرُ معدودةٌ من عميلٍ مُحقونٍ يَعُدُّ كلَّ نداءٍ — وحدّةُ
 *    القياسِ عينُها التي قاسَ بها `ECO-002` نداءاتِ التوجيه: العدُّ على السِلكِ.
 *
 * ٤) **النقلُ الشبكيُّ**: بايتاتُ أجسامِ ردودِ `HTTP` + بايتاتُ إطاراتِ القناةِ
 *    الآنيّةِ — وحدّةُ القياسِ عينُها التي قاسَ بها `F1-09` بياناتِ الجلسة.
 *
 * ٥) **التخزينُ**: صفوفٌ منطقيّةٌ مُدخَلةٌ في جداولِ الرحلةِ الرئيسةِ — وحدّةُ
 *    القياسِ عدُّ الصفوفِ لا قياسُ الحجمِ على القرصِ (ضوضاءُ تخصيصِ الصفحاتِ).
 *
 * ## ما لا يقيسُه هذان المُحرِّكانِ عن قصدٍ — ويُعلَنُ في الدليلِ
 *
 * - **لا تُقاسُ النسخُ (Replication)**: `WAL`/`LSN` غيرُ مستقرٍّ في CI
 *   (صورةُ `postgis/postgis:17-3.5` بلا `wal_level = logical`)، فلا يُدَّعى
 *   قياسُها — وتُترَكُ للزيادةِ الثانيةِ أو لبيئةِ نشرٍ شبيهةٍ بالإنتاجِ.
 * - **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ لا يملكُها
 *   المستودَعُ. فالمقيسُ **العددُ**، ومن ضربَه في سعرٍ حقيقيٍّ حصلَ على الفاتورةِ.
 * - **لا يُقاسُ سلوكُ مستخدمينَ حقيقيّينَ**: شكلُ النافذةِ مُعلَنٌ بسببِه لا
 *   مقيسٌ من نشرٍ حيٍّ (`ADR 0099`).
 * - **لا يُقاسُ ما لا يملكُه المستودَعُ**: `CDN` و`WAF` و`TLS` خارجُ نطاقِ
 *   الشيفرةِ — فلا يُدَّعى قياسُ النقلِ الشبكيِّ الكاملِ بل نصيبُ الشيفرةِ منه.
 */

/** ملفُّ القياسِ الوحيدُ الذي يعدُّ المواردَ على السِلكِ — يقرؤُه الحاجزُ. */
export const RESOURCE_USAGE_TEST_FILE = "tests/integration/resource-usage-budget.test.ts";

/**
 * حاجزُ سياسةِ تخزينِ المساراتِ (`CAP-012`) — سندٌ بنيويٌّ سابقٌ: القاعدةُ
 * «النسخُ يُقاسُ بالعملِ» (`DEC-18`) تفرضُ قياسَ `pg_stat_database`، وهذا
 * القياسُ يستوردُ وحدّتَها.
 */
export const SOAK_WORK_MEASURE_MODULE = "soak-work-measure";

/**
 * ملفُّ القياسِ السابقُ لبياناتِ الجلسةِ (`F1-09`) — سندٌ بنيويٌّ: قياسُ بايتاتِ
 * الردودِ والإطاراتِ مُستورَدٌ من وحدّتِه لا مُعادٌ بناؤُه.
 */
export const SESSION_DATA_BUDGET_MODULE = "session-data-budget";

/**
 * شكلُ نافذةِ القياسِ — **مُعلَنٌ بسببِه لا مقيسٌ من نشرٍ حيٍّ** (`ADR 0099`).
 *
 * والنافذةُ عشرُ دقائقَ لتُطابِقَ نافذةَ `ECO-002` و`ECO-003` و`F1-09` فيُقرأَ
 * القياسُ كلُّه على المحورِ عينِه.
 */
export interface ResourceUsageProfile {
  /** طولُ النافذةِ المقيسةِ بالمِلِّي ثانيةِ. */
  readonly windowMs: number;
  /**
   * عددُ نبضاتِ موقعِ السائقِ في النافذةِ — عينُ شكلِ `ECO-002` و`ECO-003`:
   * ستّونَ نبضةً في عشرِ دقائقَ (كلَّ عشرِ ثوانٍ) شكلٌ محافظٌ.
   */
  readonly heartbeatCount: number;
  /**
   * عددُ قراءاتِ الراكبِ لرحلتِه النشطةِ في النافذةِ — عينُ شكلِ `ECO-002`.
   */
  readonly activeReadCount: number;
  /**
   * عددُ رسائلِ الردودِ في الحوارِ — عينُ شكلِ `ECO-003`: ثمانيةُ تحديثاتٍ
   * واردةٍ تُنتِجُ ردوداً.
   */
  readonly inboundUpdateCount: number;
  /**
   * عددُ الانتقالاتِ بين الأطوارِ في دورةِ حياةِ الرحلةِ: `created` ← `matched`
   * ← `started` ← `completed` ← `rated`. خمسةُ انتقالاتٍ هيَ ما تفرضُه آلةُ
   * الحالاتِ اليومَ.
   */
  readonly lifecycleTransitionCount: number;
}

/** شكلُ النافذةِ المُعلَنُ الذي يُقاسُ عليهِ. */
export const RIDE_RESOURCE_PROFILE: ResourceUsageProfile = {
  windowMs: 10 * 60 * 1000,
  heartbeatCount: 60,
  activeReadCount: 8,
  inboundUpdateCount: 8,
  lifecycleTransitionCount: 5,
};

/**
 * سقفُ العملِ في القاعدةِ لكلِّ رحلةٍ **مُشتَقٌّ من الشكلِ لا مكتوبٌ رقماً**.
 *
 * `pg_stat_database` يَعُدُّ **كلَّ** صفٍّ مَسَّهُ أيُّ استعلامٍ في القاعدةِ — لا
 * صفوفَ الرحلةِ وحدَها — فيشملُ الوسيطَ (جلسةٌ + مصادقةٌ + صلاحيّاتٌ) ومنطقَ
 * الأعمالِ معاً. فالسقفُ يُشتَقُّ من **عددِ نداءاتِ API الإجماليِّ** لا من
 * دورةِ حياةِ الرحلةِ وحدَها: كلُّ نداءٍ يولِّدُ صفوفاً تتناسبُ مع تعقيدِ الرحلةِ
 * (تحديثاتٌ واردةٌ × انتقالاتُ حياةٍ) — فالسقفُ يُشتَقُّ من الشكلِ ويُحرسُ من نموٍّ
 * خطّيٍّ مع النبضاتِ.
 */
export function databaseRowBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  const totalApiCalls =
    profile.heartbeatCount + profile.activeReadCount + profile.lifecycleTransitionCount + 2;
  const rowsPerCall = profile.inboundUpdateCount * profile.lifecycleTransitionCount * 5;
  return totalApiCalls * rowsPerCall + 100;
}

/**
 * سقفُ الكُتَلِ الملموسةِ — مشتقٌّ من سقفِ الصفوفِ بنسبةِ ٠.٧٢ التي قِيسَت في
 * `DEC-18` (الكُتَلُ أقلُّ من الصفوفِ بسببِ التخزينِ المؤقّتِ). والنسبةُ ثابتةٌ
 * لا تتغيّرُ مع الشكلِ.
 */
export function databaseBlockBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  return Math.ceil(databaseRowBudget(profile) * 0.72);
}

/**
 * سقفُ رسائلِ الطابورِ لكلِّ رحلةٍ — مشتقٌّ من شكلِ `ECO-003`: العرضُ +
 * الانتقالاتُ + طلبُ التقييمِ. والطابورُ هنا `notification_outbox` +
 * `order_offers`.
 */
export function queueMessageBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  return profile.lifecycleTransitionCount + 2;
}

/**
 * سقفُ أوامرِ `Redis` لكلِّ رحلةٍ — مشتقٌّ من **جميعِ نداءاتِ API** في الرحلةِ:
 * النبضاتُ + القراءاتُ النشطةُ + الانتقالاتُ + الاقتباسُ والإنشاءُ. كلُّ نداءٍ
 * يَمَسُّ `Redis` مرّتَينِ تقريباً (جلسةٌ + حدٌّ)، و`+١٠` لتأسيسِ الحاويةِ.
 * والسقفُ يحرسُ من نموٍّ خطّيٍّ مع النبضاتِ.
 */
export function redisCommandBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  return (
    (profile.heartbeatCount + profile.activeReadCount + profile.lifecycleTransitionCount + 2) * 2 +
    10
  );
}

/**
 * سقفُ بايتاتِ النقلِ الشبكيِّ لكلِّ رحلةٍ — مشتقٌّ من شكلِ النافذةِ: الحملُ
 * الأوّلُ + القراءاتُ النشطةُ + الإطاراتُ. والسقفُ يحرسُ من نموِّ البايتاتِ بلا سببٍ.
 * والرقمُ محافظٌ (512 KB) لا مشتقٌّ من أبعادِ الإطاراتِ لأنَّ قياسَ الإطاراتِ
 * عملُ `F1-09` لا هذا — وههنا يُقاسُ مجموعُ الردودِ.
 */
export function networkByteBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  // السقفُ ثابتٌ لا يتغيّرُ بالشكلِ، لكنَّ الدالّةَ تأخذُه لاتّساقِ الواجهةِ.
  void profile;
  return 512 * 1024;
}

/**
 * سقفُ الصفوفِ المُدخَلةِ في التخزينِ لكلِّ رحلةٍ — مشتقٌّ من انتقالاتِ الحياةِ:
 * كلُّ انتقالٍ يُنشِئُ صفّاً أو يُحدِّثُه. والسقفُ يحرسُ من نموٍّ غيرِ مُبرَّرٍ.
 */
export function storageRowBudget(profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE): number {
  return profile.lifecycleTransitionCount * 4;
}

/** حقائقُ المواردِ كما تُقاسُ على السِلكِ — بلا تقديرٍ ولا اشتقاقٍ. */
export interface ResourceUsageFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرَأُ «صفرَ مواردَ». */
  readonly measured: boolean;
  /** الصفوفُ الممسوحةُ في القاعدةِ (`tup_returned + tup_fetched`). */
  readonly databaseRowsTouched: number;
  /** الكُتَلُ الملموسةُ في القاعدةِ (`blks_read + blks_hit`). */
  readonly databaseBlocksTouched: number;
  /** رسائلُ الطابورِ المُنتَجةُ (`notification_outbox` + `order_offers`). */
  readonly queueMessagesEnqueued: number;
  /** أوامرُ `Redis` المُنفَّذةُ من العميلِ المُحقونِ. */
  readonly redisCommandsExecuted: number;
  /** بايتاتُ النقلِ الشبكيِّ (أجسامُ ردودِ `HTTP` + إطاراتُ القناةِ). */
  readonly networkBytesTransferred: number;
  /** الصفوفُ المُدخَلةُ في التخزينِ (جداولُ الرحلةِ الرئيسةِ). */
  readonly storageRowsInserted: number;
  /** طولُ النافذةِ التي جرى فيها القياسُ. */
  readonly windowMs: number;
}

/** مخالفةٌ واحدةٌ: اسمُ قاعدةٍ وتفصيلُها. */
export interface ResourceUsageViolation {
  readonly rule: string;
  readonly detail: string;
}

/** أسماءُ قواعدِ الحَكَمِ — لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "facts.measured",
  "counts.sane",
  "database.within-budget",
  "queue.within-budget",
  "redis.within-budget",
  "network.within-budget",
  "storage.within-budget",
  "budget.derived",
  "window.declared",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

/** مدخلاتُ الحُكمِ — كلُّها محقونةٌ، ولا ساعةَ ولا قرصَ. */
export interface JudgeInputs {
  readonly facts: ResourceUsageFacts;
  readonly profile: ResourceUsageProfile;
  readonly databaseRowsBudget: number;
  readonly databaseBlocksBudget: number;
  readonly queueMessagesBudget: number;
  readonly redisCommandsBudget: number;
  readonly networkBytesBudget: number;
  readonly storageRowsBudget: number;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ،
 * **ولا تعني أنَّ التكلفةَ محسوبةٌ**.
 */
export function judgeResourceUsage(inputs: JudgeInputs): readonly ResourceUsageViolation[] {
  const violations: ResourceUsageViolation[] = [];
  const { facts, profile } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ. والأخضرُ الفارغُ أخطرُ من الأحمرِ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا صفرُ مواردَ.",
    });
  }

  // ٢) أعدادٌ غيرُ صحيحةٍ أو سالبةٌ تُبطِلُ كلَّ ما بعدَها.
  for (const [name, value] of [
    ["databaseRowsTouched", facts.databaseRowsTouched],
    ["databaseBlocksTouched", facts.databaseBlocksTouched],
    ["queueMessagesEnqueued", facts.queueMessagesEnqueued],
    ["redisCommandsExecuted", facts.redisCommandsExecuted],
    ["networkBytesTransferred", facts.networkBytesTransferred],
    ["storageRowsInserted", facts.storageRowsInserted],
  ] as const) {
    if (!isCount(value)) {
      violations.push({
        rule: "counts.sane",
        detail: `«${name}» ليسَ عدداً صحيحاً غيرَ سالبٍ: ${String(value)}.`,
      });
    }
  }

  // ٣) القاعدةُ: الصفوفُ الممسوحةُ ضمنَ السقفِ.
  if (facts.databaseRowsTouched > inputs.databaseRowsBudget) {
    violations.push({
      rule: "database.within-budget",
      detail: `${facts.databaseRowsTouched} صفّاً ممسوحاً يتجاوزُ السقفَ ${inputs.databaseRowsBudget}.`,
    });
  }

  // ٤) القاعدةُ: الكُتَلُ الملموسةُ ضمنَ السقفِ.
  if (facts.databaseBlocksTouched > inputs.databaseBlocksBudget) {
    violations.push({
      rule: "database.within-budget",
      detail: `${facts.databaseBlocksTouched} كتلةً ملموسةً يتجاوزُ السقفَ ${inputs.databaseBlocksBudget}.`,
    });
  }

  // ٥) الطابورُ: الرسائلُ المُنتَجةُ ضمنَ السقفِ.
  if (facts.queueMessagesEnqueued > inputs.queueMessagesBudget) {
    violations.push({
      rule: "queue.within-budget",
      detail: `${facts.queueMessagesEnqueued} رسالةَ طابورٍ يتجاوزُ السقفَ ${inputs.queueMessagesBudget}.`,
    });
  }

  // ٦) Redis: الأوامرُ ضمنَ السقفِ.
  if (facts.redisCommandsExecuted > inputs.redisCommandsBudget) {
    violations.push({
      rule: "redis.within-budget",
      detail: `${facts.redisCommandsExecuted} أمرَ Redis يتجاوزُ السقفَ ${inputs.redisCommandsBudget}.`,
    });
  }

  // ٧) النقلُ الشبكيُّ: البايتاتُ ضمنَ السقفِ.
  if (facts.networkBytesTransferred > inputs.networkBytesBudget) {
    violations.push({
      rule: "network.within-budget",
      detail: `${facts.networkBytesTransferred} بايتَ نقلٍ شبكيٍّ يتجاوزُ السقفَ ${inputs.networkBytesBudget}.`,
    });
  }

  // ٨) التخزينُ: الصفوفُ المُدخَلةُ ضمنَ السقفِ.
  if (facts.storageRowsInserted > inputs.storageRowsBudget) {
    violations.push({
      rule: "storage.within-budget",
      detail: `${facts.storageRowsInserted} صفّاً مُدخَلاً يتجاوزُ السقفَ ${inputs.storageRowsBudget}.`,
    });
  }

  // ٩) السقفُ مُشتَقٌّ لا مكتوبٌ: من كتبَهُ رقماً أكبرَ سقطَ.
  const derivedRows = databaseRowBudget(profile);
  const derivedBlocks = databaseBlockBudget(profile);
  const derivedQueue = queueMessageBudget(profile);
  const derivedRedis = redisCommandBudget(profile);
  const derivedNetwork = networkByteBudget(profile);
  const derivedStorage = storageRowBudget(profile);

  if (inputs.databaseRowsBudget !== derivedRows) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ الصفوفِ ${inputs.databaseRowsBudget} لا يُطابِقُ المُشتَقَّ ${derivedRows}.`,
    });
  }
  if (inputs.databaseBlocksBudget !== derivedBlocks) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ الكُتَلِ ${inputs.databaseBlocksBudget} لا يُطابِقُ المُشتَقَّ ${derivedBlocks}.`,
    });
  }
  if (inputs.queueMessagesBudget !== derivedQueue) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ الطابورِ ${inputs.queueMessagesBudget} لا يُطابِقُ المُشتَقَّ ${derivedQueue}.`,
    });
  }
  if (inputs.redisCommandsBudget !== derivedRedis) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ Redis ${inputs.redisCommandsBudget} لا يُطابِقُ المُشتَقَّ ${derivedRedis}.`,
    });
  }
  if (inputs.networkBytesBudget !== derivedNetwork) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ النقلِ ${inputs.networkBytesBudget} لا يُطابِقُ المُشتَقَّ ${derivedNetwork}.`,
    });
  }
  if (inputs.storageRowsBudget !== derivedStorage) {
    violations.push({
      rule: "budget.derived",
      detail: `سقفُ التخزينِ ${inputs.storageRowsBudget} لا يُطابِقُ المُشتَقَّ ${derivedStorage}.`,
    });
  }

  // ١٠) نافذةُ القياسِ هيَ النافذةُ المُعلَنةُ — لا أقصرَ تُخفي نمواً.
  if (facts.windowMs !== profile.windowMs) {
    violations.push({
      rule: "window.declared",
      detail: `نافذةُ القياسِ ${facts.windowMs} مِلِّي ثانيةٍ تُخالِفُ المُعلَنةَ ${profile.windowMs}.`,
    });
  }

  return violations;
}

/** وصفُ مخالفةٍ سطراً واحداً — للحاجزِ وللدليلِ. */
export function describeResourceUsageViolation(violation: ResourceUsageViolation): string {
  return `${violation.rule}: ${violation.detail}`;
}

/**
 * وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**: العددُ ليسَ تكلفةً.
 */
export function summarizeResourceUsage(facts: ResourceUsageFacts): string {
  return (
    `القاعدةُ: ${facts.databaseRowsTouched} صفّاً / ${facts.databaseBlocksTouched} كتلةً · ` +
    `الطابورُ: ${facts.queueMessagesEnqueued} رسالةً · ` +
    `Redis: ${facts.redisCommandsExecuted} أمراً · ` +
    `النقلُ: ${facts.networkBytesTransferred} بايتاً · ` +
    `التخزينُ: ${facts.storageRowsInserted} صفّاً. ` +
    "ولا يُدَّعى أنَّ هذا تكلفةٌ: العددُ مقيسٌ والسعرُ في فاتورةِ مزوّدِ سحابةٍ (REQ-09)."
  );
}
