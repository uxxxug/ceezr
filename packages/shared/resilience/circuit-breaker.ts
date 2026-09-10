/**
 * الغرض: قاطعُ دائرةٍ واحدٌ لكلِّ اعتماديّةٍ خارجيّةٍ (`CAP-006` · `F8-04`).
 *   يمنعُ أن يستمرَّ الطالبُ في قرعِ بابٍ ثبتَ أنّه مغلقٌ: بعدَ عددٍ مُعلَنٍ من
 *   الإخفاقاتِ في نافذةٍ زمنيّةٍ يُفتَحُ القاطعُ، فترتدُّ النداءاتُ **فوراً** بدلَ
 *   أن ينتظرَ كلُّ واحدٍ منها ميزانيتَه الكاملةَ.
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: shared/resilience
 * يُتوقع أن يستخدمه لاحقاً: `dependency-guard.ts` وحدَه. لا يُستعملُ مباشرةً في
 *   مُحوِّلٍ: تركيبُ القاطعِ معَ الحدِّ والمهلةِ في موضعٍ واحدٍ أصدقُ من تركيبٍ
 *   يُعادُ في كلِّ مُحوِّلٍ بترتيبٍ مختلفٍ.
 * ملاحظات مستقبلية: نشرُ حالةِ القاطعِ مقياساً موضعُه `F8-02` لا هذا الملفّ.
 */

/**
 * حالاتُ القاطعِ الثلاثُ. **و`half-open` ليست تجميلاً**: من انتقلَ من `open` إلى
 * `closed` مباشرةً أطلقَ كلَّ الحملِ المحتجزِ على خادمٍ لم يُثبِتْ بعدُ أنّه أفاقَ،
 * فأسقطَه من جديدٍ — وتلكَ حلقةٌ تُسمّى الرعشةَ (flapping).
 */
export type BreakerState = "closed" | "open" | "half-open";

/**
 * الإعداداتُ. كلُّها إلزاميّةٌ عن قصدٍ: قيمةٌ افتراضيّةٌ ههنا تعني رقماً يُطبَّقُ
 * على اعتماديّةٍ لم يُقرَّرْ لها شيءٌ، والأرقامُ المُقرَّرةُ موضعُها
 * `DEPENDENCY_BUDGETS` في `dependency-guard.ts` — مصدرُ حقيقةٍ واحدٌ.
 */
export interface BreakerConfig {
  /** عددُ الإخفاقاتِ المتتاليةِ في النافذةِ الذي يفتحُ القاطعَ. أقلُّه ١. */
  readonly failureThreshold: number;
  /** طولُ النافذةِ التي تُعَدُّ فيها الإخفاقاتُ بالميلي ثانية. */
  readonly windowMs: number;
  /** ما يُنتظَرُ في `open` قبلَ السماحِ بمَجَسٍّ واحدٍ. */
  readonly cooldownMs: number;
  /** عددُ المجسّاتِ المسموحةِ في `half-open`. أقلُّه ١. */
  readonly halfOpenProbes: number;
}

/** لقطةٌ للقراءةِ فقط — للتشخيصِ وللاختبارِ، ولا يُبنى عليها قرارٌ في الشيفرةِ. */
export interface BreakerSnapshot {
  readonly state: BreakerState;
  /** عددُ الإخفاقاتِ المحسوبةِ الآنَ داخلَ النافذةِ. */
  readonly failures: number;
  /** متى يُسمَحُ بمَجَسٍّ، بالميلي ثانية من مَبدأِ الساعةِ المُمرَّرةِ. `null` إن لم يكنِ القاطعُ مفتوحاً. */
  readonly openedUntil: number | null;
}

export interface CircuitBreaker {
  /**
   * هل يُسمَحُ بنداءٍ الآنَ؟ **ويُحجَزُ المَجَسُّ عندَ السماحِ في `half-open`** —
   * فالسؤالُ ليسَ قراءةً بريئةً بل مُطالبةٌ بإذنٍ، ومن جعلَه قراءةً بريئةً سمحَ
   * لعشرةِ طالبينَ متزامنينَ أن يقرأوا «مسموحٌ» فيصيرَ المَجَسُّ الواحدُ عشرةً.
   */
  tryAcquire(): boolean;
  /** يُبلَّغُ بعدَ نداءٍ استقرَّ نجاحاً. */
  recordSuccess(): void;
  /** يُبلَّغُ بعدَ نداءٍ استقرَّ إخفاقاً بنيويّاً (رميٌ أو تجاوزُ مهلةٍ). */
  recordFailure(): void;
  snapshot(): BreakerSnapshot;
}

/**
 * يُنشئُ قاطعاً. **والساعةُ مُمرَّرةٌ لا مقروءةٌ من `Date.now()` داخلاً**: قاطعٌ
 * يقرأُ الساعةَ الحقيقيّةَ لا يُختبَرُ إلاّ بانتظارٍ حقيقيٍّ، فتصيرُ اختباراتُه
 * بطيئةً فتُتخطّى فلا يبقى مُثبَتاً منها شيءٌ.
 */
export function createCircuitBreaker(
  config: BreakerConfig,
  now: () => number = () => Date.now(),
): CircuitBreaker {
  if (config.failureThreshold < 1) {
    throw new Error("failureThreshold أقلُّه ١ — قاطعٌ بحدٍّ صفرٍ مفتوحٌ دائماً");
  }
  if (config.halfOpenProbes < 1) {
    throw new Error("halfOpenProbes أقلُّه ١ — قاطعٌ بلا مَجَسٍّ لا يُغلَقُ أبداً");
  }

  let state: BreakerState = "closed";
  /** أزمنةُ الإخفاقاتِ، تُقصَّرُ من رأسِها كلَّما خرجَت من النافذةِ. */
  let failureTimes: number[] = [];
  let openedUntil: number | null = null;
  /** مجسّاتٌ مُنطلِقةٌ لم تستقرَّ بعدُ. */
  let probesInFlight = 0;

  function pruneWindow(at: number): void {
    const cutoff = at - config.windowMs;
    if (failureTimes.length > 0 && failureTimes[0] !== undefined && failureTimes[0] <= cutoff) {
      failureTimes = failureTimes.filter((t) => t > cutoff);
    }
  }

  function open(at: number): void {
    state = "open";
    openedUntil = at + config.cooldownMs;
    probesInFlight = 0;
    failureTimes = [];
  }

  return {
    tryAcquire(): boolean {
      const at = now();
      if (state === "open") {
        if (openedUntil !== null && at < openedUntil) return false;
        // انتهى التهدئةُ: يُسمَحُ بمَجَسٍّ واحدٍ لا بالحملِ كلِّه.
        state = "half-open";
        openedUntil = null;
        probesInFlight = 0;
      }
      if (state === "half-open") {
        if (probesInFlight >= config.halfOpenProbes) return false;
        probesInFlight += 1;
        return true;
      }
      pruneWindow(at);
      return true;
    },

    recordSuccess(): void {
      if (state === "half-open") {
        // مَجَسٌّ نجحَ ⇦ يُغلَقُ القاطعُ ويُنسى ما قبلَه: النافذةُ القديمةُ تصفُ
        // عطلاً انتهى، وإبقاؤها يُعيدُ الفتحَ بأوّلِ إخفاقٍ عارضٍ بعدَ الإفاقةِ.
        state = "closed";
        failureTimes = [];
        probesInFlight = 0;
        openedUntil = null;
        return;
      }
      if (state === "closed") {
        pruneWindow(now());
      }
    },

    recordFailure(): void {
      const at = now();
      if (state === "half-open") {
        // مَجَسٌّ أخفقَ ⇦ يُعادُ الفتحُ بتهدئةٍ كاملةٍ من جديدٍ.
        open(at);
        return;
      }
      if (state === "open") return;
      pruneWindow(at);
      failureTimes.push(at);
      if (failureTimes.length >= config.failureThreshold) open(at);
    },

    snapshot(): BreakerSnapshot {
      const at = now();
      // القراءةُ لا تُغيِّرُ الحالةَ: من جعلَ اللقطةَ تنقلُ `open` إلى `half-open`
      // جعلَ التشخيصَ يستهلكُ المَجَسَّ، فصارَ النظرُ في العطلِ سبباً لعطلٍ.
      let visible: BreakerState = state;
      if (state === "open" && openedUntil !== null && at >= openedUntil) visible = "half-open";
      if (visible === "closed") pruneWindow(at);
      return {
        state: visible,
        failures: visible === "closed" ? failureTimes.length : 0,
        openedUntil: state === "open" ? openedUntil : null,
      };
    },
  };
}
