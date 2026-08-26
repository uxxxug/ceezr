/**
 * الغرض: نواةُ مولّدِ حملٍ مفتوحِ الحلقة: تُطلق الطلباتِ حسب ساعةِ وصولٍ معلنة،
 *        لا حسب اكتمال الطلب السابق، وتُسجّل انزلاق الجدولة والنتائج كاملةً.
 * الحالة: منفّذ فعلياً — وحدة 2-3 من استعادة محيط القياس.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: bench/run-open-loop.ts وخط أساس القياس في الوحدة 2-4.
 * ملاحظات مستقبلية: هذه النواة تقيس الوصول إلى هدف HTTP واحد؛ مزيجُ حركة العمل
 *        ومعايير سعة المنتج لا يُستنتجان منها ويُعلنان في وحدةٍ لاحقة.
 */

export interface OpenLoopClock {
  /** ساعةٌ رتيبة بالميلي ثانية، لا ساعةٌ حائطية قابلة للقفز. */
  readonly now: () => number;
  /** انتظارُ زمنٍ موجب؛ يُحقن في الاختبار كي لا يعتمد الحكم على توقيت جهاز CI. */
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface OpenLoopAttempt {
  readonly scheduledAtMs: number;
  readonly launchedAtMs: number;
  readonly completedAtMs: number;
  readonly status: number | null;
  readonly error: string | null;
}

export interface OpenLoopWorkloadResult {
  readonly status: number;
}

export type OpenLoopWorkload = (attempt: number) => Promise<OpenLoopWorkloadResult>;

export interface OpenLoopOptions {
  /** عددُ محاولات البدء في الثانية؛ ليس عدداً متزامناً ولا هدفَ throughput. */
  readonly arrivalRatePerSecond: number;
  /** نافذةُ إطلاق الطلبات. الطلبات التي بدأت قبل نهايتها تُنتظر حتى تنتهي أو تفشل. */
  readonly durationMs: number;
  readonly workload: OpenLoopWorkload;
  readonly clock?: OpenLoopClock;
}

export interface DistributionSummary {
  readonly count: number;
  readonly minMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface OpenLoopReport {
  readonly startedAtMs: number;
  readonly schedulingFinishedAtMs: number;
  readonly completedAtMs: number;
  readonly configuredArrivalRatePerSecond: number;
  readonly configuredDurationMs: number;
  readonly scheduled: number;
  readonly launched: number;
  readonly completed: number;
  readonly failed: number;
  readonly maxInFlight: number;
  /** معدل الإطلاق المرصود من بداية التجربة إلى آخر طلب أطلقه المولّد، لا throughput. */
  readonly observedLaunchRatePerSecond: number;
  /** تأخر الإطلاق عن موعده المخطط؛ رقم موجب يكشف أن المولّد نفسه لم يحافظ على الحمل. */
  readonly schedulingLag: DistributionSummary;
  /** زمن الطلب من لحظة الإطلاق حتى نجاح HTTP أو فشل النقل. */
  readonly latency: DistributionSummary;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, number>>;
  readonly attempts: readonly OpenLoopAttempt[];
}

const systemClock: OpenLoopClock = {
  now: () => performance.now(),
  sleep: async (milliseconds) => Bun.sleep(milliseconds),
};

/** يعيد مواعيد الوصول النسبية؛ وجودها كدالة نقية يجعل قانون المعدل قابلاً للفحص الحتمي. */
export function buildArrivalSchedule(
  arrivalRatePerSecond: number,
  durationMs: number,
): readonly number[] {
  assertPositiveFinite("arrivalRatePerSecond", arrivalRatePerSecond);
  assertPositiveFinite("durationMs", durationMs);

  const intervalMs = 1_000 / arrivalRatePerSecond;
  const count = Math.ceil(durationMs / intervalMs);
  return Array.from({ length: count }, (_unused, index) => index * intervalMs);
}

/**
 * يطلق كل محاولة عند موعدها مهما بقيت المحاولات السابقة قيد التنفيذ. هذا هو الفرق
 * المقصود عن حلقةٍ مغلقة: لا يوجد `await workload` في مسار الإطلاق.
 */
export async function runOpenLoop(options: OpenLoopOptions): Promise<OpenLoopReport> {
  const clock = options.clock ?? systemClock;
  const schedule = buildArrivalSchedule(options.arrivalRatePerSecond, options.durationMs);
  const startedAtMs = clock.now();
  const attempts: OpenLoopAttempt[] = [];
  let launched = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  const running: Promise<void>[] = [];
  for (const offsetMs of schedule) {
    const dueAtMs = startedAtMs + offsetMs;
    const remainingMs = dueAtMs - clock.now();
    if (remainingMs > 0) await clock.sleep(remainingMs);

    const launchedAtMs = clock.now();
    const index = launched;
    launched += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    const pending = options
      .workload(index)
      .then((result) => {
        attempts.push({
          scheduledAtMs: dueAtMs,
          launchedAtMs,
          completedAtMs: clock.now(),
          status: result.status,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        attempts.push({
          scheduledAtMs: dueAtMs,
          launchedAtMs,
          completedAtMs: clock.now(),
          status: null,
          error: formatError(cause),
        });
      })
      .finally(() => {
        inFlight -= 1;
      });
    running.push(pending);
  }

  const schedulingFinishedAtMs = clock.now();
  await Promise.all(running);
  const completedAtMs = clock.now();

  const ordered = [...attempts].sort((left, right) => left.scheduledAtMs - right.scheduledAtMs);
  const lags = ordered.map((attempt) => Math.max(0, attempt.launchedAtMs - attempt.scheduledAtMs));
  const latencies = ordered.map((attempt) =>
    Math.max(0, attempt.completedAtMs - attempt.launchedAtMs),
  );
  const statusCounts: Record<string, number> = {};
  const errors: Record<string, number> = {};
  for (const attempt of ordered) {
    if (attempt.status !== null) {
      const key = String(attempt.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
    }
    if (attempt.error !== null) errors[attempt.error] = (errors[attempt.error] ?? 0) + 1;
  }

  const launchWindowMs = Math.max(1, schedulingFinishedAtMs - startedAtMs);
  return {
    startedAtMs,
    schedulingFinishedAtMs,
    completedAtMs,
    configuredArrivalRatePerSecond: options.arrivalRatePerSecond,
    configuredDurationMs: options.durationMs,
    scheduled: schedule.length,
    launched,
    completed: ordered.length,
    failed: ordered.filter((attempt) => attempt.error !== null).length,
    maxInFlight,
    observedLaunchRatePerSecond: (ordered.length * 1_000) / launchWindowMs,
    schedulingLag: summarizeDistribution(lags),
    latency: summarizeDistribution(latencies),
    statusCounts,
    errors,
    attempts: ordered,
  };
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, minMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    meanMs: sum / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[bench/open-loop] ${name} يجب أن يكون رقماً موجباً منتهياً، ووصل: ${value}`);
  }
}

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
