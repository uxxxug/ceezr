/**
 * الغرض: نقطة دخول العامل الخلفي على Render: يبني الحاوية، يجمع الجوبات، يشغّل
 *   المشغّل الدوري، ويُغلق كل شيء بنظافة عند SIGTERM.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: docker/Dockerfile.worker كأمر تشغيل الخدمة
 * ملاحظات مستقبلية: القفل الموزَّع يأتي من الحاوية، فتشغيل عدّة نسخ آمن بلا تعديل هنا.
 */

import {
  createConfiguredMetricsExporter,
  createOperationalMetrics,
} from "../../../packages/infrastructure/observability/index.ts";
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

  /**
   * مسجِّلُ مقاييسِ العامل — `F5-07` / `SCL-006`.
   *
   * ولماذا في العاملِ أصلاً: لأنّ `apps/workers` عمليّةٌ منفصلةٌ **بلا خادمِ HTTP**،
   * فلا `GET /metrics` فيها أصلاً ولا موضعَ يُكشَط منه. وهذا بالضبط ما يجعل الدفعَ
   * الطريقَ الوحيدَ لقياسِها، وهو شرطٌ سابقٌ لـ`F5-04` (فصلُ العاملِ عن البوابة): فصلٌ
   * بلا تجميعٍ مركزيٍّ يعني عاملاً حيّاً لا يراه أحد.
   *
   * ويُمرَّر إلى `buildWorkerContainer` عبر `overrides.metrics` الذي تقبله الحاويةُ
   * أصلاً منذ اليوم الأول، فتُقاس محوّلاتُ العروضِ في العاملِ كما تُقاس في البوابة.
   * وقبلَ اليوم كان هذا الحقلُ يُترَك فارغاً في نقطةِ التشغيل، فتعمل الحاويةُ بمحوّلاتٍ
   * غيرِ مُقاسة — أي عاملٌ يعمل ولا يُنتج رقماً واحداً.
   */
  const workerMetrics = createOperationalMetrics();
  const metricsExporter = createConfiguredMetricsExporter({
    registry: workerMetrics.registry,
    serviceName: "waslah-worker",
    deploymentEnvironment: config.value.env,
    processTopology: config.value.processTopology,
    metricsExport: config.value.metricsExport,
    log: (message, fields) => log.info(message, fields),
  });
  if (metricsExporter === null) {
    log.info("metrics_export.disabled", { reason: "METRICS_EXPORT_ENDPOINT غير مضبوط" });
  } else {
    metricsExporter.start();
  }

  const container = buildWorkerContainer(config.value, { metrics: workerMetrics });
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
    // النبضة (§4.3): هذه الخدمة منفصلة عن البوابة، ولا طريقةَ للبوابة لتعلم أنّ
    // مهامّها تعمل إلاّ من القاعدة. بلا هذا السطر يقول `/ready` إنّ المهامّ غائبة.
    heartbeat: container.heartbeat,
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
    // دفعةٌ أخيرةٌ بعدَ التصريفِ وقبلَ إغلاقِ القاعدة: تحمل نتيجةَ آخرِ شوطٍ
    // انتهى توّاً. وبدونها يموت العاملُ حاملاً عدّادَ مهمّاتِه إلى القبر.
    if (metricsExporter !== null) await metricsExporter.stop();
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
