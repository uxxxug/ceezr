/**
 * الغرض: إثبات سلوك مشغّل الجوبات نفسه: الاستحقاق بالتواتر، عزل الأعطال، منع
 *   التراكب، وتسجيل التوقيت حتى عند الفشل.
 * الحالة: اختبار وحدة حقيقي بلا شبكة ولا قاعدة — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test)
 * ملاحظات مستقبلية: عند إضافة قفل موزَّع تُضاف حالة «نسخة أخرى تحمل القفل».
 */

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

function silentLog(): JobLogger & { readonly errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    info: () => {},
    error: (message) => {
      errors.push(message);
    },
  };
}

describe("createJobRunner", () => {
  test("يشغّل مهمّة runOnStart في أول شوط، ولا يشغّل غيرها قبل استحقاقها", async () => {
    const clock = fakeClock(0);
    let eagerRuns = 0;
    let lazyRuns = 0;

    const jobs: JobDefinition[] = [
      {
        name: "eager",
        everySeconds: 60,
        runOnStart: true,
        run: async () => {
          eagerRuns += 1;
          return "ok";
        },
      },
      {
        name: "lazy",
        everySeconds: 60,
        run: async () => {
          lazyRuns += 1;
          return "ok";
        },
      },
    ];

    const runner = createJobRunner({ lock: createNoopLock(), jobs, clock, log: silentLog() });
    const first = await runner.runDue();

    expect(eagerRuns).toBe(1);
    expect(lazyRuns).toBe(0);
    expect(first.find((o) => o.name === "eager")?.status).toBe("ran");
    expect(first.find((o) => o.name === "lazy")?.status).toBe("skipped_not_due");
  });

  test("لا يُعيد تشغيل مهمّة قبل انقضاء تواترها، ويُعيدها بعده", async () => {
    const clock = fakeClock(1_000_000);
    let runs = 0;
    const jobs: JobDefinition[] = [
      {
        name: "minutely",
        everySeconds: 60,
        runOnStart: true,
        run: async () => {
          runs += 1;
          return `run#${runs}`;
        },
      },
    ];

    const runner = createJobRunner({ lock: createNoopLock(), jobs, clock, log: silentLog() });
    await runner.runDue();
    expect(runs).toBe(1);

    clock.advance(59_000);
    const tooEarly = await runner.runDue();
    expect(runs).toBe(1);
    expect(tooEarly[0]?.status).toBe("skipped_not_due");

    clock.advance(1_500);
    const due = await runner.runDue();
    expect(runs).toBe(2);
    expect(due[0]?.status).toBe("ran");
    expect(due[0]?.detail).toBe("run#2");
  });

  test("عطل مهمّة لا يُسقط أختها في نفس الشوط", async () => {
    const clock = fakeClock(0);
    let healthyRuns = 0;
    const log = silentLog();

    const jobs: JobDefinition[] = [
      {
        name: "broken",
        everySeconds: 60,
        runOnStart: true,
        run: async () => {
          throw new Error("القاعدة غير متاحة");
        },
      },
      {
        name: "healthy",
        everySeconds: 60,
        runOnStart: true,
        run: async () => {
          healthyRuns += 1;
          return "ok";
        },
      },
    ];

    const runner = createJobRunner({ lock: createNoopLock(), jobs, clock, log });
    const outcomes = await runner.runDue();

    expect(healthyRuns).toBe(1);
    const broken = outcomes.find((o) => o.name === "broken");
    expect(broken?.status).toBe("failed");
    expect(broken?.detail).toBe("القاعدة غير متاحة");
    expect(log.errors).toEqual(["job.failed"]);
  });

  test("مهمّة تفشل باستمرار لا تُشغَّل في كل نبضة: توقيت الفشل يُسجَّل أيضاً", async () => {
    const clock = fakeClock(0);
    let attempts = 0;
    const jobs: JobDefinition[] = [
      {
        name: "always-broken",
        everySeconds: 60,
        runOnStart: true,
        run: async () => {
          attempts += 1;
          throw new Error("فشل دائم");
        },
      },
    ];

    const runner = createJobRunner({ lock: createNoopLock(), jobs, clock, log: silentLog() });
    await runner.runDue();
    await runner.runDue();
    await runner.runDue();

    expect(attempts).toBe(1);

    clock.advance(61_000);
    await runner.runDue();
    expect(attempts).toBe(2);
  });

  test("لا يبدأ شوطاً ثانياً لمهمّة لم ينتهِ شوطها الأول", async () => {
    const clock = fakeClock(0);
    let starts = 0;
    // حاوية بدل متغيّر مباشر: TypeScript لا يتبع الإسناد داخل دالّة رد النداء،
    // فيضيّق النوع إلى null ويعتبر النداء لاحقاً غير ممكن.
    const gate: { release: (() => void) | null } = { release: null };

    const jobs: JobDefinition[] = [
      {
        name: "slow",
        everySeconds: 1,
        runOnStart: true,
        run: async () => {
          starts += 1;
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
          return "done";
        },
      },
    ];

    const runner = createJobRunner({ lock: createNoopLock(), jobs, clock, log: silentLog() });
    const firstRun = runner.runDue();
    // ننتظر دورة حدث واحدة حتى يدخل الشوط الأول فعلاً في الانتظار.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    clock.advance(5_000);
    const overlapping = await runner.runDue();
    expect(starts).toBe(1);
    expect(overlapping[0]?.status).toBe("skipped_overlapping");

    gate.release?.();
    const finished = await firstRun;
    expect(finished[0]?.status).toBe("ran");
  });

  test("start و stop يعكسان حالة التشغيل ولا يتكرّران", () => {
    const clock = fakeClock(0);
    const runner = createJobRunner({
      lock: createNoopLock(),
      jobs: [],
      clock,
      log: silentLog(),
      tickMs: 3_600_000,
    });

    expect(runner.running).toBe(false);
    runner.start();
    expect(runner.running).toBe(true);
    runner.start();
    expect(runner.running).toBe(true);
    runner.stop();
    expect(runner.running).toBe(false);
    runner.stop();
    expect(runner.running).toBe(false);
  });

  test("قفل مرفوض يعطي skipped_locked_elsewhere ولا يُشغّل المهمّة ولا يُسجّل وقتاً", async () => {
    const clock = fakeClock(0);
    let ran = 0;
    const runner = createJobRunner({
      // قفل يرفض دائماً: يحاكي نسخة أخرى تعمل الآن على نفس المهمّة.
      lock: { withLock: async () => ({ acquired: false }) },
      jobs: [
        {
          name: "locked",
          everySeconds: 60,
          runOnStart: true,
          run: async () => {
            ran += 1;
            return "لا ينبغي أن يُنفَّذ";
          },
        },
      ],
      clock,
      log: silentLog(),
    });

    const first = await runner.runDue();
    expect(first[0]?.status).toBe("skipped_locked_elsewhere");
    expect(ran).toBe(0);

    // الوقت لم يُسجَّل، فالمهمّة لا تزال مستحقّة في النبضة التالية بلا انتظار فاصل.
    const second = await runner.runDue();
    expect(second[0]?.status).toBe("skipped_locked_elsewhere");
  });

  test("مهمّة تخطّاها القفل تعمل في الشوط التالي حين يتحرّر", async () => {
    const clock = fakeClock(0);
    let allow = false;
    const runner = createJobRunner({
      lock: {
        withLock: async (_key, run) =>
          allow ? { acquired: true as const, value: await run() } : { acquired: false as const },
      },
      jobs: [{ name: "eventual", everySeconds: 60, runOnStart: true, run: async () => "تمّ" }],
      clock,
      log: silentLog(),
    });

    expect((await runner.runDue())[0]?.status).toBe("skipped_locked_elsewhere");
    allow = true;
    const after = await runner.runDue();
    expect(after[0]?.status).toBe("ran");
    expect(after[0]?.detail).toBe("تمّ");
  });

  test("التوازي محدود بالسقف: لا تعمل مهامّ أكثر منه في اللحظة نفسها", async () => {
    const clock = fakeClock(0);
    let active = 0;
    let peak = 0;

    const jobs: JobDefinition[] = Array.from({ length: 9 }, (_, index) => ({
      name: `job-${index}`,
      everySeconds: 60,
      runOnStart: true,
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return "تمّ";
      },
    }));

    const outcomes = await createJobRunner({
      lock: createNoopLock(),
      jobs,
      clock,
      log: silentLog(),
      maxConcurrency: 3,
    }).runDue();

    // الذروة ثلاثة لا تسعة: كل مهمّة جارية تحتجز اتصال قفل، فالتوازي غير المحدود
    // يستنزف تجمّع الاتصالات ويُسقط المهامّ جميعاً بمهلة انتظار.
    expect(peak).toBe(3);
    expect(outcomes.filter((outcome) => outcome.status === "ran").length).toBe(9);
  });

  test("سقف توازٍ صفر أو سالب يُصحَّح إلى واحد لا يُعطّل المشغّل", async () => {
    const clock = fakeClock(0);
    const outcomes = await createJobRunner({
      lock: createNoopLock(),
      jobs: [{ name: "solo", everySeconds: 60, runOnStart: true, run: async () => "تمّ" }],
      clock,
      log: silentLog(),
      maxConcurrency: 0,
    }).runDue();

    expect(outcomes[0]?.status).toBe("ran");
  });
});
