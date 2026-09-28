/**
 * الدوالُّ الصرفةُ لخطةِ الحملِ الموزَّعِ — `F9-03` · `OPS-004`.
 *
 * وُضِعَت ههنا (لا في `deferred/`) للقاعدةِ نفسِها التي في
 * `bench-seed-fingerprint.ts`: الشجرةُ الحيّةُ لا تستوردُ من `deferred/`
 * (`S-2` · `ADR 0095`)، والاختباراتُ والحاجزُ يحتاجانِ هذهِ الدوالَ، فتسكنُ
 * ههنا ويستوردُها `deferred/field-experiments/bench/distributed/` لا العكس.
 *
 * ## ما الذي يجعلُ الحملَ «موزَّعاً» هنا
 *
 * البندُ يطلبُ ثلاثةً: مولّداتٍ في عملياتٍ/مضيفينَ منفصلينَ، ومنسّقاً عالميّاً،
 * وبصمةَ إعداداتٍ مع كلِّ تشغيلٍ. والأولانِ بنيةُ تشغيلٍ (عملياتٌ حقيقيّةٌ
 * يتحدثُ بعضُها إلى بعضٍ عبرَ الشبكةِ لا خيوطٌ في عمليةٍ واحدةٍ)، والثالثُ
 * دالةٌ صرفةٌ تُحسَبُ من الخطةِ وحدَها. فهذهِ المكتبةُ تملكُ: **تقسيمَ الخطةِ
 * تقسيماً حتميّاً** بينَ المولّداتِ (لا قرعةً ولا توقيتاً)، و**بصمةَ الخطةِ**،
 * و**حَكَمَ الجولةِ** — قواعدَ خالصةً تُفشِلُ التشغيلَ إذا اختفى مولّدٌ أو
 * كذبَ في بصمتِهِ أو أطلقَ أقلَّ مما جُدِّلَ له.
 *
 * ## ما لا تفعلهُ هذهِ المكتبةُ عن قصدٍ
 *
 * - **لا تُشغِّلُ شيئاً.** التشغيلُ في `bench/distributed/` — عملياتٌ حقيقيّةٌ.
 * - **لا تعرفُ الشبكةَ.** كلُّ مدخلاتِها قيمٌ مُعلَنةٌ أو تقاريرُ وصلتْها.
 * - **لا تدّعي السعةَ.** إطلاقُ الحملِ الموزَّعِ بنيةُ قياسٍ لا رقمُ سعةٍ؛
 *   رقمُ السعةِ بندُ `F10` ولا يُستنتجُ من ههنا (`ح-5`).
 */

import { createHash } from "node:crypto";

/** خطةُ جولةِ حملٍ موزَّعةٍ واحدةٍ — المدخلُ الوحيدُ لكلِّ الحساباتِ. */
export interface DistributedLoadPlan {
  /** الهدفُ الذي تُطلقُ عليهِ المولّداتُ طلباتِها (URL كاملٌ). */
  readonly target: string;
  /** طريقةُ الطلبِ (`GET`/`POST`/…) — جزءٌ من البصمةِ لا تفصيلٍ شكليٍّ. */
  readonly method: string;
  /** مجموعُ معدلِ الوصولِ المطلوبِ عبرَ المولّداتِ كلِّها (محاولة/ثانية). */
  readonly arrivalRatePerSecond: number;
  /** نافذةُ الإطلاقِ بالميلي ثانية. */
  readonly durationMs: number;
  /** عددُ المولّداتِ المتوقَّعةِ — عقدُ الجولةِ: منهم من يُنتظرُ ومنهم من يُحاسَبُ. */
  readonly generators: number;
  /**
   * سقفُ انزلاقِ الجدولةِ المقبولِ لكلِّ مولّدٍ (p95 بالميلي ثانية). جزءٌ من
   * الخطةِ المُبصَّمةِ لا حدٍّ سريٍّ: من غيّرَ السقفَ غيّرَ البصمةَ.
   */
  readonly schedulingLagBudgetP95Ms: number;
}

/** حصةُ مولّدٍ واحدٍ من الخطةِ — اشتقاقٌ حتميٌّ لا تفاوضَ عليهِ. */
export interface GeneratorPartition {
  /** فهرسُ المولّدِ — من ٠ إلى `generators-1` ولا يتكرَّرُ داخلَ الجولةِ. */
  readonly index: number;
  /** معدلُ وصولِ هذا المولّدِ (محاولة/ثانية) — مجموعُ الحصصِ = المعدلُ الكلّيُّ. */
  readonly arrivalRatePerSecond: number;
  readonly durationMs: number;
  /** عددُ المحاولاتِ المجدولةِ لهذا المولّدِ — يُحاسَبُ التقريرُ عليهِ. */
  readonly scheduledCount: number;
}

/**
 * بصمةُ الخطةِ — `OPS-004`: «بصمةُ إعداداتٍ مع كلِّ تشغيلٍ». الخطةُ كلُّها
 * (الهدفُ والطريقةُ والمعدلُ والمدةُ والعددُ والسقفُ) تدخلُ البصمةَ، فتغييرُ
 * أيِّ عنصرٍ يُنتجُ بصمةً مختلفةً — والتقريرُ الذي لا يحملُ بصمةَ جولتِهِ
 * مرفوضٌ في الحَكَمِ لا مقبولٌ بالتسامحِ.
 */
export function computeDistributedLoadFingerprint(plan: DistributedLoadPlan): string {
  assertPositiveFinite("arrivalRatePerSecond", plan.arrivalRatePerSecond);
  assertPositiveFinite("durationMs", plan.durationMs);
  assertPositiveInteger("generators", plan.generators);
  assertPositiveFinite("schedulingLagBudgetP95Ms", plan.schedulingLagBudgetP95Ms);
  return createHash("sha256")
    .update(
      JSON.stringify({
        target: new URL(plan.target).toString(),
        method: plan.method.toUpperCase(),
        arrivalRatePerSecond: plan.arrivalRatePerSecond,
        durationMs: plan.durationMs,
        generators: plan.generators,
        schedulingLagBudgetP95Ms: plan.schedulingLagBudgetP95Ms,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * تقسيمُ الخطةِ على مولّدٍ بالفهرسِ — حتميٌّ: الخطةُ والفهرسُ نفسُهما يُنتجانِ
 * الحصةَ نفسَها دائماً. المعدلُ الكلّيُّ يُقسَّمُ بالتساوي، والباقي (إن وُجدَ
 * لأنَّ المعدلَ لا ينقسمُ على العددِ) يُمنحُ للمولّداتِ الأولى بالترتيبِ —
 * فالتوزيعُ قابلٌ للإعادةِ والمجموعُ محسوبٌ لا مُقدَّرٌ.
 */
export function partitionForGenerator(
  plan: DistributedLoadPlan,
  index: number,
): GeneratorPartition {
  assertPositiveInteger("generators", plan.generators);
  if (!Number.isInteger(index) || index < 0 || index >= plan.generators) {
    throw new Error(
      `[bench-distributed] فهرسُ المولّدِ خارجُ النطاقِ: ${index} (المتوقَّعُ 0..${plan.generators - 1})`,
    );
  }
  // الباقي بالمحاولاتِ لا بالكسورِ: العددُ الصحيحُ من المحاولاتِ في الثانيةِ
  // يوزَّعُ على الأوائلِ بالترتيبِ، فلا يضيعَ جزءٌ من الحملِ في تقريبِ فاصلةٍ
  // عائمةٍ، والتوزيعَ قابلٌ للإعادةِ والمجموعُ محسوبٌ لا مُقدَّرٌ.
  const totalPerSecond = Math.max(1, Math.round(plan.arrivalRatePerSecond));
  const wholePerGenerator = Math.floor(totalPerSecond / plan.generators);
  const remainder = totalPerSecond % plan.generators;
  const ratePerSecond = wholePerGenerator + (index < remainder ? 1 : 0);
  const scheduledCount = Math.ceil((ratePerSecond * plan.durationMs) / 1_000);
  return {
    index,
    arrivalRatePerSecond: ratePerSecond,
    durationMs: plan.durationMs,
    scheduledCount,
  };
}

/** تقريرُ مولّدٍ واحدٍ كما يصلُ المنسّقَ — بصمةٌ وتقريرُ الحلقةِ المفتوحةِ. */
export interface GeneratorReport {
  readonly generatorId: string;
  readonly index: number;
  /** بصمةُ الخطةِ كما عرفَها المولّدُ — لا كما يشتهيها المنسّقُ. */
  readonly fingerprint: string;
  /** ما جدولهُ المولّدُ فعلاً (لا ما جُدِّلَ لهُ) — من مخرجاتِ `runOpenLoop`. */
  readonly scheduled: number;
  readonly launched: number;
  readonly failed: number;
  /** p95 انزلاقِ الجدولةِ بالميلي ثانيةِ من تقريرِ المولّدِ. */
  readonly schedulingLagP95Ms: number;
}

export interface DistributedLoadVerdictRule {
  readonly rule: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface DistributedLoadVerdict {
  readonly passed: boolean;
  readonly rules: readonly DistributedLoadVerdictRule[];
}

/**
 * حَكَمُ جولةِ الحملِ الموزَّعِ — خالصٌ بستِّ قواعدَ، كلُّ واحدةٍ قابلةٌ
 * للإخفاقِ فعلاً (ولها سالبةٌ مزروعةٌ في الاختبارِ — `ح-7`):
 *
 * 1. `all-generators-reported`: كلُّ المولّداتِ المُعلَّنةِ أبلغت — مولّدٌ ماتَ
 *    أو غابَ يُفشِلُ الجولةَ باسمِهِ لا يُسكَتُ عنهُ (لا خسارةَ صامتةَ).
 * 2. `fingerprint-agreement`: كلُّ تقريرٍ يحملُ بصمةَ الخطةِ — تقريرٌ ببصمةٍ
 *    أخرى دليلُ جولةٍ مختلفةٍ أو كذبٍ، ومرفوضٌ.
 * 3. `partition-integrity`: كلُّ مولّدٍ أعلنَ ما جدولهُ التقسيمُ الحتميُّ لهُ
 *    (المجموعُ محسوبٌ لا مُقدَّرٌ).
 * 4. `schedule-honored`: ما جُدِّلَ أُطلقَ — المولّدُ الذي أطلقَ أقلَّ مما
 *    جدَّلَهُ أخلَّ بقانونِ الحلقةِ المفتوحةِ.
 * 5. `no-transport-errors`: صفرَ أخطاءِ نقلٍ — خطأُ نقلٍ واحدٌ يُفشِلُ الجولةَ.
 * 6. `scheduling-lag-bounded`: انزلاقُ جدولةِ كلِّ مولّدٍ (p95) ضمنَ السقفِ
 *    المُعلَّنِ في الخطةِ المُبصَّمةِ.
 */
export function decideDistributedLoadVerdict(
  plan: DistributedLoadPlan,
  reports: readonly GeneratorReport[],
): DistributedLoadVerdict {
  const fingerprint = computeDistributedLoadFingerprint(plan);
  const rules: DistributedLoadVerdictRule[] = [];

  const byIndex = new Map<number, GeneratorReport>();
  for (const report of reports) {
    if (report.index >= 0 && report.index < plan.generators && !byIndex.has(report.index)) {
      byIndex.set(report.index, report);
    }
  }
  const missing: number[] = [];
  for (let index = 0; index < plan.generators; index += 1) {
    if (!byIndex.has(index)) missing.push(index);
  }
  rules.push({
    rule: "all-generators-reported",
    passed: missing.length === 0,
    detail:
      missing.length === 0
        ? `كلُّ ${plan.generators} مولّداً أبلغَ تقريرَه.`
        : `مولّداتٌ لم تُبلِّغْ (فهرسُها): ${missing.join("، ")} — لا خسارةَ صامتةَ في جولةِ قياس.`,
  });

  const foreignFingerprints = reports.filter((report) => report.fingerprint !== fingerprint);
  rules.push({
    rule: "fingerprint-agreement",
    passed: foreignFingerprints.length === 0,
    detail:
      foreignFingerprints.length === 0
        ? `بصمةُ الخطةِ واحدةٌ في كلِّ التقاريرِ (${fingerprint}).`
        : `تقاريرُ ببصمةٍ أجنبيّةٍ: ${foreignFingerprints
            .map((report) => `${report.generatorId}=${report.fingerprint}`)
            .join("، ")}`,
  });

  const partitionViolations: string[] = [];
  let totalScheduled = 0;
  for (const report of reports) {
    const partition = safePartition(plan, report.index);
    if (partition === null) {
      partitionViolations.push(`${report.generatorId}: فهرسٌ خارجُ الخطةِ (${report.index})`);
      continue;
    }
    totalScheduled += report.scheduled;
    if (report.scheduled !== partition.scheduledCount) {
      partitionViolations.push(
        `${report.generatorId}: أعلنَ ${report.scheduled} والمقصودُ ${partition.scheduledCount}`,
      );
    }
  }
  rules.push({
    rule: "partition-integrity",
    passed: partitionViolations.length === 0,
    detail:
      partitionViolations.length === 0
        ? `كلُّ حصةٍ أُعلِنت كما قُسِّمت (المجموعُ ${totalScheduled} محاولةً).`
        : partitionViolations.join("؛ "),
  });

  const launchShortfalls = reports.filter((report) => report.launched < report.scheduled);
  rules.push({
    rule: "schedule-honored",
    passed: launchShortfalls.length === 0,
    detail:
      launchShortfalls.length === 0
        ? "كلُّ ما جُدِّلَ أُطلقَ."
        : `مولّداتٌ أطلقتْ أقلَّ مما جدَّلتْ: ${launchShortfalls
            .map((report) => `${report.generatorId} أطلقَ ${report.launched} من ${report.scheduled}`)
            .join("، ")}`,
  });

  const totalFailed = reports.reduce((sum, report) => sum + report.failed, 0);
  rules.push({
    rule: "no-transport-errors",
    passed: totalFailed === 0,
    detail:
      totalFailed === 0
        ? "صفرَ أخطاءِ نقلٍ."
        : `${totalFailed} خطأَ نقلٍ في الجولةِ — الجولةُ باطلةٌ لا «نجاحٌ بشروحٍ».`,
  });

  const lagViolations = reports.filter(
    (report) => report.schedulingLagP95Ms > plan.schedulingLagBudgetP95Ms,
  );
  rules.push({
    rule: "scheduling-lag-bounded",
    passed: lagViolations.length === 0,
    detail:
      lagViolations.length === 0
        ? `انزلاقُ الجدولةِ (p95) لكلِّ مولّدٍ ضمنَ السقفِ (${plan.schedulingLagBudgetP95Ms}ms).`
        : `مولّداتٌ تجاوزَ سقفَ الانزلاقِ: ${lagViolations
            .map((report) => `${report.generatorId}=${report.schedulingLagP95Ms.toFixed(3)}ms`)
            .join("، ")}`,
  });

  return { passed: rules.every((rule) => rule.passed), rules };
}

function safePartition(plan: DistributedLoadPlan, index: number): GeneratorPartition | null {
  try {
    return partitionForGenerator(plan, index);
  } catch {
    return null;
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[bench-distributed] ${name} يجبُ أن يكونَ رقماً موجباً منتهياً، ووصلَ: ${value}`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[bench-distributed] ${name} يجبُ أن يكونَ عدداً صحيحاً موجباً، ووصلَ: ${value}`);
  }
}
