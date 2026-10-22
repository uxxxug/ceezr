import { describe, expect, test } from "bun:test";
import {
  createJobRunner,
  type JobDefinition,
  type JobLogger,
} from "../../apps/workers/src/runner.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import type { Clock } from "../../packages/shared/kernel/index.ts";

function fakeClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    advance: (ms) => {
      nowMs += ms;
    },
  };
}
function silentLog(): JobLogger {
  return { info: () => {}, error: () => {} };
}
function gate(): { release: () => void; promise: Promise<void> } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

describe("حدُّ ملكيةِ الحارسِ: نبضةُ شوطٍ سابقٍ لا تحذفُ حارسَ شوطٍ لاحقٍ (JOB-TICK-02)", () => {
  test("نبضةُ الشوطِ الأولِ تكتملُ أثناءَ شوطٍ ثانٍ جارٍ — فالشوطُ الثالثُ يُقصى لا يُوازيه", async () => {
    const clock = fakeClock(0);
    const runDurationMs = 9_000;
    const heartbeatWriteMs = 500;
    let starts = 0;
    let beats = 0;
    const heartbeatGate = gate();
    const run2Gate = gate(); // يوقف الشوطَ الثانيَ في منتصفِ مدِّه

    const jobs: JobDefinition[] = [
      {
        name: "drain",
        everySeconds: 5,
        runOnStart: true,
        run: async () => {
          starts += 1;
          if (starts === 2) await run2Gate.promise; // الشوطُ الثاني: يبقى جاريًا
          clock.advance(runDurationMs);
          return "ok";
        },
      },
    ];

    const runner = createJobRunner({
      lock: createNoopLock(),
      jobs,
      clock,
      log: silentLog(),
      heartbeat: {
        record: async () => {
          beats += 1;
          if (beats === 1) await heartbeatGate.promise; // نبضةُ الشوطِ الأولِ معلقة
          clock.advance(heartbeatWriteMs);
        },
      },
    });

    // t=0: الشوطُ الأولُ يبدأُ وينتهي مدُّه عند 9ث، وتنتظرُ سلسلةُ إنهائِه بوّابةَ النبضة.
    const first = runner.runDue();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // t=10ث: الحارسُ انتهى بانتهاءِ الشوطِ (الإصلاحُ JOB-TICK-01) — الشوطُ الثاني يبدأ
    // ويبقى جاريًا خلفَ بوّابتِه، ونبضةُ الشوطِ الأولِ ما تزالُ معلّقة.
    clock.advance(10_000 - runDurationMs);
    const second = runner.runDue();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(starts).toBe(2);

    // تكتملُ نبضةُ الشوطِ الأول: الـfinally الخاصُّ بهِ يُنفَّذُ الآن — لا يجوزُ أن يحذفَ
    // حارسَ الشوطِ الثاني الجاري.
    heartbeatGate.release();
    await first;

    // t=20ث: الشوطُ الثاني ما زالَ جاريًا — الثالثُ يجبُ أن يُقصى (skipped_overlapping).
    clock.advance(10_000);
    const third = await runner.runDue();
    expect(third[0]?.status).toBe("skipped_overlapping");
    expect(starts).toBe(2);

    // يكتملُ الشوطُ الثاني فتبدأُ الأشواطُ من جديد.
    run2Gate.release();
    await second;
    expect(starts).toBe(2);
  });
});
