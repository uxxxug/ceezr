/**
 * الغرض: **حَكَمٌ نقيٌّ** لحسّاسيّةِ شكلِ التكلفةِ عندَ ١٠x من حجمِ الرحلاتِ
 *   (`ECO-008` — الشقُّ المملوكُ للمستودَعِ): يحملُ شكلَ النافذةِ المُعلَنَ
 *   (نفسُ شكلِ `ECO-004` لكلِّ رحلةٍ × عشرةِ رحلاتٍ متتابعةٍ)، ويشتقُّ سقفَ كلِّ
 *   سطحٍ موردٍ عندَ الحجمِ من سقفِ الرحلةِ الواحدةِ **بالاستيرادِ لا بالنسخِ**
 *   (`scripts/lib/resource-usage-budget.ts` هو مصدرُ الحقيقةِ الواحدُ)، ويحكمُ على
 *   حقائقَ مقيسةٍ بقواعدَ لكلِّ واحدةٍ سالبةٌ مبذورةٌ.
 *
 * الحالة: منفّذ فعلياً — `ECO-008` (شكلُ الكمِّ عندَ الحجمِ — الشقُّ المملوكُ للمستودَعِ).
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `tests/integration/cost-sensitivity.test.ts` (القياسُ) ·
 *   `scripts/check-cost-sensitivity.ts` (الحاجزُ)
 * يحكمُه: `docs/adr/0156-cost-shape-sensitivity-at-10x-volume-is-measured-not-assumed.md`
 *
 * ## السؤالُ الذي يجيبُ عنه هذا الحَكَمُ — ولماذا هو شقٌّ مملوكٌ للمستودَعِ
 *
 * `ECO-008` يسألُ: «حسّاسيّةُ التكلفةِ: ماذا يحدثُ للتكلفةِ عندَ 10x من الحمل؟»
 * والتكلفةُ حاصلُ ضربِ **عددٍ** في **سعرٍ**. السعرُ في فاتورةِ مزوّدِ سحابةٍ لا
 * يملكُه المستودَعُ (`REQ-09` · `[!]`) — فلا يُحسَبُ ههنا ولا يُخترَعُ. أمّا
 * **شكلُ العددِ عندَ مضاعفةِ الحجمِ** فسلوكُ شيفرةٍ: هل تبقى مقاديرُ المواردِ
 * لكلِّ رحلةٍ ثابتةً (نموٌّ خطّيٌّ معَ الحجمِ) أم تتضخَّمُ (نموٌّ فائقُ الخطّيّةِ:
 * استعلامٌ يمسحُ جدولاً ينمو، أو حالةٌ تُجمَّعُ ولا تُفكُّ)؟ وهذا يُقاسُ لا
 * يُخمَّنُ: قياساتُ الرحلةِ الواحدةِ (`ECO-004`) تُبقي النموَّ الفائقَ خفيّاً لأنَّ
 * رحلةً واحدةً ترى جدولاً صغيراً وحالةً فتيّةً.
 *
 * ## ما يقيسُه هذا الحَكَمُ (الشقُّ المملوكُ للمستودَعِ)
 *
 * الأسطحُ الخمسةُ نفسُها التي قاسَها `ECO-004`، لكنَّها **مجمعةً على نافذةِ عشرِ
 * رحلاتٍ متتابعةٍ** في حاويةٍ واحدةٍ وبوّابةٍ واحدةٍ، وتُحاكَمُ بسقوفٍ حجميّةٍ
 * مُشتقّةٍ: الحجمُ × سقفُ الرحلةِ الواحدةِ — مستوردةً من `ECO-004` عينِهِ.
 *
 * ## ما لا يقيسُه هذا الحَكَمُ عن قصدٍ — ويُعلَنُ في الدليلِ
 *
 * - **لا يُدَّعى قياسُ حملٍ أو سعةٍ أو تزامنٍ**: الرحلاتُ العشرُ **متتابعةٌ** لا
 *   متزامنةٌ، ولا يُدَّعى إشباعُ `F9`/`F10`/`F11` ولا بوابةِ السعةِ ولا اقتصادُ
 *   الإنتاجِ — فذاكَ عملُ مختبرِ النشرِ (`DEC-17`). المقيسُ **شكلُ العددِ** لا
 *   قدرةُ النظامِ.
 * - **لا تُحسَبُ تكلفةٌ بالمالِ**: السعرُ في فاتورةِ مزوّدِ سحابةٍ لا يملكُها
 *   المستودَعُ (`REQ-09` · `[!]`).
 * - **لا يُدَّعى تثبيتُ سقوفِ الرحلةِ الواحدةِ**: ذاكَ حُكمُ `ECO-004` على
 *   رحلتِه؛ ههنا السقفُ مُعادُ الاشتقاقِ من حجمٍ مضروبٍ لا مُعادُ كتابتِهِ.
 * - **لا تُقاسُ النسخُ ولا سلوكُ مستخدمينَ حقيقيّينَ ولا `CDN`/`WAF`/`TLS`**:
 *   القيودُ المُعلَنةُ في `ECO-004` تنسحبُ ههنا حرفاً بحرفٍ.
 */

import {
  databaseBlockBudget,
  databaseRowBudget,
  networkByteBudget,
  queueMessageBudget,
  type ResourceUsageProfile,
  RIDE_RESOURCE_PROFILE,
  redisCommandBudget,
  storageRowBudget,
} from "./resource-usage-budget.ts";

/** ملفُّ القياسِ الوحيدُ الذي يقيسُ حسّاسيّةَ الحجمِ على السِلكِ — يقرؤُه الحاجزُ. */
export const COST_SENSITIVITY_TEST_FILE = "tests/integration/cost-sensitivity.test.ts";

/** ملفُّ سقوفِ الرحلةِ الواحدةِ — مصدرُ الحقيقةِ الواحدُ الذي يُستورَدُ ولا يُنسَخُ. */
export const RIDE_BUDGET_MODULE = "resource-usage-budget.ts";

/**
 * مُضاعِفُ الحجمِ المُعلَنُ: عشرُ رحلاتٍ. وهو رقمُ السؤالِ نفسُهِ (`ECO-008`
 * يسألُ عن 10x) — مُعلَنٌ بسببِهِ لا مُشتَقٌّ من نشرٍ حيٍّ.
 */
export const SENSITIVITY_VOLUME_MULTIPLIER = 10;

/** سقوفُ النافذةِ عندَ الحجمِ المُعلَنِ — كلُّها مضروبٌ من سقفِ الرحلةِ الواحدةِ. */
export interface VolumeBudgets {
  /** سقفُ الصفوفِ الممسوحةِ عندَ الحجمِ. */
  readonly databaseRows: number;
  /** سقفُ الكُتَلِ الملموسةِ عندَ الحجمِ. */
  readonly databaseBlocks: number;
  /** سقفُ رسائلِ الطابورِ عندَ الحجمِ. */
  readonly queueMessages: number;
  /** سقفُ أوامرِ `Redis` عندَ الحجمِ. */
  readonly redisCommands: number;
  /** سقفُ بايتاتِ النقلِ الشبكيِّ عندَ الحجمِ. */
  readonly networkBytes: number;
  /** سقفُ الصفوفِ المُدخَلةِ عندَ الحجمِ. */
  readonly storageRows: number;
}

/**
 * اشتقاقُ السقوفِ الحجميّةِ: الحجمُ × سقفُ الرحلةِ الواحدةِ — **بلا رقمٍ جديدٍ
 * يُكتَبُ ولا هامشٍ يُخترَعُ**. والثابتُ الوحيدُ داخلَ سقوفِ `ECO-004` (مثلُ `+10`
 * لتأسيسِ الحاويةِ في `Redis`) يُعَدُّ معَ كلِّ رحلةٍ لا مرّةً واحدةً، فيجعلُ
 * السقفَ الحجميَّ **أشدَّ لا أرخى** على النموِّ الفائقِ الخطّيّةِ — والانحرافُ
 * المُعلَنُ: السقفُ الحجميُّ يسمحُ بما يُقرأهُ من هامشِ الرحلةِ الواحدةِ مُضاعَفاً،
 * وهو أضيقُ من سقفٍ يُكتَبُ يدويّاً لأنَّهُ يتبعُ سقفَ الرحلةِ إن رُفِعَ أو ضُيِّقَ.
 */
export function volumeBudgets(
  multiplier: number = SENSITIVITY_VOLUME_MULTIPLIER,
  profile: ResourceUsageProfile = RIDE_RESOURCE_PROFILE,
): VolumeBudgets {
  return {
    databaseRows: multiplier * databaseRowBudget(profile),
    databaseBlocks: multiplier * databaseBlockBudget(profile),
    queueMessages: multiplier * queueMessageBudget(profile),
    redisCommands: multiplier * redisCommandBudget(profile),
    networkBytes: multiplier * networkByteBudget(profile),
    storageRows: multiplier * storageRowBudget(profile),
  };
}

/** حقائقُ النافذةِ الحجميّةِ كما تُقاسُ على السِلكِ — بلا تقديرٍ ولا اشتقاقٍ. */
export interface CostSensitivityFacts {
  /** أَجرى القياسُ فعلاً أم لا: قياسٌ لم يجرِ لا يُقرَأُ «ثباتاً». */
  readonly measured: boolean;
  /** عددُ الرحلاتِ المكتملةِ في النافذةِ — النافذةُ بلا حجمِها المُعلَنِ قياسٌ ناقصٌ. */
  readonly rideCount: number;
  /** الصفوفُ الممسوحةُ في القاعدةِ عبرَ النافذةِ كلِّها (`tup_returned + tup_fetched`). */
  readonly databaseRowsTouched: number;
  /** الكُتَلُ الملموسةُ في القاعدةِ عبرَ النافذةِ كلِّها. */
  readonly databaseBlocksTouched: number;
  /** رسائلُ الطابورِ المُنتَجةُ صافيًا عبرَ النافذةِ. */
  readonly queueMessagesEnqueued: number;
  /** أوامرُ `Redis` المُنفَّذةُ من العميلِ المُحقونِ عبرَ النافذةِ كلِّها. */
  readonly redisCommandsExecuted: number;
  /** بايتاتُ النقلِ الشبكيِّ (أجسامُ ردودِ `HTTP`) عبرَ النافذةِ كلِّها. */
  readonly networkBytesTransferred: number;
  /** الصفوفُ المُدخَلةُ في التخزينِ (جداولُ الرحلةِ الرئيسةِ) عبرَ النافذةِ. */
  readonly storageRowsInserted: number;
  /** طولُ النافذةِ المُعلَنِ = شكلُ الرحلةِ الواحدةِ × الحجمُ. */
  readonly windowMs: number;
}

/** مخالفةٌ واحدةٌ: اسمُ قاعدةٍ وتفصيلُها. */
export interface CostSensitivityViolation {
  readonly rule: string;
  readonly detail: string;
}

/** أسماءُ قواعدِ الحَكَمِ — لكلِّ واحدةٍ سالبةٌ مبذورةٌ (`ح-7`). */
export const JUDGE_RULE_NAMES = [
  "facts.measured",
  "counts.sane",
  "counts.nonempty",
  "volume.exact",
  "database.linear",
  "blocks.linear",
  "queue.linear",
  "redis.linear",
  "network.linear",
  "storage.linear",
  "budget.volume-derived",
  "window.declared",
] as const;

export type JudgeRuleName = (typeof JUDGE_RULE_NAMES)[number];

/** مدخلاتُ الحُكمِ — كلُّها محقونةٌ، ولا ساعةَ ولا قرصَ. */
export interface JudgeInputs {
  readonly facts: CostSensitivityFacts;
  readonly profile: ResourceUsageProfile;
  readonly multiplier: number;
  readonly budgets: VolumeBudgets;
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * الحُكمُ: من حقائقَ مقيسةٍ إلى قائمةِ مخالفاتٍ. قائمةٌ فارغةٌ = لا مخالفةَ،
 * **ولا تعني أنَّ التكلفةَ محسوبةٌ ولا أنَّ السعةَ مقيسةٌ**.
 */
export function judgeCostSensitivity(inputs: JudgeInputs): readonly CostSensitivityViolation[] {
  const violations: CostSensitivityViolation[] = [];
  const { facts, profile, multiplier } = inputs;

  // ١) قياسٌ لم يجرِ لا يُقرأُ أخضرَ. والأخضرُ الفارغُ أخطرُ من الأحمرِ.
  if (!facts.measured) {
    violations.push({
      rule: "facts.measured",
      detail: "الحقائقُ تقولُ إنَّ القياسَ لم يجرِ — والعجزُ عن القياسِ عطبٌ لا ثباتُ شكلٍ.",
    });
  }

  // ٢) أعدادٌ غيرُ صحيحةٍ أو سالبةٍ تُبطِلُ كلَّ ما بعدَها.
  for (const [name, value] of [
    ["rideCount", facts.rideCount],
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

  // ٣) سطوحٌ بلا أيِّ قياسٍ = قياسٌ لم يُشغِّلْ شيئاً — «الأخضرُ الفارغُ». والطابورُ
  //    وحدهُ مُعفًى: صافي الصفوفِ فيهِ قد يكونُ صفراً شرعيّاً (رسالةٌ تُستهلَكُ
  //    داخلَ النافذةِ) كما قاسَ `ECO-004` نفسُهُ في رحلةٍ واحدةٍ.
  if (
    facts.measured &&
    (facts.databaseRowsTouched === 0 ||
      facts.databaseBlocksTouched === 0 ||
      facts.redisCommandsExecuted === 0 ||
      facts.networkBytesTransferred === 0 ||
      facts.storageRowsInserted === 0)
  ) {
    violations.push({
      rule: "counts.nonempty",
      detail:
        "نافذةٌ مقيسةٌ بسطحٍ صفرِ الموردِ — قياسٌ لم يُشغِّلْ شيئاً يُقرأُ ثباتَ شكلٍ " +
        "(الصفوفُ أو الكُتَلُ أو Redis أو النقلُ أو التخزينُ = صفرٌ).",
    });
  }

  // ٤) الحجمُ هوَ المُعلَنُ: نافذةٌ لا تحملُ عشرَ رحلاتٍ مكتملةً ليست نافذةَ 10x.
  if (facts.rideCount !== multiplier) {
    violations.push({
      rule: "volume.exact",
      detail: `النافذةُ تحملُ ${String(facts.rideCount)} رحلةٍ والحجمُ المُعلَنُ ${String(multiplier)} — قياسٌ بحجمٍ آخرَ يجيبُ عن سؤالٍ آخرَ.`,
    });
  }

  // ٥..١٠) الخطّيّةُ: كلُّ سطحٍ تحتَ سقفِهِ الحجميِّ. والمفصَّلُ يقولُ نصيبَ الرحلةِ
  // الواحدةِ كي يُقرأَ الرقمُ لا أن يُصدَّقَ.
  if (facts.databaseRowsTouched > inputs.budgets.databaseRows) {
    violations.push({
      rule: "database.linear",
      detail: `${String(facts.databaseRowsTouched)} صفّاً (${Math.round(facts.databaseRowsTouched / Math.max(1, facts.rideCount))} لكلِّ رحلةٍ) يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.databaseRows)} — نموٌّ فائقُ الخطّيّةِ.`,
    });
  }
  if (facts.databaseBlocksTouched > inputs.budgets.databaseBlocks) {
    violations.push({
      rule: "blocks.linear",
      detail: `${String(facts.databaseBlocksTouched)} كتلةً (${Math.round(facts.databaseBlocksTouched / Math.max(1, facts.rideCount))} لكلِّ رحلةٍ) يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.databaseBlocks)} — نموٌّ فائقُ الخطّيّةِ.`,
    });
  }
  if (facts.queueMessagesEnqueued > inputs.budgets.queueMessages) {
    violations.push({
      rule: "queue.linear",
      detail: `${String(facts.queueMessagesEnqueued)} رسالةَ طابورٍ يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.queueMessages)}.`,
    });
  }
  if (facts.redisCommandsExecuted > inputs.budgets.redisCommands) {
    violations.push({
      rule: "redis.linear",
      detail: `${String(facts.redisCommandsExecuted)} أمرَ Redis (${Math.round(facts.redisCommandsExecuted / Math.max(1, facts.rideCount))} لكلِّ رحلةٍ) يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.redisCommands)}.`,
    });
  }
  if (facts.networkBytesTransferred > inputs.budgets.networkBytes) {
    violations.push({
      rule: "network.linear",
      detail: `${String(facts.networkBytesTransferred)} بايتَ نقلٍ يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.networkBytes)}.`,
    });
  }
  if (facts.storageRowsInserted > inputs.budgets.storageRows) {
    violations.push({
      rule: "storage.linear",
      detail: `${String(facts.storageRowsInserted)} صفَّ تخزينٍ يتجاوزُ السقفَ الحجميَّ ${String(inputs.budgets.storageRows)}.`,
    });
  }

  // ١١) السقوفُ الحجميّةُ مُشتقّةٌ لا مكتوبةٌ: من ضربَ رقماً أرخى سقطَ.
  const derived = volumeBudgets(multiplier, profile);
  for (const [name, given, expected] of [
    ["databaseRows", inputs.budgets.databaseRows, derived.databaseRows],
    ["databaseBlocks", inputs.budgets.databaseBlocks, derived.databaseBlocks],
    ["queueMessages", inputs.budgets.queueMessages, derived.queueMessages],
    ["redisCommands", inputs.budgets.redisCommands, derived.redisCommands],
    ["networkBytes", inputs.budgets.networkBytes, derived.networkBytes],
    ["storageRows", inputs.budgets.storageRows, derived.storageRows],
  ] as const) {
    if (given !== expected) {
      violations.push({
        rule: "budget.volume-derived",
        detail: `السقفُ الحجميُّ «${name}» ${String(given)} لا يُطابِقُ المُشتَقَّ ${String(expected)} — سقفٌ يُكتبُ يدويّاً ليسَ سقفَ الحجمِ المُعلَنِ.`,
      });
    }
  }

  // ١٢) نافذةُ القياسِ هيَ المُعلَنةُ: شكلُ الرحلةِ × الحجمُ — لا أقصرَ تُخفي نموّاً.
  const declaredWindowMs = profile.windowMs * multiplier;
  if (facts.windowMs !== declaredWindowMs) {
    violations.push({
      rule: "window.declared",
      detail: `نافذةُ القياسِ ${String(facts.windowMs)} مِلِّي ثانيةٍ تُخالِفُ المُعلَنةَ ${String(declaredWindowMs)} (شكلُ الرحلةِ × الحجمُ).`,
    });
  }

  return violations;
}

/** وصفُ القياسِ سطراً واحداً — **ويقولُ ما لا يُدَّعى**: الثباتُ ليسَ فاتورةً. */
export function summarizeCostSensitivity(facts: CostSensitivityFacts): string {
  const perRide = Math.max(1, facts.rideCount);
  return (
    `الحجمُ: ${String(facts.rideCount)} رحلاتٍ · ` +
    `القاعدةُ: ${String(facts.databaseRowsTouched)} صفّاً (${Math.round(facts.databaseRowsTouched / perRide)}/رحلةٍ) / ` +
    `${String(facts.databaseBlocksTouched)} كتلةً (${Math.round(facts.databaseBlocksTouched / perRide)}/رحلةٍ) · ` +
    `الطابورُ: ${String(facts.queueMessagesEnqueued)} رسالةً · ` +
    `Redis: ${String(facts.redisCommandsExecuted)} أمراً (${Math.round(facts.redisCommandsExecuted / perRide)}/رحلةٍ) · ` +
    `النقلُ: ${String(facts.networkBytesTransferred)} بايتاً · ` +
    `التخزينُ: ${String(facts.storageRowsInserted)} صفّاً. ` +
    "ولا يُدَّعى أنَّ هذا فاتورةً ولا قياسَ سعةٍ: الشكلُ مقيسٌ والسعرُ في فاتورةِ مزوّدِ سحابةٍ (REQ-09)، " +
    "والرحلاتُ متتابعةٌ لا متزامنةٌ ولا تُدَّعى بوابةَ السعةِ."
  );
}
