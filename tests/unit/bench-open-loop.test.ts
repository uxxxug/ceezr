/**
 * الغرض: اختبارُ حاكمِ الحمل المفتوح — جدول الوصول، عدم انغلاقه على زمن الاستجابة،
 *        والإفصاح عن انزلاق المولّد والأخطاء بدل طمسها.
 * الحالة: منفّذ فعلياً — وحدة 2-3 من استعادة محيط القياس.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي مزيج حركة أو خط أساس يعتمد bench/open-loop.ts.
 * ملاحظات مستقبلية: الاختبارات تستبدل الساعة كي تحكم على قانون الوصول لا سرعة جهاز CI.
 */

import { describe, expect, test } from "bun:test";
import {
  buildArrivalSchedule,
  type OpenLoopClock,
  runOpenLoop,
  summarizeDistribution,
} from "../../bench/open-loop.ts";

function controllableClock(extraDelayMs = 0): OpenLoopClock {
  let current = 0;
  return {
    now: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds + extraDelayMs;
    },
  };
}

describe("جدول الوصول المفتوح", () => {
  test("يحوّل معدل الوصول والمدة إلى مواعيد ثابتة أقل من نهاية النافذة", () => {
    expect(buildArrivalSchedule(5, 1_000)).toEqual([0, 200, 400, 600, 800]);
  });

  test("يرفض المعدل أو المدة غير الموجبة بدل قياس تشغيلٍ بلا معنى", () => {
    expect(() => buildArrivalSchedule(0, 1_000)).toThrow("arrivalRatePerSecond");
    expect(() => buildArrivalSchedule(10, 0)).toThrow("durationMs");
  });
});

describe("مشغّل الحمل المفتوح", () => {
  test("يطلق المحاولات التالية قبل اكتمال الطلب البطيء — ليس حلقةً مغلقة", async () => {
    const completions: Array<() => void> = [];
    let launched = 0;
    const report = await runOpenLoop({
      arrivalRatePerSecond: 4,
      durationMs: 1_000,
      clock: controllableClock(),
      workload: async () =>
        new Promise((resolve) => {
          launched += 1;
          completions.push(() => resolve({ status: 202 }));
          if (launched === 4) {
            for (const complete of completions) complete();
          }
        }),
    });

    expect(launched).toBe(4);
    expect(report.scheduled).toBe(4);
    expect(report.completed).toBe(4);
    expect(report.maxInFlight).toBe(4);
    expect(report.statusCounts).toEqual({ "202": 4 });
  });

  test("يكشف انزلاق ساعة المولّد والأخطاء الشبكية في التقرير", async () => {
    let calls = 0;
    const report = await runOpenLoop({
      arrivalRatePerSecond: 2,
      durationMs: 1_000,
      clock: controllableClock(25),
      workload: async () => {
        calls += 1;
        if (calls === 2) throw new Error("socket closed");
        return { status: 204 };
      },
    });

    expect(report.schedulingLag.maxMs).toBeGreaterThan(0);
    expect(report.failed).toBe(1);
    expect(report.errors).toEqual({ "socket closed": 1 });
    expect(report.statusCounts).toEqual({ "204": 1 });
  });
});

describe("تلخيص التوزيع", () => {
  test("لا يخفي العيّنة الفارغة خلف قيمة غير منتهية", () => {
    expect(summarizeDistribution([])).toEqual({
      count: 0,
      minMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    });
  });

  test("يحسب المئينات من عيّنة مرتبة بلا تقريب يُنقص الذيل", () => {
    const summary = summarizeDistribution([100, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(summary.meanMs).toBe(55);
    expect(summary.p50Ms).toBe(50);
    expect(summary.p95Ms).toBe(100);
    expect(summary.p99Ms).toBe(100);
  });
});
