/**
 * الغرض: نقطة دخول العامل الخلفي على Render: يبني الحاوية، يجمع الجوبات، يشغّل
 *   المشغّل الدوري، ويُغلق كل شيء بنظافة عند SIGTERM.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: docker/Dockerfile.worker كأمر تشغيل الخدمة
 * ملاحظات مستقبلية: القفل الموزَّع يأتي من الحاوية، فتشغيل عدّة نسخ آمن بلا تعديل هنا.
 */

import { tryLoadConfig } from "../../../packages/shared/config/index.ts";
import { buildWorkerContainer, MAX_JOB_CONCURRENCY } from "./container.ts";
import { createJobRunner, type JobLogger } from "./runner.ts";

const log: JobLogger = {
  info: (message, fields) => console.log(JSON.stringify({ level: "info", message, ...fields })),
  error: (message, fields) => console.error(JSON.stringify({ level: "error", message, ...fields })),
};

async function main(): Promise<void> {
  const config = tryLoadConfig(process.env);
  if (!config.ok) {
    // إقلاعٌ بإعداد ناقص أخطر من عدم الإقلاع: عاملٌ يعمل بنصف إعداد يُفسد بيانات
    // بصمت، وعاملٌ لا يعمل يظهر فوراً في Render.
    log.error("worker.config_invalid", { detail: String(config.error) });
    process.exit(1);
  }

  const container = buildWorkerContainer(config.value);
  const jobs = await container.jobs();

  if (jobs.length === 0) {
    log.error("worker.no_jobs", { hint: "لا مدينة مفعَّلة ولا مهامّ عامّة — راجع جدول cities" });
  }

  const runner = createJobRunner({
    jobs,
    lock: container.lock,
    maxConcurrency: MAX_JOB_CONCURRENCY,
    clock: { now: () => new Date() },
    log,
  });
  runner.start();
  log.info("worker.started", { jobCount: jobs.length });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker.shutdown", { signal });
    runner.stop();
    // إغلاق القاعدة بعد إيقاف المشغّل لا قبله: شوطٌ جاري بلا اتصال يفشل بلا داعٍ.
    // و`stop` وحده لا يكفي: يمسح المؤقّت ولا ينتظر الجاري، فالتصريف هو ما يجعل
    // الترتيب أعلاه وعداً محقّقاً لا تعليقاً. والمهلة محدودة لأنّ المنصّة تقتل قسراً.
    const drained = await runner.drain();
    if (!drained) log.error("worker.shutdown_not_drained", { signal });
    await container.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// يُشغَّل فقط عند التنفيذ المباشر، فتستورده الاختبارات بلا أن تُقلع عاملاً حقيقياً.
if (import.meta.main) {
  await main();
}

export { main };
