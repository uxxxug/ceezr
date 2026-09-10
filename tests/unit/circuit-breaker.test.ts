/**
 * الغرض: اختبارُ قاطعِ الدائرةِ (`F8-04` · ADR-0079): انتقالاتُ الحالةِ بساعةٍ
 *    مَحقونةٍ، وحجزُ مَسبَرِ النصفِ المفتوحِ، وألاّ يُغيِّرَ `snapshot` حالةً.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-04`.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا ساعةٌ مَحقونةٌ
 *
 * اختبارٌ ينتظرُ مهلةَ تبريدٍ حقيقيّةً يُطيلُ السلسلةَ ويصيرُ متقلّباً على آلةٍ
 * مشغولةٍ، فيُسكَّتُ أو يُصنَّفُ تخطّياً. والساعةُ المَحقونةُ تجعلُ الزمنَ مُدخَلاً
 * فيُقاسُ التبريدُ دونَ انتظارِ مللي ثانيةٍ واحدةٍ.
 */

import { describe, expect, test } from "bun:test";
import {
  type BreakerConfig,
  createCircuitBreaker,
} from "../../packages/shared/resilience/circuit-breaker.ts";

const CONFIG: BreakerConfig = {
  failureThreshold: 3,
  windowMs: 10_000,
  cooldownMs: 5_000,
  halfOpenProbes: 1,
};

/** ساعةٌ يدويّةٌ: الزمنُ مُدخَلٌ لا انتظارٌ. */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe("قاطعُ الدائرةِ (F8-04)", () => {
  test("١) يُقبَلُ النداءُ في الحالةِ المغلقةِ", () => {
    const breaker = createCircuitBreaker(CONFIG, clock().now);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.snapshot().state).toBe("closed");
  });

  test("٢) لا يُفتَحُ قبلَ بلوغِ العتبةِ، ويُفتَحُ عندَها", () => {
    const breaker = createCircuitBreaker(CONFIG, clock().now);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("closed");
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.tryAcquire()).toBe(false);
  });

  /**
   * **نجاحٌ متداخلٌ لا يُصفِّرُ النافذةَ عن قصدٍ**: من صفَّرَها بكلِّ نجاحٍ جعلَ
   * الاعتماديّةَ المتقلِّبةَ — تُخفِقُ واحدةً وتنجحُ واحدةً — لا تفتحُ القاطعَ
   * أبداً وهيَ أشدُّ ما يستحقُّ الفتحَ. والتصفيرُ محصورٌ في نجاحِ المَسبَرِ بعدَ
   * الفتحِ (الحالةُ ٨)، وذاكَ إفاقةٌ مُثبَتةٌ لا نجاحٌ عارضٌ.
   */
  test("٣) نجاحٌ متداخلٌ لا يُصفِّرُ النافذةَ المتدحرجةَ", () => {
    const breaker = createCircuitBreaker(CONFIG, clock().now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    expect(breaker.snapshot().failures).toBe(2);
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("open");
  });

  test("٤) نافذةٌ متدحرجةٌ: إخفاقٌ خارجَ النافذةِ لا يُحسَبُ", () => {
    const time = clock();
    const breaker = createCircuitBreaker(CONFIG, time.now);
    breaker.recordFailure();
    breaker.recordFailure();
    time.advance(CONFIG.windowMs + 1);
    breaker.recordFailure();
    // الإخفاقانِ الأوّلانِ سقطا من النافذةِ، فواحدٌ لا ثلاثةٌ.
    expect(breaker.snapshot().state).toBe("closed");
    expect(breaker.snapshot().failures).toBe(1);
  });

  test("٥) بعدَ التبريدِ يصيرُ نصفَ مفتوحٍ ويُقبَلُ مَسبَرٌ واحدٌ", () => {
    const time = clock();
    const breaker = createCircuitBreaker(CONFIG, time.now);
    for (let index = 0; index < CONFIG.failureThreshold; index += 1) breaker.recordFailure();
    expect(breaker.tryAcquire()).toBe(false);

    time.advance(CONFIG.cooldownMs + 1);
    expect(breaker.tryAcquire()).toBe(true);
    // **المَسبَرُ محجوزٌ لا مقروءٌ**: الثاني يُرَدُّ، وإلاّ انطلقَ على مزوّدٍ
    // معتلٍّ عددٌ غيرُ محدودٍ في اللحظةِ نفسِها.
    expect(breaker.tryAcquire()).toBe(false);
    expect(breaker.snapshot().state).toBe("half-open");
  });

  test("٦) `snapshot` لا يستهلكُ المَسبَرَ ولا يُغيِّرُ حالةً", () => {
    const time = clock();
    const breaker = createCircuitBreaker(CONFIG, time.now);
    for (let index = 0; index < CONFIG.failureThreshold; index += 1) breaker.recordFailure();
    time.advance(CONFIG.cooldownMs + 1);

    // قراءةٌ للتشخيصِ مرّاتٍ: لو كانت تحجزُ لسرقَتْ مَسبَرَ النداءِ الحقيقيِّ.
    breaker.snapshot();
    breaker.snapshot();
    breaker.snapshot();
    expect(breaker.tryAcquire()).toBe(true);
  });

  test("٧) إخفاقُ المَسبَرِ يُعيدُ الفتحَ ويُجدِّدُ التبريدَ", () => {
    const time = clock();
    const breaker = createCircuitBreaker(CONFIG, time.now);
    for (let index = 0; index < CONFIG.failureThreshold; index += 1) breaker.recordFailure();
    time.advance(CONFIG.cooldownMs + 1);
    expect(breaker.tryAcquire()).toBe(true);

    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.tryAcquire()).toBe(false);

    // ولا يُفتَحُ إلا بعدَ تبريدٍ **جديدٍ** يُحسَبُ من لحظةِ إخفاقِ المَسبَرِ.
    time.advance(CONFIG.cooldownMs - 1);
    expect(breaker.tryAcquire()).toBe(false);
    time.advance(2);
    expect(breaker.tryAcquire()).toBe(true);
  });

  test("٨) نجاحُ المَسبَرِ يُغلِقُ الدائرةَ ويرفعُ الحجزَ", () => {
    const time = clock();
    const breaker = createCircuitBreaker(CONFIG, time.now);
    for (let index = 0; index < CONFIG.failureThreshold; index += 1) breaker.recordFailure();
    time.advance(CONFIG.cooldownMs + 1);
    expect(breaker.tryAcquire()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.snapshot().state).toBe("closed");
    expect(breaker.snapshot().failures).toBe(0);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(true);
  });

  test("٩) عتبةٌ أو مَسبَرٌ دونَ الواحدِ يُسقِطُ البناءَ لا يُصحَّحُ صامتاً", () => {
    expect(() => createCircuitBreaker({ ...CONFIG, failureThreshold: 0 })).toThrow();
    expect(() => createCircuitBreaker({ ...CONFIG, halfOpenProbes: 0 })).toThrow();
  });

  test("١٠) `openedUntil` مُعلَنٌ في القراءةِ ليُبنى عليه `retryAfterMs`", () => {
    const time = clock(50_000);
    const breaker = createCircuitBreaker(CONFIG, time.now);
    for (let index = 0; index < CONFIG.failureThreshold; index += 1) breaker.recordFailure();
    expect(breaker.snapshot().openedUntil).toBe(50_000 + CONFIG.cooldownMs);
  });
});
