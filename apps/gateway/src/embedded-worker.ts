/**
 * الغرض: تشغيل مجدول المهامّ الدورية داخل عملية البوابة نفسها حين لا توجد خدمة عامل
 *   مستقلّة على منصّة النشر — بإعادة استخدام حاوية العامل ومشغّله بلا نسخ سطر منطق واحد.
 * الحالة: منفّذ فعلياً — إغلاق فجوة البند 0 القسم 0.2.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/embedded-worker.test.ts
 * ملاحظات مستقبلية: يوم تُنشأ خدمة `waslah-worker` يُضبط RUN_WORKER_IN_GATEWAY=false
 *   ويُحذف أثره كلّه بلا مسّ أي مهمّة — لا مهمّة واحدة معرّفة هنا.
 */

import { createJobHeartbeatReader } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import {
  buildWorkerContainer,
  MAX_JOB_CONCURRENCY,
  WORKER_SETTINGS_REMEMBER_MS,
  type WorkerContainerOverrides,
} from "../../workers/src/container.ts";
import {
  createJobRunner,
  HEARTBEAT_OK_REWRITE_MS,
  type JobDefinition,
  type JobLogger,
  type JobRunner,
  lastRunMsFromHeartbeats,
} from "../../workers/src/runner.ts";

export interface EmbeddedWorkerHandle {
  /** عدد المهامّ المسجَّلة الآن — صفرٌ عرضٌ مشبوه يستحقّ سطر سجلّ. يزيدُ بالمصالحة. */
  readonly jobCount: number;
  /**
   * `WR-27` — مصالحةُ المدنِ المفعَّلة: يُعيدُ حسابَ المهامّ، فإن ظهرت مهامُّ جديدةٌ
   * (مدينةٌ فُعِّلَت بعدَ الإقلاع) يُبدِّلُ المشغّلَ بآخرَ يحملُها. مكشوفةٌ للاختبار؛
   * والمؤقّتُ يستدعيها كلَّ `reconcileMs`. تعيدُ أسماءَ المهامّ المضافة.
   */
  reconcile(): Promise<readonly string[]>;
  /** إيقاف المشغّل وإغلاق تجمّعات الاتصال. */
  stop(): Promise<void>;
}

/**
 * يُقلع المجدول في نفس العملية ويُعيد مقبضاً لإيقافه.
 *
 * لماذا تُبنى حاوية عامل ثانية ولا يُعاد استخدام `container` البوابة؟ لأن العامل
 * يحتاج تجمّع اتصالات مستقلّاً للأقفال الاستشارية: القفل ملكُ الجلسة، فالمهمّة تحتجز
 * اتصالها طول عملها وهو خاملٌ لا يستعلم. لو أُخذ ذلك الاتصال من تجمّع البوابة لتنافس
 * الخاملُ المحتجزُ مع تحديثات تلغرام الحقيقية على نفس الميزانية، فيتحوّل مكسبُ توفير
 * الاتصالات إلى بطء في الحوار — وهو أسوأ ما يُقايَض به.
 *
 * `buildWorkerContainer` هو نفسه الذي تستدعيه `apps/workers/src/index.ts`. لا يوجد
 * هنا تعريف مهمّة ولا تواتر ولا عتبة: كل ذلك يبقى في موضع واحد.
 */
/**
 * `WR-27` — كلَّ دقيقةٍ يُعادُ حسابُ المهامّ. قبلَه كانت مهامُّ المدنِ تُحسَبُ عندَ الإقلاعِ
 * وحدَه: مدينةٌ تُفعَّلُ أثناءَ التشغيلِ لا تُكتَبُ لها نبضة، و`/ready` يقرأُ نبضاتِ القاعدةِ
 * في كلِّ نسخة، فيُعلنُ `not_ready` في النسخِ كلِّها ويُخرجُها الموزِّعُ معًا — انقطاعٌ تامٌّ
 * حتّى إعادةِ العامل (مقيسٌ على CasaOS 2026-10-30). القراءةُ استعلامُ مدنٍ واحد.
 */
export const ACTIVE_CITIES_RECONCILE_MS = 60_000;

export interface EmbeddedWorkerOptions {
  /** فترةُ مصالحةِ المدن؛ `0` يُطفئُ المؤقّتَ (الاختباراتُ تستدعي `reconcile` مباشرةً). */
  readonly reconcileMs?: number;
}

export async function startEmbeddedWorker(
  config: AppConfig,
  log: JobLogger,
  overrides: WorkerContainerOverrides = {},
  options: EmbeddedWorkerOptions = {},
): Promise<EmbeddedWorkerHandle> {
  const container = buildWorkerContainer(config, {
    settingsRememberMs: WORKER_SETTINGS_REMEMBER_MS,
    ...overrides,
    log,
  });
  const jobs = await container.jobs();

  if (jobs.length === 0) {
    log.error("embedded_worker.no_jobs", {
      hint: "لا مدينة مفعَّلة ولا مهامّ عامّة — راجع جدول cities",
    });
  }

  // `JOB-LAZY-01` — آخرُ شوطٍ لكلِّ مهمّةٍ من القاعدةِ لا من الذاكرةِ: الإقلاعُ لا يُصفِّرُ عدَّ
  // المهمّةِ اليوميّةِ. وفشلُ القراءةِ لا يُسقطُ العاملَ — تبدأُ المهامُّ الكسولةُ بعدَ مهلةِ الأوّلِ.
  async function readLastRuns(): Promise<Map<string, number>> {
    try {
      return lastRunMsFromHeartbeats(await createJobHeartbeatReader(container.sql).list());
    } catch (cause) {
      log.error("runner.last_runs_unavailable", {
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return new Map();
    }
  }

  function buildRunner(
    forJobs: readonly JobDefinition[],
    initialLastRunMs: Map<string, number>,
  ): JobRunner {
    return createJobRunner({
      jobs: forJobs,
      initialLastRunMs,
      lock: container.lock,
      maxConcurrency: MAX_JOB_CONCURRENCY,
      clock: { now: () => new Date() },
      log,
      // النبضة (§4.3): ولو كان العاملُ في العمليّة نفسها، فالمرجعُ القاعدة لا الذاكرة:
      // موضعٌ واحد لحقيقة واحدة يعمل في الحالتين بلا فرعٍ في الفحص، ومقبضٌ في الذاكرة
      // كان سيقول «المشغّل مقلع» لا «المهامّ تعمل» — وهما ليسا شيئاً واحداً.
      heartbeat: container.heartbeat,
      // `OPS-EGRESS-01`: نبضةُ `ok` المتكرّرةُ تُكتَبُ مرّةً في الدقيقةِ لا في كلِّ شوط.
      heartbeatOkRewriteMs: HEARTBEAT_OK_REWRITE_MS,
    });
  }

  let stopped = false;
  let currentJobs: readonly JobDefinition[] = jobs;
  let runner = buildRunner(jobs, await readLastRuns());
  runner.start();
  log.info("embedded_worker.started", {
    jobCount: jobs.length,
    names: jobs.map((job) => job.name),
  });

  let reconciling = false;
  async function reconcile(): Promise<readonly string[]> {
    if (reconciling || stopped) return [];
    reconciling = true;
    try {
      const next = await container.jobs();
      const have = new Set(currentJobs.map((job) => job.name));
      const nextNames = new Set(next.map((job) => job.name));
      const added = next.filter((job) => !have.has(job.name)).map((job) => job.name);
      const missing = currentJobs.filter((job) => !nextNames.has(job.name)).map((job) => job.name);
      if (missing.length > 0) {
        // الإضافةُ فقط، عن قصد: قراءةُ المدنِ الفاشلةُ تعيدُ قائمةً فارغة (`OPS-POOL-01`)،
        // فالحذفُ بها يُطفئُ مهامَّ المدنِ كلِّها بعطلٍ عابر. وإيقافُ مدينةٍ نادرٌ ومهامُّها
        // تعملُ بلا طلبات؛ فيُسجَّلُ ويُترَكُ لإعادةِ العامل.
        log.info("embedded_worker.reconcile_kept_missing", { missing: missing.length });
        return [];
      }
      if (added.length === 0 || stopped) return [];
      const replacement = buildRunner(next, await readLastRuns());
      // الشوطُ الجاري في المشغّلِ القديمِ يكملُ، والقفلُ باسمِ المهمّةِ يمنعُ تراكبَه مع الجديد.
      runner.stop();
      replacement.start();
      runner = replacement;
      currentJobs = next;
      log.info("embedded_worker.jobs_reconciled", { jobCount: next.length, added });
      return added;
    } catch (cause) {
      log.error("embedded_worker.reconcile_failed", {
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return [];
    } finally {
      reconciling = false;
    }
  }

  const reconcileMs = options.reconcileMs ?? ACTIVE_CITIES_RECONCILE_MS;
  const reconcileTimer =
    reconcileMs > 0
      ? setInterval(() => {
          void reconcile();
        }, reconcileMs)
      : null;
  (reconcileTimer as { unref?: () => void } | null)?.unref?.();

  return {
    get jobCount() {
      return currentJobs.length;
    },
    reconcile,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (reconcileTimer !== null) clearInterval(reconcileTimer);
      // إيقاف المشغّل قبل إغلاق القاعدة: شوطٌ جارٍ بلا اتصال يفشل بلا داعٍ.
      runner.stop();
      await container.close();
      log.info("embedded_worker.stopped", {});
    },
  };
}
