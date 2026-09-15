/**
 * الغرض: منافذُ دعمِ الراكبِ — عقدُ ما تحتاجُه حالتا الاستخدامِ من مخزنٍ،
 *   بلا ذكرِ SQL ولا HTTP (`F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `packages/application/support/rider-support.ts` ·
 *   `packages/infrastructure/support/rider-support-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: دورٌ ثالثٌ يفتحُ تذكرةً — يُسمّى منفذُه من
 *   `SupportTicketStore` ولا يُنسَخُ عقدٌ ثالثٌ.
 *
 * ## ما زِيدَ في `F3-08` — منفذُ السائقِ **اسمٌ على عقدٍ واحدٍ**
 *
 * `SupportTicketStore<C>` هوَ العقدُ، والدورُ **مُعامَلُ صنفٍ** فيه؛ ومنفذُ كلِّ
 * دورٍ اسمٌ له. ولو كُتِبَ للسائقِ عقدٌ ثانٍ مُطابِقٌ لَافترقَ توقيعُ `listTickets`
 * بينَ دورَينِ عندَ أوّلِ زيادةٍ. **و`RiderSupportStore` لم يُمَسَّ معناه**: هوَ
 * اليومَ اسمٌ لِما كانَ يُكتَبُ بيدِه حرفاً (`ح-8`).
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا رفضُ القاعدةِ **مجالٌ مغلقٌ** ههنا لا نصٌّ يمرُّ
 *
 * دالّةُ الفتحِ تُعيدُ سبعةَ رموزِ رفضٍ مُصنَّفةٍ (تهدئةٌ · حظرٌ · طلبٌ ليسَ
 * لكَ …)، وكلٌّ منها **حالةُ HTTP مختلفةٌ ونصُّ شاشةٍ مختلفٌ**. ونصٌّ يمرُّ بلا
 * مقابلةٍ يجعلُ رمزاً جديداً في القاعدةِ يظهرُ على الشاشةِ خاماً بالإنجليزيّةِ.
 * فالمجالُ مغلقٌ، ورمزٌ خارجَه `MALFORMED_RESULT` — **عطبٌ يُقرأُ في السجلِّ لا
 * جوابٌ يُعرَضُ للإنسانِ**.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ `Sql`**: المحوّلُ وحدَه يعرفُها.
 *   ــ **لا يقرأُ جلسةً**: `MiniAppSessionReader` منفذٌ قائمٌ لا يُنسَخُ.
 */

import type { DriverSupportCategory } from "../../domain/support/driver-support.ts";
import type { RiderSupportCategory } from "../../domain/support/rider-support.ts";
import type {
  OpenedSupportTicketOf,
  SupportTicketCursor,
  SupportTicketsPage,
  SupportTicketType,
} from "../../domain/support/ticket-types.ts";
import type { Result } from "../../shared/result/index.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ — مجالٌ مغلقٌ يُقابِلُ رموزَ
 * `open_support_ticket` و`rider_support_tickets` حرفاً.
 */
export type SupportStoreRejection =
  | "MESSAGE_EMPTY"
  | "USER_NOT_FOUND"
  | "USER_BLOCKED"
  | "NOT_REGISTERED"
  | "NOT_A_DRIVER"
  | "NOT_A_RIDER"
  | "CITY_GROUP_MISSING"
  | "COOLDOWN_ACTIVE"
  | "ORDER_NOT_YOURS"
  | "LIMIT_OUT_OF_RANGE"
  | "CURSOR_INCOMPLETE";

/** عطبُ مخزنٍ أو حمولةٌ لا تُفهَمُ — يُنشَرُ `503`، ولا يُخلَطُ برفضٍ مُصنَّفٍ. */
export interface SupportStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

/** رفضٌ يحملُ ثانيةً يُنتظَرُها — التهدئةُ وحدَها. */
export interface SupportRejectionDetail {
  readonly rejection: SupportStoreRejection;
  readonly retryAfterSeconds: number | null;
}

export type SupportStoreError = SupportStoreFailure | SupportRejectionDetail;

export function isSupportRejection(error: SupportStoreError): error is SupportRejectionDetail {
  return "rejection" in error;
}

/**
 * عقدُ مخزنِ تذاكرَ لدورٍ واحدٍ — **الكتابةُ بمجالِ الدورِ** (`C`)
 * **والقراءةُ بمجالِ النوعِ كلِّه** (`SupportTicketsPage`)، بالعِلّةِ المكتوبةِ
 * في `packages/domain/support/ticket-types.ts`.
 */
export interface SupportTicketStore<C extends SupportTicketType> {
  /** **يكتبُ**: تذكرةٌ وسجلُّ تدقيقٍ في معاملةِ القاعدةِ نفسِها. */
  openTicket(input: {
    readonly telegramUserId: string;
    readonly category: C;
    readonly message: string;
    readonly orderId: string | null;
  }): Promise<Result<OpenedSupportTicketOf<C>, SupportStoreError>>;

  /** **يقرأُ ولا يكتبُ** — صفحةٌ بترقيمِ مفتاحٍ. */
  listTickets(input: {
    readonly telegramUserId: string;
    readonly limit: number;
    readonly cursor: SupportTicketCursor | null;
  }): Promise<Result<SupportTicketsPage, SupportStoreError>>;
}

export type RiderSupportStore = SupportTicketStore<RiderSupportCategory>;

/**
 * منفذُ السائقِ — يُنفَّذُ بدالّتَي القاعدةِ `open_support_ticket` (بأصنافِ
 * السائقِ) و`driver_support_tickets`. ورفضُ `NOT_A_DRIVER` **كانَ في المجالِ
 * أصلاً** فلم يُزَدْ رمزٌ.
 */
export type DriverSupportStore = SupportTicketStore<DriverSupportCategory>;
