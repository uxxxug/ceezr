/**
 * الغرض: اختبارُ حدودِ السباقِ بينَ مدّةِ شوطِ المهمّةِ وبينَ نبضةِ المشغّلِ
 *   `tickMs` — وهوَ اختبارُ الانحدارِ لإصلاحِ `JOB-TICK-01`: كانَت كتابةُ
 *   النبضةِ (رصدٌ لا عمل) تُبقي المهمّةَ في `inFlight` بعدَ انتهاءِ الشوطِ
 *   نفسِه، فكلُّ كتابةٍ تتجاوزُ حدودَ النبضةِ التاليةِ (كلَّ 60 ثانيةٍ في
 *   `ok` المتكرّر) كانت تُسقِطُ الشوطَ التاليَ كاملًا (`skipped_overlapping`)
 *   فيخملُ التصريفُ دورةً كاملةً بلا سببٍ. الإصلاحُ: حراسةُ التراكبِ تنتهي
 *   بانتهاءِ الشوطِ (تحريرُ `inFlight` قبلَ `await beat`) لا بانتهاءِ دفترِه.
 * الحالة: اختبارُ حدودٍ حتميٌّ بساعةٍ زائفةٍ وقفلٍ صامتٍ — يُنفَّذُ على شيفرةِ
 *   المشغّلِ نفسِها لا على محاكاةٍ خارجيةٍ لها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test)
 * ملاحظات مستقبلية: إن عادَت كتابةُ النبضةِ إلى داخلِ نافذةِ `inFlight` فهذا
 *   الاختبارُ هوَ الذي يُثبتُ عودةَ الجدارِ.
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

function silentLog(): JobLogger {
  return { info: () => {}, error: () => {} };
}

/** بوّابةٌ تُغلَقُ فتُوقفُ السلسلةَ، وتُفتَحُ فتُكملُها — تحكّمٌ حتميٌّ بالترتيب. */
function gate(): { release: () => void; promise: Promise<void> } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

describe("حدُّ السباقِ بينَ الشوطِ والنبضةِ (LOAD-01 · JOB-TICK-01)", () => {
  test("شوطٌ انتهى قبلَ النبضةِ التاليةِ لا يُقصى ولو بقيت كتابةُ نبضتِهِ معلّقةً", async () => {
    // السيناريو المقيسُ في b33m-idle v1 الموجةِ w3-on: مدةٌ مقيسةٌ 9.83ث
    // (الميزانيةُ + هامشُ حاراتِ التصريف) على نبضةِ 10ث، ثمّ كتابةُ نبضةٍ
    // (كتابةُ قاعدةٍ ~0.1–0.2ث). قبلَ الإصلاحِ كانت الكتابةُ تُبقي المهمّةَ
    // في `inFlight` بعدَ النبضةِ التاليةِ فتُقصى ويبدأُ الشوطُ بعدَ نبضتين؛
    // بعدَ الإصلاحِ ينتهي الحارسُ بانتهاءِ الشوطِ نفسِه فيبدأُ التالي متلألئًا.
    const clock = fakeClock(0);
    const runDurationMs = 9_830;
    const heartbeatWriteMs = 250;
    let starts = 0;
    let beats = 0;
    const heartbeatGate = gate();

    const jobs: JobDefinition[] = [
      {
        name: "drain",
        everySeconds: 5,
        runOnStart: true,
        run: async () => {
          starts += 1;
          // المدةُ المقيسةُ: يتقدّمُ الزمنُ الزائفُ بمقدارِ الشوطِ ثمّ يُحلُّ
          // الوعدُ فوراً — كما في الإنتاجِ حيثَ سجلُّ job.ran يُكتبُ قبلَ
          // انتظارِ النبضة.
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
        // كتابةُ النبضةِ: معاملةُ قاعدةٍ تُبقي الدفترَ معلّقًا — وهيَ خارجُ
        // المدةِ المقيسةِ، وبعدَ الإصلاحِ خارجَ نافذةِ الاشتعالِ أيضًا. البوّابةُ
        // لنبضةِ الشوطِ الأولِ وحده: الثانيةُ تُكملُ بلا انتظارٍ كي لا تنسدّ السلسلة.
        record: async () => {
          beats += 1;
          if (beats === 1) await heartbeatGate.promise;
          clock.advance(heartbeatWriteMs);
        },
      },
    });

    // النبضةُ الأولى عند t=0: يبدأُ الشوطُ وينتهي مدُّهُ المقيسُ عند 9.83ث،
    // ثمّ تنتظرُ سلسلةُ الإنهاءِ بوّابةَ كتابةِ النبضة.
    const first = runner.runDue();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // النبضةُ التاليةُ عند t=10ث: كتابةُ نبضةِ الشوطِ الأولِ ما تزالُ معلّقةً،
    // لكنَّ الحارسَ انتهى بانتهاءِ الشوطِ نفسِه — فالشوطُ التاليُ يبدأُ ولا
    // يُقصى. هذا هوَ جوهرُ إصلاحِ JOB-TICK-01.
    clock.advance(10_000 - runDurationMs);
    const second = await runner.runDue();
    expect(starts).toBe(2);
    expect(second[0]?.status).toBe("ran");

    // تكتملُ كتابةُ نبضةِ الشوطِ الأول: المدةُ المقيسةُ لا تشملُ الكتابةَ —
    // سجلُّ job.ran كُتبَ قبلَها.
    heartbeatGate.release();
    const firstOutcomes = await first;
    expect(firstOutcomes[0]?.status).toBe("ran");
    expect(firstOutcomes[0]?.durationMs).toBe(runDurationMs);
  });

  test("شوطٌ تكتملُ حاويّتُهُ (المدةُ + النبضةُ) قبلَ النبضةِ التاليةِ يبدأُ التاليَ متلألئًا", async () => {
    // الجانبُ الآخرُ منَ الحدِّ نفسِهِ: ميزانيةٌ تُبقي المدةَ المقيسةَ
    // والنبضةَ معًا داخلَ النبضةِ (duty ≈ 97.5%) — أفضلُ ما تبلغُهُ المهمّةُ
    // داخلَ بنيةِ النبضةِ الحاليةِ بلاِ فواتٍ. الإصلاحُ لا يُغيّرُ هذا
    // الجانبَ (السلوكُ سليمٌ فيهِ أصلًا).
    const clock = fakeClock(0);
    const runDurationMs = 9_500;
    const heartbeatWriteMs = 250;
    let starts = 0;

    const jobs: JobDefinition[] = [
      {
        name: "drain",
        everySeconds: 5,
        runOnStart: true,
        run: async () => {
          starts += 1;
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
          clock.advance(heartbeatWriteMs);
        },
      },
    });

    const first = await runner.runDue();
    expect(starts).toBe(1);
    expect(first[0]?.durationMs).toBe(runDurationMs);
    // انتهى كلُّ شيءٍ (مدّةٌ + نبضةٌ) عند t=9.75ث قبلَ النبضةِ التاليةِ.
    expect(clock.now().getTime()).toBe(runDurationMs + heartbeatWriteMs);

    clock.advance(10_000 - (runDurationMs + heartbeatWriteMs));
    const second = await runner.runDue();
    expect(starts).toBe(2);
    expect(second[0]?.status).toBe("ran");
    // الفجوةُ بينَ نهايةِ الحاويةِ والنبضةِ التاليةِ: 0.25ث فقط — أيْ خمولٌ
    // بنيويٌّ (0.25/10 = 2.5%) هوَ سقفُ ما تمنحُهُ البنيةُ بلاِ فواتٍ.
  });
});
