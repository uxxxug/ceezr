/**
 * الغرض: إثباتُ منطقِ التصريفِ الرشيقِ في `createLifecycle` بمعزلٍ عن إشاراتِ
 *   النظامِ — الساعةُ والنومُ والخروجُ ومواردُ الإغلاقِ كلُّها مَحقونَة. ما يُختبرُ
 *   ههنا هو الحالةُ المُقَرَّرةُ في `F5-05`/`CAP-008`: إعلانُ التصريف، انتظارُ
 *   فراغِ الجاري ضمنَ مهلة، ثمّ إغلاقُ الموارد.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (`bun run test`).
 * ملاحظات مستقبلية: اختبارُ الإشارةِ الفعليِّ (`SIGTERM`) في اختبارِ العمليّةِ الفرعيِّ
 *   يُثبتُ التوصيلَ، وهذا يُثبتُ المنطقَ.
 */

import { describe, expect, it } from "bun:test";
import { createLifecycle, type ShutdownResources } from "../../apps/gateway/src/lifecycle.ts";

interface FakeState {
  closed: boolean;
  forceClosed: boolean;
}

/** مصنعُ مواردَ مزيفةٍ للاختبار. يُسجِّلُ كلَّ نداءٍ ويتحكَّمُ في عدَّادِ الجاري. */
function fakeResources(options?: {
  readonly initialInFlight?: number;
  readonly closeError?: unknown;
}): {
  readonly resources: ShutdownResources;
  readonly calls: string[];
  setInFlight(value: number): void;
  readonly state: FakeState;
} {
  let inFlight = options?.initialInFlight ?? 0;
  const calls: string[] = [];
  const state: FakeState = { closed: false, forceClosed: false };
  const resources: ShutdownResources = {
    inFlight: () => inFlight,
    forceClose: () => {
      state.forceClosed = true;
      calls.push("forceClose");
    },
    close: async () => {
      calls.push("close");
      state.closed = true;
      if (options?.closeError !== undefined) throw options.closeError;
    },
  };
  return {
    resources,
    calls,
    setInFlight: (value: number) => {
      inFlight = value;
    },
    state,
  };
}

/** ساعةٌ مُصطنعةٌ ونومٌ يُقدِّمُ الزمنَ — للتحكُّمِ حتميّاً. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("createLifecycle — التصريفُ الرشيقُ (F5-05 / CAP-008)", () => {
  it("غيرُ مُصرِّفٍ عند الإنشاء، ثمّ مُصرِّفاً بعد بدءِ الإيقاف", async () => {
    const { resources } = fakeResources();
    const lifecycle = createLifecycle({
      resources,
      graceMs: 100,
      now: () => 0,
      sleep: async () => {},
    });
    expect(lifecycle.isDraining()).toBe(false);
    void lifecycle.requestShutdown("SIGTERM");
    expect(lifecycle.isDraining()).toBe(true);
    await lifecycle.requestShutdown("SIGTERM");
  });

  it("التصريفُ الناجحُ: ينتظرُ فراغَ الجاري، يُغلقُ الموارد، يُعيدُ drained", async () => {
    const { resources, calls, setInFlight, state } = fakeResources({ initialInFlight: 1 });
    const clock = fakeClock();
    const lifecycle = createLifecycle({
      resources,
      graceMs: 1_000,
      now: clock.now,
      sleep: async () => {
        // عند أوّلِ استطلاعٍ بعدَ بدءِ التصريف: فرغَ الجاري.
        setInFlight(0);
      },
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(state.forceClosed).toBe(false);
    expect(state.closed).toBe(true);
    expect(calls).toContain("close");
    expect(result.outcome).toBe("drained");
    expect(result.signal).toBe("SIGTERM");
    expect(result.inFlightAtShutdown).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("الإغلاقُ القسريُّ عند انقضاءِ المهلة: الجاري لا يفرغُ أبداً ⇒ force_closed", async () => {
    const { resources, calls, state } = fakeResources({ initialInFlight: 3 });
    const clock = fakeClock();
    const lifecycle = createLifecycle({
      resources,
      graceMs: 50,
      now: clock.now,
      // النومُ يُقدِّمُ الساعةَ حتى يبلغَ الانتظارُ حدَّ المهلةِ — والجاري ثابتٌ لا ينزل.
      sleep: clock.sleep,
      pollIntervalMs: 5,
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(state.forceClosed).toBe(true);
    expect(calls).toContain("forceClose");
    expect(state.closed).toBe(true);
    expect(result.outcome).toBe("force_closed");
    expect(result.inFlightAtShutdown).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
  });

  it("idempotent: نداءانِ متزامنانِ يُعيدانِ النتيجةَ نفسَها ولا يُغلقانِ مرّتين", async () => {
    const { resources, state } = fakeResources({ initialInFlight: 0 });
    const lifecycle = createLifecycle({
      resources,
      graceMs: 100,
      now: () => 0,
      sleep: async () => {},
    });

    const a = lifecycle.requestShutdown("SIGTERM");
    const b = lifecycle.requestShutdown("SIGINT");
    const [resultA, resultB] = await Promise.all([a, b]);

    expect(resultA).toEqual(resultB);
    expect(state.closed).toBe(true);
  });

  it("فشلُ الإغلاقِ لا يمنعُ إكمالَ التصريف ولا يُسقطُ النتيجةَ", async () => {
    const { resources, state } = fakeResources({
      initialInFlight: 0,
      closeError: new Error("connection refused"),
    });
    const lifecycle = createLifecycle({
      resources,
      graceMs: 100,
      now: () => 0,
      sleep: async () => {},
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(state.closed).toBe(true);
    expect(result.outcome).toBe("drained");
  });
  it("نافذةُ الإعلانِ: `isDraining` يُرفَعُ ويُنتظَرُ قبلَ الإغلاقِ ولو لم يكن جارٍ", async () => {
    const { resources, state } = fakeResources({ initialInFlight: 0 });
    const sleeps: number[] = [];
    const observed = { seen: false, draining: false, closed: true };

    const lifecycle = createLifecycle({
      resources,
      graceMs: 10_000,
      announceMs: 500,
      now: () => 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        if (!observed.seen) {
          // أوّلُ نومٍ هو نافذةُ الإعلانِ: الحالةُ مُعلَنةٌ والمواردُ لم تُغلَق بعدُ.
          observed.seen = true;
          observed.draining = lifecycle.isDraining();
          observed.closed = state.closed;
        }
      },
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(sleeps[0]).toBe(500);
    expect(observed.seen).toBe(true);
    expect(observed.draining).toBe(true);
    expect(observed.closed).toBe(false);
    expect(state.closed).toBe(true);
    expect(result.outcome).toBe("drained");
  });

  it("بلا `announceMs` لا يُنتظَرُ شيءٌ — السلوكُ السابقُ محفوظٌ حرفاً", async () => {
    const { resources, state } = fakeResources({ initialInFlight: 0 });
    const sleeps: number[] = [];
    const lifecycle = createLifecycle({
      resources,
      graceMs: 10_000,
      now: () => 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(sleeps).toEqual([]);
    expect(state.closed).toBe(true);
    expect(result.outcome).toBe("drained");
  });

  it("طلبٌ جارٍ ينتهي خلالَ نافذةِ الإعلانِ ⇒ `drained` لا `force_closed`", async () => {
    const { resources, state, setInFlight } = fakeResources({ initialInFlight: 2 });
    let first = true;
    const lifecycle = createLifecycle({
      resources,
      graceMs: 10_000,
      announceMs: 500,
      now: () => 0,
      sleep: async () => {
        // خلالَ نافذةِ الإعلانِ فرغَ الجاريُ — فيُقرأُ العدّادُ بعدَها لا قبلَها.
        if (first) {
          first = false;
          setInFlight(0);
        }
      },
    });

    const result = await lifecycle.requestShutdown("SIGTERM");

    expect(result.outcome).toBe("drained");
    expect(result.inFlightAtShutdown).toBe(2);
    expect(state.forceClosed).toBe(false);
    expect(state.closed).toBe(true);
  });
});
