/**
 * الغرض: مشغّل الجوبات: يعرف ماذا يُشغَّل ومتى، ويعزل كل مهمّة عن أخواتها فلا يُسقط
 *   عطلُ واحدة الحلقة كلّها، ولا يبدأ شوطاً جديداً لمهمّة لم ينتهِ شوطها السابق.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات المشغّل
 * ملاحظات مستقبلية: مع تعدّد نسخ العامل يلزم قفل موزَّع (Redis) قبل تشغيل نسختين.
 */

import type { Clock } from "../../../packages/shared/kernel/index.ts";

export interface JobDefinition {
  readonly name: string;
  /** كل كم ثانية يُشغَّل. */
  readonly everySeconds: number;
  /**
   * لا ترمي: المهمّة مسؤولة عن ترجمة فشلها إلى سطر سجلّ. لكن إن رمت رغم ذلك
   * فالمشغّل يلتقطها ويستمرّ — مهمّة معطوبة لا يجوز أن تُوقف بقية النظام.
   */
  run(): Promise<string>;
  /** هل يُشغَّل مرّة عند الإقلاع قبل انتظار أول دورة. */
  readonly runOnStart?: boolean;
}

export interface JobLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface JobRunnerOptions {
  readonly jobs: readonly JobDefinition[];
  readonly clock: Clock;
  readonly log: JobLogger;
  /** كل كم مللي ثانية تُفحَص المهامّ المستحقّة. لا علاقة له بتواتر المهامّ نفسها. */
  readonly tickMs?: number;
}

export interface JobOutcome {
  readonly name: string;
  readonly status: "ran" | "skipped_not_due" | "skipped_overlapping" | "failed";
  readonly durationMs: number;
  readonly detail: string | null;
}

export interface JobRunner {
  /**
   * يُشغّل ما استحقّ في هذه اللحظة ويعيد نتيجة كل مهمّة. مكشوفة للاختبار عن قصد:
   * اختبار الجدولة بانتظار ساعة حقيقية اختبارٌ لا يُشغَّل، فيصبح اختباراً لا وجود له.
   */
  runDue(): Promise<readonly JobOutcome[]>;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

const DEFAULT_TICK_MS = 10_000;

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const lastRunMs = new Map<string, number>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function isDue(job: JobDefinition, nowMs: number): boolean {
    const last = lastRunMs.get(job.name);
    if (last === undefined) return job.runOnStart === true;
    return nowMs - last >= job.everySeconds * 1000;
  }

  async function runOne(job: JobDefinition, nowMs: number): Promise<JobOutcome> {
    // الحماية من التراكب أهمّ ممّا تبدو: مهمّة تأخذ دقيقتين وتواترها دقيقة تُنتج
    // نسختين متزامنتين تتنافسان على نفس الصفوف — وهذا مصدر أقفال متبادلة حقيقي.
    if (inFlight.has(job.name)) {
      return { name: job.name, status: "skipped_overlapping", durationMs: 0, detail: null };
    }

    inFlight.add(job.name);
    const startedAt = options.clock.now().getTime();

    try {
      const detail = await job.run();
      lastRunMs.set(job.name, nowMs);
      const durationMs = options.clock.now().getTime() - startedAt;
      options.log.info("job.ran", { job: job.name, durationMs, detail });
      return { name: job.name, status: "ran", durationMs, detail };
    } catch (error) {
      // التوقيت يُسجَّل حتى عند الفشل: مهمّة تفشل كل مرّة لا يجوز أن تُشغَّل في
      // كل نبضة، وإلّا صارت هجوماً على القاعدة بدل أن تكون مهمّة دورية.
      lastRunMs.set(job.name, nowMs);
      const durationMs = options.clock.now().getTime() - startedAt;
      const detail = error instanceof Error ? error.message : String(error);
      options.log.error("job.failed", { job: job.name, durationMs, detail });
      return { name: job.name, status: "failed", durationMs, detail };
    } finally {
      inFlight.delete(job.name);
    }
  }

  async function runDue(): Promise<readonly JobOutcome[]> {
    const nowMs = options.clock.now().getTime();
    const outcomes: JobOutcome[] = [];

    // المهامّ المستحقّة تُشغَّل متوازية: مهمّة بطيئة لا يجوز أن تؤخّر أختها المستحقّة
    // في نفس النبضة، خصوصاً وأن إنهاء العروض المنتهية حسّاسٌ للتأخير.
    const due = options.jobs.filter((job) => isDue(job, nowMs));
    const notDue = options.jobs.filter((job) => !isDue(job, nowMs));

    for (const job of notDue) {
      outcomes.push({ name: job.name, status: "skipped_not_due", durationMs: 0, detail: null });
    }

    const results = await Promise.all(due.map((job) => runOne(job, nowMs)));
    outcomes.push(...results);
    return outcomes;
  }

  return {
    runDue,

    get running() {
      return timer !== null;
    },

    start: () => {
      if (timer !== null) return;
      options.log.info("runner.started", {
        jobs: options.jobs.map((job) => `${job.name}@${job.everySeconds}s`),
        tickMs,
      });
      timer = setInterval(() => {
        void runDue();
      }, tickMs);
      // نبضة فورية حتى تعمل مهامّ runOnStart بلا انتظار أول فاصل.
      void runDue();
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      options.log.info("runner.stopped", {});
    },
  };
}
