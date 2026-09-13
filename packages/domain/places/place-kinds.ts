/**
 * الغرض: أنواعُ المكانِ المحفوظِ وحدودُ لافتتِه وإحداثيّاتِه — البند `F2-02`
 *   (`SR-02`: «أماكنٌ محفوظةٌ (المنزل/العمل)»).
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: packages/domain/places
 * يُستخدم من: `packages/application/places/*` و`apps/gateway/src/routes/me-places.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-03` (اختيارُ الوجهةِ) و`SR-12` (إدارةُ الأماكنِ).
 *
 * ## لماذا القائمةُ ههنا لا في المخطَّطِ وحدَه
 *
 * `saved_places.kind` مُقيَّدٌ في القاعدةِ بثلاثةٍ، والحاجزُ
 * `scripts/check-place-kinds.ts` يُطابِقُ هذا الملفَّ بالقيدِ في الهجرةِ. فلو
 * أُضيفَ نوعٌ في أحدِ الموضعَينِ وحدَه لَبَقِيَ الفرقُ صامتاً حتّى تُخفِقَ كتابةُ
 * مستخدمٍ في الإنتاجِ بخطأِ قيدٍ لا يفهمُه أحدٌ. والحاجزُ يُسقِطُ البناءَ بدلَ ذلكَ.
 * وهوَ عينُ ما فُعِلَ بوثائقِ الموافقاتِ في `F2-01` (`scripts/check-consent-documents.ts`).
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ لا يحملُ نصّاً معروضاً: `homeLabelKey` مفتاحٌ لا نصٌّ (القسم 9.11).
 *   ــ لا يقرِّرُ حدَّ عددِ الأماكنِ من نوعِ `other`: القاعدةُ تحملُ الفريدَ
 *      الجزئيَّ للمنزلِ والعملِ وحدَهما، و`SR-12` يملكُ الحدَّ إن وُجِدَ.
 *   ــ لا يتحقّقُ من كونِ النقطةِ داخلَ المدينةِ: ذاكَ `F2-03` بحدودِ المدنِ،
 *      وحدُّه ههنا حدُّ الكرةِ الأرضيّةِ لا حدُّ خدمةٍ.
 */

/** الأنواعُ الثلاثةُ عينُها في قيدِ `saved_places_kind_check`. */
export const SAVED_PLACE_KINDS = ["home", "work", "other"] as const;

export type SavedPlaceKind = (typeof SAVED_PLACE_KINDS)[number];

/**
 * النوعانِ المُفرَدانِ: واحدٌ لكلِّ مستخدمٍ، تفرضُه القاعدةُ بفهرسٍ فريدٍ جزئيٍّ
 * (`saved_places_user_singleton_idx`) لا هذا الملفُّ. وههنا يُعرَفانِ كي تعرفَ
 * الشاشةُ أيَّ بطاقةٍ تُظهِرُ ثابتةً وأيَّها قائمةً تُضافُ إليها.
 */
export const SINGLETON_PLACE_KINDS: readonly SavedPlaceKind[] = ["home", "work"];

/** حدُّ اللافتةِ محرفاً — لا بايتاً: المستخدمُ يكتبُ عربيّةً. */
export const MAX_PLACE_LABEL_LENGTH = 80;

export function isSavedPlaceKind(value: unknown): value is SavedPlaceKind {
  return typeof value === "string" && (SAVED_PLACE_KINDS as readonly string[]).includes(value);
}

export function isSingletonPlaceKind(kind: SavedPlaceKind): boolean {
  return SINGLETON_PLACE_KINDS.includes(kind);
}

/**
 * لافتةٌ مقبولةٌ: نصٌّ غيرُ فارغٍ بعدَ التشذيبِ، دونَ الحدِّ، بلا محارفِ تحكّمٍ.
 * ومحارفُ التحكّمِ تُردُّ لا تُنزَعُ: نزعُها يُغيِّرُ ما كتبَه المستخدمُ صامتاً،
 * وردُّها يُخبِرُه. ولا تُمنَعُ الرموزُ ولا الأرقامُ: «بيت أمّي ٢» لافتةٌ صحيحةٌ.
 */
export function normalizePlaceLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if ([...trimmed].length > MAX_PLACE_LABEL_LENGTH) return null;
  // محارفُ التحكّمِ C0 وC1 ومحرفُ الحذفِ — تُفحَصُ بنقاطِ الترميزِ لا بنمطٍ
  // يحملُ محارفَ تحكّمٍ في نصِّه (الحاجزُ `noControlCharactersInRegex` يمنعُ
  // ذلكَ بحقٍّ: نمطٌ فيه محرفٌ غيرُ مرئيٍّ يُقرأُ خطأً ويُنسَخُ خطأً).
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return null;
  }
  return trimmed;
}

export interface PlacePoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * إحداثيّةٌ مقبولةٌ: عددٌ منتهٍ داخلَ حدودِ الكرةِ. و`0,0` **مقبولةٌ** ولا تُعَدُّ
 * «فارغةً»: إحداثيّةٌ صحيحةٌ في خليجِ غينيا، ومعاملةُ الصفرِ غياباً خطأٌ متكرِّرٌ
 * يُسقِطُ نقاطاً حقيقيّةً. الغيابُ يُمثَّلُ بـ`null` لا بصفرٍ.
 */
export function readPlacePoint(lat: unknown, lng: unknown): PlacePoint | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { lat, lng };
}
