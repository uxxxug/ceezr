/**
 * الغرض: دمج تجاوزات البيئة مع افتراضات المجال في سياسةٍ واحدة نافذة.
 * الحالة: منفّذ فعلياً — إصلاح انحراف إعدادات التتبّع (§4.3 من أمر الإطلاق).
 * ينتمي إلى: packages/tracking
 * يستخدمه: apps/gateway/src/container.ts، apps/workers/src/container.ts
 *
 * لماذا هنا لا في `packages/shared/config`؟ لأنّ الأرقام الافتراضية مصدرُها
 * `DEFAULT_GPS_POLICY` في المجال، و`shared` تُستورَد **من** المجال لا العكس —
 * فقراءتها هناك كانت ستُنشئ حلقةَ اعتماد، أو تُنشئ نسخةً ثانية من كلّ رقم.
 * وهذه الطبقة تستورد الاثنين بلا حلقة، فهي موضع الدمج الوحيد الممكن.
 *
 * ولماذا الدمج أصلاً؟ لأنّ البديل الذي كان قائماً هو أسوأ الاحتمالين: قيمٌ
 * مرمَّزةٌ في الكود ومتغيّراتٌ مُعلَنةٌ في `render.yaml` لا تُقرَأ — فالمشغّل
 * يضبط حدَّ السرعة فلا يتغيّر شيء، ولا خطأَ يُخبره. حدٌّ لا يسري أسوأ من حدٍّ
 * لا وجود له: الأوّل يُطمئن، والثاني يُفصح.
 */

import { DEFAULT_GPS_POLICY, type GpsPolicy } from "../domain/geo/gps-fix.ts";
import type { TrackingEnvOverrides } from "../shared/config/index.ts";

/** حدود تقييم إصلاحة GPS النافذة فعلياً — افتراض المجال ما لم يتجاوزه المشغّل. */
export function resolveGpsPolicy(overrides: TrackingEnvOverrides): GpsPolicy {
  return {
    ...DEFAULT_GPS_POLICY,
    ...(overrides.maxAccuracyMeters === null
      ? {}
      : { maxAccuracyMeters: overrides.maxAccuracyMeters }),
    ...(overrides.maxReasonableSpeedKmh === null
      ? {}
      : { maxPlausibleSpeedKmh: overrides.maxReasonableSpeedKmh }),
    ...(overrides.maxTimeDriftSeconds === null
      ? {}
      : { maxFutureSkewSeconds: overrides.maxTimeDriftSeconds }),
    ...(overrides.teleportThresholdMeters === null
      ? {}
      : { maxJumpMeters: overrides.teleportThresholdMeters }),
  };
}

/**
 * وأين ذهب `resolveTrackingConfig`؟ حُذف بـADR-0052 مع `TrackingService`: لم يكن
 * يدمج إلا ثلاثة حدودٍ لا يقرؤها إلا تلك الخدمة المحذوفة، ويلفّ حولها
 * `resolveGpsPolicy` لفّاً. وما يسري فعلاً في الإنتاج هو `resolveGpsPolicy` وحده،
 * يستدعيه `apps/gateway/src/container.ts`.
 *
 * ويَلزم قولُ ما كُشِف لا طَيُّه: `TRACKING_GPS_INTERVAL_SECONDS` و
 * `TRACKING_GPS_IDLE_INTERVAL_SECONDS` و`TRACKING_MIN_DISTANCE_METERS` تُقرأ وتُتحقّق
 * عند الإقلاع ولا يستهلكها شيءٌ في الإنتاج منذ الآن — وهو عينُ ما يُدينه عنوانُ
 * هذا الملف أعلاه. والحذف لم يُحدِث هذا العيب بل كشفه؛ فيُعالَج بنداً مستقلاً
 * (إمّا بإسقاط المتغيّرات وإمّا بوصلها بمستهلك) لا يُبتَلع في وحدة إغلاق `R-16`.
 */
