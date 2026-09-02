/**
 * الغرض: السطحُ العامُّ لطبقةِ التتبّع — ما تُصدّره هذه الطبقةُ من عندِها لا ما
 *   تُمرّره عن غيرِها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/tracking
 *
 * كان في هذه الطبقة `location-validator.ts` نسخة ثانية أضعف من التحقّق القائم
 * في `domain/geo` — بلا فحص انتهاء ولا حدود — فحُذفت في المرحلة ٣ لصالح المصدر الواحد.
 *
 * وفي 2026-09-02 حُذف منها `TrackingService` و`tracking-auth.ts` بـADR-0052 (إغلاق
 * `R-16`): كانا تنسيقاً ثانياً لتتبّعٍ **غيرَ موصولٍ بالإنتاج**، يقرأ الإصلاحةَ
 * السابقةَ من ذاكرةٍ داخل العملية — وهو ما نصّ `ADR-0015` صراحةً على أنّه لا يصحّ
 * حتى تُقرأ من المصدر القانوني نفسه. والمسارُ الحيّ يقرؤها منه فعلاً، فبطل سببُ
 * الاستبقاء. ولا يُعاد بناءُ بديلٍ لما حُذف.
 *
 * ولماذا لا يُعاد تصدير `assessGpsFix` وأخواتِها من هنا كما كان؟ لأنّ كلّ مستهلكٍ
 * في المستودع يستوردها من `packages/domain/geo/gps-fix.ts` مباشرةً، فكان المرورُ
 * بهذه الطبقة اسماً ثانياً لمسارٍ واحد — ومسارانِ لاستيرادِ رمزٍ واحد يجعلان
 * «مَن يستعمل المجال؟» سؤالاً لا يُجاب بالبحث.
 */

export { resolveGpsPolicy } from "./config.ts";
export {
  createMemoryTrackingSessionStore,
  type SessionAdvanceOutcome,
  type TrackingSessionRecord,
  type TrackingSessionStore,
} from "./session-store.ts";
export type {
  LatLng,
  SessionEndReason,
  TrackingEvent,
  TrackingEventPublisher,
  TrackingEventType,
  TrackingSessionFacts,
  TrackingSessionState,
} from "./types.ts";
