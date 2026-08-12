/**
 * الغرض: آلة حالة جلسة التتبّع — المرحلة ٥.
 *   نقيّة تماماً: لا ساعة تُقرأ، ولا قاعدة تُلمس، ولا حالة محفوظة بين الاستدعاءات.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: domain/tracking
 * يُتوقع أن يستخدمه: packages/tracking/tracking-service.ts، ومخزن الجلسات في البنية التحتية.
 *
 * ## لماذا الحالة تُشتقّ ولا تُخزَّن — القرار وسنده
 *
 * الإغراء الأول أن يُضاف عمود `status text` إلى جدول الجلسات ويُكتب فيه
 * `'ACTIVE'` أو `'STALE'`. وهو خطأ يكشفه سؤال واحد: **متى يُكتب `STALE`؟**
 *
 * الانتقال إلى STALE ليس حدثاً يقع، بل **حدثاً يتخلّف عن الوقوع**: السائق
 * توقّف عن الإرسال. ولا شيء يجري في اللحظة التي يصير فيها متخلّفاً، فلا كاتب
 * هناك ليكتب. فيبقى حلّان:
 *
 *   ١. مهمّة دورية تمسح الجلسات وتُحدّث العمود. وحينها يكون العمود **كاذباً**
 *      في كل لحظة بين تشغيلين — تقرؤه العمليات `ACTIVE` والسائق منقطع منذ
 *      دقيقتين. وكلّما قصُرت الدورة زاد الحمل ولم يزُل الكذب.
 *   ٢. أن يُشتقّ عند القراءة من `lastFixAt` و`now`. وهو صادق دائماً بلا مهمّة
 *      ولا كتابة ولا مسار فشل.
 *
 * فالمخزَّن هو **الوقائع** (بدأت متى، آخر إصلاحة متى، انتهت متى ولماذا)،
 * والمحسوب هو **الحكم**. وهذا يمنع أن يكون للحالة مصدران يتعارضان — القاعدة ٥.
 *
 * CREATED و ACTIVE و ENDED انتقالات لها أحداث حقيقية، فهي تُشتقّ من وقائعها.
 * و STALE وحدها تُشتقّ من غياب واقعة، ولذلك لا يجوز أن تُكتب أبداً.
 */

/**
 * `CREATED` جلسة بدأت ولم تصل منها إصلاحة بعد — السائق فتح التتبّع ولم يُرسل.
 * `ACTIVE` وصلت إصلاحة حديثة.
 * `STALE` بدأت ووصلت إصلاحات ثم انقطعت — الجلسة قائمة والسائق غير مرئي.
 * `ENDED` أُنهيت بحدث صريح. نهائية.
 */
export type TrackingSessionState = "CREATED" | "ACTIVE" | "STALE" | "ENDED";

/** سبب الإنهاء يُخزَّن: «انتهت» وحدها لا تكفي لتفسير ما جرى بعد أسبوع. */
export type SessionEndReason =
  | "TRIP_COMPLETED"
  | "DRIVER_STOPPED"
  | "TRIP_CANCELLED"
  | "EXPIRED"
  | "ADMIN_TERMINATED";

/** الوقائع المخزَّنة عن الجلسة — وحدها. لا حقل حالة هنا بقصد. */
export interface TrackingSessionFacts {
  readonly driverId: string;
  readonly tripId: string | null;
  readonly startedAtMs: number;
  /** `null` = بدأت ولم تصل إصلاحة بعد. */
  readonly lastFixAtMs: number | null;
  /** `null` = لم تنتهِ. وجودها ينفي كل حالة أخرى. */
  readonly endedAtMs: number | null;
  readonly endReason: SessionEndReason | null;
}

export interface SessionPolicy {
  /** بعدها تُعدّ الجلسة منقطعة. */
  readonly staleAfterSeconds: number;
  /**
   * عمر أقصى للجلسة مهما كانت نشطة. جلسة بلا سقف تبقى مفتوحة إلى الأبد إن
   * فُقد حدث الإنهاء — وهو ما يقع فعلاً حين يُقتل الخادم في منتصف رحلة.
   */
  readonly maxSessionSeconds: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  staleAfterSeconds: 30,
  maxSessionSeconds: 12 * 60 * 60,
};

/**
 * الحكم على الجلسة في لحظة بعينها. `nowMs` يُمرَّر ولا يُقرأ: الدالة نقيّة،
 * فالحالة نفسها تُعاد لنفس المُدخلات دائماً — وهو شرط أن تكون قابلة للاختبار
 * بلا حِيَل على الزمن.
 */
export function sessionStateAt(
  facts: TrackingSessionFacts,
  nowMs: number,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): TrackingSessionState {
  if (facts.endedAtMs !== null) return "ENDED";

  // السقف الزمني يُقاس من البداية لا من آخر إصلاحة: جلسةٌ نشطة اثنتي عشرة ساعة
  // متّصلة ليست جلسة عمل، بل عميل لم يُغلق أو جهاز عالق يُرسل بلا سائق.
  if (nowMs - facts.startedAtMs >= policy.maxSessionSeconds * 1000) return "ENDED";

  if (facts.lastFixAtMs === null) {
    // لم تصل إصلاحة قط. تبقى CREATED ما دامت في مهلة الانقطاع، ثم تصير STALE:
    // جلسةٌ بُدئت ولم يُرسل صاحبها شيئاً حالُها حال من أرسل ثم انقطع — كلاهما
    // غير مرئي، وتمييزهما في العرض يُضلّل المشغّل بفارق لا أثر له عليه.
    return nowMs - facts.startedAtMs >= policy.staleAfterSeconds * 1000 ? "STALE" : "CREATED";
  }

  return nowMs - facts.lastFixAtMs >= policy.staleAfterSeconds * 1000 ? "STALE" : "ACTIVE";
}

export type SessionTransitionCode =
  | "SESSION_ALREADY_ENDED"
  | "SESSION_NOT_STARTED"
  | "FIX_BEFORE_SESSION_START";

export class SessionTransitionError {
  readonly code = "INVALID_SESSION_TRANSITION" as const;
  constructor(readonly reason: SessionTransitionCode) {}
}

export type SessionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SessionTransitionError };

/** بدء جلسة. الوقائع الوحيدة المعروفة عند البدء: من، ولأي رحلة، ومتى. */
export function startSession(
  driverId: string,
  tripId: string | null,
  nowMs: number,
): TrackingSessionFacts {
  return {
    driverId,
    tripId,
    startedAtMs: nowMs,
    lastFixAtMs: null,
    endedAtMs: null,
    endReason: null,
  };
}

/**
 * تسجيل إصلاحة. يُرفض أمران:
 *
 *   ١. إصلاحة على جلسة منتهية — وإلا «أحيت» الجلسةَ إصلاحةٌ متأخّرة في الشبكة
 *      بعد إنهائها، فيعود السائق إلى الخريطة وقد أغلق تطبيقه.
 *   ٢. إصلاحة أقدم من بداية الجلسة — طابعها يخصّ جلسةً أخرى أو ساعةً معطوبة.
 *
 * وهذا لا يُغني عن `assessGpsFix`: ذاك يحكم على الإصلاحة في ذاتها، وهذا يحكم
 * على موضعها من الجلسة. حكمان مختلفان على شيء واحد، ودمجهما كان سيخلط
 * صحّة القياس بصحّة السياق.
 */
export function recordFix(
  facts: TrackingSessionFacts,
  fixAtMs: number,
  nowMs: number,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): SessionResult<TrackingSessionFacts> {
  if (sessionStateAt(facts, nowMs, policy) === "ENDED") {
    return { ok: false, error: new SessionTransitionError("SESSION_ALREADY_ENDED") };
  }
  if (fixAtMs < facts.startedAtMs) {
    return { ok: false, error: new SessionTransitionError("FIX_BEFORE_SESSION_START") };
  }

  /**
   * `Math.max` مقصود: إصلاحات تصل خارج ترتيبها (طابور شبكة يُدفَع بعد انقطاع)،
   * وأخذُ الأحدث طابعاً — لا آخر ما وصل — يمنع أن تُرجِع إصلاحةٌ قديمةٌ الجلسةَ
   * إلى STALE وهي تتلقّى تحديثات فعلاً.
   */
  const lastFixAtMs = facts.lastFixAtMs === null ? fixAtMs : Math.max(facts.lastFixAtMs, fixAtMs);
  return { ok: true, value: { ...facts, lastFixAtMs } };
}

/**
 * إنهاء الجلسة. الإنهاء **مُتسامِح مع التكرار**: إنهاء جلسة منتهية يعيد الوقائع
 * كما هي بلا خطأ، ولا يُعيد كتابة وقت الإنهاء ولا سببه. فالأول هو الصحيح —
 * والثاني إعادةُ محاولةٍ من عميل لم يصله الردّ، لا واقعةٌ جديدة.
 */
export function endSession(
  facts: TrackingSessionFacts,
  reason: SessionEndReason,
  nowMs: number,
): TrackingSessionFacts {
  if (facts.endedAtMs !== null) return facts;
  return { ...facts, endedAtMs: nowMs, endReason: reason };
}

/**
 * حالة السائق من جهة الخدمة — لا من جهة الجلسة. مصدرها القاعدة: صفُّ الإتاحة
 * والرحلة الجارية.
 */
export interface DriverDutyState {
  readonly isOnDuty: boolean;
  readonly hasActiveTrip: boolean;
}

/**
 * هل يجوز أن تكون للسائق جلسة تتبّع مفتوحة الآن؟
 *
 * ## المشكلة التي تُحلّ
 *
 * قبل المرحلة ١٢ كانت الجلسة تُفتح بأوّل إصلاحة وتبقى مفتوحة حتى تنتهي رحلةٌ
 * أو يبلغ السقف الزمني (١٢ ساعة). فسائقٌ يضغط «أوقف استقبال الطلبات» ثم يُبقي
 * الموقع الحيّ يبثّ من جهازه كان: (١) يبقى على خريطة العمليات ساعاتٍ بعد خروجه
 * من الخدمة — والاستعلام يقرأ `ended_at is null` لا الإتاحة، و(٢) يُتتبَّع موقعه
 * وهو في وقته الخاص. وقياسُ ذلك بمسبار تنفيذ: الجلسة بقيت مفتوحة بعد
 * `/unavailable`، وإصلاحةٌ بعده قُبِلت وقدّمت الجلسة.
 *
 * ## ولماذا «أو» لا «و»
 *
 * لأن الرحلة تسبق الإتاحة. سائقٌ في منتصف رحلة يجب أن يُتتبَّع وإن أُخرج من
 * الإتاحة بيد مشغّلٍ أو بوظيفةٍ مجدولة — وإلّا فقد عميلُه خريطته في أثناء
 * رحلته. وهذه ليست قاعدةً جديدة: وظيفة إخراج الساكنين من الإتاحة
 * (`expire_stale_availability`) تستثني أصحاب الرحلات الجارية بنفس الشرط
 * حرفياً. فالسياسة هنا **تُطابق** حكماً قائماً في القاعدة ولا تُنشئ ثانياً.
 */
export function sessionShouldRun(duty: DriverDutyState): boolean {
  return duty.isOnDuty || duty.hasActiveTrip;
}

/** هل تقبل الجلسة إصلاحات الآن؟ سؤال العمليات، وجوابه حالة واحدة لا ثلاث. */
export function acceptsFixes(
  facts: TrackingSessionFacts,
  nowMs: number,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): boolean {
  return sessionStateAt(facts, nowMs, policy) !== "ENDED";
}
