/**
 * الغرض: مخزنُ حالةِ البثّ الحيّ المشتركُ بينَ النسخِ — يحلُّ `SCL-005`.
 * الحالة: منفّذ فعلياً — `SCL-005`.
 * ينتمي إلى: application/tracking
 *
 * ## لماذا مخزنٌ مشتركٌ لا خريطةُ ذاكرةٍ
 *
 * كان المُرحِّلُ يخزنُ `tripId → messageId` في `Map` داخلَ العمليةِ. فإذا ماتتِ
 * النسخةُ أو أُعيدَ تشغيلُها فُقدتِ المعرّفاتُ، وتُفتحُ رسالةُ بثٍّ ثانيةٌ في
 * محادثةِ العميلِ — والأولى تسكنُ حتى تنتهيَ مدّتُها. والعيبُ تجميليٌّ يظهرُ عندَ
 * النشرِ فقط، لكنّه عيبٌ حقيقيٌّ متعدّدُ النسخِ: نسختانِ تريانِ الحدثَ الأولَ
 * لرحلةٍ معاً فتفتحانِ رسالتَي بثٍّ unless تُسلسَلُ بدءُ البثّ.
 *
 * والمخزنُ المشتركُ (Redis) يحلُّ الأمرَين: حالةٌ تبقى بعدَ إعادةِ التشغيلِ،
 * وادّعاءٌ ذرّيٌّ (`SET NX`) يمنعُ نسختَينِ من فتحِ رسالتَينِ. وهو «مفتاحٌ
 * مشتركٌ» كما يقولُ نصُّ الحلّ في `ROADMAP` — لا حاجةَ لتعديلِ النصّ (`ح-1`).
 *
 * ## حدودُ القبولِ
 *
 * المخزنُ مقبضٌ عابرٌ لقناةِ تلغرام، لا حقيقةُ مجالٍ دائمةٌ. يُكتَبُ عندَ بدءِ
 * البثّ وإغلاقِه لا عندَ كلِّ إصلاحةٍ — فيتفادّى ثمنَ الكتابةِ لكلِّ تحديث. وله
 * TTL طبيعيٌّ (عمرُ البثّ + هامش)، فيزولُ من تلقاءِ نفسِه. وسينقلُه `F4-07`
 * (انتقالُ Mini App) كلياً عندَ إسقاطِ مسارِ Live Location الأساسيّ.
 */

/** حالةُ بثٍّ مفتوحٍ لرحلةٍ واحدة — تُخزَّنُ مشتركةً. */
export interface BroadcastState {
  readonly chatId: string;
  readonly messageId: string;
  sentAtMs: number;
  lat: number;
  lng: number;
  sessionId: string;
  lastAppliedSeq: number;
}

/**
 * مخزنُ حالةِ البثّ المشترك. تنفيذُه في الذاكرةِ (للاختبار) أو في Redis (للإنتاج).
 * كلُّ عمليّةٍ لا ترمي: الفشلُ يُسجَّلُ ويُتابَع، فالعرضُ نقطةٌ واحدةٌ تُستبدَلُ
 * بأحدثِ ما وصل.
 */
export interface LiveBroadcastStore {
  /** يقرأ الحالةَ المشتركةَ للرحلة، أو `null` إن لم يكن لها بثٌّ مفتوح. */
  get(tripId: string): Promise<BroadcastState | null>;
  /** يكتبُ الحالةَ مع عمرٍ محدودٍ (`ttlMs`). */
  save(tripId: string, state: BroadcastState, ttlMs: number): Promise<void>;
  /** يحذفُ الحالةَ إن وُجدت. */
  delete(tripId: string): Promise<void>;
  /**
   * يدّعي بدءَ بثٍّ ذرّيّاً: ينجحُ مرّةً واحدةً فقط لكلِّ رحلةٍ حتى يُحرَّرَ.
   * يعيدُ `true` إن اكتسبَت هذه النسخةُ الادّعاءَ، و`false` إن كانت مشغولةً بنسخةٍ
   * أخرى. مفتاحُ الأمانِ ضدُّ فتحِ رسالتَي بثٍّ متزامنتَين.
   */
  claimStart(tripId: string, token: string, ttlMs: number): Promise<boolean>;
  /** يحرّر الادّعاءَ إن كان الرمزُ صاحبَه (قفلٌ آمنٌ ضدَّ الإطلاقِ الخاطئ). */
  releaseClaim(tripId: string, token: string): Promise<void>;
}

/**
 * حارسُ نوعٍ يُميِّزُ حالةَ البثِّ الصالحةَ من قيمةٍ مجهولةٍ. يُستعمَلُ في تنفيذِ Redis
 * لرفضِ القيمِ المشوّهةِ دونَ رميٍ، ويُحمَّلُ وقتَ التشغيلِ لا وقتَ الترجمةِ وحدها.
 */
export function isBroadcastState(value: unknown): value is BroadcastState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<BroadcastState>;
  return (
    typeof v.chatId === "string" &&
    typeof v.messageId === "string" &&
    typeof v.sessionId === "string"
  );
}
