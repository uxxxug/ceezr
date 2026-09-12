/**
 * الغرض: منافذُ سجلِّ الموافقاتِ — قراءةُ ما وُوفِقَ عليه، وكتابةُ موافقةٍ **ذرّيّةً
 *   ومُتماثِلةً** (البند `F2-01` · القاعدة 0.5).
 * الحالة: منفّذ فعلياً — البند `F2-01` (تعريفُ منافذَ بلا تنفيذٍ ههنا).
 * ينتمي إلى: packages/application/consent
 * يُتوقع أن يستخدمه لاحقاً: `packages/application/consent/record-consent.ts`
 *   و`packages/infrastructure/consent/` حينَ يُوصَلُ بالقاعدةِ.
 * ملاحظات مستقبلية: «تنزيلُ بياناتي» و«حذفُ حسابي» (`F2-11`) يحتاجانِ قراءةَ هذا
 *   السجلِّ كاملاً لا الواجبَ منه فقط؛ تُضافُ دالّةٌ ثالثةٌ ههنا حينَها.
 *
 * ## لماذا `telegramUserId` لا `userId`
 *
 * المعرّفُ الوحيدُ الذي يملكُه الخادمُ **موقَّعاً منّا** هوَ معرّفُ تيليجرام
 * المستخرَجُ من رمزِ الجلسةِ (القسم 9.8). فلو أخذَ المنفذُ `userId` لَوَجَبَ أن
 * يأتيَ من مكانٍ ما، وأقربُ مكانٍ هوَ جسمُ الطلبِ — وذاكَ بابُ «اكتُبْ موافقةً
 * باسمِ غيرِك». فالمنفذُ يأخذُ ما هوَ موقَّعٌ، والصفُّ يُحَلُّ داخلَ القاعدةِ.
 *
 * ## ولماذا لا تأخذُ الكتابةُ `cityId`
 *
 * القاعدةُ 0.4 تُوجِبُ `city_id` على كلِّ صفٍّ، ولكنَّ مصدرَه **صفُّ المستخدمِ
 * نفسُه** لا العميلُ: `users.city_id` غيرُ فارغٍ منذُ المخطَّطِ الأساسيِّ. فلو
 * قَبِلَ المنفذُ مدينةً من العميلِ لصارَ بالإمكانِ تسجيلُ موافقةٍ في مدينةٍ ليست
 * مدينةَ صاحبِها، وهوَ تلويثُ بيانٍ لا مجردُ حقلٍ خاطئٍ.
 */

import type { RecordedConsent } from "../../domain/consent/consent-decision.ts";
import type { ConsentDocumentKind } from "../../domain/consent/consent-documents.ts";
import type { Result } from "../../shared/result/index.ts";

export type ConsentStoreFailureReason =
  /** لا صفَّ مستخدمٍ لهذا المعرّفِ — لا يُنشَأُ ههنا (ADR 0035). */
  | "USER_NOT_FOUND"
  /** المنفذُ غيرُ مُهيَّأٍ — يُترجَمُ 503 لا 200 بجسمٍ فارغٍ. */
  | "NOT_CONFIGURED"
  | "STORE_ERROR";

export interface ConsentStoreFailure {
  readonly code: "CONSENT_STORE_FAILED";
  readonly reason: ConsentStoreFailureReason;
}

export interface RecordConsentCommand {
  readonly telegramUserId: string;
  readonly kind: ConsentDocumentKind;
  readonly version: string;
  /** لحظةُ الموافقةِ كما يقيسُها الخادمُ — لا يُقبَلُ ختمٌ زمنيٌّ من العميل. */
  readonly acceptedAtMs: number;
}

export interface RecordConsentOutcome {
  /**
   * `recorded` صفٌّ جديدٌ، و`already_recorded` نداءٌ مُكرَّرٌ لم يُنشِئْ صفّاً
   * ثانياً ولم **يُحرِّكْ** ختمَ الأوّلِ. والفرقُ يُعادُ صريحاً لا مطويّاً: نداءٌ
   * ثانٍ يُبلَّغُ نجاحاً بلا تمييزٍ يُخفي أنَّ الختمَ المسجَّلَ أقدمُ مما يُظنُّ.
   */
  readonly status: "recorded" | "already_recorded";
  readonly acceptedAtMs: number;
}

export interface ConsentRecordWriter {
  record(command: RecordConsentCommand): Promise<Result<RecordConsentOutcome, ConsentStoreFailure>>;
}

export interface ConsentRecordReader {
  listForTelegramUser(
    telegramUserId: string,
  ): Promise<Result<readonly RecordedConsent[], ConsentStoreFailure>>;
}
