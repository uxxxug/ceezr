/**
 * الغرض: نموذجُ عرضِ الاستغاثةِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ إلى مفاتيحِ نصٍّ
 *   وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-10` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/sos
 * يُستخدم من: `SosCard.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: سطحُ السائقِ — المفاتيحُ مُعامَلةٌ بالدورِ لا مكتوبةٌ.
 *
 * ## لماذا **بطاقةٌ محكومةٌ** لا زرٌّ دائمٌ
 *
 * زرُّ استغاثةٍ يُعرَضُ دائماً ثمَّ يُجيبُ «لا رحلةَ لكَ» **يكذبُ مرّتَينِ**:
 * يَعِدُ قبلَ الضغطِ، ويُخلِفُ بعدَه — في اللحظةِ التي لا يُحتمَلُ فيها إخلافٌ.
 * فالحكمُ يُقرأُ قبلَ الرسمِ، والبطاقةُ تقولُ قبلَ الضغطِ ما ستفعلُ وما لن تفعلَ.
 *
 * ## ولماذا بلاغٌ قائمٌ **يُبقي البطاقةَ ظاهرةً** ولو انتهَت الأهليّةُ
 *
 * مَن أبلغَ ثمَّ اختفَت بطاقتُه يظنُّ أنَّ بلاغَه ضاعَ — فيُبلِّغُ ثانيةً أو
 * ييأسُ. فما دامَ بلاغٌ مفتوحاً، تبقى البطاقةُ تقولُ حالَه وعُمرَه.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يُصيغُ نصّاً**: النصُّ في `packages/shared/i18n` وحدَه.
 *   ــ **لا يعُدُّ الوقتَ بساعةِ الجهازِ**: العُمرُ يصلُ مقيساً من القاعدةِ.
 *   ــ **لا يخترعُ رمزاً**: ما لا يُعرَفُ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً.
 */

import type { ApiSosIncident } from "./sos-contract.ts";

/**
 * أتُرسَمُ البطاقةُ أصلاً؟ **الأهليّةُ أو بلاغٌ قائمٌ** — والثاني وحدَه يكفي
 * (انظرْ رأسَ المِلفِّ).
 */
export function isSosCardVisible(
  eligible: boolean,
  incident: ApiSosIncident | null | undefined,
): boolean {
  return eligible || (incident !== null && incident !== undefined);
}

/** أما زالَ البلاغُ يُنتظَرُ جوابُه؟ `closed` وحدَها منتهيةٌ. */
export function isIncidentPending(incident: ApiSosIncident): boolean {
  return incident.status !== "closed";
}

export interface AgeText {
  readonly key: string;
  readonly minutes: number;
  readonly seconds: number;
}

/**
 * عُمرُ البلاغِ ⇒ مفتاحٌ وأعدادٌ. ودونَ الدقيقةِ يُقالُ بالثواني كي لا يُقرأَ
 * «منذُ ٠ دقيقةٍ» فيُظَنَّ أنَّ شيئاً لم يُرسَلْ.
 */
export function incidentAgeText(ageSeconds: number): AgeText {
  const safe = Number.isFinite(ageSeconds) && ageSeconds > 0 ? Math.trunc(ageSeconds) : 0;
  const minutes = Math.trunc(safe / 60);
  return {
    key: minutes === 0 ? "rider.sos.incident.ageSeconds" : "rider.sos.incident.ageMinutes",
    minutes,
    seconds: safe % 60,
  };
}

/** حالُ البلاغِ ⇒ مفتاحُ نصٍّ. وحالٌ لا تُعرَفُ تُقالُ «قيدَ المتابعةِ» لا فراغاً. */
export function incidentStatusKey(status: string): string {
  if (status === "open") return "rider.sos.incident.status.open";
  if (status === "received") return "rider.sos.incident.status.received";
  if (status === "closed") return "rider.sos.incident.status.closed";
  return "rider.sos.incident.status.unknown";
}

/** أصلُ الأهليّةِ ⇒ مفتاحُ نصٍّ: «رحلةٌ جاريةٌ» أو «رحلةٌ انتهَت قريباً». */
export function originKey(origin: string): string {
  if (origin === "ACTIVE_ORDER") return "rider.sos.origin.active";
  if (origin === "RECENT_ORDER") return "rider.sos.origin.recent";
  return "rider.sos.origin.unknown";
}

/**
 * سببُ المنعِ ⇒ مفتاحُ نصٍّ. و**عطلُ التهيئةِ لا يُقالُ للراكبِ «لا رحلةَ لكَ»**:
 * الأوّلُ عيبٌ فينا والثاني حالُه هو، وخلطُهما يُرسِلُ صاحبَ الحقِّ يبحثُ عن
 * خطأٍ في نفسِه بينما العطبُ عندَنا.
 */
export function blockReasonKey(reason: string): string {
  if (reason === "NO_ACTIVE_ORDER") return "rider.sos.blocked.noRide";
  if (reason === "ESCALATION_GROUP_MISSING" || reason === "SOS_DEDUP_SETTING_MISSING") {
    return "rider.sos.blocked.unavailable";
  }
  return "rider.sos.blocked.unknown";
}

/** رمزُ إفصاحٍ ⇒ مفتاحُ نصٍّ. */
export function disclosureKey(code: string): string {
  return `rider.sos.disclosure.${code}`;
}

/** رفضُ الضغطةِ ⇒ مفتاحُ نصٍّ. */
export function triggerRefusalKey(refusal: string): string {
  if (refusal === "NO_ACTIVE_ORDER") return "rider.sos.refusal.noRide";
  if (refusal === "ESCALATION_GROUP_MISSING" || refusal === "SOS_DEDUP_SETTING_MISSING") {
    return "rider.sos.refusal.unavailable";
  }
  if (refusal === "NOT_ALLOWED") return "rider.sos.refusal.notAllowed";
  return "rider.sos.refusal.unknown";
}

/** رفضُ القراءةِ ⇒ مفتاحُ نصٍّ. */
export function readRefusalKey(refusal: string): string {
  if (refusal === "ACCOUNT_BLOCKED") return "rider.sos.refusal.notAllowed";
  if (refusal === "INVALID_ROLE") return "rider.sos.refusal.unknown";
  return "rider.sos.refusal.notFound";
}

/**
 * رمزُ خطأٍ من الخادمِ ⇒ مفتاحُ نصٍّ. و`SAFETY_STORE_NOT_AVAILABLE` **لهُ نصُّه
 * الخاصُّ** يقولُ صراحةً: «لم يصلْ بلاغُكَ — اتّصلْ بالطوارئِ العامّةِ». وصمتٌ
 * ههنا أو «حدثَ خطأٌ» يتركُ إنساناً يظنُّ أنَّ نداءَه في طريقِه.
 */
export function sosErrorKey(code: string): string {
  if (code === "SESSION_REQUIRED" || code === "SESSION_EXPIRED" || code === "SESSION_INVALID") {
    return "rider.sos.error.session";
  }
  if (code === "ACCOUNT_NOT_FOUND") return "rider.sos.error.account";
  if (code === "SAFETY_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE") {
    return "rider.sos.error.unavailable";
  }
  return "rider.sos.error.unknown";
}

/** أيُعادُ السؤالُ بزرٍّ؟ عطلُ خدمةٍ نعم، وجلسةٌ منتهيةٌ لا. */
export function isRetryableSosError(code: string): boolean {
  return code === "SAFETY_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE";
}
