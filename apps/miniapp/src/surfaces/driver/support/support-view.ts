/**
 * الغرض: نموذجُ عرضِ شاشةِ دعمِ السائقِ — **وصفُ دورِه** فوقَ النواةِ المشتركةِ
 *   (البند `F3-08` · `SD-10` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/support
 * يُستخدم من: `SupportScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 *
 * ## لِمَ أصنافُ الراكبِ **تُعرَضُ** في صفحةِ السائقِ ولا تُختارُ
 *
 * لأنَّ صفحةَ السائقِ تُفرَزُ بصفِّ سياقتِه، وحسابٌ ذو دورَينِ قد فتحَ بدورِ
 * رُكوبِه تذكرةَ «مفقوداتٍ» تحملُ **صفَّ سياقتِه أيضاً** (الصفُّ واحدٌ يحملُ
 * الهويّتَينِ). فمَن رآها في قائمتِه بصنفٍ بلا نصٍّ **ظنَّ العطبَ** — والعِلّةُ
 * نفسُها المكتوبةُ في `packages/domain/support/ticket-types.ts`: **مجالُ
 * القراءةِ أوسعُ من مجالِ الكتابةِ**، وهذا وجهُه في الشاشةِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُعرِّفُ رمزَ عطبٍ خاصّاً بالسائقِ**: `NOT_A_DRIVER` من القاعدةِ
 *      يُترجِمُه التطبيقُ إلى `NOT_REGISTERED` — رمزٌ واحدٌ للدورَينِ، فالشاشةُ
 *      لا تعرفُ رمزاً لا تعرفُه شاشةُ الراكبِ.
 *   ــ **لا يُنسِّقُ وقتاً**، **ولا يبني صنفَ نمطٍ**: مُفصَّلةٌ في رأسِ
 *      `../../support/ticket-view.ts`.
 */

import {
  DRIVER_SUPPORT_CATEGORIES,
  type DriverSupportCategory,
  driverCategoryRequiresOrder,
} from "../../../../../../packages/domain/support/driver-support.ts";
import {
  DEFAULT_SUPPORT_PAGE_SIZE,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
} from "../../../../../../packages/domain/support/rider-support.ts";
import {
  isRetryableSupportError,
  type SupportStatusTone,
  type SupportSurfaceSpec,
  type SupportTicketRow,
  statusTone,
  supportViewModel,
} from "../../support/ticket-view.ts";

export type { DriverSupportCategory, SupportStatusTone, SupportTicketRow };
/** بابٌ واحدٌ إلى النطاقِ كي لا تستوردَه الشاشةُ مرّتَينِ (القاعدة 0.6). */
export {
  DEFAULT_SUPPORT_PAGE_SIZE,
  DRIVER_SUPPORT_CATEGORIES,
  driverCategoryRequiresOrder,
  isRetryableSupportError,
  MAX_SUPPORT_MESSAGE_CHARS,
  statusTone,
};

/** أصنافُ الراكبِ التي لا يفتحُها السائقُ **ويقرؤها** — انظرْ رأسَ المِلفِّ. */
const DRIVER_READ_ONLY_CATEGORIES: readonly string[] = RIDER_SUPPORT_CATEGORIES.filter(
  (category) => !(DRIVER_SUPPORT_CATEGORIES as readonly string[]).includes(category),
);

export const DRIVER_SUPPORT_SPEC: SupportSurfaceSpec = {
  keyPrefix: "driver.support.",
  selectableCategories: DRIVER_SUPPORT_CATEGORIES,
  readOnlyCategories: DRIVER_READ_ONLY_CATEGORIES,
  requiresOrder: (category) => driverCategoryRequiresOrder(category as DriverSupportCategory),
  maxMessageChars: MAX_SUPPORT_MESSAGE_CHARS,
};

const view = supportViewModel(DRIVER_SUPPORT_SPEC);

export const supportErrorKey = view.errorKey;
export const categoryKey = view.categoryKey;
export const statusKey = view.statusKey;
export const toTicketRow = view.toTicketRow;
export const remainingChars = view.remainingChars;

/** بتوقيعٍ مُقيَّدٍ بأصنافِ السائقِ — لا `string` مفتوحاً. */
export function canSubmit(input: {
  readonly category: DriverSupportCategory | null;
  readonly message: string;
  readonly orderId: string | null;
  readonly busy: boolean;
}): boolean {
  return view.canSubmit(input);
}

export { view as DRIVER_SUPPORT_VIEW };
