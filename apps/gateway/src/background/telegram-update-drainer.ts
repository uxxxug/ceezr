/**
 * الغرض: الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يلتقطُ ما أودعَه الويبهوكُ
 *    ويُعالجُه خارجَ مسارِ HTTP. هذا هو إغلاقُ `BUG-002` / `F6-02` على وجهِه
 *    العمليِّ: ACK سريعٌ عندَ الإيداعِ، ومعالجةٌ غيرُ متزامنةٍ هنا بإيجارٍ
 *    واسترجاعٍ وختمٍ برمزٍ. القرارُ المعماريُّ في
 *    [ADR 0057](../../../../docs/adr/0057-telegram-ingress-bound-payload-carrier-and-worker.md):
 *    الدرينرُ يعملُ داخلَ عمليةِ البوابةِ (gateway background drainer) لا في
 *    `apps/workers` — نقلُهُ إلى خدمةٍ منفصلةٍ (`SCL-007` / `F5-04`) لم يُغلَقْ بعد.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/background
 * يُتوقَّع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts`
 *
 * ## لماذا دالتانِ لا واحدةٌ
 *
 * `drainTelegramUpdateJobsOnce` هي الشوطُ الواحدُ — تلتقطُ وتُعالجُ وتُختمُ. وهي ما
 * يُختَبرُ به مباشرةً بلا `setInterval`: فالاختبارُ يُلاقي حقيقةَ «التقاطٌ ثمّ ختمٌ»
 * لا مؤقِّتاً قد يتراكمُ. و`startTelegramUpdateDrainer` هي غلافُ الإنتاجِ الذي
 * يُديرُ المؤقّتَ ومانعَ التداخلِ والإيقافَ النظيفَ فوقَها.
 *
 * ## مانعُ التداخلِ
 *
 * إذا طال شوطُ المعالجةِ عن فترةِ التكرارِ، فلا يُجدولُ شوطٌ ثانٍ فوقَه: المؤقّتُ
 * يصيرُ «مُسكِتاً» لا «مُراكمَ». فلا تتنافسُ أشواطٌ على الإيجارِ، ولا تتضخّمُ
 * الذاكرةُ بدريَنرَ يقتلعُ بعضُه بعضاً.
 */

import type { TelegramUpdateQueue } from "../../../../packages/infrastructure/db/telegram-update-queue.ts";
import type { BotKind, UpdateHandler } from "../routes/telegram-webhook.ts";

export interface TelegramUpdateDrainDeps {
  readonly queue: TelegramUpdateQueue;
  readonly handler: UpdateHandler;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** نتيجةُ شوطِ استنزافٍ واحد. */
export interface DrainReport {
  /** وظائفُ أُلتقطَت في هذا الشوطِ. */
  readonly claimed: number;
  /** وظائفُ خُتمَت بنجاحٍ. */
  readonly done: number;
  /** وظائفُ فشلَت وعادت للطابورِ أو ماتت. */
  readonly failed: number;
}

/**
 * يلتقطُ وظيفةً واحدةً معلَّقةً ويُعالجُها ويُختمُها. يكرّرُ حتى يفرغَ الطابورُ
 * (claim يُعيدُ null). يُعيدُ تقريرَ الشوطِ. لا يُديرُ مؤقّتاً — للاختبارِ المباشرِ.
 */
export async function drainTelegramUpdateJobsOnce(
  deps: TelegramUpdateDrainDeps,
): Promise<DrainReport> {
  let claimed = 0;
  let done = 0;
  let failed = 0;

  for (;;) {
    let job: Awaited<ReturnType<TelegramUpdateQueue["claim"]>>["job"];
    try {
      job = (await deps.queue.claim()).job;
    } catch (error) {
      // عجزُ القاعدةِ عندَ الالتقاطِ يكسرُ الشوطَ لا يقتله: السياقُ التاليُّ للدرينرِ
      // الخلفيِّ يُعيدُ المحاولةَ في المؤقّتِ. والوظيفةُ إن وُجدت تبقى معلَّقةً لا تُفقَد.
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.("تعذّر التقاط وظائف تيليجرام", { error: message });
      break;
    }
    if (job === null) break;
    claimed += 1;

    const lease = { bot: job.bot, updateId: job.updateId, claimToken: job.claimToken };
    try {
      const handled = await deps.handler.handle(job.bot as BotKind, job.payload);
      const sealed = await deps.queue.finish(lease, handled, handled ? undefined : "NOT_HANDLED");
      if (handled && sealed) {
        done += 1;
      } else {
        failed += 1;
        deps.log?.("فشل ختم وظيفة بعد المعالجة", {
          bot: job.bot,
          updateId: job.updateId,
          handled,
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      // الختمُ كفشلٍ: إن لم تُستنفدِ المحاولاتُ تعاد للطابورِ، وإلّا ماتت نهائيّاً.
      await deps.queue.finish(lease, false, message).catch(() => {});
      deps.log?.("خطأ أثناء معالجة وظيفة", {
        bot: job.bot,
        updateId: job.updateId,
        error: message,
      });
    }
  }

  return { claimed, done, failed };
}

export interface TelegramUpdateDrainer {
  /** يُوقفُ المؤقّتَ وينتظرُ الشوطَ الجاري إن وُجد. */
  stop(): Promise<void>;
}

export interface StartDrainerOptions {
  /** فترةُ التكرارِ بين الأشواطِ، مللي ثانية. */
  readonly intervalMs: number;
  readonly clock?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

/**
 * يُشغّلُ الدرينرَ دوريّاً في الخلفيةِ مع مانعِ تداخلٍ: إن طالَ شوطٌ عن فترةِ
 * التكرارِ يُسكَتُ المؤقّتُ ولا يُجدولُ فوقَه. يتوقّفُ نظيفاً عندَ `stop` منتظراً
 * الشوطَ الجاري.
 */
export function startTelegramUpdateDrainer(
  deps: TelegramUpdateDrainDeps,
  options: StartDrainerOptions,
): TelegramUpdateDrainer {
  const setInterval = options.clock?.setInterval ?? globalThis.setInterval;
  const clearInterval = options.clock?.clearInterval ?? globalThis.clearInterval;

  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (running) return; // مانعُ التداخلِ: لا شوطٌ فوقَ شوطٍ.
    running = true;
    try {
      const report = await drainTelegramUpdateJobsOnce(deps);
      if (report.claimed > 0) {
        deps.log?.("شوط استنزاف وظائف تيليجرام", { ...report });
      }
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, options.intervalMs) as ReturnType<typeof setInterval>;

  return {
    stop: async () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      // إن كان شوطٌ جارٍ، انتظرْه. لا نُهملُ وظيفةً محجوزةً.
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
