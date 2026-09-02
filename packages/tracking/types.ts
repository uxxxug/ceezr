/**
 * الغرض: الأنواع المشتركة لطبقة التتبّع اللحظي.
 *   تحديث موقع GPS، جلسة تتبّع، أحداث التتبّع.
 * الحالة: منفّذ فعلياً — المرحلة 2.
 * ينتمي إلى: packages/tracking
 */

import type { LatLng } from "../maps/core/types.ts";

/** معرّف سائق (إعادة تصدير للوضوح). */
export type { LatLng } from "../maps/core/types.ts";

/**
 * المرحلة ١٢ — حُذف من هنا `GpsUpdate` و`ValidationResult` بـADR-0052 مع
 * `TrackingService`: كانا مدخلَ ذلك المسارِ ومخرجَه، ولم يبقَ لهما مستدعٍ بعده.
 * ومدخلُ المسار الحيّ ليس هذا: هو `StoredFix` في `packages/application/tracking`،
 * محسوبٌ **بعد** الكتابة القانونية لا قبلها. ونوعُ مدخلٍ لمسارٍ محذوفٍ يبقى في
 * الشجرة دعوةٌ لأن يُبنى عليه ثانيةً ما هُدم.
 */

/**
 * المرحلة ٥ — حالة الجلسة تُعرَّف في المجال لا هنا.
 *
 * كان هنا `TrackingStatus = "active" | "idle" | "ended"`: تعريف ثانٍ لحالة
 * الجلسة، بمفرداتٍ مختلفة عن مفردات المجال (`idle` مقابل `STALE`) وبلا آلة
 * انتقالات ولا شرطٍ لأيٍّ منها. ولم يكن يُحسَب في موضع واحد من المستودع.
 *
 * ونوعان للحالة نفسها مخالفةٌ للقاعدة ٥ حتى لو كان أحدهما ميتاً: أوّل من
 * يُنفّذ الجلسة يختار أقربهما إلى يده، فتنقسم المفردات بين طبقتين.
 */
export type {
  SessionEndReason,
  TrackingSessionFacts,
  TrackingSessionState,
} from "../domain/tracking/session.ts";

/** حدث تتبّع — يُطلق عند تغيّر حالة الرحلة. */
export interface TrackingEvent {
  readonly type: TrackingEventType;
  readonly driverId: string;
  readonly tripId: string | null;
  /**
   * `BUG-009` — القناةُ التي يُقاس عليها الترتيبُ: `tracking_sessions.id`.
   *
   * ونطاقُ الترتيبِ جلسةٌ لا سائقٌ ولا رحلةٌ (`ADR 0053` §٣-أ/٢): سائقٌ واحدٌ قد
   * يعبُر جلستَينِ في رحلةٍ واحدةٍ (سقفُ الاثنتَي عشرةَ ساعةً يُغلق الأولى ويفتح
   * الثانيةَ)، فيتراجع الرقمُ بحكمِ تبدُّلِ القناةِ. ولذلك يُقرأ الرقمُ **مقروناً**
   * بهذا الحقلِ دائماً: تبدُّلُ `sessionId` فجوةٌ تُوجب لقطةً، لا تراجعاً يُسقَط
   * (`ADR 0053` §٤-ب/٢).
   */
  readonly sessionId: string;
  /**
   * `BUG-009` — رقمُ ترتيبٍ رتيبٌ متزايدٌ **صادرٌ من الخادمِ** داخلَ الكتابةِ التي
   * أثبتَت هذا الحدثَ (`ADR 0053` §٣-أ/١ و٦ و٨).
   *
   * وليس هو `recordedAtMs` ولا `message.date` ولا `Date.now()` ولا عدّاداً في
   * العمليةِ: تلك كلُّها ساعاتٌ أو ذاكرةٌ، والأولى ساعةُ جهازِ السائقِ بدقّةِ
   * الثانيةِ. و`timestamp` أدناه يبقى ما هو: واقعةٌ زمنيّةٌ للعرضِ، لا مفتاحَ ترتيبٍ.
   *
   * وإلزاميٌّ لا اختياريٌّ بقصدٍ: ناشرٌ ينسى الحقلَ يقف عندَ المُترجِمِ، لا في
   * الإنتاجِ بخريطةٍ تتراجع.
   */
  readonly sequence: number;
  /**
   * المرحلة ٥ — `null` لحدثٍ لا موضع له.
   *
   * كانت الحقول إلزامية، فكان بدء الجلسة وإنهاؤها يُنشران `{lat: 0, lng: 0}`
   * حشواً. وهي ليست قيمةً فارغة بل نقطةٌ حقيقية في خليج غينيا: أي مستهلكٍ
   * يرسم الأحداث على خريطة كان يضع السائق قبالة سواحل أفريقيا عند كل بدء
   * جلسة، وأي حسابِ مسافةٍ على تلك النقطة يُنتج آلاف الكيلومترات.
   *
   * والصفر أخطر من الغياب لأنه يمرّ من كل تحقّق: الإحداثية ضمن المدى، والنوع
   * صحيح، ولا شيء يُميّزها عن موقعٍ حقيقي إلا معرفة أنها لم تكن موجودة أصلاً.
   */
  readonly position: LatLng | null;
  /**
   * المرحلة ٦ — مدينة السائق. اختياري لأن حدثاً عن رحلةٍ انتهت قد يُنشر ولا
   * تُقرأ فيه المدينة (مفتاحه الرحلة لا السائق).
   *
   * ولماذا في الحدث لا يُستعلم عند الاستهلاك؟ لأن مُرشِّح العمليات على المدينة
   * يُطبَّق على **كل** حدث لكل مشترك: استعلامُ مدينةِ السائق هناك يعني استعلاماً
   * لكل حدثٍ مضروباً بعدد المشتركين. والمدينة معلومة عند النشر بلا كلفة.
   */
  readonly cityId?: string;
  readonly timestamp: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * منفذ نشر أحداث التتبّع.
 *
 * كان مُعرَّفاً في `tracking-service.ts` المحذوف، وليس منه في شيء: مستهلكاه
 * الفعليّان `packages/application/tracking/live-tracking.ts` و
 * `packages/infrastructure/tracking/event-bus.ts` — أي المسارُ الحيّ وناقلُه، وكلاهما
 * موصولٌ في `container.ts`. فنُقِل إلى جانب `TrackingEvent` بـADR-0052 ولم يُحذف،
 * لأنّ منفذَ النشر ينتمي إلى الحدث لا إلى مَن كان ينشرُه يوماً.
 */
export interface TrackingEventPublisher {
  publish(event: TrackingEvent): Promise<void>;
}

export type TrackingEventType =
  | "session_started"
  | "session_ended"
  | "location_updated"
  | "driver_arrived_pickup"
  | "driver_left_pickup"
  | "driver_near_customer"
  | "driver_arrived_customer"
  | "speeding_detected"
  | "teleport_detected"
  | "connection_lost"
  | "connection_restored";
