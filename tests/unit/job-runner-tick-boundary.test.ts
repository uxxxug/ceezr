/**
 * الغرض: إثباتُ حدِّ السباقِ البنيويِّ بينَ مدّةِ شوطِ المهمّةِ (وكتابةِ نبضتِهِ
 *   اللاحقةِ) وبينَ نبضةِ المشغّلِ `tickMs`: شوطٌ تتجاوزُ حاويّتُه — المدةُ
 *   المقيسةُ + كتابةُ النبضةِ — حدودَ النبضةِ التاليةِ يُفوّتُ دورةً كاملةً
 *   فلا يبدأُ الشوطُ التالي إلا في النبضةِ التي تليها. هذا هوَ الجدارُ الذي
 *   يحكمُ سقفَ دورةِ عملِ مهمّةِ التصريفِ في LOAD-01: الميزانيةُ
 *   (`NOTIFICATION_DRAIN_BUDGET_MS`) وحدها لا ترفعُ الدورةَ فوقَ
 *   (نبضة − كتابةُ نبضة − هامش) مهما كانت قيمتُها؛ وما تجاوزَها منَ الميزانياتِ
 *   يجعلُ الفواتَ أرجحَ فيهبطُ الدورةَ بدلَ رفعِها (مُقيسٌ في b33m-idle v1:
 *   ميزانيةُ 9800 على نبضةِ 10ث أنتجتْ خمولاً 0.175–0.229 بدلَ ≤0.05).
 * الحالة: اختبارُ حدودٍ حتميٌّ بساعةٍ زائفةٍ وقفلٍ صامتٍ — يُنفَّذُ على شيفرةِ
 *   المشغّلِ نفسِها لا على محاكاةٍ خارجيةٍ لها.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test) + PROTOCOL-b33m-idle-v2.md
 * ملاحظات مستقبلية: إن اعتُمدَ تعديلُ بنيةِ الجدولةِ (شوطٌ يعيدُ جدولتَهُ
 *   بنفسِهِ أو نبضةٌ قابلةُ للضبطِ ببيئةٍ) فهذا الاختبارُ هوَ المرجعُ الذي
 *   يُثبتُ زوالَ الجدارِ أو بقائَه.
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

describe("حدُّ السباقِ بينَ الشوطِ والنبضةِ (LOAD-01)", () => {
  test("شوطٌ ينتهي مدُّه المقيسُ قبلَ النبضةِ لكنَّ نبضتَهُ تتجاوزُها يُفوّتُ دورةً كاملة", async () => {
    // السيناريو المقيسُ في b33m-idle v1 الموجةِ w3-on: مدةٌ مقيسةٌ 9.83ث
    // (الميزانيةُ + هامشُ حاراتِ التصريف) على نبضةِ 10ث، ثمّ كتابةُ نبضةٍ
    // (كتابةُ قاعدةٍ ~0.1–0.2ث) تُبقي المهمّةَ في `inFlight` بعدَ النبضةِ
    // التاليةِ فتُقصى `skipped_overlapping` ويبدأُ الشوطُ التالي بعدَ نبضتين.
    const clock = fakeClock(0);
    const runDurationMs = 9_830;
    const heartbeatWriteMs = 250;
    let starts = 0;
    const heartbeatGate = gate();

    const jobs: JobDefinition[] = [
      {
        name: "drain",
        everySeconds: 5,
        runOnStart: true,
        run: async () => {
          starts += 1;
          // المدةُ المقيسةُ: يتقدّمُ الزمنُ الزائفُ بمقدارِ الشوطِ (الميزانيةُ
          // + هامشُ الحارات) ثمّ يُحلُّ الوعدُ فوراً — كما في الإنتاجِ حيثَ
          // سجلُّ job.ran يُكتبُ قبلَ انتظارِ النبضة.
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
        // كتابةُ النبضةِ: معاملةُ قاعدةٍ تُبقي المهمّةَ في inFlight حتى تكتمل —
        // وهيَ خارجُ المدةِ المقيسةِ لكنّها داخلُ نافذةِ الاشتعالِ (inFlight).
        record: async () => {
          await heartbeatGate.promise;
          clock.advance(heartbeatWriteMs);
        },
      },
    });

    // النبضةُ الأولى عند t=0: يبدأُ الشوطُ وينتهي مدُّهُ المقيسُ عند 9.83ث،
    // ثمّ تنتظرُ سلسلةُ الإنهاءِ بوّابةَ كتابةِ النبضة.
    const first = runner.runDue();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // النبضةُ التاليةُ عند t=10ث: المهمّةُ ما تزالُ في inFlight (كتابةُ
    // النبضةِ معلّقةٌ) فتُقصى — وهذا هوَ الفواتُ الذي قاسَتْهُ v1.
    clock.advance(10_000 - runDurationMs);
    const second = await runner.runDue();
    expect(starts).toBe(1);
    expect(second[0]?.status).toBe("skipped_overlapping");

    // تكتملُ كتابةُ النبضةِ (t=10.08ث) فيُغلقُ الشوطُ الأولُ كاملًا.
    heartbeatGate.release();
    const firstOutcomes = await first;
    // المدةُ المقيسةُ لا تشملُ كتابةَ النبضةِ — سجلُّ job.ran كُتبَ قبلَها.
    expect(firstOutcomes[0]?.status).toBe("ran");
    expect(firstOutcomes[0]?.durationMs).toBe(runDurationMs);

    // الشوطُ التالي لا يبدأُ إلا في النبضةِ التي تليها (t=20ث): فجوةٌ
    // بنبضةٍ كاملةٍ (~10.17ث) بدلَ فجوةِ 0.17ث — هذا هوَ الجدارُ.
    clock.advance(20_000 - (runDurationMs + heartbeatWriteMs));
    const third = await runner.runDue();
    expect(starts).toBe(2);
    expect(third[0]?.status).toBe("ran");
  });

  test("شوطٌ تكتملُ حاويّتُهُ (المدةُ + النبضةُ) قبلَ النبضةِ التاليةِ يبدأُ التاليَ متلألئًا", async () => {
    // الجانبُ الآخرُ منَ الحدِّ نفسِهِ: ميزانيةٌ تُبقي المدةَ المقيسةَ
    // والنبضةَ معًا داخلَ النبضةِ (duty ≈ 97.5%) — أفضلُ ما تبلغُهُ
    // المهمّةُ داخلَ بنيةِ النبضةِ الحاليةِ بلاِ فواتٍ.
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
