/**
 * `LOAD-01` (CLAIM-SPLIT) — أداتا رصدٍ لتفكيكِ زمنِ الالتقاطِ الجداريّ، مطفأتانِ ما لم يُشعَلْ
 * `NOTIFICATION_CLAIM_SPLIT=1`:
 *
 * 1. **ساعةُ زمنٍ حقيقيٍّ عاليةُ الدقّة** تُقارَنُ بـ`statement_timestamp()`/`clock_timestamp()` في PG
 *    على المضيفِ نفسِه. `Date.now()` دقّتُه ملّي ثانيةٌ واحدة، و`performance.now()` رتيبٌ لكنّه
 *    ينحرفُ عن الزمنِ الحقيقيّ. لذلك يُعايَرُ الفرقُ بينهما عندَ حدِّ تبدّلِ `Date.now()` في أوّلِ كلِّ
 *    شوط (انتظارٌ مشغولٌ ≤ 1ms)، فيبقى الانحرافُ داخلَ الشوطِ مهمَلًا.
 * 2. **مسبارُ حلقةِ الأحداث**: `monitorEventLoopDelay` (تأخّرُ المؤقّتات؛ في Bun يُسجَّلُ التأخّرُ الزائدُ
 *    عن الدقّة لا الفاصلُ كلُّه — خمولٌ ≈ 0.06ms ومشغولٌ 20ms ≈ 15ms محلّيًّا) و`eventLoopUtilization`
 *    (نسبةُ انشغالِ الحلقة) **خلالَ الشوطِ وحدَه**، لأنّ العاملَ يتقاسمُ الحلقةَ مع البوّابة.
 */
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { ClaimSplitClock } from "./notification-outbox-adapters.ts";

export interface CalibratedClock extends ClaimSplitClock {
  /** يعيدُ المعايرة؛ ويُرجعُ الفرقَ المقيسَ (ms) للاختبار. */
  calibrate(): number;
}

export function createCalibratedClock(
  deps: { readonly dateNow?: () => number; readonly monoNow?: () => number } = {},
): CalibratedClock {
  const dateNow = deps.dateNow ?? Date.now;
  const monoNow = deps.monoNow ?? (() => performance.now());
  let offset = dateNow() - monoNow();
  return {
    calibrate() {
      // عندَ أوّلِ تبدّلٍ لـDate.now() يكونُ الزمنُ الحقيقيُّ = d تمامًا (± دقّةِ القراءة).
      const d0 = dateNow();
      let d = d0;
      let m = monoNow();
      for (let i = 0; i < 1_000_000 && d === d0; i++) {
        m = monoNow();
        d = dateNow();
      }
      offset = d - m;
      return offset;
    },
    realtimeMs: () => monoNow() + offset,
  };
}

export interface LoopProbeReading {
  readonly delayMeanUs: number;
  readonly delayP99Us: number;
  readonly delayMaxUs: number;
  /**
   * نسبةُ انشغالِ الحلقةِ خلالَ الشوط × 1000 (عددٌ صحيح)، أو **-1 إن لم يوفّرها وقتُ التشغيل**:
   * Bun 1.4.4 يُرجعُ `{idle:0, active:0}` دائمًا (تحقّقٌ محلّيّ)، فالصفرُ هناك ليس قياسًا.
   */
  readonly eluPermille: number;
}

export interface LoopProbe {
  start(): void;
  read(): LoopProbeReading;
  stop(): void;
}

export function createLoopProbe(resolutionMs = 10): LoopProbe {
  const h = monitorEventLoopDelay({ resolution: resolutionMs });
  h.enable();
  let elu = performance.eventLoopUtilization();
  const us = (ns: number) => (Number.isFinite(ns) ? Math.round(ns / 1000) : 0);
  return {
    start() {
      h.reset();
      elu = performance.eventLoopUtilization();
    },
    read() {
      const d = performance.eventLoopUtilization(elu);
      const measured = d.idle + d.active > 0;
      return {
        delayMeanUs: us(h.mean),
        delayP99Us: us(h.percentile(99)),
        delayMaxUs: us(h.max),
        eluPermille: measured ? Math.round(1000 * d.utilization) : -1,
      };
    },
    stop() {
      h.disable();
    },
  };
}

/**
 * `LOAD-01` (CLAIM-WAIT) — مراحلُ استعلامٍ واحدٍ في postgres.js 3.4.9 كما يسجّلُها كائنُ الاستعلامِ نفسُه،
 * بلا `reserve()` ولا تغييرِ مسارِه:
 * - `executed` يُضبَطُ في `handle()`: الإصدار.
 * - `state` يُضبَطُ في `connection.execute()` لحظةَ الكتابةِ إلى المقبس. ما قبلَها انتظارٌ في طابورِ
 *   التجمّع (لا اتّصالَ بسعة) مع مهمّةٍ دقيقةٍ واحدة (`await 1`).
 * - `active` يُضبَطُ في الاستدعاءِ نفسِه إن كان الاتّصالُ خاليًا. وإلّا فعندَ انتهاءِ ما قبلَه على
 *   الاتّصالِ نفسِه (`ReadyForQuery`)، أي أنّ الاستعلامَ ظلَّ في الأنبوبِ خلفَ غيره.
 * - `resolve` يُستدعى عندَ `ReadyForQuery` لهذا الاستعلام. وما بعدَه حتّى عودةِ `await` = الاستكمال.
 * المراقبةُ خصائصُ وصولٍ على الكائنِ نفسِه تحفظُ القيمةَ كما هي، فلا يتغيّرُ سلوكُه.
 */
export interface QueryObservation {
  /** لحظةُ الكتابةِ إلى المقبس (ms، ساعةُ `realtimeMs`)، أو null إن لم تُرصد. */
  tWrite: number | null;
  /** لحظةُ صيرورتِه رأسَ الاتّصال. */
  tActive: number | null;
  /** صارَ رأسًا لاحقًا لا فورَ الكتابة، أي انتظرَ خلفَ استعلامٍ آخرَ على الاتّصالِ نفسِه. */
  pipelined: boolean | null;
  /** لحظةُ `resolve` (وصولُ `ReadyForQuery` ومعالجتُه). */
  tResolved: number | null;
}

export function observeQuery(query: object, now: () => number): QueryObservation {
  const obs: QueryObservation = { tWrite: null, tActive: null, pipelined: null, tResolved: null };
  const q = query as { state: unknown; active: unknown; resolve: unknown };
  let state = q.state;
  let active = q.active;
  let sameTurn = false;
  Object.defineProperty(q, "state", {
    configurable: true,
    enumerable: true,
    get: () => state,
    set: (v: unknown) => {
      if (v != null && obs.tWrite === null) {
        obs.tWrite = now();
        sameTurn = true;
        queueMicrotask(() => {
          sameTurn = false;
        });
      }
      state = v;
    },
  });
  Object.defineProperty(q, "active", {
    configurable: true,
    enumerable: true,
    get: () => active,
    set: (v: unknown) => {
      if (v === true && obs.tActive === null) {
        obs.tActive = now();
        obs.pipelined = !sameTurn;
      }
      active = v;
    },
  });
  const resolve = q.resolve;
  if (typeof resolve === "function") {
    q.resolve = (x: unknown) => {
      if (obs.tResolved === null) obs.tResolved = now();
      return (resolve as (x: unknown) => unknown)(x);
    };
  }
  return obs;
}

/**
 * عدّادُ ما في الطيرانِ على تجمّعٍ واحد: استعلاماتٌ أُصدِرَت ولم تنتهِ (`queries`)، ومعاملاتٌ مفتوحة
 * (`transactions`، كلٌّ منها يحجزُ اتّصالًا طوالَ عمرِه). يُقرأُ لحظةَ إصدارِ استعلامِ الالتقاط.
 * استعلاماتُ المعاملةِ الداخليّةُ لا تُعَدُّ مرّتين، فهي على الاتّصالِ المحجوزِ نفسِه.
 */
export interface PoolInflight {
  readonly queries: number;
  readonly transactions: number;
}

export interface PoolInflightCounter {
  read(): PoolInflight;
}

/**
 * يلفُّ `sql` تجمّعٍ بـProxy عدٍّ فقط: النداءُ الموسوم، و`unsafe`، و`begin`. والاستعلامُ يُعَدُّ حينَ يُنفَّذُ
 * فعلًا (`executed`)، فالمقاطعُ المتداخلةُ التي لا تُنفَّذُ وحدَها لا تُعَدّ. ويُنقَصُ عندَ استقرارِه
 * (`Symbol.species` = Promise فلا يُبنى استعلامٌ جديد). ولا يغيّرُ التوجيهَ ولا الترتيبَ ولا الاتّصال.
 */
export function instrumentPoolSql<T extends object>(
  sql: T,
): { readonly sql: T; readonly counter: PoolInflightCounter } {
  let queries = 0;
  let transactions = 0;
  const done = () => {
    queries -= 1;
  };
  const wrapQuery = (q: unknown): unknown => {
    if (q === null || typeof q !== "object" || !("executed" in q) || !("handle" in q)) return q;
    const target = q as { executed: unknown };
    let executed = target.executed;
    Object.defineProperty(target, "executed", {
      configurable: true,
      enumerable: true,
      get: () => executed,
      set: (v: unknown) => {
        if (v === true && executed !== true) {
          queries += 1;
          Promise.prototype.then.call(target, done, done);
        }
        executed = v;
      },
    });
    return q;
  };
  const proxy = new Proxy(sql, {
    apply(fn, thisArg, args) {
      return wrapQuery(Reflect.apply(fn as (...a: unknown[]) => unknown, thisArg, args));
    },
    get(obj, prop, receiver) {
      const v = Reflect.get(obj, prop, receiver);
      if (prop === "unsafe" && typeof v === "function") {
        return (...a: unknown[]) => wrapQuery((v as (...b: unknown[]) => unknown)(...a));
      }
      if (prop === "begin" && typeof v === "function") {
        return (...a: unknown[]) => {
          transactions += 1;
          const p = (v as (...b: unknown[]) => Promise<unknown>)(...a);
          const end = () => {
            transactions -= 1;
          };
          p.then(end, end);
          return p;
        };
      }
      return v;
    },
  });
  return { sql: proxy, counter: { read: () => ({ queries, transactions }) } };
}
