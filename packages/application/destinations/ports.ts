/**
 * الغرض: منافذُ اختيارِ الوجهةِ — بحثٌ في ثلاثةِ مصادرَ ومصادقةُ دبّوسٍ على حدِّ
 *   منطقةِ الخدمةِ (البند `F2-03` · القاعدتان 0.4 و0.5).
 * الحالة: منفّذ فعلياً — البند `F2-03` (تعريفُ منافذَ بلا تنفيذٍ ههنا).
 * ينتمي إلى: packages/application/destinations
 * يُستخدم من: `packages/application/destinations/choose-destination.ts`
 *   و`packages/infrastructure/destinations/destinations-store.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-04` — يقرأُ `AcceptedDestination` مدخلاً للطلبِ
 *   ولا يُعيدُ مصادقةً ثانيةً بمنطقٍ آخرَ.
 *
 * ## لماذا الرفضُ حمولةٌ لا عطبٌ
 *
 * «هذه النقطةُ خارجَ منطقةِ الخدمةِ» **جوابٌ صحيحٌ** عن سؤالٍ صحيحٍ، لا إخفاقٌ في
 * الجوابِ. ولو صارَ خطأً (`Result.err`) لَاختلطَ بعطبِ المخزنِ في نفسِ القناةِ،
 * فصارت الشاشةُ تعرضُ «تعذَّرَ الاتصالُ» لمَن وضعَ دبّوساً في الرياضِ. ولذا:
 *
 *   ــ `DestinationVerdict` اتّحادٌ مُميَّزٌ: `accepted` أو `refused` برمزٍ.
 *   ــ و`DestinationStoreFailure` قناةٌ أخرى للعطبِ وحدَه.
 *
 * وهوَ عينُ ما تفعلُه القاعدةُ: `resolve_destination` تُعيدُ `jsonb` فيه
 * `ok: false` ولا ترفعُ استثناءً (القاعدة 0.5 — الحكمُ في القاعدةِ).
 *
 * ## ولماذا `cityCode` في الرفضِ أيضاً
 *
 * مَن رُفِضَ يحتاجُ أن يعرفَ **أيَّ** مدينةٍ يُقاسُ عليها، وإلّا ظنَّ الحدَّ خطأً
 * وهوَ في مدينةٍ أخرى. والمدينةُ من صفِّ المستخدمِ لا من طلبِه (القاعدة 0.4).
 */

import type {
  DestinationRefusal,
  DestinationSource,
} from "../../domain/destinations/landmark-kinds.ts";
import type { Result } from "../../shared/result/index.ts";

export type DestinationStoreFailureReason =
  /** لا صفَّ مستخدمٍ لهذا المعرّفِ — لا يُنشَأُ ههنا (ADR 0035). */
  | "USER_NOT_FOUND"
  /** المنفذُ غيرُ مُهيَّأٍ — يُترجَمُ 503 لا 200 بقائمةٍ فارغةٍ. */
  | "NOT_CONFIGURED"
  | "STORE_ERROR";

export interface DestinationStoreFailure {
  readonly code: "DESTINATION_STORE_FAILED";
  readonly reason: DestinationStoreFailureReason;
}

/** مدينةُ القياسِ كما قرأتها القاعدةُ — تُعادُ في القبولِ والرفضِ سواءً. */
export interface DestinationCity {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** إصدارُ الحدِّ الذي حُكِمَ به؛ `null` حينَ لا حدَّ مُعرَّفاً. */
  readonly areaVersion: string | null;
}

/** أقربُ معلَمٍ إلى الدبّوسِ ومسافتُه المستقيمةُ — بيانةٌ خامٌّ لا وصفٌ جاهزٌ. */
export interface NearestLandmark {
  readonly kind: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly straightDistanceM: number;
}

export interface AcceptedDestination {
  readonly lat: number;
  readonly lng: number;
  readonly city: DestinationCity;
  /** `null` حينَ الدليلُ خالٍ في هذه المدينةِ — لا يُختلَقُ معلَمٌ. */
  readonly nearest: NearestLandmark | null;
}

export type DestinationVerdict =
  | { readonly accepted: true; readonly destination: AcceptedDestination }
  | {
      readonly accepted: false;
      readonly refusal: DestinationRefusal;
      readonly city: DestinationCity | null;
    };

export interface DestinationResolver {
  resolveForTelegramUser(
    telegramUserId: string,
    lat: number,
    lng: number,
  ): Promise<Result<DestinationVerdict, DestinationStoreFailure>>;
}

/**
 * صفُّ نتيجةٍ. الإحداثيّةُ **إلزاميّةٌ**: نتيجةٌ بلا موضعٍ لا تُختارُ وجهةً،
 * وعرضُها يُنتِجُ نقرةً لا تُفضي إلى شيءٍ. و`refId` معرّفُ المصدرِ حينَ يكونُ له
 * صفٌّ (محفوظٌ أو معلَمٌ) و`null` للمشتقِّ من الطلباتِ.
 */
export interface DestinationSuggestion {
  readonly source: DestinationSource;
  readonly refId: string | null;
  /** صنفُ المعلَمِ، و`null` لما ليسَ معلَماً. */
  readonly kind: string | null;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly lat: number;
  readonly lng: number;
  /** `0` مطابقةُ بدايةِ كلمةٍ و`1` مطابقةُ احتواءٍ — تُعادُ ولا تُترجَمُ رتبةً مضمرةً. */
  readonly matchRank: number;
}

export interface DestinationSearcher {
  searchForTelegramUser(
    telegramUserId: string,
    normalizedQuery: string,
    limit: number,
  ): Promise<Result<readonly DestinationSuggestion[], DestinationStoreFailure>>;
}
