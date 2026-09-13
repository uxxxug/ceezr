/**
 * الغرض: منافذُ الاقتباسِ — حكمُ القاعدةِ على طرفَي الرحلةِ وخدماتِ المدينةِ،
 *   ومنفذُ التوجيهِ للمدّةِ (البند `F2-04` · القاعدتان 0.5 و0.6).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (تعريفُ منافذَ بلا تنفيذٍ ههنا).
 * ينتمي إلى: packages/application/quote
 * يُستخدم من: `packages/application/quote/quote-ride.ts` ·
 *   `packages/infrastructure/quote/quote-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يستدعي الحكمَ نفسَه قبلَ إنشاءِ الرحلةِ، فلا
 *   تُكرَّرُ قاعدةُ منطقةِ الخدمةِ في موضعَينِ.
 * ملاحظات مستقبلية: يومَ تُفَكُّ حَجيرةُ `DEC-11` يُضافُ منفذُ أجرةٍ **منفصلٌ**
 *   ومعَه مصدرُ سياستِه؛ ولا يُوسَّعُ هذا المنفذُ بحقلٍ فارغٍ اليومَ (`م13-7`).
 *
 * ## لماذا الرفضُ حمولةٌ لا عطبٌ — ثانيةً وبسببٍ زائدٍ
 *
 * كما في `F2-03`: «خارجَ منطقةِ الخدمةِ» جوابٌ صحيحٌ. والزائدُ ههنا أنَّ الرفضَ
 * **رمزانِ** لا رمزٌ: الانطلاقُ والوجهةُ. ولو جُمِعا لَقالت الشاشةُ للراكبِ
 * «وجهتُك خارجَ الخدمةِ» وهوَ نفسُه الواقفُ خارجَها — فيُصحِّحُ ما ليسَ خطأً.
 *
 * ## ولماذا يُعادُ فحصُ الوجهةِ وقد فُحِصَت في `F2-03`
 *
 * لأنَّ المفحوصَ هناكَ نقطةٌ أرسلَها **العميلُ**، والعميلُ يُعدَّلُ. فلو قَبِلَ
 * الخادمُ «صادقةٌ لأنَّ الشاشةَ قالت ذلكَ» لَصارَ حدُّ منطقةِ الخدمةِ إرشاداً في
 * الواجهةِ لا حدّاً. وليسَ هذا منطقاً ثانياً: **الفحصُ نفسُه** — `st_covers` على
 * صفِّ `city_service_areas` المُفعَّلِ نفسِه — في المحرِّكِ نفسِه. مصدرُ الحقيقةِ
 * واحدٌ، والاستدعاءُ في موضعَينِ لأنَّ السؤالَينِ اثنانِ.
 *
 * ## ولا أجرةَ في هذا المنفذِ
 *
 * `ADR 0039` §٤ يحجبُ آليةَ الأجرةِ على `DEC-11`، و§٦ لا يقبلُ تحليلاً داخليّاً
 * — بشريّاً أو آليّاً — سنداً لإغلاقِه. و`م13-7` يُجمِّدُ الهياكلَ التمهيديّةَ.
 * فليسَ في هذا العقدِ حقلُ أجرةٍ ولا حقلٌ فارغٌ لها، وحاجزُ
 * `scripts/check-quote-contract.ts` يُسقِطُ CI إن ظهرَ.
 */

import type { EtaVerdict } from "../../domain/eta/index.ts";
import type { TaggedDistance } from "../../domain/quote/distance-kind.ts";
import type { ServiceOffer } from "../../domain/quote/service-offer.ts";
import type { Result } from "../../shared/result/index.ts";

export type QuoteStoreFailureReason =
  /** لا صفَّ مستخدمٍ لهذا المعرّفِ — لا يُنشَأُ ههنا (ADR 0035). */
  | "USER_NOT_FOUND"
  /** المنفذُ غيرُ مُهيَّأٍ — يُترجَمُ 503 لا 200 بحكمٍ مخترَعٍ. */
  | "NOT_CONFIGURED"
  | "STORE_ERROR";

export interface QuoteStoreFailure {
  readonly reason: QuoteStoreFailureReason;
  readonly detail?: string;
}

export interface QuoteCity {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export type QuoteRefusal =
  /** إحداثيّةٌ غيرُ عدديّةٍ أو خارجَ مدى الأرضِ — عيبُ عميلٍ لا حالةُ منتَجٍ. */
  | "INVALID_POINT"
  /** مدينةُ الراكبِ بلا حدٍّ مرسومٍ: تُعلَنُ ولا تُقبَلُ افتراضاً. */
  | "CITY_HAS_NO_SERVICE_AREA"
  | "ORIGIN_OUTSIDE_SERVICE_AREA"
  | "DESTINATION_OUTSIDE_SERVICE_AREA";

/** حكمُ القاعدةِ المقبولُ: مدينةٌ وإصدارُ حدٍّ ومسافةٌ موسومةٌ وخدماتٌ مخدومةٌ. */
export interface AcceptedQuote {
  readonly city: QuoteCity;
  readonly areaVersion: string;
  readonly distance: TaggedDistance;
  /** أسماءُ الخدماتِ كما أعادتْها القاعدةُ — تُترجَمُ بطاقاتٍ في النطاقِ. */
  readonly servedServices: readonly string[];
}

export type QuoteVerdict =
  | { readonly accepted: true; readonly quote: AcceptedQuote }
  | {
      readonly accepted: false;
      readonly refusal: QuoteRefusal;
      /** قد تُعرَفُ المدينةُ ويُرفَضُ الطلبُ؛ و`INVALID_POINT` لا مدينةَ فيه. */
      readonly city: QuoteCity | null;
    };

export interface QuotePoint {
  readonly lat: number;
  readonly lng: number;
}

export interface QuoteJudge {
  /**
   * حكمُ الاقتباسِ. المدينةُ تُقرأُ من صفِّ المستخدمِ لا من الطلبِ (القاعدة 0.4).
   */
  judge(input: {
    /** نصٌّ لا عددٌ: عينُ عُرفِ `F2-02` و`F2-03`، ويُفحَصُ في المحوّلِ قبلَ أن
     *  يُرسَلَ إلى `bigint`. */
    readonly telegramUserId: string;
    readonly origin: QuotePoint;
    readonly destination: QuotePoint;
  }): Promise<Result<QuoteVerdict, QuoteStoreFailure>>;
}

/** ما تُخرِجُه حالةُ الاستخدامِ للناقلِ: حكمٌ ومدّةٌ وبطاقاتٌ — ولا أجرةَ. */
export interface QuoteOutput {
  readonly city: QuoteCity;
  readonly areaVersion: string;
  readonly distance: TaggedDistance;
  readonly eta: EtaVerdict;
  readonly services: readonly ServiceOffer[];
}
