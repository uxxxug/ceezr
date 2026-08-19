/**
 * الغرض: خدمة التتبّع المركزية — تستقبل تحديثات GPS وتتحقّق منها
 *   وتخزّن الموقع الحالي وتطلق الأحداث.
 *   الفصل الجوهري: GPS ← Tracking ← Realtime ← Map UI
 * الحالة: **منفّذ ومختبر وغير موصول بمسار الإنتاج** — المرحلة 2.
 *   لا يُنشَأ `TrackingService` في أيّ من `apps/`: مواضعُ إنشائه كلّها في
 *   `tests/unit/tracking.test.ts` و `tests/unit/tracking-route.test.ts`، ومستهلِكه
 *   الوحيد في الشجرة هو `apps/gateway/src/routes/tracking.ts` — وهو نفسه غير
 *   مركَّب في `index.ts`.
 * ينتمي إلى: packages/tracking
 *
 * ## ما يعمل بدلاً منه في الإنتاج
 *
 * تقييم الإصلاحة يجري في `handleLocation` مباشرةً عبر `assessGpsFix`، والكتابة
 * بـ`drivers.updateLocation` (ADR-0015)، والجلسة والنشر في
 * `packages/application/tracking/live-tracking.ts` الموصول في `container.ts`.
 *
 * فهذا الصنف مسارٌ ثانٍ للوظيفة نفسها (تقييم + تخزين + أحداث)، مبنيٌّ على
 * أنّ العميل يُرسل GPS إلى HTTP برمز تتبّع لا مُصدِر له في المستودع. يُحفظ
 * لمرحلة تتبّع العميل، ولا يُوصَل قبل دمج التقييم في مسارٍ واحد (القاعدة ٤:
 * لا خدمة جديدة لوظيفة قائمة). ومن يقرأ هنا واحدةً من دوالّ التقييم فليقرأها من
 * `domain/geo/gps-fix.ts` — فهي المصدر الواحد وهذا الصنف يُناديها لا ينسخها.
 */

import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsAssessment,
  type GpsPolicy,
  type PreviousFix,
} from "../domain/geo/gps-fix.ts";
import {
  acceptsFixes,
  DEFAULT_SESSION_POLICY,
  endSession as endSessionFacts,
  recordFix,
  type SessionEndReason,
  type SessionPolicy,
  sessionStateAt,
  startSession as startSessionFacts,
  type TrackingSessionFacts,
  type TrackingSessionState,
} from "../domain/tracking/session.ts";
import type { LatLng } from "../maps/core/types.ts";
import type { GpsUpdate, TrackingEvent, TrackingEventType } from "./types.ts";

/** منفذ تخزين الموقع الحالي (Redis عادةً). */
export interface LocationStore {
  /** يخزّن الموقع الحالي للسائق. */
  setCurrent(driverId: string, position: LatLng, metadata: Record<string, unknown>): Promise<void>;
  /** يقرأ الموقع الحالي للسائق. */
  getCurrent(
    driverId: string,
  ): Promise<{ position: LatLng; timestamp: number; metadata: Record<string, unknown> } | null>;
  /** يحذف الموقع عند انتهاء الجلسة. */
  clear(driverId: string): Promise<void>;
}

/** منفذ نشر أحداث التتبّع (WebSocket/SSE عادةً). */
export interface TrackingEventPublisher {
  publish(event: TrackingEvent): Promise<void>;
}

/** ساعة قابلة للحقن للاختبار. */
export interface Clock {
  now(): Date;
}

export interface TrackingConfig {
  /** معدّل التحديث أثناء القيادة بالثواني. */
  readonly gpsIntervalSeconds: number;
  /** معدّل التحديث أثناء الوقوف بالثواني. */
  readonly idleIntervalSeconds: number;
  /** الحد الأدنى للانزياف قبل الإرسال بالمتر. */
  readonly minDistanceMeters: number;
  /** حدود التحقّق من صحة GPS — سياسة المجال. */
  readonly validator: GpsPolicy;
  /** حدود حياة الجلسة — سياسة المجال (المرحلة ٥). */
  readonly session: SessionPolicy;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  gpsIntervalSeconds: 3,
  idleIntervalSeconds: 20,
  minDistanceMeters: 15,
  validator: DEFAULT_GPS_POLICY,
  session: DEFAULT_SESSION_POLICY,
};

export interface TrackingDeps {
  readonly store: LocationStore;
  readonly publisher: TrackingEventPublisher;
  readonly clock: Clock;
  readonly config: TrackingConfig;
}

/**
 * نوع الحدث يُشتقّ من رمز مُعرَّف لا من مطابقة نصّية على رسالة خطأ.
 * ما كان `reason?.includes("Teleport")` قراراً تشغيلياً معلّقاً على تهجئة نصّ.
 */
function alertEventType(assessment: GpsAssessment): TrackingEventType {
  return assessment.findings.some((f) => f.code === "DISPLACEMENT_IMPLAUSIBLE")
    ? "teleport_detected"
    : "speeding_detected";
}

/**
 * نتيجة معالجة إصلاحة.
 *
 * الرفض نوعان لا نوع واحد، ولا يجوز إسقاط أحدهما على مفردات الآخر:
 *   - `INVALID_FIX`: الإصلاحة نفسها فاسدة — حكمٌ على القياس، ويحمل تقييماً.
 *   - `NO_ACTIVE_SESSION`: الإصلاحة سليمة وسياقها غائب — حكمٌ على الجلسة.
 *
 * وإقحام رمزٍ للجلسة في `GpsFindingCode` كان سيجعل «لا جلسة» تبدو عيباً في
 * إشارة القمر الصناعي، فتُحقَّق في الجهاز بينما العلّة في دورة حياة الرحلة.
 */
export type GpsUpdateResult =
  | { readonly accepted: true; readonly assessment: GpsAssessment }
  | {
      readonly accepted: false;
      readonly rejection: "INVALID_FIX";
      readonly assessment: GpsAssessment;
    }
  | {
      readonly accepted: false;
      readonly rejection: "NO_ACTIVE_SESSION";
      readonly sessionState: TrackingSessionState | null;
    };

/**
 * خدمة التتبّع — تتعامل مع تحديثات GPS الواردة.
 * ليست مسؤولة عن العرض (ذلك في طبقة Map UI).
 */
export class TrackingService {
  /**
   * ذاكرة داخل العملية — محدودية معروفة (P1-7): تضيع عند إعادة التشغيل
   * ولا تُشارَك بين نسخ.
   *
   * المرحلة ٥ لم تُخرجها إلى القاعدة عمداً. هذه الخدمة **غير موصولة** بعد
   * (`routes/tracking.ts` غير مُركَّب)، وإضافة جدولٍ ومستودعٍ لخدمةٍ لا تعمل
   * تُنتج بالضبط ما أدانته المرحلة ٤: بنيةٌ كاملة توحي بأنها المسار المعتمد
   * وليس خلفها مستهلك. القرار مؤجَّل إلى المرحلة ٦ حين يُركَّب النقل اللحظي.
   *
   * والمنطق نفسه ليس مؤجَّلاً: كل حكمٍ على الحالة يمرّ بآلة المجال النقيّة،
   * فحين تُستبدَل الذاكرة بجدولٍ تتغيّر طريقة الحفظ وحدها.
   */
  private readonly sessions = new Map<string, TrackingSessionFacts>();

  private readonly previousPositions = new Map<string, PreviousFix>();

  constructor(private readonly deps: TrackingDeps) {}

  /** يعالج تحديث GPS واحد: يُقيّم، يخزّن، ينشر. */
  async handleGpsUpdate(update: GpsUpdate): Promise<GpsUpdateResult> {
    const nowMs = this.deps.clock.now().getTime();

    /**
     * بوّابة الجلسة تسبق تقييم الإصلاحة. إصلاحةٌ تصل بلا جلسةٍ مفتوحة — أو بعد
     * إنهائها — ليست بياناً فاسداً بل بياناً بلا سياق: تخزينُها يُعيد سائقاً
     * أغلق تطبيقه إلى الخريطة، وهو أسوأ من غيابه لأنّ المشغّل يراه متاحاً.
     */
    const session = this.sessions.get(update.driverId) ?? null;
    if (session === null || !acceptsFixes(session, nowMs, this.deps.config.session)) {
      return {
        accepted: false,
        rejection: "NO_ACTIVE_SESSION",
        sessionState:
          session === null ? null : sessionStateAt(session, nowMs, this.deps.config.session),
      };
    }

    const previous = this.previousPositions.get(update.driverId) ?? null;

    const assessment = assessGpsFix(
      {
        latitude: update.position.lat,
        longitude: update.position.lng,
        recordedAtMs: update.timestamp,
        accuracyMeters: update.accuracy,
        speedKmh: update.speed,
        headingDegrees: update.heading,
      },
      previous,
      nowMs,
      this.deps.config.validator,
    );

    // المرفوض بيانات فاسدة لا سلوك مريب: لا يُخزّن ولا يُنشَر عنه حدث تشغيلي.
    // إغراق العمليات بتنبيهات عن إحداثيات مشوّهة يدفن التنبيه الحقيقي.
    if (assessment.fix === null) {
      return { accepted: false, rejection: "INVALID_FIX", assessment };
    }

    const fix = assessment.fix;

    await this.deps.store.setCurrent(update.driverId, update.position, {
      heading: fix.headingDegrees,
      speed: fix.speedKmh,
      accuracy: fix.accuracyMeters,
      timestamp: fix.recordedAtMs,
      tripId: update.tripId,
      quality: assessment.verdict,
    });

    /**
     * المؤشّر السابق يتقدّم حتّى عند التنبيه. الطبقة القديمة لم تكن تقدّمه عند
     * الرفض، فأول قفزة تُجمّده عند نقطة ميتة ثم تُقاس عليها كل إصلاحة تالية
     * فتُرفض هي الأخرى — التتبّع يموت إلى آخر الجلسة.
     */
    this.previousPositions.set(update.driverId, {
      coordinates: fix.coordinates,
      recordedAtMs: fix.recordedAtMs,
    });

    /**
     * تقدُّم الجلسة يُسجَّل بآلة المجال لا بإسنادٍ مباشر: هي وحدها التي تعرف أن
     * إصلاحةً خارج ترتيبها يجب ألّا تُرجِع المؤشّر إلى الوراء. وفشلُ التسجيل هنا
     * لا يُبطل ما خُزّن — الإصلاحة صحيحة وقد نُشرت — فيُهمَل الناتج قصداً.
     */
    const advanced = recordFix(session, fix.recordedAtMs, nowMs, this.deps.config.session);
    if (advanced.ok) this.sessions.set(update.driverId, advanced.value);

    if (assessment.verdict === "ALERT") {
      await this.deps.publisher.publish({
        type: alertEventType(assessment),
        driverId: update.driverId,
        tripId: update.tripId,
        position: update.position,
        timestamp: this.deps.clock.now(),
        metadata: { findings: assessment.findings },
      });
    }

    await this.deps.publisher.publish({
      type: "location_updated",
      driverId: update.driverId,
      tripId: update.tripId,
      position: update.position,
      timestamp: this.deps.clock.now(),
      metadata: {
        heading: fix.headingDegrees,
        speed: fix.speedKmh,
        accuracy: fix.accuracyMeters,
        quality: assessment.verdict,
        findings: assessment.findings.map((f) => f.code),
      },
    });

    return { accepted: true, assessment };
  }

  /**
   * يبدأ جلسة تتبّع. كان هذا التابع يُطلق حدثاً ولا يُنشئ شيئاً — فلم تكن ثمّة
   * جلسة تُبدأ أصلاً، وكانت الإصلاحات تُقبل بلا جلسة والإنهاءُ يقع بلا بداية.
   */
  async startSession(driverId: string, tripId: string | null): Promise<void> {
    const now = this.deps.clock.now();
    this.sessions.set(driverId, startSessionFacts(driverId, tripId, now.getTime()));
    // بداية جديدة تُبطل سابقةَ الجلسة الماضية: قياس إزاحةٍ عبر فجوةٍ بين جلستين
    // يُنتج «انتقالاً لحظياً» وهمياً كلّما بدأ السائق يومه في حيٍّ آخر.
    this.previousPositions.delete(driverId);
    await this.deps.publisher.publish({
      type: "session_started",
      driverId,
      tripId,
      position: null,
      timestamp: now,
    });
  }

  /** ينهي جلسة تتبّع ويمسح الموقع الحالي. */
  async endSession(
    driverId: string,
    tripId: string | null,
    reason: SessionEndReason = "DRIVER_STOPPED",
  ): Promise<void> {
    const now = this.deps.clock.now();
    const existing = this.sessions.get(driverId);
    if (existing !== undefined) {
      this.sessions.set(driverId, endSessionFacts(existing, reason, now.getTime()));
    }
    this.previousPositions.delete(driverId);
    await this.deps.store.clear(driverId);
    await this.deps.publisher.publish({
      type: "session_ended",
      driverId,
      tripId,
      position: null,
      timestamp: now,
      metadata: { reason },
    });
  }

  /**
   * حالة الجلسة الآن. تُحسب ولا تُقرأ من حقل محفوظ — و`STALE` خاصّةً مستحيلة
   * التخزين لأنها انتقالٌ بلا حدث: لا شيء يقع لحظةَ ينقطع السائق ليُكتب.
   */
  sessionState(driverId: string): TrackingSessionState | null {
    const facts = this.sessions.get(driverId);
    if (facts === undefined) return null;
    return sessionStateAt(facts, this.deps.clock.now().getTime(), this.deps.config.session);
  }
}
