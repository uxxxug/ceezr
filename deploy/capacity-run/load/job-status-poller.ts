/**
 * LOAD-01 · خفضُ أثرِ المراقِب (harness overhead) — انتظارُ مهامِّ `telegram_update_jobs` بجملةٍ واحدةٍ لكلِّ دورة.
 *
 * كانَ كلُّ سائقٍ ينتظرُ مهمّتَه بجملةٍ مستقلّةٍ كلَّ 400ms (`waitForSpecificJob`)، فبلغت الجملُ 549,427 في موجةِ
 * m5-1500 (≈ 51% من كلِّ جملِ القاعدة) على المقعدِ نفسِه الذي يُقاسُ أداؤه ومعالجُه مشبَعٌ (خطُّ الأساس
 * LOAD01-MAIN-BASELINE-20261027: انتظارُ PostgreSQL في طابورِ المعالجِ أطولُ من تشغيلِه).
 *
 * الدلالةُ نفسُها حرفًا: المهمّةُ المحدّدةُ بمفتاحِ (bot, update_id) لا فراغُ الطابور؛ `done` ⇒ ok، و`dead` ⇒ dead،
 * وبلوغُ المهلةِ قبلَ رؤيةِ أحدِهما ⇒ timeout. الإيقاعُ نفسُه: دورةٌ كلَّ `intervalMs` بعدَ انتهاءِ السابقة (لا تداخل)،
 * فالرؤيةُ في ≤ intervalMs + زمنِ الجملة كما كانت. الفرقُ الوحيد: جملةٌ واحدةٌ لكلِّ المنتظِرين (مقطّعةٌ بـ`chunk`).
 */

export type JobOutcome = "ok" | "dead" | "timeout";

export interface JobStatusRow {
  readonly updateId: number;
  readonly status: string;
}

export interface JobStatusPollerDeps {
  /** جملةٌ واحدةٌ لدفعةٍ من المعرّفات ⇒ حالةُ الموجودِ منها (الغائبُ لم يُدرَجْ بعد) */
  readonly query: (updateIds: readonly number[]) => Promise<readonly JobStatusRow[]>;
  readonly intervalMs?: number;
  readonly chunk?: number;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => unknown;
}

interface Waiter {
  readonly deadline: number;
  readonly resolve: (o: JobOutcome) => void;
  readonly reject: (e: unknown) => void;
}

export interface JobStatusPoller {
  wait(updateId: number, deadlineMs: number): Promise<JobOutcome>;
  /** عددُ الجملِ المرسلةِ — للتحقّقِ والأثر */
  readonly stats: () => { queries: number; pending: number };
}

export function createJobStatusPoller(deps: JobStatusPollerDeps): JobStatusPoller {
  const intervalMs = deps.intervalMs ?? 400;
  const chunk = deps.chunk ?? 2000;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const waiters = new Map<number, Waiter[]>();
  let running = false;
  let queries = 0;

  const settle = (id: number, outcome: JobOutcome): void => {
    const list = waiters.get(id);
    if (list === undefined) return;
    waiters.delete(id);
    for (const w of list) w.resolve(outcome);
  };

  const tick = async (): Promise<void> => {
    const ids = [...waiters.keys()];
    const seen = new Map<number, string>();
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      queries += 1;
      try {
        for (const r of await deps.query(part)) seen.set(r.updateId, r.status);
      } catch (e) {
        // كما في الحلقةِ القديمة: خطأُ القراءةِ يُرمى إلى المنتظِرِ نفسِه (لا يُبتلَعُ ولا يُحسَبُ نجاحًا ولا مهلة).
        for (const id of part) {
          const list = waiters.get(id);
          waiters.delete(id);
          for (const w of list ?? []) w.reject(e);
        }
      }
    }
    const t = now();
    for (const id of ids) {
      if (!waiters.has(id)) continue;
      const s = seen.get(id);
      if (s === "done") settle(id, "ok");
      else if (s === "dead") settle(id, "dead");
      else {
        const list = waiters.get(id);
        if (list === undefined) continue;
        const live = list.filter((w) => {
          if (t >= w.deadline) {
            w.resolve("timeout");
            return false;
          }
          return true;
        });
        if (live.length === 0) waiters.delete(id);
        else waiters.set(id, live);
      }
    }
  };

  const loop = (): void => {
    if (running) return;
    running = true;
    const step = async (): Promise<void> => {
      await tick();
      if (waiters.size === 0) {
        running = false;
        return;
      }
      schedule(() => void step(), intervalMs);
    };
    void step();
  };

  return {
    wait(updateId, deadlineMs) {
      return new Promise<JobOutcome>((resolve, reject) => {
        const list = waiters.get(updateId) ?? [];
        list.push({ deadline: now() + deadlineMs, resolve, reject });
        waiters.set(updateId, list);
        loop();
      });
    },
    stats: () => ({ queries, pending: waiters.size }),
  };
}
