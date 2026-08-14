/**
 * الغرض: إثبات حكم صحّة المهامّ الدورية (§4.3): الغيابُ بعد الإمهال إخفاق، والغيابُ
 *   داخله إقلاعٌ لا إخفاق، والنبضةُ الأقدم من ضِعف تواترها بيات، والمهمّةُ المشروطة
 *   لا يُحاسَب غيابُها — وأنّ المشغّل ينبض فعلاً بعد كلّ شوط بحالته الصحيحة.
 * الحالة: اختبار وحدة حقيقي بلا قاعدة ولا شبكة — أُضيف في 2026-08-14.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test)، وكلّ تعديل على عتبة البيات أو على قائمة
 *   المهامّ الحرجة في apps/workers/src/container.ts
 */

import { describe, expect, test } from "bun:test";
import {
  createJobRunner,
  type JobDefinition,
  type JobLogger,
} from "../../apps/workers/src/runner.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import {
  describeJobHealth,
  evaluateJobHealth,
  type JobHeartbeatRecord,
  type JobHeartbeatRecorderPort,
  type JobHeartbeatRow,
  MIN_HEARTBEAT_GRACE_MS,
} from "../../packages/application/scheduling/job-heartbeat.ts";
import type { CityId, Clock } from "../../packages/shared/kernel/index.ts";

const CITY = "11111111-2222-3333-4444-555555555555" as CityId;
const NOW = new Date("2026-08-14T10:00:00.000Z");
/** إقلاعٌ قديم بما يكفي لتجاوز كلّ نوافذ الإمهال في هذا الملف. */
const BOOTED_LONG_AGO = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

function row(overrides: Partial<JobHeartbeatRow> & { jobName: string }): JobHeartbeatRow {
  return {
    cityId: CITY,
    lastRunAt: NOW,
    lastStatus: "ok",
    detail: null,
    ...overrides,
  };
}

function collectingRecorder(): JobHeartbeatRecorderPort & {
  readonly written: JobHeartbeatRecord[];
} {
  const written: JobHeartbeatRecord[] = [];
  return {
    written,
    record: async (input) => {
      written.push(input);
    },
  };
}

function fakeClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let nowMs = startMs;
  return {
    now: () => new Date(nowMs),
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

const silentLog: JobLogger = { info: () => {}, error: () => {} };

describe("evaluateJobHealth", () => {
  test("كل المهامّ نبضت في وقتها ⇒ ok بلا شيء في القوائم", () => {
    const health = evaluateJobHealth({
      expectations: [
        { jobName: `expire-offers:${CITY}`, everySeconds: 60 },
        { jobName: "expire-subscriptions", everySeconds: 900 },
      ],
      heartbeats: [
        row({ jobName: `expire-offers:${CITY}` }),
        row({ jobName: "expire-subscriptions" }),
      ],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("ok");
    expect(health.missing).toEqual([]);
    expect(health.stale).toEqual([]);
    expect(health.failing).toEqual([]);
  });

  test("مهمّة حرجة بلا نبضة بعد انقضاء الإمهال ⇒ failed باسمها", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: `expire-offers:${CITY}`, everySeconds: 60 }],
      heartbeats: [],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("failed");
    expect(health.missing).toEqual([`expire-offers:${CITY}`]);
    expect(describeJobHealth(health)).toContain(`expire-offers:${CITY}`);
  });

  test("الغياب داخل نافذة الإقلاع ليس إخفاقاً — وإلّا دخل النشر دورة إعادة تشغيل", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: `expire-offers:${CITY}`, everySeconds: 20 }],
      heartbeats: [],
      now: NOW,
      // أقلّ من أدنى إمهال: العملية أقلعت قبل ثانيتين ولم يدُر الشوط الأوّل بعد.
      startedAt: new Date(NOW.getTime() - 2000),
    });

    expect(health.status).toBe("ok");
    expect(health.missing).toEqual([]);
    expect(health.warming).toEqual([`expire-offers:${CITY}`]);
  });

  test("أدنى إمهالٍ يحمي المهامّ السريعة: ٢٠ ثانية لا تعني إمهال ٤٠ ثانية", () => {
    const justInside = evaluateJobHealth({
      expectations: [{ jobName: "fast", everySeconds: 20 }],
      heartbeats: [],
      now: NOW,
      startedAt: new Date(NOW.getTime() - (MIN_HEARTBEAT_GRACE_MS - 1000)),
    });
    const justOutside = evaluateJobHealth({
      expectations: [{ jobName: "fast", everySeconds: 20 }],
      heartbeats: [],
      now: NOW,
      startedAt: new Date(NOW.getTime() - (MIN_HEARTBEAT_GRACE_MS + 1000)),
    });

    expect(justInside.status).toBe("ok");
    expect(justOutside.status).toBe("failed");
  });

  test("نبضة أقدم من ضِعف التواتر ⇒ degraded لا failed", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: "recompute-ratings", everySeconds: 3600 }],
      heartbeats: [
        row({
          jobName: "recompute-ratings",
          // ثلاث ساعات: أكثر من ضِعف الساعة.
          lastRunAt: new Date(NOW.getTime() - 3 * 3600 * 1000),
        }),
      ],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("degraded");
    expect(health.stale).toEqual(["recompute-ratings"]);
    expect(health.missing).toEqual([]);
  });

  test("شوطٌ فائتٌ واحد يُغتفَر: نبضةٌ داخل ضِعف التواتر ما زالت ok", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: "expire-subscriptions", everySeconds: 900 }],
      heartbeats: [
        row({
          jobName: "expire-subscriptions",
          lastRunAt: new Date(NOW.getTime() - 1000 * 1000),
        }),
      ],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("ok");
  });

  test("نبضةٌ حديثة بحالة failed ⇒ degraded: عاملٌ حيٌّ فيه عطل", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: `expire-offers:${CITY}`, everySeconds: 60 }],
      heartbeats: [row({ jobName: `expire-offers:${CITY}`, lastStatus: "failed" })],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("degraded");
    expect(health.failing).toEqual([`expire-offers:${CITY}`]);
  });

  test("skipped ليست فشلاً: نسخة أخرى حملت القفل والمهمّة تعمل", () => {
    const health = evaluateJobHealth({
      expectations: [{ jobName: `expire-offers:${CITY}`, everySeconds: 60 }],
      heartbeats: [row({ jobName: `expire-offers:${CITY}`, lastStatus: "skipped" })],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(health.status).toBe("ok");
  });

  test("المهمّة المشروطة: غيابُها يُغتفَر، وبياتُها بعد أوّل نبضةٍ لا يُغتفَر", () => {
    const absent = evaluateJobHealth({
      expectations: [],
      optionalExpectations: [{ jobName: "backup-database", everySeconds: 86_400 }],
      heartbeats: [],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });
    const stale = evaluateJobHealth({
      expectations: [],
      optionalExpectations: [{ jobName: "backup-database", everySeconds: 86_400 }],
      heartbeats: [
        row({
          jobName: "backup-database",
          lastRunAt: new Date(NOW.getTime() - 3 * 86_400 * 1000),
        }),
      ],
      now: NOW,
      startedAt: BOOTED_LONG_AGO,
    });

    expect(absent.status).toBe("ok");
    expect(stale.status).toBe("degraded");
    expect(stale.stale).toEqual(["backup-database"]);
  });
});

describe("نبضة المشغّل", () => {
  test("الشوط الناجح يكتب ok بمعرّف المدينة وتفصيل الشوط", async () => {
    const heartbeat = collectingRecorder();
    const jobs: JobDefinition[] = [
      {
        name: `expire-offers:${CITY}`,
        everySeconds: 60,
        runOnStart: true,
        cityId: CITY,
        run: async () => "examined=3 expired=1",
      },
    ];
    const runner = createJobRunner({
      jobs,
      lock: createNoopLock(),
      clock: fakeClock(0),
      log: silentLog,
      heartbeat,
    });

    await runner.runDue();

    expect(heartbeat.written).toHaveLength(1);
    expect(heartbeat.written[0]).toEqual({
      jobName: `expire-offers:${CITY}`,
      cityId: CITY,
      status: "ok",
      detail: "examined=3 expired=1",
    });
  });

  test("الشوط الفاشل ينبض failed بسببه — لا صمتاً يُشبه الموت", async () => {
    const heartbeat = collectingRecorder();
    const runner = createJobRunner({
      jobs: [
        {
          name: "expire-subscriptions",
          everySeconds: 900,
          runOnStart: true,
          run: async () => {
            throw new Error("قاعدة مقطوعة");
          },
        },
      ],
      lock: createNoopLock(),
      clock: fakeClock(0),
      log: silentLog,
      heartbeat,
    });

    await runner.runDue();

    expect(heartbeat.written).toHaveLength(1);
    expect(heartbeat.written[0]?.status).toBe("failed");
    expect(heartbeat.written[0]?.cityId).toBeNull();
    expect(heartbeat.written[0]?.detail).toContain("قاعدة مقطوعة");
  });

  test("غياب منفذ النبضة لا يُسقط الشوط: الرصد اختياريّ لا شرطٌ للعمل", async () => {
    let ran = 0;
    const runner = createJobRunner({
      jobs: [
        {
          name: "no-heartbeat",
          everySeconds: 60,
          runOnStart: true,
          run: async () => {
            ran += 1;
            return "ok";
          },
        },
      ],
      lock: createNoopLock(),
      clock: fakeClock(0),
      log: silentLog,
    });

    const outcomes = await runner.runDue();

    expect(ran).toBe(1);
    expect(outcomes[0]?.status).toBe("ran");
  });
});
