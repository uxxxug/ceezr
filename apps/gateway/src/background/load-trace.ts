/**
 * `LOAD-01` (الدفعةُ الحاديةَ عشرةَ) — أثرُ كلفةِ السيناريو: تشخيصيٌّ اختياريٌّ، مُعطَّلٌ افتراضيّاً.
 *
 * يُفعَّلُ بـ`DISPATCH_TRACE_FILE=<مسار>` وحدَه (المفتاحُ نفسُه لأثرِ البثِّ)، ويكتبُ JSONL إلى
 * `<مسار>.load.jsonl`. بغيابِه تُعيدُ الدالّةُ `null` فلا يتغيّرُ سلوكٌ ولا كلفة:
 *
 * - `job`: وظيفةُ تحديثِ تيليجرامَ واحدةٌ بمعرّفِها — لحظةُ التقاطِها، وبدءُ معالجتِها (بعدَ
 *   انتظارِ مسارِ المستخدمِ)، ونهايتُها، وأطوارُ المسارِ الدائم (فحصُ الأثرِ، والتحضير، والختم).
 *   والإيداعُ (`created_at`) يُقرَأُ من القاعدةِ بعدَ الموجةِ فيُفصَلُ انتظارُ الطابورِ عن التنفيذ.
 * - `sweep`: شوطُ الدرينر — بدؤه وآخرُ التقاطٍ فيه ونهايتُه (الفرقُ = انتظارُ آخرِ الوظائفِ
 *   والمساراتُ فارغةٌ)، ورحلاتُ الالتقاطِ وزمنُها.
 * - `http`: كلَّ 5ث لكلِّ مسارٍ مُطبَّعٍ: العدد، والمجموع، وp50/p95/max لزمنِ المعالجةِ في الخادم
 *   (من دخولِ `fetch` حتى الردّ) — لا زمنُ العميلِ.
 * - `loop`: كلَّ 5ث تأخُّرُ حلقةِ الأحداثِ (مؤقّتٌ كلَّ 50ms: p50/p95/max للانحراف) وCPU الخيطِ
 *   الرئيسيِّ (`/proc/self/task/<pid>/stat`، لينكس) وCPU العمليّةِ كلِّها (`process.cpuUsage`)،
 *   فيُفصَلُ «الخيطُ مشغول» عن «الخيطُ ينتظرُ دورَه على المعالج».
 * - `rsig` (الدفعةُ 21): عددُ كلِّ استعلامٍ بتوقيعِه **منسوبًا إلى مسارِ HTTP الذي أطلقَه**
 *   (`AsyncLocalStorage` حولَ `app.fetch`)، وما لا طلبَ له (الدرينر، العمّال) يُنسَبُ إلى
 *   `(background)`. يُصبُّ عندَ الإيقاف، فيُحصى «استعلامٌ لكلِّ طلبٍ» لكلِّ مسارٍ من الأثرِ لا تخمينًا.
 * - `pdb` / `pagg` (الدفعةُ 32): انتظارُ مقعدِ البوّابةِ (`waitMs`) واحتجازُه (`runMs`) **لكلِّ مسارٍ
 *   مُعلَنٍ** (`load-path-scope.ts`): `http:<مسار>` · `drainer:sweep` · `drainer:job:<bot>:<نوع>` ·
 *   `drainer:replies` · `redispatch:immediate` · وما سواها `(background)`. `pdb` كلَّ 5ث، و`pagg`
 *   للموجةِ كلِّها عندَ الإيقاف (n، المجموع، p50/p95/p99/max). و`rsig` باقٍ بمعناه القديمِ دونَ تغيير.
 * - `psig` (دورةُ حجوزاتِ المجمّع، 2026-10-25): عددُ كلِّ استعلامٍ بتوقيعِه وانتظارُه واحتجازُه
 *   **منسوبًا إلى المسارِ المُعلَن** (`drainer:job:<bot>:<نوع>` وسواه) لا إلى مسارِ HTTP وحدَه،
 *   فيُحصى «أيُّ استعلامٍ يحجزُ المقعدَ في كلِّ وظيفة» من الأثرِ لا تخمينًا. يُصبُّ عندَ الإيقاف.
 *   ما لا نطاقَ مُعلَنًا له لا يدخلُه (`rsig` يغطّيه). قياسٌ فقط: لا يغيّرُ سلوكًا ولا حدًّا.
 * - `httpreq`/`pseat`/`arr1s` (دورةُ تشخيصِ انتظارِ HTTP، 2026-10-26 — البروتوكولُ
 *   `LOAD01-C2-HTTP-WAIT-PROBE-20261026`): ربطٌ طلبيٌّ فرديٌّ بلا نوافذَ ولا مجاميعَ:
 *   `httpreq` سطرٌ لكلِّ طلبِ HTTP (المعرّفُ المارُّ فعلًا في رأسِ `X-Request-Id` — لا معرّفٌ
 *   جديد — والمسارُ وزمنُهُ الخادميُّ وحالتُهُ ومجموعُ انتظارِ مقعدِهِ واحتجازِهِ)، و`pseat`
 *   سطرٌ لكلِّ حجزِ مقعدٍ **منسوبٍ إلى معرّفِ الطلبِ** بفواصلِهِ المشتقّةِ (بدايةُ الانتظارِ
 *   ونهايتُهُ ونهايةُ الاحتجازِ من `waitMs`/`runMs` عندَ الحسمِ)، و`arr1s` عدُّ وصولٍ
 *   بثانيةٍ واحدةٍ **عندَ الدخولِ** (طلباتُ HTTP لكلِّ مسارٍ، وطلباتُ المقاعدِ لحظةَ طلبِها لكلِّ
 *   تجمُّعٍ) — لا إعادةُ تسميةٍ لعدّادِ الاكتمالاتِ. القياسُ كلهُ خلفَ `DISPATCH_TRACE_FILE`
 *   وحدَه كما كلُّ هذا الملفِّ: بلا تفعيلٍ لا سلوكَ ولا كلفة.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { observeQueryTimings } from "../../../../packages/infrastructure/db/query-deadline.ts";
import { currentRequestId } from "../../../../packages/infrastructure/observability/correlation.ts";
import { REQUEST_ID_HEADER } from "../observability/request-id.ts";
import { currentLoadPath, enableLoadPathScope, withLoadPath } from "./load-path-scope.ts";
import type { DrainerTiming } from "./telegram-update-drainer.ts";

export interface LoadTrace {
  readonly drainer: DrainerTiming;
  readonly onHttp: (pathname: string, method: string, ms: number, status: number) => void;
  /** يُشغِّلُ معالجةَ الطلبِ داخلَ نطاقِ مسارِه فتُنسَبُ إليه استعلاماتُه (`rsig`). */
  readonly inRoute: <T>(pathname: string, method: string, fn: () => Promise<T>) => Promise<T>;
  readonly stop: () => Promise<void>;
}

/** يُطبِّعُ المسارَ: المعرّفاتُ (UUID/أرقامٌ طويلة) تصيرُ `:id` فلا ينفجرُ عددُ المفاتيح. */
export function normaliseRoute(method: string, pathname: string): string {
  const path = pathname
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
      /^\d{3,}$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
  return `${method} ${path}`;
}

/** ثواني CPU للخيطِ الرئيسيِّ (utime+stime) أو `null` خارجَ لينكس. */
function mainThreadCpuSeconds(): number | null {
  try {
    const stat = readFileSync(`/proc/self/task/${process.pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / 100;
  } catch {
    return null;
  }
}

function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** ملخّصُ مسارٍ (`path|pool|kind`): العدد، والمجموع، والمئينات — `full` يُضيفُ p99 وأقصى الاحتجاز. */
function pathSummary(
  key: string,
  w: { wait: number[]; run: number[] },
  full: boolean,
): Record<string, unknown> {
  const [path, pool, kind] = key.split("|");
  const wait = [...w.wait].sort((a, b) => a - b);
  const run = [...w.run].sort((a, b) => a - b);
  return {
    path,
    pool,
    kind,
    n: run.length,
    waitSumMs: round2(wait.reduce((s, x) => s + x, 0)),
    runSumMs: round2(run.reduce((s, x) => s + x, 0)),
    waitP50Ms: percentile(wait, 0.5),
    waitP95Ms: percentile(wait, 0.95),
    ...(full ? { waitP99Ms: percentile(wait, 0.99) } : {}),
    waitMaxMs: wait[wait.length - 1] ?? null,
    runP50Ms: percentile(run, 0.5),
    runP95Ms: percentile(run, 0.95),
    ...(full ? { runP99Ms: percentile(run, 0.99), runMaxMs: run[run.length - 1] ?? null } : {}),
  };
}

export function createLoadTrace(file: string | undefined): LoadTrace | null {
  if (file === undefined || file === "") return null;
  const out = `${file}.load.jsonl`;
  let buffer: string[] = [];
  const emit = (row: Record<string, unknown>): void => {
    buffer.push(JSON.stringify(row));
  };
  let window = new Map<string, { ms: number[]; errors: number }>();
  // توقيتُ الاستعلاماتِ لكلِّ تجمُّعٍ ونوعٍ: انتظارُ المقعدِ وزمنُ التنفيذِ/الاحتجاز.
  let dbWindow = new Map<string, { wait: number[]; run: number[] }>();
  // عددُ كلِّ استعلامٍ بتوقيعِه وزمنُ احتجازِه المقعدَ — يُصبُّ كاملًا عندَ الإيقاف.
  const sigWindow = new Map<string, { n: number; runMs: number }>();
  const pathSig = new Map<string, { n: number; waitMs: number; runMs: number }>();
  const routeScope = new AsyncLocalStorage<string>();
  const routeSig = new Map<string, { n: number; runMs: number }>();
  // ب32: انتظارُ المقعدِ واحتجازُه لكلِّ مسارٍ مُعلَن — نافذةُ 5ث، ومجموعُ الموجةِ كلِّها.
  enableLoadPathScope(true);
  // دورةُ تشخيصِ انتظارِ HTTP: وصولٌ بثانيةٍ واحدةٍ عندَ الدخولِ (http لكلِّ مسارٍ، وseat لكلِّ
  // تجمُّعٍ لحظةَ طلبِهِ) — لا يُصبُّ إلا ما مضت ثانيتُه كاملةً (انظر flush).
  const arrivals = new Map<string, number>();
  const countArrival = (key: string): void => {
    arrivals.set(key, (arrivals.get(key) ?? 0) + 1);
  };
  let pathWindow = new Map<string, { wait: number[]; run: number[] }>();
  const pathTotal = new Map<string, { wait: number[]; run: number[] }>();
  const pushPath = (
    m: Map<string, { wait: number[]; run: number[] }>,
    key: string,
    wait: number,
    run: number,
  ): void => {
    let w = m.get(key);
    if (w === undefined) {
      w = { wait: [], run: [] };
      m.set(key, w);
    }
    w.wait.push(wait);
    w.run.push(run);
  };
  observeQueryTimings((t) => {
    const store = currentLoadPath();
    if (store !== undefined && t.kind !== "txQuery") {
      // استعلامُ المعاملةِ لا يحجزُ مقعداً جديداً: احتجازُه داخلٌ في احتجازِ المعاملة.
      store.gate.waitMs += t.waitMs;
      store.gate.holdMs += t.runMs;
      store.gate.acquisitions += 1;
    }
    const pk = `${store?.path ?? "(background)"}|${t.label}|${t.kind}`;
    pushPath(pathWindow, pk, t.waitMs, t.runMs);
    pushPath(pathTotal, pk, t.waitMs, t.runMs);
    // طلبُ مقعدٍ لحظةَ طلبِه: بدايةُ الانتظارِ ≈ الحسم − الاحتجاز − الانتظار (بالميلي ثانيةِ).
    if (t.kind !== "txQuery") {
      const now = Date.now();
      const sec = Math.floor((now - t.waitMs - t.runMs) / 1000) * 1000;
      countArrival(`${sec}|seat|${t.label}`);
    }
    // pseat: حجزُ مقعدٍ فردّيٌّ منسوبٌ إلى معرّفِ الطلبِ (المارِّ فعلًا في سياقِ الارتباطِ
    // الجاري — لا معرّفٌ جديد) بفواصلِهِ المشتقّةِ، للنطاقاتِ الـHTTP وحدها.
    if (store?.path.startsWith("http:")) {
      const rid = currentRequestId();
      if (rid !== undefined) {
        const now = Date.now();
        emit({
          k: "pseat",
          at: now,
          requestId: rid,
          path: store.path,
          pool: t.label,
          kind: t.kind,
          waitMs: round2(t.waitMs),
          runMs: round2(t.runMs),
          waitStartAt: Math.round(now - t.waitMs - t.runMs),
          waitEndAt: Math.round(now - t.runMs),
          holdEndAt: now,
        });
      }
    }
    const key = `${t.label}|${t.kind}`;
    let w = dbWindow.get(key);
    if (w === undefined) {
      w = { wait: [], run: [] };
      dbWindow.set(key, w);
    }
    w.wait.push(t.waitMs);
    w.run.push(t.runMs);
    if (t.sig !== undefined) {
      const sk = `${t.label}|${t.kind}|${t.sig}`;
      const c = sigWindow.get(sk) ?? { n: 0, runMs: 0 };
      c.n += 1;
      c.runMs += t.runMs;
      sigWindow.set(sk, c);
      const rk = `${routeScope.getStore() ?? "(background)"}|${t.label}|${t.kind}|${t.sig}`;
      const r = routeSig.get(rk) ?? { n: 0, runMs: 0 };
      r.n += 1;
      r.runMs += t.runMs;
      routeSig.set(rk, r);
      if (store !== undefined) {
        const xk = `${store.path}|${t.label}|${t.kind}|${t.sig}`;
        const x = pathSig.get(xk) ?? { n: 0, waitMs: 0, runMs: 0 };
        x.n += 1;
        x.waitMs += t.waitMs;
        x.runMs += t.runMs;
        pathSig.set(xk, x);
      }
    }
  });
  const flush = async (): Promise<void> => {
    if (window.size > 0) {
      const at = Date.now();
      for (const [route, w] of window) {
        const sorted = [...w.ms].sort((a, b) => a - b);
        emit({
          k: "http",
          at,
          route,
          n: sorted.length,
          sumMs: Math.round(sorted.reduce((s, x) => s + x, 0) * 100) / 100,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
          maxMs: sorted[sorted.length - 1] ?? null,
          errors: w.errors,
        });
      }
      window = new Map();
    }
    if (dbWindow.size > 0) {
      const at = Date.now();
      for (const [key, w] of dbWindow) {
        const [pool, kind] = key.split("|");
        const wait = [...w.wait].sort((a, b) => a - b);
        const run = [...w.run].sort((a, b) => a - b);
        emit({
          k: "db",
          at,
          pool,
          kind,
          n: run.length,
          waitSumMs: Math.round(wait.reduce((s, x) => s + x, 0)),
          runSumMs: Math.round(run.reduce((s, x) => s + x, 0)),
          waitP50Ms: percentile(wait, 0.5),
          waitP95Ms: percentile(wait, 0.95),
          runP50Ms: percentile(run, 0.5),
          runP95Ms: percentile(run, 0.95),
          runMaxMs: run[run.length - 1] ?? null,
        });
      }
      dbWindow = new Map();
    }
    if (pathWindow.size > 0) {
      const at = Date.now();
      for (const [key, w] of pathWindow) emit({ k: "pdb", at, ...pathSummary(key, w, false) });
      pathWindow = new Map();
    }
    // arr1s: لا تُصبُّ ثانيةٌ إلا بعدَ انقضائِها كاملةً (الثانيةُ الجاريةُ ناقصةٌ بحكمِ اللحظةِ).
    if (arrivals.size > 0) {
      const now = Date.now();
      for (const [key, n] of [...arrivals]) {
        const [at, cls, ...rest] = key.split("|");
        if (Number(at) + 1000 > now) continue;
        arrivals.delete(key);
        emit({ k: "arr1s", at: Number(at), cls, name: rest.join("|"), n });
      }
    }
    if (buffer.length === 0) return;
    const text = `${buffer.join("\n")}\n`;
    buffer = [];
    await appendFile(out, text).catch(() => {});
  };
  let lags: number[] = [];
  let expected = performance.now() + 50;
  const lagTimer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + 50;
  }, 50);
  lagTimer.unref?.();
  let lastMain = mainThreadCpuSeconds();
  let lastProc = process.cpuUsage();
  let lastAt = performance.now();
  const sampleLoop = (): void => {
    const now = performance.now();
    const main = mainThreadCpuSeconds();
    const proc = process.cpuUsage();
    const wall = (now - lastAt) / 1000;
    const sorted = [...lags].sort((a, b) => a - b);
    emit({
      k: "loop",
      at: Date.now(),
      lagP50Ms: percentile(sorted, 0.5),
      lagP95Ms: percentile(sorted, 0.95),
      lagMaxMs: sorted[sorted.length - 1] ?? null,
      mainThreadCpuPct:
        main === null || lastMain === null
          ? null
          : Math.round((1000 * (main - lastMain)) / wall) / 10,
      processCpuPct:
        Math.round(
          ((100 * (proc.user - lastProc.user + proc.system - lastProc.system)) / 1e6 / wall) * 10,
        ) / 10,
    });
    lags = [];
    lastMain = main;
    lastProc = proc;
    lastAt = now;
  };
  const timer = setInterval(() => {
    sampleLoop();
    void flush();
  }, 5_000);
  timer.unref?.();
  return {
    drainer: {
      onJob: (t) => emit({ k: "job", ...t }),
      onSweep: (t) => emit({ k: "sweep", ...t }),
      onReply: (t) => emit({ k: "reply", ...t }),
      scope: (path, fn) => withLoadPath(path, fn),
      gateOf: () => currentLoadPath()?.gate,
    },
    onHttp: (pathname, method, ms, status) => {
      const route = normaliseRoute(method, pathname);
      let w = window.get(route);
      if (w === undefined) {
        w = { ms: [], errors: 0 };
        window.set(route, w);
      }
      w.ms.push(ms);
      if (status >= 500) w.errors += 1;
    },
    inRoute: (pathname, method, fn) => {
      const route = normaliseRoute(method, pathname);
      // وصولُ الطلبِ يُعدُّ عندَ دخولِهِ — لا عندَ ردِّهِ (ليس إعادةَ تسميةٍ لعدّادِ الاكتمالاتِ).
      const sec = Math.floor(Date.now() / 1000) * 1000;
      countArrival(`${sec}|http|${route}`);
      const t0 = performance.now();
      return routeScope.run(route, () =>
        withLoadPath(`http:${route}`, async () => {
          const result = await fn();
          // httpreq: سطرٌ طلبيٌّ فردّيٌّ — المعرّفُ من رأسِ الردِّ القائمِ (X-Request-Id) لا
          // معرّفٌ جديد، والزمنُ الخادميُّ من دخولِ inRoute حتى الردِّ، ومجموعا مقعدِ الطلبِ
          // من نطاقِ المسارِ نفسِهِ.
          const r = result as {
            headers?: { get?: (name: string) => string | null };
            status?: unknown;
          } | null;
          const gate = currentLoadPath()?.gate;
          emit({
            k: "httpreq",
            at: Date.now(),
            requestId: r?.headers?.get?.(REQUEST_ID_HEADER) ?? null,
            route,
            serverMs: round2(performance.now() - t0),
            status: typeof r?.status === "number" ? r.status : null,
            gateWaitMs: round2(gate?.waitMs ?? 0),
            gateHoldMs: round2(gate?.holdMs ?? 0),
            gateAcquisitions: gate?.acquisitions ?? 0,
          });
          return result;
        }),
      );
    },
    stop: async () => {
      for (const [key, c] of routeSig) {
        const [route, pool, kind, ...rest] = key.split("|");
        emit({
          k: "rsig",
          route,
          pool,
          kind,
          sig: rest.join("|"),
          n: c.n,
          runMs: Math.round(c.runMs),
        });
      }
      for (const [key, c] of pathSig) {
        const [path, pool, kind, ...rest] = key.split("|");
        emit({
          k: "psig",
          path,
          pool,
          kind,
          sig: rest.join("|"),
          n: c.n,
          waitMs: Math.round(c.waitMs * 100) / 100,
          runMs: Math.round(c.runMs * 100) / 100,
        });
      }
      for (const [key, c] of sigWindow) {
        const [pool, kind, ...rest] = key.split("|");
        emit({ k: "sig", pool, kind, sig: rest.join("|"), n: c.n, runMs: Math.round(c.runMs) });
      }
      clearInterval(timer);
      clearInterval(lagTimer);
      observeQueryTimings(null);
      await flush();
      // عندَ الإيقافِ صبُّ ما تبقى: الثواني الأخيرةُ انقضت كلُّها بحكمِ نهايةِ الموجةِ.
      for (const [key, n] of [...arrivals]) {
        const [at, cls, ...rest] = key.split("|");
        arrivals.delete(key);
        emit({ k: "arr1s", at: Number(at), cls, name: rest.join("|"), n });
      }
      for (const [key, w] of pathTotal) emit({ k: "pagg", ...pathSummary(key, w, true) });
      pathTotal.clear();
      enableLoadPathScope(false);
      await flush();
    },
  };
}
