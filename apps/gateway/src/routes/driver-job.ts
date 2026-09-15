/**
 * الغرض: مساراتُ مَهمّةِ السائقِ النشطةِ — `GET /v1/driver/job` و
 *   `POST /v1/driver/job/:orderId/arrived` و`…/start` و`…/complete`
 *   (`F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — الأرباحُ مسارٌ يُضافُ، ولا يُغيَّرُ جوابُ
 *   الإنهاءِ ليحملَ حصيلةً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ المعرِّفُ **في المسارِ** لا في الجسمِ
 *
 * لأنَّ الفعلَ فعلٌ على مَورِدٍ بعينِه، والمسارُ يقولُ أيَّ مَورِدٍ. ولأنَّ هذا
 * يُغني عن قراءةِ جسمٍ في `POST` بلا حمولةٍ — وجسمٌ يُقرأُ بلا حاجةٍ سطحٌ يُفحَصُ
 * ويُحَدُّ بلا مقابلٍ. **ومعرِّفُ السائقِ لا يُقرأُ من المسارِ ولا من الجسمِ
 * ألبتّةَ**: من الرمزِ الموقَّعِ وحدَه.
 *
 * ## ولِمَ ثلاثةُ مساراتٍ لا مسارٌ بحقلِ فعلٍ
 *
 * `POST /v1/driver/job {action}` كانت ستجعلَ اسمَ الفعلِ **نصّاً من الشاشةِ**
 * يُوجَّهُ به إلى كاتبٍ في القاعدةِ، ويصيرُ سجلُّ الوصولِ (`access log`) عاجزاً
 * عن التفريقِ بينَ ختمِ وصولٍ وإنهاءِ رحلةٍ. ومسارٌ لكلِّ انتقالٍ **يُقرأُ في
 * السجلِّ وفي حدِّ المعدّلِ وفي التصريحِ** بلا فتحِ حمولةٍ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُفرِّقُ بينَ «لا وجودَ لها» و«ليسَت لكَ»**: `JOB_NOT_FOUND` واحدٌ —
 *      والفرقُ يُعلِمُ المُجرِّبَ بوجودِ مَهمّةٍ لغيرِه.
 *   ــ **لا تُلغي رحلةً**: لا مسارَ إلغاءٍ ههنا — كاتبُه قائمٌ وسياستُه مُجمَّدةٌ
 *      بقرارٍ (`F2-06`).
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا تُسجِّلُ موضعاً ولا ملاحظةَ راكبٍ في السجلِّ**: الرمزُ والحكمُ فحسب.
 *   ــ **لا تُقدِّرُ زمناً**: امتناعٌ مُصنَّفٌ (`ADR 0024`).
 */

import { type Context, Hono } from "hono";
import {
  completeDriverRide,
  type DriverJobDeps,
  type DriverJobPublicErrorCode,
  type DriverJobRejection,
  markDriverArrived,
  readDriverActiveJob,
  startDriverRide,
} from "../../../../packages/application/driver/driver-job.ts";

export interface DriverJobRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly job?: DriverJobDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverJobPublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  JOB_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  // طلبٌ مفهومٌ وقيمتُه ليسَت معرِّفاً — لا عطبَ خدمةٍ ولا منعَ صلاحيةٍ.
  ORDER_ID_INVALID: 422,
  JOB_NOT_FOUND: 404,
  // تعارُضٌ مع حالةِ المَورِدِ: الطلبُ صحيحٌ والطَورُ لا يسمحُ به.
  PHASE_MISMATCH: 409,
  ALREADY_ARRIVED: 409,
  TRANSITION_REFUSED: 409,
};

function rejected(c: Context, rejection: DriverJobRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

function unavailable(code: DriverJobPublicErrorCode): DriverJobRejection {
  return { code };
}

/**
 * رابطُ الملاحةِ **يُبنى في الخادمِ ويُنشَرُ في الحمولةِ** — ولا يُبنى في حزمةِ
 * التطبيقِ المصغَّرِ. والسببُ حاجزٌ لا ذوقٌ: `F1-10` و`TG-005` يقصُرانِ كلَّ
 * عنوانٍ مطلقٍ في شيفرةِ المصغَّرِ على قائمةٍ **مغلقةٍ** بسندٍ مكتوبٍ، وفيها
 * مضيفٌ واحدٌ لأصلٍ تنفيذيٍّ. ورابطُ ملاحةٍ **ليسَ أصلاً تنفيذيّاً**، لكنَّ
 * توسيعَ القائمةِ لأجلِه كانَ سيُوسِّعُ `script-src` نفسَه لِمُضيفٍ لا نُشغِّلُ
 * منه شيفرةً — أي إضعافُ حاجزٍ لِسببٍ لا يستحقُّه. فالمُضيفُ يبقى **في الخادمِ
 * وحدَه** حيثُ يُقرأُ في سجلِّ المخارجِ (`W-6`)، والشاشةُ تفتحُ **ما أُعطِيَت**
 * ولا تُركِّبُ عنواناً — وهوَ نفسُ ما فعلَته لوحةُ الإشرافِ قبلَها.
 *
 * والمُضيفُ حرفيٌّ لا من تهيئةٍ: تهيئةٌ تُغيَّرُ بلا مراجعةٍ تُحوِّلُ الرابطَ
 * إلى وجهةٍ أُخرى في يدِ مَن يملكُ متغيّرَ بيئةٍ.
 */
export function navigationUrlFor(place: {
  readonly latitude: number;
  readonly longitude: number;
}): string {
  return `https://maps.google.com/?q=${place.latitude},${place.longitude}`;
}

function wirePlace(place: { latitude: number; longitude: number; label: string | null }) {
  return {
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
    navigation_url: navigationUrlFor(place),
  };
}

export function createDriverJobRoutes(deps: DriverJobRouteDependencies): Hono {
  const app = new Hono();

  /** «مَهمّتي» — `SD-05` كامِلاً: الطَورُ وأختامُه ونقطتا الرحلةِ وراكبٌ بلا هويّةٍ. */
  app.get("/v1/driver/job", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.read_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverActiveJob(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const snapshot = result.value;
    const job = snapshot.job;
    return c.json({
      ok: true,
      // **لحظةُ الخادمِ تُنشَرُ**: كلُّ عُمرٍ يُعرَضُ فرقٌ عنها.
      server_time: snapshot.serverTime,
      // **عَدَمٌ صريحٌ** لا كائنٌ فارغٌ: «لا مَهمّةَ» حالٌ تُقالُ لا تُخمَّنُ.
      job:
        job === null
          ? null
          : {
              order_id: job.orderId,
              status: job.status,
              service: job.service,
              next_action: job.nextAction,
              matched_at: job.matchedAt,
              arrived_at: job.arrivedAt,
              started_at: job.startedAt,
              pickup: wirePlace(job.pickup),
              dropoff: job.dropoff === null ? null : wirePlace(job.dropoff),
              notes: job.notes,
              rider: {
                first_name: job.rider.firstName,
                language_code: job.rider.languageCode,
              },
            },
    });
  });

  /** «وصلتُ» — الطَورُ الذي لم يكن له كاتبٌ، وكاتبُه `driver_mark_arrived`. */
  app.post("/v1/driver/job/:orderId/arrived", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.arrived_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await markDriverArrived(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.arrived_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.arrived", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      arrived_at: result.value.arrivedAt,
    });
  });

  /** «بدأتُ الرحلةَ» — تفويضٌ إلى `start_ride` القائمةِ بحرفِها. */
  app.post("/v1/driver/job/:orderId/start", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.start_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await startDriverRide(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.start_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.started", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      started_at: result.value.startedAt,
    });
  });

  /** «أنهيتُ» — تفويضٌ إلى `complete_ride` القائمةِ، وهيَ تُعيدُ السائقَ متاحاً. */
  app.post("/v1/driver/job/:orderId/complete", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.complete_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await completeDriverRide(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.complete_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.completed", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      completed_at: result.value.completedAt,
      // المدّةُ **مقيسةٌ في الكاتبِ** — تُنقَلُ ولا تُحسَبُ ههنا.
      duration_seconds: result.value.durationSeconds,
    });
  });

  return app;
}
