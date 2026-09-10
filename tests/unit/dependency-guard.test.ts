/**
 * الغرض: اختبارُ حاجزِ الاعتماديّةِ (`F8-04` · ADR-0079): ترتيبُ القاطعِ قبلَ
 *    الحدِّ، وأنَّ المَسلَكَ يُحجَزُ حتّى **يستقرَّ** النداءُ لا حتّى تنقضيَ
 *    المهلةُ، وأنَّ الإشباعَ ليسَ إخفاقاً للاعتماديّةِ، وأنَّ الرمياتِ تُنقَلُ كما
 *    هيَ، وأنَّ الإخفاقَ العائدَ **قيمةً** يُرى عندَ القاطعِ بالتصنيفِ.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-04`.
 * ينتمي إلى: tests/unit
 *
 * ## أخطرُ ما ههنا
 *
 * الحالةُ ٥: نداءٌ عصى الإشارةَ واستقرَّ **بعدَ** المهلةِ. الحاجزُ يردُّ
 * المُنتَظِرَ عندَ المهلةِ، لكنَّ المَسلَكَ يبقى محجوزاً حتّى يستقرَّ النداءُ فعلاً.
 * ولو أُفرِجَ عندَ المهلةِ لصارَ الحدُّ كذباً: مئةُ نداءٍ عالقٍ وحاجزٌ يقولُ «لا
 * شيءَ مُنطلِقٌ». وهذا هوَ العطبُ الذي يُنتِجُه أبسطُ تنفيذٍ لحاجزٍ صحيحٍ ظاهراً.
 */

import { describe, expect, test } from "bun:test";
import {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  DEPENDENCY_NAMES,
  type GuardBudget,
} from "../../packages/shared/resilience/dependency-guard.ts";

const BUDGET: GuardBudget = {
  timeoutMs: 1_000,
  maxConcurrent: 2,
  failureThreshold: 2,
  windowMs: 10_000,
  cooldownMs: 5_000,
  halfOpenProbes: 1,
};

/** ساعةٌ ومهلةٌ يدويّتانِ: لا انتظارَ حقيقيَّ في أيِّ حالةٍ ههنا. */
function harness() {
  let value = 1_000;
  const timers: Array<() => void> = [];
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
    /** يُطلَقُ كلُّ مؤقّتٍ مُعلَّقٍ: أي «انقضَتِ المهلةُ الآن». */
    fireTimeouts: () => {
      const pending = timers.splice(0, timers.length);
      for (const fire of pending) fire();
    },
    delay: (_ms: number) => {
      let fire: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        fire = resolve;
      });
      timers.push(fire);
      return { promise, cancel: () => undefined };
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("حاجزُ الاعتماديّةِ (F8-04)", () => {
  test("١) لكلِّ اسمٍ ميزانيّةٌ، ولكلِّ ميزانيّةٍ اسمٌ", () => {
    for (const name of DEPENDENCY_NAMES) {
      const budget = DEPENDENCY_BUDGETS[name];
      expect(budget.timeoutMs).toBeGreaterThan(0);
      expect(budget.maxConcurrent).toBeGreaterThan(0);
      expect(budget.failureThreshold).toBeGreaterThan(0);
      expect(budget.halfOpenProbes).toBeGreaterThan(0);
    }
    expect(Object.keys(DEPENDENCY_BUDGETS).sort()).toEqual([...DEPENDENCY_NAMES].sort());
  });

  test("٢) النداءُ الناجحُ يُقبَلُ وتُعادُ قيمتُه", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    const outcome = await guard.run(async () => 42);
    expect(outcome).toEqual({ admitted: true, value: 42 });
    expect(guard.snapshot().breaker.state).toBe("closed");
  });

  test("٣) الإشارةُ تُمرَّرُ إلى النداءِ لتُطاعَ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    let seen: AbortSignal | null = null;
    await guard.run(async (signal) => {
      seen = signal;
      return 1;
    });
    expect(seen).not.toBeNull();
    expect((seen as unknown as AbortSignal).aborted).toBe(false);
  });

  test("٤) تجاوزُ المهلةِ يُلغي النداءَ ويُعَدُّ إخفاقاً", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    const hanging = deferred<number>();
    let aborted = false;

    const running = guard.run(async (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return await hanging.promise;
    });

    clock.fireTimeouts();
    const outcome = await running;

    expect(outcome.admitted).toBe(false);
    expect(outcome.admitted === false && outcome.rejection.reason).toBe("timeout");
    expect(aborted).toBe(true);
    expect(guard.snapshot().breaker.failures).toBe(1);
    hanging.resolve(0);
  });

  test("٥) المَسلَكُ محجوزٌ حتّى يستقرَّ النداءُ لا حتّى تنقضيَ المهلةُ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: { ...BUDGET, maxConcurrent: 1, failureThreshold: 99 },
      now: clock.now,
      delay: clock.delay,
    });
    const stubborn = deferred<number>();

    const first = guard.run(async () => await stubborn.promise);
    clock.fireTimeouts();
    expect((await first).admitted).toBe(false);

    // النداءُ الأوّلُ **لم يستقرَّ بعدُ**: الحدُّ ما زالَ مشغولاً، فالثاني يُرَدُّ
    // إشباعاً. ولو أُفرِجَ عندَ المهلةِ لقُبِلَ الثاني على مزوّدٍ لم يفرغْ.
    expect(guard.snapshot().bulkhead.inFlight).toBe(1);
    const second = await guard.run(async () => 7);
    expect(second.admitted === false && second.rejection.reason).toBe("saturated");

    stubborn.resolve(1);
    await stubborn.promise;
    await Promise.resolve();
    expect(guard.snapshot().bulkhead.inFlight).toBe(0);
  });

  test("٦) الإشباعُ ليسَ إخفاقاً للاعتماديّةِ فلا يفتحُ القاطعَ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: { ...BUDGET, maxConcurrent: 1, failureThreshold: 2 },
      now: clock.now,
      delay: clock.delay,
    });
    const busy = deferred<number>();
    const held = guard.run(async () => await busy.promise);

    for (let index = 0; index < 5; index += 1) {
      const rejected = await guard.run(async () => 0);
      expect(rejected.admitted === false && rejected.rejection.reason).toBe("saturated");
    }
    // خمسةُ رفضٍ للضيقِ عندَنا، والقاطعُ مغلقٌ: المزوّدُ لم يُسأَلْ فلا يُلامُ.
    expect(guard.snapshot().breaker.state).toBe("closed");

    busy.resolve(1);
    await held;
  });

  test("٧) القاطعُ يُقيَّمُ قبلَ الحدِّ: المفتوحُ يردُّ بلا حجزِ مَسلَكٍ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: { ...BUDGET, failureThreshold: 1 },
      now: clock.now,
      delay: clock.delay,
    });
    await guard
      .run(async () => {
        throw new Error("عطلٌ");
      })
      .catch(() => undefined);
    expect(guard.snapshot().breaker.state).toBe("open");

    let called = false;
    const outcome = await guard.run(async () => {
      called = true;
      return 1;
    });
    expect(called).toBe(false);
    expect(outcome.admitted === false && outcome.rejection.reason).toBe("open");
    // **ولا مَسلَكَ محجوزٌ**: الردُّ قبلَ الحجزِ، فلا يُستهلَكُ ما لا يُنادى به.
    expect(guard.snapshot().bulkhead.inFlight).toBe(0);
  });

  test("٨) `retryAfterMs` عندَ الفتحِ يُشتقُّ من التبريدِ المتبقّي", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: { ...BUDGET, failureThreshold: 1, cooldownMs: 5_000 },
      now: clock.now,
      delay: clock.delay,
    });
    await guard
      .run(async () => {
        throw new Error("عطلٌ");
      })
      .catch(() => undefined);

    clock.advance(2_000);
    const outcome = await guard.run(async () => 1);
    expect(outcome.admitted === false && outcome.rejection.retryAfterMs).toBe(3_000);
  });

  test("٩) الرميُ يُنقَلُ كما هوَ ولا يُحوَّلُ إلى رفضٍ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    const original = new TypeError("صنفُ الخطأِ يجبُ أن يبقى");
    await expect(
      guard.run(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(guard.snapshot().breaker.failures).toBe(1);
  });

  test("١٠) الإخفاقُ العائدُ قيمةً يُرى عندَ القاطعِ بالتصنيفِ وحدَه", async () => {
    const clock = harness();
    const build = () =>
      createDependencyGuard({
        dependency: "redis",
        budget: { ...BUDGET, failureThreshold: 2 },
        now: clock.now,
        delay: clock.delay,
      });

    // بلا تصنيفٍ: `503` مئةَ مرّةٍ نجاحٌ عندَ القاطعِ — وهوَ العَمى المقصودُ رفعُه.
    const blind = build();
    for (let index = 0; index < 5; index += 1) await blind.run(async () => ({ status: 503 }));
    expect(blind.snapshot().breaker.state).toBe("closed");

    const seeing = build();
    for (let index = 0; index < 2; index += 1) {
      const outcome = await seeing.run(async () => ({ status: 503 }), {
        failed: (value) => value.status >= 500,
      });
      // **والقيمةُ تُعادُ كما هيَ**: جوابٌ وصلَ فعلاً، وإنّما يُسجَّلُ الإخفاقُ.
      expect(outcome).toEqual({ admitted: true, value: { status: 503 } });
    }
    expect(seeing.snapshot().breaker.state).toBe("open");
  });

  test("١١) التصنيفُ لا يُغيِّرُ حكمَ الناجحِ", async () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "redis",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    const outcome = await guard.run(async () => ({ status: 200 }), {
      failed: (value) => value.status >= 500,
    });
    expect(outcome).toEqual({ admitted: true, value: { status: 200 } });
    expect(guard.snapshot().breaker.failures).toBe(0);
  });

  test("١٢) القراءةُ تُعلِنُ الاعتماديّةَ وحالتَي القاطعِ والحدِّ", () => {
    const clock = harness();
    const guard = createDependencyGuard({
      dependency: "telegram",
      budget: BUDGET,
      now: clock.now,
      delay: clock.delay,
    });
    expect(guard.snapshot()).toEqual({
      dependency: "telegram",
      breaker: { state: "closed", failures: 0, openedUntil: null },
      bulkhead: { inFlight: 0, maxConcurrent: BUDGET.maxConcurrent },
    });
  });
});
