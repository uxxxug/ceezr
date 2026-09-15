/**
 * الغرض: منفذُ اشتراكِ السائقِ — عقدُ **قراءةٍ محضةٍ** لا كتابةَ فيه
 *   ألبتّةَ (`F3-06` · `SD-07`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-06`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-subscription.ts` ·
 *   `packages/infrastructure/driver/driver-subscription-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F3-09` — تجديدُ الاشتراكِ منفذٌ يُضافُ بجانبِه، ولا
 *   يُوسَّعُ هذا العقدُ ليبدأَ الدفعَ.
 * الحاكم: docs/adr/0094-project-independence.md
 *
 * ## لِمَ منفذٌ منفصلٌ عن `SubscriptionReader`
 *
 * لأنَّ `SubscriptionReader` يقرأُ كيانَ الاشتراكِ الساري للإسنادِ (`findLive`)،
 * وهذا **يقرأُ لوحاً للعرضِ**: أسعارٌ وتجربةٌ وتحذيرٌ وتاريخُ دفعٍ. وحقُّ العقدِ
 * مختلفٌ: ذاك يُسألُ «هل يصلح؟» وهذا يُسألُ «ما حالُه؟». وأوسعُ سلطةٍ في عقدٍ
 * تُقرأُ سلطةَ كلِّ مُستعمِلِه.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ كتابةً**: لا تفعيلَ ولا إلغاءَ ولا تجديدَ — قراءةٌ محضةٌ.
 *   ــ **لا يقولُ مزوّدَ دفعٍ**: المزوّدُ تهيئةٌ لا عقدُ قراءةٍ.
 *   ــ **لا يقولُ سائقاً آخرَ**: الهويّةُ من الرمزِ الموقَّعِ وحدَه.
 */

import type {
  DriverSubscriptionDashboard,
  DriverSubscriptionHistory,
} from "../../domain/driver/driver-subscription.ts";
import type { Result } from "../../shared/result/index.ts";

/** رفضٌ مُصنَّفٌ من القاعدةِ — مجالٌ مغلقٌ يقابل رموزَ الدوالّ. */
export type DriverSubscriptionStoreRejection = "USER_NOT_FOUND" | "NOT_A_DRIVER";

export interface DriverSubscriptionStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export interface DriverSubscriptionRejectionDetail {
  readonly rejection: DriverSubscriptionStoreRejection;
}

export type DriverSubscriptionStoreError =
  | DriverSubscriptionStoreFailure
  | DriverSubscriptionRejectionDetail;

export function isDriverSubscriptionRejection(
  error: DriverSubscriptionStoreError,
): error is DriverSubscriptionRejectionDetail {
  return "rejection" in error;
}

export interface DriverSubscriptionStore {
  /** **يقرأُ ولا يكتبُ**: لوحُ الاشتراكِ بأسعارِه وتجربتِه وتحذيرِه. */
  readDashboard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverSubscriptionDashboard, DriverSubscriptionStoreError>>;

  /** **يقرأُ ولا يكتبُ**: تاريخُ دفعاتِ الاشتراكِ بسقفٍ خادميٍّ. */
  readHistory(input: {
    readonly telegramUserId: string;
    readonly limit: number;
  }): Promise<Result<DriverSubscriptionHistory, DriverSubscriptionStoreError>>;
}
