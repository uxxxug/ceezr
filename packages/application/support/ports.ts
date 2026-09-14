/**
 * الغرض: منافذُ دعمِ الراكبِ — عقدُ ما تحتاجُه حالتا الاستخدامِ من مخزنٍ،
 *   بلا ذكرِ SQL ولا HTTP (`F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: packages/application/support
 * يُستخدم من: `packages/application/support/rider-support.ts` ·
 *   `packages/infrastructure/support/rider-support-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — يُزادُ منفذٌ للسائقِ ولا يُبدَّلُ هذا.
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

import type {
  OpenedSupportTicket,
  RiderSupportCategory,
  RiderSupportPage,
  SupportTicketCursor,
} from "../../domain/support/rider-support.ts";
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

export interface RiderSupportStore {
  /** **يكتبُ**: تذكرةٌ وسجلُّ تدقيقٍ في معاملةِ القاعدةِ نفسِها. */
  openTicket(input: {
    readonly telegramUserId: string;
    readonly category: RiderSupportCategory;
    readonly message: string;
    readonly orderId: string | null;
  }): Promise<Result<OpenedSupportTicket, SupportStoreError>>;

  /** **يقرأُ ولا يكتبُ** — صفحةٌ بترقيمِ مفتاحٍ. */
  listTickets(input: {
    readonly telegramUserId: string;
    readonly limit: number;
    readonly cursor: SupportTicketCursor | null;
  }): Promise<Result<RiderSupportPage, SupportStoreError>>;
}
