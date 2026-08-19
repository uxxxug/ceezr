/**
 * الغرض: تحويلُ نبضات المهامّ في القاعدة إلى فحصَي جهوزية في `/ready`، ليصير موتُ
 *   العامل — المضمَّن أو المستقلّ — مرئيّاً من الخارج باسم المهمّة (§4.3).
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: apps/gateway
 * يُستخدم في: apps/gateway/src/index.ts (مصفوفة readinessChecks)
 * يُختبَر في: tests/unit/job-health-probes.test.ts
 *
 * ## لماذا فحصان لا فحصٌ واحد
 *
 * لأنّ العلاجَين مختلفان، و`/ready` يفرّق بينهما بحقلٍ واحد هو `critical`:
 *
 * - **الغياب** (`critical_jobs`, حرج): لا نبضةَ لمهمّةٍ حرجة بعد انقضاء إمهالها —
 *   العاملُ لم يُقلع أصلاً (`RUN_WORKER_IN_GATEWAY=false` بلا خدمة عامل، أو سقوطُ
 *   إقلاعِ العامل المضمَّن الذي لا يُسقط البوابة عن قصد). وإعادةُ تشغيل النسخة
 *   تُصلحه فعلاً، فاستحقّ أن يكون حرجاً بحسب قاعدة `ReadinessProbe`.
 * - **البيات أو الفشل** (`critical_jobs_freshness`, غير حرج): العاملُ حيٌّ ومهمّةٌ
 *   منه متأخّرة أو تُخفق. إسقاطُ البوابة هنا كان سيوقف البوتَين من أجل مهمّةٍ
 *   واحدة متعثّرة — أي تحويل عطلٍ جزئيّ إلى انقطاعٍ كامل. يبقى في `degradedChecks`.
 */

import {
  type CriticalJobExpectation,
  describeJobHealth,
  evaluateJobHealth,
  type JobHeartbeatReaderPort,
  type JobHeartbeatRow,
} from "../../../packages/application/scheduling/job-heartbeat.ts";
import type { ReadinessProbe } from "./routes/health.ts";

export interface JobHealthProbeDeps {
  readonly heartbeats: JobHeartbeatReaderPort;
  /** توقّعاتُ النبض — تُقرأ في كلّ فحص لأنّ المدن تُفعَّل بعد الإقلاع. */
  readonly expectations: () => Promise<{
    readonly required: readonly CriticalJobExpectation[];
    readonly optional: readonly CriticalJobExpectation[];
  }>;
  readonly now: () => Date;
  readonly startedAt: Date;
  /**
   * مهلةُ تخزين اللقطة. `/ready` يُنادى كلّ بضع ثوانٍ من Render، وفحصان يقرآن
   * القاعدة في كلّ نداء يعني أربعَ استعلاماتٍ في الثانية لا لزومَ لها. والثوانيةُ
   * الواحدة لا تُخفي عطلاً: عتبةُ البيات دقائق لا ثوانٍ.
   */
  readonly cacheMs?: number;
}

const DEFAULT_CACHE_MS = 3000;

interface Snapshot {
  readonly at: number;
  readonly rows: readonly JobHeartbeatRow[];
  readonly required: readonly CriticalJobExpectation[];
  readonly optional: readonly CriticalJobExpectation[];
}

export function createJobHealthProbes(deps: JobHealthProbeDeps): readonly ReadinessProbe[] {
  const cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS;
  let cached: Snapshot | null = null;
  let pending: Promise<Snapshot> | null = null;

  async function snapshot(): Promise<Snapshot> {
    const nowMs = deps.now().getTime();
    if (cached !== null && nowMs - cached.at < cacheMs) return cached;
    // نداءٌ واحد للقاعدة ولو تزامن الفحصان: الوعدُ يُتقاسم، فيرى الفحصان نفسَ
    // اللقطة — واختلافُ لقطتَين كان سيُنتج ردّاً يقول «غائبة» و«حديثة» معاً.
    pending ??= (async (): Promise<Snapshot> => {
      try {
        const [rows, expectations] = await Promise.all([
          deps.heartbeats.list(),
          deps.expectations(),
        ]);
        cached = {
          at: deps.now().getTime(),
          rows,
          required: expectations.required,
          optional: expectations.optional,
        };
        return cached;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function report(): Promise<ReturnType<typeof evaluateJobHealth>> {
    const current = await snapshot();
    return evaluateJobHealth({
      expectations: current.required,
      optionalExpectations: current.optional,
      heartbeats: current.rows,
      now: deps.now(),
      startedAt: deps.startedAt,
    });
  }

  return [
    {
      name: "critical_jobs",
      // الافتراضي `true` أصلاً، ومكتوبٌ صراحةً لأنّ تصنيفَه قرارٌ لا سهو.
      critical: true,
      check: async () => {
        const health = await report();
        if (health.missing.length === 0) return { ok: true };
        return { ok: false, detail: `العامل لا ينبض — ${describeJobHealth(health)}` };
      },
    },
    {
      name: "critical_jobs_freshness",
      critical: false,
      check: async () => {
        const health = await report();
        if (health.stale.length === 0 && health.failing.length === 0) return { ok: true };
        return { ok: false, detail: describeJobHealth(health) };
      },
    },
  ];
}
