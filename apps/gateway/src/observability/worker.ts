/**
 * الغرض: تحويل سجل مشغّل المهامّ المنظم إلى مقاييس تشغيلية، مع إبقاء السجل الأصلي
 *   كما هو حتى تبقى حقول الخطأ قابلة للبحث في Render.
 * الحالة: منفّذ فعلياً — يحتاج تمرير JobLogger الناتج إلى العامل المدمج أو المستقل.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts وapps/workers/src/index.ts.
 * ملاحظات مستقبلية: لا تُحلّل detail كمصدر حقول؛ هو نص تشخيصي وقد يتغير.
 */

import type { OperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";
import type { JobLogger } from "../../../workers/src/runner.ts";

export interface WorkerLogSink {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createObservabilityJobLogger(
  metrics: OperationalMetrics,
  sink: WorkerLogSink,
  now: () => Date = () => new Date(),
): JobLogger {
  function jobOf(fields: Record<string, unknown> | undefined): string | null {
    const job = fields?.job;
    return typeof job === "string" && job !== "" ? job : null;
  }

  function durationOf(fields: Record<string, unknown> | undefined): number {
    const duration = fields?.durationMs;
    return typeof duration === "number" && Number.isFinite(duration) ? duration : 0;
  }

  return {
    info: (message, fields) => {
      const job = jobOf(fields);
      if (job !== null && message === "job.ran") {
        metrics.recordWorkerRun(job, "success", durationOf(fields), now());
      }
      if (job !== null && message === "job.skipped_locked_elsewhere") {
        metrics.recordWorkerRun(job, "skipped_locked_elsewhere", durationOf(fields), now());
      }
      sink.info(message, fields);
    },
    error: (message, fields) => {
      const job = jobOf(fields);
      if (job !== null && message === "job.failed") {
        metrics.recordWorkerRun(job, "failure", durationOf(fields), now());
      }
      sink.error(message, fields);
    },
  };
}
