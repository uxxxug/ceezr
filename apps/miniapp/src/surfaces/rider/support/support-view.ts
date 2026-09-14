/**
 * الغرض: نموذجُ عرضِ شاشةِ الدعمِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ والرمزَ إلى
 *   مفاتيحِ نصٍّ، بلا JSX وبلا شبكةٍ (البند `F2-12` · `SR-11` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `SupportScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — المفاتيحُ مُعامَلةٌ لا مكتوبةٌ.
 *
 * ## لماذا رمزٌ مجهولٌ يُقرأُ مفتاحاً عامّاً لا رمزاً خاماً
 *
 * سابقةُ `account-view.ts` و`sos-view.ts` حرفاً: شاشةٌ تعرضُ
 * `CITY_GROUP_MISSING` خاماً على إنسانٍ يشكو **تزيدُه شكوى**. والمجالُ مغلقٌ
 * ههنا، وما خرجَ عنه يُقرأُ «تعثَّرَ الإرسالُ» ويُسجَّلُ رمزُه للمُشغِّلِ.
 *
 * ## ولماذا `subscription` صنفٌ **يُقرأُ ولا يُختارُ**
 *
 * تذكرةُ اشتراكٍ يفتحُها السائقُ من بوتِه. وراكبٌ يرى في «تذاكري» تذكرةً
 * قديمةً بصنفٍ لا يجدُه في قائمةِ الاختيارِ **يظنُّ العطبَ**؛ فلها مفتاحُ نصٍّ
 * يُعرَضُ، وليسَ لها مدخلٌ في نموذجِ الفتحِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُنسِّقُ وقتاً بلغةٍ**: التنسيقُ في الشاشةِ بأداةِ المنصّةِ، وههنا
 *      مفاتيحُ وأعدادٌ فحسب.
 *   ــ **لا يُصنِّفُ «مُهِمٌّ» ولا يُرتِّبُ أولويّةً**: الترتيبُ زمنيٌّ من
 *      القاعدةِ، وأولويّةُ الدعمِ حكمُ `ticket-advisor` في الخادمِ.
 */

import {
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
  type RiderSupportCategory,
} from "../../../../../../packages/domain/support/rider-support.ts";
import type { ApiSupportStatus, ApiSupportTicket } from "./support-contract.ts";

export type { RiderSupportCategory };
/**
 * تُعادُ من بابٍ واحدٍ كي لا تستوردَ الشاشةُ `packages/domain` مباشرةً — سابقةُ
 * `ride-history-view.ts`: بابانِ للشيءِ نفسِه يفترقانِ (القاعدة 0.6).
 */
export {
  categoryRequiresOrder,
  DEFAULT_SUPPORT_PAGE_SIZE,
  MAX_SUPPORT_MESSAGE_CHARS,
  RIDER_SUPPORT_CATEGORIES,
};

/** رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — مُقابِلةٌ لخريطةِ حالاتِ المسارِ. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "SUPPORT_STORE_NOT_AVAILABLE",
  "CATEGORY_UNKNOWN",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "ORDER_REQUIRED",
  "ORDER_INVALID",
  "ORDER_NOT_YOURS",
  "COOLDOWN_ACTIVE",
  "ACCOUNT_BLOCKED",
  "NOT_REGISTERED",
  "CITY_NOT_READY",
  "LIMIT_OUT_OF_RANGE",
  "CURSOR_INVALID",
]);

export function supportErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? `rider.support.error.${code}` : "rider.support.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. والتهدئةُ ليست منها: إعادةٌ
 * فوريّةٌ تُردُّ رفضاً ثانياً فيُقرأُ عطلاً — والشاشةُ تقولُ الثانيةَ وتنتظرُ.
 */
export function isRetryableSupportError(code: string): boolean {
  return code === "SUPPORT_STORE_NOT_AVAILABLE" || code === "UNKNOWN" || code === "CITY_NOT_READY";
}

export function categoryKey(category: string): string {
  return category === "subscription" ||
    (RIDER_SUPPORT_CATEGORIES as readonly string[]).includes(category)
    ? `rider.support.category.${category}`
    : "rider.support.category.unknown";
}

export function statusKey(status: ApiSupportStatus | string): string {
  const known = ["open", "claimed", "resolved", "rejected"];
  return known.includes(status) ? `rider.support.status.${status}` : "rider.support.status.unknown";
}

/**
 * نغمةُ شارةِ الحالةِ — **رمزٌ مجرَّدٌ لا صنفُ نمطٍ**: بناءُ اسمِ صنفٍ ههنا
 * يُخرِجُه من قياسِ حاجزِ الأنماطِ (`ADR 0105`)، والشاشةُ وحدَها تملِكُ الجدولَ
 * الحرفيَّ الذي يُقابِلُ الرمزَ بصنفٍ مكتوبٍ.
 */
export type SupportStatusTone = "open" | "working" | "done" | "refused";

export function statusTone(status: string): SupportStatusTone {
  if (status === "claimed") return "working";
  if (status === "resolved") return "done";
  if (status === "rejected") return "refused";
  return "open";
}

/** صفٌّ كما تعرضُه الشاشةُ — مفاتيحُ لا نصوصٌ. */
export interface SupportTicketRow {
  readonly id: string;
  readonly reference: string;
  readonly categoryKey: string;
  readonly statusKey: string;
  readonly statusTone: ReturnType<typeof statusTone>;
  readonly message: string;
  readonly resolution: string | null;
  readonly createdAt: string;
  /** هل لها رحلةٌ؟ — الشاشةُ تُظهِرُ سطراً لا معرّفاً خاماً بطولِ ٣٦ محرفاً. */
  readonly hasOrder: boolean;
}

export function toTicketRow(ticket: ApiSupportTicket): SupportTicketRow {
  return {
    id: ticket.id,
    reference: ticket.reference,
    categoryKey: categoryKey(ticket.category),
    statusKey: statusKey(ticket.status),
    statusTone: statusTone(ticket.status),
    message: ticket.message,
    resolution: ticket.resolution,
    createdAt: ticket.createdAt,
    hasOrder: ticket.orderId !== null,
  };
}

/**
 * هل النموذجُ صالحٌ للإرسالِ؟ — **فحصٌ للزرِّ لا بديلٌ عن الخادمِ**: يمنعُ
 * ذَهاباً يُردُّ يقيناً، ولا يُغنِي عن حكمِ الخادمِ لأنَّ الزرَّ يُتجاوَزُ.
 */
export function canSubmit(input: {
  readonly category: RiderSupportCategory | null;
  readonly message: string;
  readonly orderId: string | null;
  readonly busy: boolean;
}): boolean {
  if (input.busy) return false;
  if (input.category === null) return false;
  const trimmed = input.message.trim();
  if (trimmed.length === 0) return false;
  if ([...trimmed].length > MAX_SUPPORT_MESSAGE_CHARS) return false;
  if (input.orderId === null && categoryRequiresOrder(input.category)) return false;
  return true;
}

/** المتبقّي من الحدِّ — يُعرَضُ عدّاً، وسالبُه صفرٌ لا رقمٌ سالبٌ على شاشةٍ. */
export function remainingChars(message: string): number {
  return Math.max(0, MAX_SUPPORT_MESSAGE_CHARS - [...message].length);
}
