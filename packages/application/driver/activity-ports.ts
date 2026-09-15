/**
 * الغرض: منفذُ حصيلةِ السائقِ وأدائِه — عقدُ **قراءةٍ محضةٍ** لا كتابةَ فيه
 *   ألبتّةَ (`F3-05` · `SD-06` · `SD-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-05`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-activity.ts` ·
 *   `packages/infrastructure/driver/driver-activity-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-07` (الاشتراكُ) منفذٌ يُضافُ بجانبِه، ولا
 *   يُوسَّعُ هذا العقدُ ليقرأَ فاتورةً.
 * الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
 *
 * ## لِمَ **منفذٌ منفصلٌ** عن `DriverJobStore`
 *
 * لأنَّ الحقَّ مختلفٌ والسلطةُ مختلفةٌ: `DriverJobStore` **يكتبُ** أطواراً
 * (وصولٌ وبدءٌ وإنهاءٌ)، وهذا **يقرأُ تاريخاً**. ولو أُضيفَت طريقتانِ إلى عقدِ
 * المَهمّةِ لَحملَ كلُّ مُركِّبٍ يقرأُ تقريراً **سلطةَ ختمِ الأطوارِ** — وأوسعُ
 * سلطةٍ في العقدِ تُقرأُ سلطةَ كلِّ مُستعمِلِه.
 *
 * ## ولِمَ طريقتانِ لا طريقةٌ تُعيدُ الملخَّصَ والجدولَ معاً
 *
 * لأنَّ الشاشةَ تفتحُ على الملخَّصِ، والجدولُ **يُطلَبُ بطلبٍ ثانٍ** عندَ
 * التوسيعِ. وجمعُهما يجعلُ كلَّ فتحةِ شاشةٍ تقرأُ خمسينَ صفّاً لا يراها أحدٌ،
 * ويجعلُ سقفَ الصفحةِ حقلاً في طلبِ الملخَّصِ بلا معنًى.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ كتابةً**: لا طريقةَ تكتبُ ولا تُصحِّحُ رقماً — التقريرُ مرآةٌ.
 *   ــ **لا يقولُ مالاً**: لا مبلغَ في أيِّ طريقةٍ (`ADR 0039` §٤ · `DEC-11`).
 *   ــ **لا يقولُ نافذةً من العميلِ**: المُدّةُ اسمٌ (`day`/`week`/`month`) لا
 *      تاريخانِ يُرسَلانِ — ولو أُرسِلا لَصارَ للنافذةِ حاسبانِ.
 *   ــ **لا يقولُ سائقاً آخرَ**: لا مُعامَلَ `driverId` — الهويّةُ من الرمزِ
 *      الموقَّعِ وحدَه، فلا يُقرأُ تقريرُ غيرِه بتغييرِ رقمٍ في طلبٍ.
 */

import type {
  ActivityPeriod,
  DriverActivityLog,
  DriverActivitySummary,
} from "../../domain/driver/activity.ts";
import type { Result } from "../../shared/result/index.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ. و`WINDOW_UNRESOLVED` رفضٌ لا عطبٌ: مُدّةٌ لا
 * تُعرَفُ أو منطقةُ زمنِ مدينةٍ غيرُ مبذورةٍ — ويُقالُ صريحاً ولا يُستبدَلُ
 * بنافذةٍ مُخترَعةٍ.
 */
export type DriverActivityStoreRejection = "USER_NOT_FOUND" | "NOT_A_DRIVER" | "WINDOW_UNRESOLVED";

export interface DriverActivityStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export interface DriverActivityRejectionDetail {
  readonly rejection: DriverActivityStoreRejection;
}

export type DriverActivityStoreError = DriverActivityStoreFailure | DriverActivityRejectionDetail;

export function isDriverActivityRejection(
  error: DriverActivityStoreError,
): error is DriverActivityRejectionDetail {
  return "rejection" in error;
}

export interface DriverActivityStore {
  /** **يقرأُ ولا يكتبُ**: ملخَّصُ المُدّةِ بأرقامِه ومقاماتِه وعواملِ ترتيبِه. */
  readSummary(input: {
    readonly telegramUserId: string;
    readonly period: ActivityPeriod;
  }): Promise<Result<DriverActivitySummary, DriverActivityStoreError>>;

  /** **يقرأُ ولا يكتبُ**: جدولُ الرحلاتِ المُكتمِلةِ في النافذةِ بسقفٍ خادميٍّ. */
  readEntries(input: {
    readonly telegramUserId: string;
    readonly period: ActivityPeriod;
    readonly limit: number;
  }): Promise<Result<DriverActivityLog, DriverActivityStoreError>>;
}
