/**
 * الغرض: مِجسُّ حلقةِ الأحداثِ لمقاعدِ القياسِ (LOAD-01-GAP-PROBE-RUN2، 2026-10-27) — تأخُّرُ
 *   حلقةِ الأحداثِ بمؤقّتٍ دقيقٍ، وزمنُ المعالجِ وانتظارُ طابورِ التشغيلِ للخيطِ الرئيسيِّ،
 *   واستخدامُ الحلقةِ (ELU) **إن أتاحَهُ المشغِّل** — كلُّها بساعةِ العمليّةِ الرتيبةِ نفسِها.
 * الحالة: منفّذ فعلياً — أداةُ قياسٍ فقط: لا يُنشأُ إلا بطلبٍ صريحٍ من أثرِ الحملِ
 *   (`DISPATCH_TRACE_FILE`) في البوّابةِ أو المولّدِ، ولا يغيّرُ سلوكًا.
 * ينتمي إلى: packages/infrastructure/observability
 * يُستخدم من: `apps/gateway/src/background/load-trace.ts` (سطرُ `loop1s`) ·
 *   `deploy/capacity-run/load/miniapp-load.ts` (سطرُ `gen_loop`) — مِجسٌّ واحدٌ للجانبينِ فلا
 *   يُقاسُ كلُّ جانبٍ بأداةٍ مختلفة.
 *
 * ## ما يُقاسُ وما لا يُقاس (لا يُدّعى أكثرُ من هذا)
 *
 * - **التأخُّرُ:** مؤقّتٌ كلَّ `intervalMs`؛ لكلِّ نبضةٍ `max(0, الآن − الموعدُ المتوقَّع)`. يكشفُ
 *   انشغالَ الحلقةِ أو انتظارَها المعالجَ **بدقّةِ الفاصلِ** — انسدادٌ أقصرُ منهُ قد لا يُرى.
 * - **`overdueMs()`:** كم تأخّرتِ النبضةُ التاليةُ عن موعدِها **لحظةَ السؤال** — مؤشِّرٌ لحظيٌّ
 *   على أنَّ الحلقةَ لم تستطعْ تشغيلَ المؤقّتاتِ مدّةً قبلَ هذهِ اللحظة. **مؤشّرٌ لا مُكوِّنٌ**:
 *   لا يُطرحُ من زمنِ طلبٍ ولا يُنسبُ إليهِ مقدارٌ.
 * - **الخيطُ الرئيسيُّ:** من `/proc/self/task/<pid>/stat` (utime+stime) و`schedstat` (الحقلُ
 *   الثاني = نانوثوانٍ قضاها الخيطُ **قابلًا للتشغيلِ ينتظرُ المعالج**) — لينكس فقط؛ وإلّا `null`.
 * - **ELU:** `performance.eventLoopUtilization` إن وُجدَ **وأعادَ زمنًا غيرَ صفريٍّ**؛ في Bun
 *   1.4 يُعيدُ أصفارًا (فُحصَ محلّيًّا) ⇒ `eluAvailable=false` ويبقى الحقلُ `null` لا صفرًا.
 * - لا تُطرحُ طوابعُ عمليّتينِ: كلُّ قيمةٍ هنا مدّةٌ داخلَ العمليّةِ نفسِها، و`at` ساعةُ الحائطِ
 *   للإسنادِ إلى النوافذِ فقط.
 */

import { readFileSync } from "node:fs";

export interface LoopSample {
  readonly at: number;
  readonly pid: number;
  readonly intervalMs: number;
  readonly ticks: number;
  readonly lagP50Ms: number | null;
  readonly lagP95Ms: number | null;
  readonly lagP99Ms: number | null;
  readonly lagMaxMs: number | null;
  /** نسبةُ نواةٍ واحدةٍ (100 = نواةٌ كاملة) — utime+stime للخيطِ الرئيسيِّ. */
  readonly mainThreadCpuPct: number | null;
  /** نسبةُ نواةٍ واحدةٍ — زمنُ الخيطِ الرئيسيِّ قابلًا للتشغيلِ في طابورِ المعالج. */
  readonly mainThreadRunqWaitPct: number | null;
  readonly processCpuPct: number;
  readonly eluAvailable: boolean;
  readonly elu: number | null;
}

export interface LoopProbe {
  /** كم تأخّرتِ النبضةُ التاليةُ لحظةَ السؤال (مللي ثانية، ≥ 0). */
  readonly overdueMs: () => number;
  readonly stop: () => void;
}

export interface ThreadTimes {
  /** ثواني CPU للخيطِ (utime+stime). */
  readonly cpuSec: number;
  /** نانوثواني الانتظارِ في طابورِ التشغيلِ (schedstat الحقل 2). */
  readonly runqWaitNs: number | null;
}

export interface LoopProbeOptions {
  readonly intervalMs: number;
  readonly sampleMs: number;
  readonly emit: (sample: LoopSample) => void;
  /** للاختبار: ساعةٌ رتيبةٌ بديلةٌ (الافتراضيُّ `performance.now`). */
  readonly now?: () => number;
  /** للاختبار: قراءةُ أزمنةِ الخيطِ (الافتراضيُّ /proc). */
  readonly readThread?: () => ThreadTimes | null;
  /** للاختبار: ELU (الافتراضيُّ `performance.eventLoopUtilization`). */
  readonly elu?: (() => { idle: number; active: number }) | null;
}

export function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const q = (sorted: readonly number[], p: number): number | null => {
  const v = percentile(sorted, p);
  return v === null ? null : round3(v);
};

/** أزمنةُ الخيطِ الرئيسيِّ من /proc (لينكس) أو `null`. */
export function readMainThreadTimes(): ThreadTimes | null {
  try {
    const base = `/proc/self/task/${process.pid}`;
    const stat = readFileSync(`${base}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // الحقولُ بعدَ الاسمِ تبدأُ بالحقلِ 3؛ utime = 14 وstime = 15 ⇒ الفهرسانِ 11 و12.
    const ticks = Number(f[11]) + Number(f[12]);
    let runq: number | null = null;
    try {
      const ss = readFileSync(`${base}/schedstat`, "utf8").trim().split(/\s+/);
      const v = Number(ss[1]);
      runq = Number.isFinite(v) ? v : null;
    } catch {
      runq = null;
    }
    // CLK_TCK = 100 على لينكس الشائع؛ تُقرأُ النسبةُ فرقًا فلا يلزمُ أكثرُ من ثباتِه.
    return Number.isFinite(ticks) ? { cpuSec: ticks / 100, runqWaitNs: runq } : null;
  } catch {
    return null;
  }
}

function defaultElu(): (() => { idle: number; active: number }) | null {
  const p = performance as unknown as {
    eventLoopUtilization?: () => { idle: number; active: number };
  };
  const fn = p.eventLoopUtilization;
  return typeof fn === "function" ? () => fn.call(performance) : null;
}

export function startLoopProbe(opts: LoopProbeOptions): LoopProbe {
  const now = opts.now ?? (() => performance.now());
  const readThread = opts.readThread ?? readMainThreadTimes;
  const eluFn = opts.elu === undefined ? defaultElu() : opts.elu;
  let lags: number[] = [];
  let lastTick = now();
  let expected = lastTick + opts.intervalMs;
  const tick = setInterval(() => {
    const t = now();
    lags.push(Math.max(0, t - expected));
    lastTick = t;
    expected = t + opts.intervalMs;
  }, opts.intervalMs);
  tick.unref?.();

  let lastAt = now();
  let lastThread = readThread();
  let lastProc = process.cpuUsage();
  let lastElu = eluFn?.() ?? null;
  const sample = setInterval(() => {
    const t = now();
    const wall = (t - lastAt) / 1000;
    const thread = readThread();
    const proc = process.cpuUsage();
    const eluNow = eluFn?.() ?? null;
    const sorted = [...lags].sort((a, b) => a - b);
    let eluVal: number | null = null;
    let eluOk = false;
    if (eluNow !== null && lastElu !== null) {
      const active = eluNow.active - lastElu.active;
      const idle = eluNow.idle - lastElu.idle;
      if (active + idle > 0) {
        eluOk = true;
        eluVal = round3(active / (active + idle));
      }
    }
    opts.emit({
      at: Date.now(),
      pid: process.pid,
      intervalMs: opts.intervalMs,
      ticks: sorted.length,
      lagP50Ms: q(sorted, 0.5),
      lagP95Ms: q(sorted, 0.95),
      lagP99Ms: q(sorted, 0.99),
      lagMaxMs: q(sorted, 1),
      mainThreadCpuPct:
        thread === null || lastThread === null || wall <= 0
          ? null
          : Math.round((1000 * (thread.cpuSec - lastThread.cpuSec)) / wall) / 10,
      mainThreadRunqWaitPct:
        thread?.runqWaitNs == null || lastThread?.runqWaitNs == null || wall <= 0
          ? null
          : Math.round((1000 * ((thread.runqWaitNs - lastThread.runqWaitNs) / 1e9)) / wall) / 10,
      processCpuPct:
        wall <= 0
          ? 0
          : Math.round(
              ((100 * (proc.user - lastProc.user + proc.system - lastProc.system)) / 1e6 / wall) *
                10,
            ) / 10,
      eluAvailable: eluOk,
      elu: eluVal,
    });
    lags = [];
    lastAt = t;
    lastThread = thread;
    lastProc = proc;
    lastElu = eluNow;
  }, opts.sampleMs);
  sample.unref?.();

  return {
    overdueMs: () => Math.max(0, round3(now() - lastTick - opts.intervalMs)),
    stop: () => {
      clearInterval(tick);
      clearInterval(sample);
    },
  };
}
