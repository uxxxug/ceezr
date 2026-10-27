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
