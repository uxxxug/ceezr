/**
 * الغرض: مشغّل الجوبات: يعرف ماذا يُشغَّل ومتى، ويعزل كل مهمّة عن أخواتها فلا يُسقط
 *   عطلُ واحدة الحلقة كلّها، ولا يبدأ شوطاً جديداً لمهمّة لم ينتهِ شوطها السابق.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات المشغّل
 * ملاحظات مستقبلية: القفل الموزَّع مُطبَّق هنا في المشغّل لا في كل مهمّة، فمهمّة جديدة
 *   تُحمى بمجرّد تسجيلها. أيّ تنفيذ آخر للقفل (Redis مثلاً) يدخل من نفس المنفذ.
 */

import type { DistributedLock } from "../../../packages/application/scheduling/distributed-lock.ts";
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
  /**
   * القفل الموزَّع. موضعه هنا — في المشغّل لا في كل مهمّة — قرار مقصود: لو كان على
   * كل مهمّة أن تقفل نفسها، لكانت أوّل مهمّة جديدة يكتبها أحدٌ في المستقبل بلا قفل،
   * وما كان أحد سيلاحظ حتى تُنفَّذ مرّتين في الإنتاج.
   */
  readonly lock: DistributedLock;
  /** كل كم مللي ثانية تُفحَص المهامّ المستحقّة. لا علاقة له بتواتر المهامّ نفسها. */
  readonly tickMs?: number;
  /**
   * أقصى عدد مهامّ تعمل في اللحظة نفسها. ليس ضبطاً تجميلياً بل حدٌّ لازم: كل مهمّة
   * جارية تستهلك اتصال قفل محجوزاً واتصالاً أو أكثر لاستعلاماتها، فتوازٍ غير محدود
   * مع أربع مدن مفعَّلة يعني 24 مهمّة تتزاحم على تجمّع اتصالات محدود — وهذا استنزاف
   * تجمّع يُسقط المهامّ جميعاً بمهلة انتظار لا بخطأ مفهوم.
   *
   * والحدّ **على المشغّل كلّه لا على النبضة الواحدة**: `start` يستدعي `runDue` بلا
   * انتظار انتهاء سابقته، فشوطٌ يتجاوز النبضة (النسخ الاحتياطي يومياً) يجعل نبضتين
   * متراكبتين. وحدٌّ محسوبٌ داخل كل استدعاء يصير حدَّين، فيتضاعف التوازي الفعلي.
   */
  readonly maxConcurrency?: number;
}

export interface JobOutcome {
  readonly name: string;
  readonly status:
    | "ran"
    | "skipped_not_due"
    | "skipped_overlapping"
    | "skipped_locked_elsewhere"
    | "failed";
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
  /**
   * ينتظر انتهاء الأشواط الجارية. لازمٌ للإطفاء: `stop` يمسح المؤقّت ولا ينتظر
   * شيئاً، فإغلاق القاعدة بعده مباشرةً يسحب الاتصال من شوطٍ جارٍ فيُفشله بلا داعٍ.
   * ومحدودٌ بمهلة: منصّة النشر تقتل العملية قسراً بعد مدّة، فانتظارٌ بلا حدٍّ
   * يضيع فرصة الإغلاق النطيف بدل أن يحفزها — والنسخ الاحتياطي قد يطول دقائق.
   *
   * يعود `true` إن فرغت الأشواط، و`false` إن انتهت المهلة وبعضها جارٍ — فالمُطفِئ
   * يسجّل ذلك بدل أن يظنّ أنّه أغلق نطيفاً.
   */
  drain(timeoutMs?: number): Promise<boolean>;
  readonly running: boolean;
}

const DEFAULT_TICK_MS = 10_000;
const DEFAULT_MAX_CONCURRENCY = 4;

/** مهلة التصريف الافتراضية: أقلّ من مهلة القتل القسري لدى منصّة النشر، ليبقى متّسعٌ للإغلاق. */
const DEFAULT_DRAIN_MS = 20_000;
const DRAIN_POLL_MS = 50;

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  const lastRunMs = new Map<string, number>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * خانات التوازي على مستوى المشغّل، لا على مستوى الاستدعاء. الحالة هنا — في
   * الإغلاق لا داخل `runDue` — هي جوهر الأمر: نبضتان متراكبتان لكلٍّ منهما عدّادها
   * تُشغّلان ضِعف السقف، وتجمّع القفل مقاسٌ على السقف بالضبط (`MAX_JOB_CONCURRENCY + 1`)
   * فالتجاوز استنزافُ تجمّع لا بطءٌ مقبول.
   *
   * والخانة تُسلَّم للمنتظر تسليماً ولا تُحرَّر ثم تُطلب، فلا تنفلت خانة لطالبٍ جديد
   * بين التحرير والاستلام.
   */
  let activeSlots = 0;
  const slotWaiters: (() => void)[] = [];

  async function acquireSlot(): Promise<void> {
    if (activeSlots < maxConcurrency) {
      activeSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      slotWaiters.push(resolve);
    });
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    activeSlots -= 1;
  }

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
      // القفل باسم المهمّة نفسه، وأسماء مهامّ المدن تحمل معرّف المدينة، فمدينتان
      // لا تتعطّل إحداهما بقفل الأخرى — الحصرية لكل (مهمّة، مدينة) لا لكل مهمّة.
      const attempt = await options.lock.withLock(job.name, () => job.run());

      if (!attempt.acquired) {
        // نسخة أخرى تعمل الآن. لا يُسجَّل الوقت: هذه النسخة لم تُشغّل شيئاً، وتسجيل
        // الوقت كان سيعني أنها ستنتظر فاصلاً كاملاً بعد شوطٍ لم يحدث عندها.
        const durationMs = options.clock.now().getTime() - startedAt;
        options.log.info("job.skipped_locked_elsewhere", { job: job.name, durationMs });
        return { name: job.name, status: "skipped_locked_elsewhere", durationMs, detail: null };
      }

      const detail = attempt.value;
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

    // توازٍ محدود بنافذة منزلقة: تبدأ مهمّة كلّما تحرّرت خانة، فلا ننتظر انتهاء
    // دفعة كاملة قبل بدء التالية (وهو ما يجعل مهمّة واحدة بطيئة تُعطّل ثلاثاً معها).
    // والخانات مشتركة بين النبضات المتراكبة، فالسقف سقفُ المشغّل لا سقفُ النبضة.
    const results: JobOutcome[] = [];
    await Promise.all(
      due.map(async (job) => {
        await acquireSlot();
        try {
          results.push(await runOne(job, nowMs));
        } finally {
          releaseSlot();
        }
      }),
    );

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

    drain: async (timeoutMs = DEFAULT_DRAIN_MS) => {
      // استقصاءٌ لا تجميعُ وعود: الأشواط تُنشأ في نبضاتٍ لا نملك وعودها هنا،
      // والمرجع الواحد للجاري هو `inFlight` نفسه — وهو مرجعٌ صادق لأنّ `finally`
      // يحذف منه حتّى عند الرمي، فلا يبقى اسمٌ عالقاً فيه فيستنفد المهلة أبداً.
      const deadline = options.clock.now().getTime() + timeoutMs;
      while (inFlight.size > 0) {
        if (options.clock.now().getTime() >= deadline) {
          options.log.error("runner.drain_timeout", { pending: [...inFlight] });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
      }
      return true;
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      options.log.info("runner.stopped", {});
    },
  };
}
