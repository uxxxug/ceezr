/**
 * الغرض: نموذجُ عرضِ شاشةِ دعمِ الراكبِ — **وصفُ دورِه** فوقَ النواةِ المشتركةِ،
 *   وأبوابٌ بأسمائِها القديمةِ حرفاً (البند `F2-12` · `SR-11` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`، **وصارَ باباً بـ`F3-08`** (`S-5`).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `SupportScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 *
 * ## لِمَ الأسماءُ المُصدَّرةُ لم تُغيَّرْ ولو صارَ الجسدُ مشتركاً
 *
 * حكمُ `ح-8`: **الإصلاحُ زيادةٌ لا نقصٌ**. فما استوردَ `supportErrorKey` أو
 * `canSubmit` يستوردُهما كما كانَ، والمُقاسُ في `rider-support-view.test.ts`
 * يمرُّ بالأبوابِ نفسِها فيكونُ **القياسُ حكماً على النواةِ الجديدةِ لا على
 * نسخةٍ ميّتةٍ**.
 *
 * ## ولماذا `subscription` صنفٌ **يُقرأُ ولا يُختارُ**
 *
 * تذكرةُ اشتراكٍ يفتحُها السائقُ. وراكبٌ يرى في «تذاكري» تذكرةً بصنفٍ لا يجدُه
 * في قائمةِ الاختيارِ **يظنُّ العطبَ**؛ فلها مفتاحُ نصٍّ يُعرَضُ، وليسَ لها
 * مدخلٌ في نموذجِ الفتحِ. **وبعدَ `F3-08` صارَت أصنافُ السائقِ كذلكَ**: حسابٌ
 * ذو دورَينِ يرى في صفحةِ راكبِه تذكرةَ خصمٍ فتحَها بدورِ سياقتِه — ولها نصٌّ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُنسِّقُ وقتاً بلغةٍ**، **ولا يُصنِّفُ أولويّةً**، **ولا يبني صنفَ
 *      نمطٍ**: مُفصَّلةٌ في رأسِ `../../support/ticket-view.ts`.
 */

// `D-33` · `ADR 0188`: نصوصُ جزءِ `support` تُسجَّلُ معَ حزمتِه لا في `shell`.
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/support.ts";
import { DRIVER_SUPPORT_CATEGORIES } from "../../../../../../packages/domain/support/driver-support.ts";
import {
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
  type RiderSupportCategory,
} from "../../../../../../packages/domain/support/rider-support.ts";
import {
  isRetryableSupportError,
  type SupportStatusTone,
  type SupportSurfaceSpec,
  type SupportTicketRow,
  statusTone,
  supportViewModel,
} from "../../support/ticket-view.ts";

export type { RiderSupportCategory, SupportStatusTone, SupportTicketRow };
/**
 * تُعادُ من بابٍ واحدٍ كي لا تستوردَ الشاشةُ `packages/domain` مباشرةً — سابقةُ
 * `ride-history-view.ts`: بابانِ للشيءِ نفسِه يفترقانِ (القاعدة 0.6).
 */
export {
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  isRetryableSupportError,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
  statusTone,
};

/**
 * أصنافٌ تُعرَضُ في صفحةِ الراكبِ ولا تُختارُ في نموذجِه: أصنافُ السائقِ كلُّها
 * — **وعِلّتُها حسابٌ ذو دورَينِ** لا احتياطٌ نظريٌّ (انظرْ رأسَ المِلفِّ).
 */
const RIDER_READ_ONLY_CATEGORIES: readonly string[] = DRIVER_SUPPORT_CATEGORIES.filter(
  (category) => !(RIDER_SUPPORT_CATEGORIES as readonly string[]).includes(category),
);

export const RIDER_SUPPORT_SPEC: SupportSurfaceSpec = {
  keyPrefix: "rider.support.",
  selectableCategories: RIDER_SUPPORT_CATEGORIES,
  readOnlyCategories: RIDER_READ_ONLY_CATEGORIES,
  requiresOrder: (category) => categoryRequiresOrder(category as RiderSupportCategory),
  maxMessageChars: MAX_SUPPORT_MESSAGE_CHARS,
};

const view = supportViewModel(RIDER_SUPPORT_SPEC);

export const supportErrorKey = view.errorKey;
export const categoryKey = view.categoryKey;
export const statusKey = view.statusKey;
export const toTicketRow = view.toTicketRow;
export const remainingChars = view.remainingChars;

/** بتوقيعٍ مُقيَّدٍ بأصنافِ الراكبِ كما كانَ — لا `string` مفتوحاً. */
export function canSubmit(input: {
  readonly category: RiderSupportCategory | null;
  readonly message: string;
  readonly orderId: string | null;
  readonly busy: boolean;
}): boolean {
  return view.canSubmit(input);
}

export { view as RIDER_SUPPORT_VIEW };
