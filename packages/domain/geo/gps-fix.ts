/**
 * الغرض: تقييم إصلاحة GPS واردة — منطق خالص بلا ساعة ولا تخزين ولا شبكة.
 *   يُفرّق بين ثلاث نتائج مختلفة جوهرياً: بيانات غير صالحة تُرفض، وبيانات
 *   متدهورة تُقبل موسومةً، وبيانات سليمة الشكل لكنها مريبة تستدعي تنبيه العمليات.
 * الحالة: منفّذ فعلياً — المرحلة ٣.
 * ينتمي إلى: domain/geo
 * يستخدمه: application/bots/driver-dialog، packages/tracking/tracking-service
 *
 * لماذا هنا لا في packages/tracking؟ لأن التحقّق من الإحداثيات قرار مجال
 * (`makeCoordinates`) وكان مكرّراً في طبقة التتبّع بنسخة أضعف. مصدر الحقيقة
 * لصحّة الموقع واحد، وهذا موضعه.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { RejectedGpsFixError } from "./errors.ts";
import { haversineKm } from "./index.ts";
import { type Coordinates, makeCoordinates } from "./value-objects.ts";

/**
 * الفصل الذي كان غائباً. الطبقة القديمة كانت تردّ `{valid:false}` على كل شذوذ،
 * ثم تستنتج نوع الحدث بمطابقة نصّية على رسالة الخطأ. فاستوى عندها الإحداثي
 * المستحيل (بيانات فاسدة) مع السائق المسرع (بيانات صحيحة وسلوك خطر) — وهما
 * يستدعيان استجابتين متعاكستين: الأولى تُطرح، والثانية تُحفظ ويُنبَّه عليها.
 */
export type GpsSeverity = "WARNING" | "ALERT" | "REJECT";

export type GpsFindingCode =
  /** الإحداثيات غير منتهية أو خارج المدى — الإصلاحة لا تُمثّل مكاناً. */
  | "COORDINATES_INVALID"
  /** الدقة غير منتهية أو سالبة — قيمة لا معنى لها فيزيائياً. */
  | "ACCURACY_INVALID"
  /** الدقة أسوأ من الحدّ — الموقع صالح لكنه لا يصلح لقرار دقيق. */
  | "ACCURACY_COARSE"
  /** السرعة المُبلَّغة غير منتهية أو سالبة. */
  | "SPEED_INVALID"
  /** سرعة تفوق المعقول — تنبيه سلامة/احتيال لا رفض بيانات. */
  | "SPEED_IMPLAUSIBLE"
  /** الاتجاه غير منتهٍ أو خارج [0,360) — يُسقَط الحقل ولا تُرفض الإصلاحة. */
  | "HEADING_INVALID"
  /** الطابع الزمني ليس عدداً منتهياً. */
  | "TIMESTAMP_INVALID"
  /** طابع زمني في المستقبل يتجاوز انحراف الساعات المقبول — ساعة معطوبة أو معبوث بها. */
  | "TIMESTAMP_IN_FUTURE"
  /** إصلاحة متأخّرة لكنها ما تزال مفيدة. */
  | "TIMESTAMP_STALE"
  /** إصلاحة أقدم من أن تُبنى عليها مطابقة حيّة. */
  | "TIMESTAMP_TOO_OLD"
  /** الطابع الزمني لا يتقدّم عن السابق — إعادة إرسال أو ترتيب مختلّ. */
  | "TIMESTAMP_NOT_MONOTONIC"
  /** إزاحة تفوق ما تسمح به الفيزياء في الزمن المنقضي. */
  | "DISPLACEMENT_IMPLAUSIBLE";

export interface GpsFinding {
  readonly code: GpsFindingCode;
  readonly severity: GpsSeverity;
  /** القيمة المقيسة التي أثارت الملحوظة — للسجلّ والتشخيص. */
  readonly observed: number;
  /** الحدّ الذي قِيست عليه، إن وُجد. */
  readonly limit?: number;
}

/** إصلاحة اجتازت التحقّق. الحقول الاختيارية تُسقَط إن كانت فاسدة. */
export interface ValidatedGpsFix {
  readonly coordinates: Coordinates;
  readonly recordedAtMs: number;
  readonly accuracyMeters: number | null;
  readonly speedKmh: number | null;
  readonly headingDegrees: number | null;
  /** أفضل تقدير للسرعة: الأكبر من المُبلَّغة والمحسوبة. `null` بلا سابقة. */
  readonly effectiveSpeedKmh: number | null;
}

/** إصلاحة خام كما وردت من الجهاز — كل شيء فيها موضع شكّ. */
export interface RawGpsFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly recordedAtMs: number;
  readonly accuracyMeters?: number | undefined;
  readonly speedKmh?: number | undefined;
  readonly headingDegrees?: number | undefined;
}

/** الموضع السابق المعتمد — يأتي من مصدر الحقيقة، لا من ذاكرة العملية. */
export interface PreviousFix {
  readonly coordinates: Coordinates;
  readonly recordedAtMs: number;
}

export interface GpsPolicy {
  /** أسوأ دقة تُقبل بلا تحذير، بالمتر. */
  readonly maxAccuracyMeters: number;
  /** أقصى سرعة معقولة كم/سا. */
  readonly maxPlausibleSpeedKmh: number;
  /** تسامح مع تقدّم ساعة الجهاز، بالثواني. */
  readonly maxFutureSkewSeconds: number;
  /** بعده تُوسَم الإصلاحة متأخّرة، بالثواني. */
  readonly staleAfterSeconds: number;
  /** بعده تُرفض الإصلاحة لقِدَمها، بالثواني. */
  readonly rejectOlderThanSeconds: number;
  /**
   * أقصى إزاحةٍ مقبولة عن الموضع السابق حين **يتعذّر قياس السرعة**، بالمتر.
   *
   * ليست حدّاً ثانياً للسرعة ولا تكراراً لها: حكمُ الإزاحة كلُّه معلَّقٌ على
   * `elapsedSeconds > 0`، فإصلاحتان بنفس الطابع الزمني — أو بطابعٍ متقهقر —
   * تمرّان بلا حكمِ إزاحةٍ إطلاقاً لأنّ القسمة على صفرٍ تُتخطّى. وهذا مسلكُ
   * تهرّبٍ كامل: من يريد أن يظهر في مكانٍ لا يبلغه يُرسل موضعاً على بعد خمسة
   * كيلومترات بنفس الطابع الزمني للإصلاحة السابقة، فلا سرعةَ تُحسَب ولا ملحوظةَ
   * تُرفَع. والحدُّ المسافيّ هنا يُقفل هذا الباب وحده — ولا يُطبَّق عند وجود
   * زمنٍ منقضٍ حقيقيّ كي لا يُنبَّه على سائقٍ صادقٍ على طريقٍ سريع.
   */
  readonly maxJumpMeters: number;
}

/**
 * الحدود الافتراضية.
 *
 * `maxFutureSkewSeconds` صغير و`rejectOlderThanSeconds` كبير عمداً: الطبقة
 * القديمة كانت تقيس |الآن − الطابع| فتساوي بين الاثنين عند ٣٠ ثانية. وهما ليسا
 * سواءً. الإصلاحة المتأخّرة أمرٌ طبيعي — الجهاز يخرج من تغطية ضعيفة فيدفع ما
 * احتُجز في الطابور. أما إصلاحة من المستقبل فمستحيلة فيزيائياً: ساعة معطوبة أو
 * معبوث بها. فرفض المتأخّرة عند ٣٠ ثانية كان يُخفي كل سائق في تغطية رديئة —
 * وهو بالضبط السائق الذي تحتاج العمليات أن تراه.
 */
export const DEFAULT_GPS_POLICY: GpsPolicy = {
  maxAccuracyMeters: 100,
  maxPlausibleSpeedKmh: 200,
  maxFutureSkewSeconds: 5,
  staleAfterSeconds: 30,
  rejectOlderThanSeconds: 300,
  maxJumpMeters: 5000,
};

export interface GpsAssessment {
  /** أشدّ ما وُجد. `"ACCEPT"` حين لا ملحوظة. */
  readonly verdict: "ACCEPT" | GpsSeverity;
  /** الإصلاحة المعتمدة — `null` إذا وفقط إذا كان الحكم `REJECT`. */
  readonly fix: ValidatedGpsFix | null;
  readonly findings: readonly GpsFinding[];
}

const SEVERITY_RANK: Record<GpsSeverity, number> = { WARNING: 1, ALERT: 2, REJECT: 3 };
const HEADING_MAX_EXCLUSIVE = 360;
const MS_PER_SECOND = 1000;
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

/**
 * يقيّم إصلاحة واحدة. خالصة: الوقت يُمرَّر ولا يُقرأ، فالسلوك عند حدود الزمن
 * قابل للاختبار بلا انتظار ولا تزييف للساعة العامّة.
 *
 * @param raw الإصلاحة الواردة من الجهاز
 * @param previous آخر موضع معتمد، أو `null` لأول إصلاحة
 * @param nowMs الزمن المرجعي (epoch ms) من ساعة المستدعي
 * @param policy الحدود
 */
export function assessGpsFix(
  raw: RawGpsFix,
  previous: PreviousFix | null,
  nowMs: number,
  policy: GpsPolicy = DEFAULT_GPS_POLICY,
): GpsAssessment {
  const findings: GpsFinding[] = [];
  const add = (
    code: GpsFindingCode,
    severity: GpsSeverity,
    observed: number,
    limit?: number,
  ): void => {
    findings.push(
      limit === undefined ? { code, severity, observed } : { code, severity, observed, limit },
    );
  };

  // ١) الإحداثيات — بالمُتحقِّق القائم في المجال، لا بنسخة ثانية منه.
  const coordinates = makeCoordinates(raw.latitude, raw.longitude);
  if (!coordinates.ok) {
    add("COORDINATES_INVALID", "REJECT", raw.latitude);
  }

  // ٢) الطابع الزمني.
  if (!Number.isFinite(raw.recordedAtMs)) {
    add("TIMESTAMP_INVALID", "REJECT", raw.recordedAtMs);
  } else {
    const ageSeconds = (nowMs - raw.recordedAtMs) / MS_PER_SECOND;
    if (ageSeconds < -policy.maxFutureSkewSeconds) {
      add("TIMESTAMP_IN_FUTURE", "REJECT", -ageSeconds, policy.maxFutureSkewSeconds);
    } else if (ageSeconds > policy.rejectOlderThanSeconds) {
      add("TIMESTAMP_TOO_OLD", "REJECT", ageSeconds, policy.rejectOlderThanSeconds);
    } else if (ageSeconds > policy.staleAfterSeconds) {
      add("TIMESTAMP_STALE", "WARNING", ageSeconds, policy.staleAfterSeconds);
    }
    if (previous !== null && raw.recordedAtMs <= previous.recordedAtMs) {
      add("TIMESTAMP_NOT_MONOTONIC", "WARNING", raw.recordedAtMs, previous.recordedAtMs);
    }
  }

  // ٣) الدقّة. السالبة وغير المنتهية تُرفض: `NaN > limit` تساوي false دائماً،
  //    فالمقارنة وحدها كانت تُمرّر NaN بلا أن تلحظه.
  let accuracyMeters: number | null = null;
  if (raw.accuracyMeters !== undefined) {
    if (!Number.isFinite(raw.accuracyMeters) || raw.accuracyMeters < 0) {
      add("ACCURACY_INVALID", "REJECT", raw.accuracyMeters);
    } else {
      accuracyMeters = raw.accuracyMeters;
      if (raw.accuracyMeters > policy.maxAccuracyMeters) {
        add("ACCURACY_COARSE", "WARNING", raw.accuracyMeters, policy.maxAccuracyMeters);
      }
    }
  }

  // ٤) السرعة المُبلَّغة.
  let speedKmh: number | null = null;
  if (raw.speedKmh !== undefined) {
    if (!Number.isFinite(raw.speedKmh) || raw.speedKmh < 0) {
      add("SPEED_INVALID", "REJECT", raw.speedKmh);
    } else {
      speedKmh = raw.speedKmh;
    }
  }

  // ٥) الاتجاه: حقل عرضٍ لا يُبنى عليه قرار. فساده يُسقطه ولا يُسقط الموضع معه —
  //    طرحُ موقع صحيح لأن سهم البوصلة مشوّه خسارةٌ بلا مقابل.
  let headingDegrees: number | null = null;
  if (raw.headingDegrees !== undefined) {
    if (
      !Number.isFinite(raw.headingDegrees) ||
      raw.headingDegrees < 0 ||
      raw.headingDegrees >= HEADING_MAX_EXCLUSIVE
    ) {
      add("HEADING_INVALID", "WARNING", raw.headingDegrees);
    } else {
      headingDegrees = raw.headingDegrees;
    }
  }

  // ٦) الإزاحة مقابل السابقة.
  //
  //    القرار الجوهري: الإزاحة المستحيلة **تنبيه لا رفض**. الطبقة القديمة كانت
  //    ترفض، ولا تُقدّم المؤشّر السابق عند الرفض — فأول قفزة (خروج من نفق،
  //    استعادة إشارة) كانت تُجمّد السابقة عند نقطة ميتة، ثم تُقاس كل إصلاحة
  //    تالية عليها فتُرفض هي الأخرى. النتيجة قياسٌ مثبت: التتبّع يموت إلى آخر
  //    الجلسة، والعمليات ترى السائق واقفاً حيث لم يعد.
  //
  //    وموقعٌ متجمّد أخطر تشغيلياً من موقع قافز: المطابقة تُسنِد الطلبات إلى شبح.
  //    والرفض لا يردع منتحلاً أصلاً — يزوّر تدرّجاً — بل يؤذي الصادق في النفق وحده.
  //    فالصواب: تُعتمد الإصلاحة الأحدث، ويُرفع تنبيه لمراجعة بشرية.
  let effectiveSpeedKmh: number | null = null;
  if (previous !== null && coordinates.ok && Number.isFinite(raw.recordedAtMs)) {
    const elapsedSeconds = (raw.recordedAtMs - previous.recordedAtMs) / MS_PER_SECOND;
    const distanceMeters = haversineKm(previous.coordinates, coordinates.value) * METERS_PER_KM;
    if (elapsedSeconds > 0) {
      effectiveSpeedKmh = (distanceMeters / METERS_PER_KM / elapsedSeconds) * SECONDS_PER_HOUR;
    } else if (distanceMeters > policy.maxJumpMeters) {
      //    الزمن لا يتقدّم فلا سرعةَ تُقاس — وهنا كان الباب مفتوحاً على مصراعيه:
      //    كلّ حكم الإزاحة أدناه معلَّقٌ على سرعةٍ محسوبة، فإصلاحةٌ على بعد خمسة
      //    كيلومترات بنفس الطابع الزمني كانت تمرّ بحكم `ACCEPT` نظيف. والملحوظة
      //    تنبيهٌ لا رفض، على نفس منهاج ما دونها: الموضع الأحدث يُعتمد كي لا
      //    يتجمّد التتبّع، والبشر هم من يحكم على المنتحل.
      add("DISPLACEMENT_IMPLAUSIBLE", "ALERT", distanceMeters, policy.maxJumpMeters);
    }
  }

  //    السرعة المُبلَّغة من الجهاز يتحكّم بها الطرف المُراقَب. لو اعتُمدت وحدها
  //    لأمكن تعطيل مؤشّر الاحتيال بإرسال speed=0 — وهذا ما كانت `isSpeeding`
  //    تفعله حرفياً. فتُؤخذ الأكبر: المُبلَّغة لا تستطيع خفض المحسوبة.
  const speedForJudgement = Math.max(speedKmh ?? 0, effectiveSpeedKmh ?? 0);
  if (speedForJudgement > policy.maxPlausibleSpeedKmh) {
    const code =
      effectiveSpeedKmh !== null && effectiveSpeedKmh > policy.maxPlausibleSpeedKmh
        ? "DISPLACEMENT_IMPLAUSIBLE"
        : "SPEED_IMPLAUSIBLE";
    add(code, "ALERT", speedForJudgement, policy.maxPlausibleSpeedKmh);
  }

  const worst = findings.reduce<GpsSeverity | null>(
    (acc, f) => (acc === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc),
    null,
  );

  if (worst === "REJECT" || !coordinates.ok || !Number.isFinite(raw.recordedAtMs)) {
    return { verdict: "REJECT", fix: null, findings };
  }

  return {
    verdict: worst ?? "ACCEPT",
    fix: {
      coordinates: coordinates.value,
      recordedAtMs: raw.recordedAtMs,
      accuracyMeters,
      speedKmh,
      headingDegrees,
      effectiveSpeedKmh,
    },
    findings,
  };
}

/** هل يحمل التقييم ملحوظة بالرمز المعطى؟ */
export function hasFinding(assessment: GpsAssessment, code: GpsFindingCode): boolean {
  return assessment.findings.some((f) => f.code === code);
}

/**
 * غلاف لمن يريد `Result` بدل الفحص اليدوي — يُبقي أسلوب المجال موحّداً.
 * الملحوظات لا تضيع: تبقى في التقييم لمن يحتاجها.
 */
export function requireValidGpsFix(
  assessment: GpsAssessment,
): Result<ValidatedGpsFix, RejectedGpsFixError> {
  if (assessment.fix === null) {
    return err(
      new RejectedGpsFixError(
        assessment.findings.filter((f) => f.severity === "REJECT").map((f) => f.code),
      ),
    );
  }
  return ok(assessment.fix);
}
