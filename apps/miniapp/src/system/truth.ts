/**
 * الغرض: طبقةُ الحقيقةِ والحالةِ الموحَّدة (UI-8 · ADR 0242) — معجمٌ واحدٌ للحالاتِ
 *   السبع (§5)، وحكمٌ واحدٌ على **عمرِ** القراءة (مقيسٌ أم مجهول، وطازجٌ أم قديم)،
 *   ومعجمٌ واحدٌ **لمصادرِ** القيمِ المعروضة (الختمُ الأصليّ §10.5). دوالُّ نقيّةٌ لا شبكةَ
 *   فيها ولا ساعةَ ولا DOM.
 * الحالة: منفّذ فعلياً — UI-8.
 * ينتمي إلى: apps/miniapp/src/system (حزمة `shell`)
 * يُستخدم من: `system/ui` (`UiTruth`) · `rider/active/ActiveRideScreen.tsx` ·
 *   `rider/active/RideJourney.tsx` · `rider/sos/SosCard.tsx` · `rider/share/RideShareCard.tsx`.
 *
 * لماذا حارسٌ في طبقةِ العرضِ لا في `*view.ts`؟ لأنَّ ملفّاتِ العرضِ عقودٌ لا تُمسّ (§0.3)،
 * وهيَ تُحوِّلُ العمرَ غيرَ الصالحِ إلى صفرٍ قبلَ التقسيم. فالشاشةُ تسألُ هنا أوّلاً عن
 * القيمةِ **الخام** كما وصلت: إن لم تكن مقيسةً لا يُرسَمُ رقمُها أصلاً (§9: «إظهارُ 0 لما
 * لم يُقَس»)، وإن كانت مقيسةً مرَّت إلى دالّةِ العرضِ كما هي.
 */

/** الحالاتُ السبعُ (§5) بترتيبِ التوجيه. لا تُخلَط ولا تُضافُ ثامنة. */
export const TRUTH_STATE_KINDS = [
  "loading",
  "empty",
  "error",
  "refused",
  "unavailable",
  "stale",
  "unknown",
] as const;

export type TruthStateKind = (typeof TRUTH_STATE_KINDS)[number];

/**
 * الفشلُ والرفضُ يقاطعان قارئَ الشاشة (`alert`)، وسائرُ الحالاتِ تُخبَرُ بأدب (`status`) —
 * القاعدةُ نفسُها في `screenTone` وفي لوحةِ الإدارة (UI-6) والتتبّعِ العامّ (UI-7).
 */
export function truthRole(kind: TruthStateKind): "alert" | "status" {
  return kind === "error" || kind === "refused" ? "alert" : "status";
}

/** عمرُ قراءةٍ: مقيسٌ بثوانٍ صحيحة، أو مجهولٌ — ولا ثالث، ولا صفرَ بديلاً عن المجهول. */
export type TruthAge =
  | { readonly kind: "measured"; readonly seconds: number }
  | { readonly kind: "unknown" };

/**
 * القيمةُ الخامُ ⇒ عمر. المقيسُ عددٌ منتهٍ غيرُ سالب (والصفرُ المقيسُ صفرٌ حقيقيّ).
 * و`null`/غيابُ الحقل/`NaN`/السالبُ/غيرُ العدد = **مجهول**: سالبٌ يعني ساعتين مختلفتين
 * لا «الآن»، وتحويلُه إلى صفرٍ يُري القديمَ حديثاً.
 */
export function truthAge(raw: unknown): TruthAge {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return { kind: "unknown" };
  return { kind: "measured", seconds: Math.trunc(raw) };
}

/**
 * طازجٌ أم قديمٌ أم مجهول؟ **المجهولُ ليس قديماً**: القديمُ عمرٌ مقيسٌ تجاوزَ الحدّ،
 * والمجهولُ لا عمرَ له أصلاً. والحدُّ يمرُّ من المستدعي (من النطاقِ أو الخادم) ولا يُكتَبُ هنا.
 */
export function truthFreshness(
  age: TruthAge,
  maxAgeSeconds: number,
): "fresh" | "stale" | "unknown" {
  if (age.kind === "unknown") return "unknown";
  return age.seconds <= maxAgeSeconds ? "fresh" : "stale";
}

/**
 * مصادرُ القيمِ المعروضةِ اليوم — **ما له مصدرٌ في ردٍّ حقيقيٍّ فقط**:
 * - `server_record`: سجلُّ الرحلةِ في الخادم (طورُها).
 * - `server_age`: عمرٌ يقيسُه الخادمُ (`now() - …` في القاعدة) — لا ساعةَ الجهاز.
 * - `routing_engine`: محرّكُ الطرقِ (OSRM) خلفَ تقديرِ الوصول.
 * - `server_clock`: ساعةُ الخادمِ لحظةَ القراءة (`observedAt` — ADR 0243).
 * - `observed_trips`: ساقاتٌ منتهيةٌ رُصِدَت في المدينة (مدى التقدير — ADR 0243).
 */
export type TruthSource =
  | "server_record"
  | "server_age"
  | "routing_engine"
  | "server_clock"
  | "observed_trips";

/** مفتاحُ نصِّ كلِّ مصدر — في النواة لأنَّ الاستغاثةَ (النواة) تحملُ ختماً. */
export const TRUTH_SOURCE_KEYS: Readonly<Record<TruthSource, string>> = {
  server_record: "truth.source.serverRecord",
  server_age: "truth.source.serverAge",
  routing_engine: "truth.source.routingEngine",
  server_clock: "truth.source.serverClock",
  observed_trips: "truth.source.observedTrips",
};

/** ما يُقالُ مكانَ عمرٍ لم يُقَس — جملةٌ لا رقم. */
export const TRUTH_AGE_UNKNOWN_KEY = "truth.age.unknown";
