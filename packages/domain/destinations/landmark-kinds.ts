/**
 * الغرض: أصنافُ معالمِ الدليلِ وحدودُ نتائجِ البحثِ ورموزُ رفضِ الوجهةِ — البند
 *   `F2-03` (`SR-03`). سجلُّ النطاقِ الذي يُطابِقُه قيدُ `check` في الهجرةِ.
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: packages/domain/destinations
 * يُستخدم من: `packages/application/destinations/*`
 *   و`packages/infrastructure/destinations/destinations-store.ts`
 *   و`apps/miniapp/src/surfaces/rider/destination/*`
 *   والحاجزُ `scripts/check-destination-contract.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-04` (يقرأُ الوجهةَ المُصادَقةَ لا الخامَّ)
 *   و`F3-02` (حدُّ منطقةِ عملِ السائقِ يقرأُ `city_service_areas` نفسَها).
 *
 * ## لماذا الأصنافُ ههنا لا في المخطَّطِ وحدَه
 *
 * عينُ حكمِ `packages/domain/places/place-kinds.ts` في `F2-02` ولذاتِ السببِ:
 * `destination_landmarks.kind` مُقيَّدٌ في القاعدةِ، ولو أُضيفَ صنفٌ في أحدِ
 * الموضعَينِ وحدَه لَبقيَ الفرقُ صامتاً — صنفٌ في الشِّفرةِ بلا قيدٍ يُخفِقُ عندَ
 * أوّلِ إدخالٍ، وصنفٌ في القيدِ بلا شِفرةٍ صفٌّ يُعرَضُ بلا اسمٍ يُقرأُ. والحاجزُ
 * يُطابِقُ القائمتَينِ **مجموعةً بمجموعةٍ لا احتواءً**.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحملُ نصّاً معروضاً**: `landmarkKindKey` مفتاحٌ لا اسمٌ (القسم 9.11).
 *   ــ **لا يُرتِّبُ الأصنافَ أفضليّةً**: ترتيبُ النتائجِ بدقّةِ المطابقةِ ثمَّ
 *      بمصدرِ الصفِّ (القاعدةُ في الدالّةِ `search_destinations`)، ولا يُقدَّمُ
 *      مطارٌ على مسجدٍ بحكمٍ مُسبَقٍ لا يعرفُه مَن كتبَ الاسمَ.
 *   ــ **لا يحكمُ على نقطةٍ**: الاحتواءُ في منطقةِ الخدمةِ حكمُ القاعدةِ
 *      (القاعدة 0.5)، وحدُّ الكرةِ الأرضيّةِ في `readPlacePoint` من `F2-02`
 *      ولا يُنسَخُ ههنا نسخةً ثانيةً.
 */

/** الأصنافُ العشرةُ عينُها في قيدِ `destination_landmarks_kind_check`. */
export const LANDMARK_KINDS = [
  "airport",
  "port",
  "terminal",
  "district",
  "landmark",
  "mosque",
  "university",
  "hospital",
  "mall",
  "stadium",
] as const;

export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export function isLandmarkKind(value: unknown): value is LandmarkKind {
  return typeof value === "string" && (LANDMARK_KINDS as readonly string[]).includes(value);
}

/**
 * مفتاحُ اسمِ الصنفِ. والصنفُ المجهولُ **لا يُسقِطُ الصفَّ**: خادمٌ أحدثُ قد
 * يعرفُ صنفاً لا تعرفُه هذه الحزمةُ، وإخفاءُ وجهةٍ صحيحةٍ أسوأُ من عرضِها بعنوانٍ
 * عامٍّ — وهوَ عينُ حكمِ `placeKindKey` في `F2-02`.
 */
export function landmarkKindKey(kind: string): string {
  return isLandmarkKind(kind)
    ? `rider.destination.kind.${kind}`
    : "rider.destination.kind.landmark";
}

/** مصادرُ صفِّ النتيجةِ الثلاثةُ كما تُعيدُها `search_destinations` نصّاً. */
export const DESTINATION_SOURCES = ["saved", "recent", "landmark"] as const;
export type DestinationSource = (typeof DESTINATION_SOURCES)[number];

export function isDestinationSource(value: unknown): value is DestinationSource {
  return typeof value === "string" && (DESTINATION_SOURCES as readonly string[]).includes(value);
}

/** مفتاحُ اسمِ المصدرِ — تُعرَضُ النتيجةُ وبجانبِها **من أينَ** جاءت. */
export function destinationSourceKey(source: DestinationSource): string {
  return `rider.destination.source.${source}`;
}

/**
 * حدُّ النتائجِ المعروضةِ. والعشرةُ قيمةُ منتَجٍ (القاعدة 0.3): شاشةُ هاتفٍ لا
 * تعرضُ أكثرَ بلا لفٍّ، ومَن لم يجدْ وجهتَه في عشرٍ فالحلُّ كلمةٌ أدقُّ لا قائمةٌ
 * أطولُ. والسقفُ حراسةُ مصدرٍ يُوافِقُ سقفَ الدالّةِ في القاعدةِ.
 */
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 25;

/**
 * حدٌّ عمليٌّ لوصفِ «قربَ كذا». وألفٌ وخمسُ مئةِ مترٍ مشياً يُقاسُ بالدقائقِ لا
 * بالأمتارِ، وما بعدَها لا يَصِفُ موضعاً بل يُضلِّلُ عنه — فيُسكَتُ عن الوصفِ ولا
 * يُقالُ «قربَ المطارِ» لنقطةٍ تبعدُ عنه ثمانيةَ كيلومتراتٍ.
 *
 * والحدُّ في **النطاقِ** لا في القاعدةِ عن قصدٍ: القاعدةُ تُعيدُ أقربَ معلَمٍ
 * والمسافةَ كما هما (بيانةٌ صادقةٌ كاملةٌ)، والنطاقُ يقرِّرُ متى يصيرُ ذلكَ وصفاً
 * يُعرَضُ. ولو حُكِمَ في القاعدةِ لَمَا استطاعَ `F2-04` قراءةَ الجارِ الأقربِ لغرضٍ
 * آخرَ بحدٍّ آخرَ.
 */
export const NEAREST_LANDMARK_DESCRIBES_WITHIN_M = 1500;

export function describesPoint(straightDistanceM: number): boolean {
  return (
    Number.isFinite(straightDistanceM) &&
    straightDistanceM >= 0 &&
    straightDistanceM <= NEAREST_LANDMARK_DESCRIBES_WITHIN_M
  );
}

/**
 * رموزُ رفضِ المصادقةِ كما تُعيدُها `resolve_destination` — **رفضُ عملٍ يُقرأُ**
 * لا عطبُ مخزنٍ. وكلُّ رمزٍ له مفتاحُ نصٍّ في اللغاتِ الثلاثِ يفرضُه الحاجزُ،
 * لأنَّ الرفضَ ههنا هوَ الشاشةُ نفسُها لا حاشيةً عليها.
 */
export const DESTINATION_REFUSALS = [
  /** إحداثيّةٌ خارجَ حدودِ الكرةِ أو غيرُ رقمٍ. */
  "INVALID_POINT",
  /** مدينةُ المستخدمِ مُعطَّلةٌ في `cities` — لا سائقَ فيها ولا تسعيرَ. */
  "CITY_NOT_SERVED",
  /** صفُّ مدينةٍ مفقودٌ — عطبُ بيانةٍ يُعلَنُ ولا يُترجَمُ «خارجَ النطاقِ». */
  "CITY_UNKNOWN",
  /** مدينةٌ مُفعَّلةٌ بلا حدٍّ مُعرَّفٍ — عطبُ تهيئةٍ، والغيابُ لا يُوسِّعُ الخدمةَ. */
  "SERVICE_AREA_NOT_DEFINED",
  /** النقطةُ خارجَ منطقةِ الخدمةِ — الرفضُ الوحيدُ الذي يُصلِحُه المستخدمُ بنفسِه. */
  "OUTSIDE_SERVICE_AREA",
] as const;

export type DestinationRefusal = (typeof DESTINATION_REFUSALS)[number];

export function isDestinationRefusal(value: unknown): value is DestinationRefusal {
  return typeof value === "string" && (DESTINATION_REFUSALS as readonly string[]).includes(value);
}

/** مفتاحُ نصِّ الرفضِ — واحدٌ لكلِّ رمزٍ، فلا رفضانِ برسالةٍ واحدةٍ عامّةٍ. */
export function destinationRefusalKey(refusal: DestinationRefusal): string {
  return `rider.destination.refused.${refusal}`;
}

/** والرفضُ الذي يُجدي معه تحريكُ الدبّوسِ — وما سواه لا يُرجى بإعادةٍ. */
export function isUserFixableRefusal(refusal: DestinationRefusal): boolean {
  return refusal === "OUTSIDE_SERVICE_AREA" || refusal === "INVALID_POINT";
}
