/**
 * الغرض: شكلُ ردَّي `POST /v1/support/tickets` و`GET /v1/support/tickets` كما
 *   يقرأُهما العميلُ — أنواعٌ لا منطقٌ (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `support-api.ts` · `support-view.ts` · `SupportScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` (شكوى السائقِ) — العقدُ عينُه بلا دورٍ.
 *
 * ## لماذا `reference` نصٌّ يُعرَضُ ولا يُبنى في العميلِ
 *
 * لأنَّ مَن يُنشئُ المرجعَ هوَ القاعدةُ (تسلسلٌ)، وبناءُ العميلِ لنصٍّ يُشبِهُه
 * يجعلُ على الشاشةِ رقماً لا وجودَ له في جدولٍ — **يُملى على موظّفٍ فلا يجدُه**.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا مُرفَقَ ولا صورةً**: رفعُ ملفٍّ دَينٌ مُعلَنٌ لا مُنفَّذٌ.
 *   ــ **لا محادثةَ داخلَ التذكرةِ**: الردُّ يجري في قروبِ المدينةِ اليومَ،
 *      وسطرُ «الحالةُ» هوَ ما يُقرأُ ههنا.
 *   ــ **لا اسمَ موظّفٍ ولا معرِّفَه**: ليسا في الردِّ أصلاً.
 */

/** أصنافُ الشكوى كما تُقبَلُ في الخادمِ — **نسخةُ عرضٍ لا مصدرُ حقيقةٍ**. */
export type ApiSupportCategory =
  | "ride_dispute"
  | "lost_item"
  | "driver_conduct"
  | "app_problem"
  | "other";

export type ApiSupportStatus = "open" | "claimed" | "resolved" | "rejected";

export interface ApiSupportTicket {
  readonly id: string;
  readonly reference: string;
  /** `subscription` تذكرةُ سائقٍ — تُقرأُ ولا تُفتَحُ من هذه الشاشةِ. */
  readonly category: ApiSupportCategory | "subscription";
  readonly status: ApiSupportStatus;
  readonly message: string;
  /** قرارُ الحلِّ — `null` غيابٌ لا نصٌّ فارغٌ. */
  readonly resolution: string | null;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface ApiSupportCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface SupportTicketsResponse {
  readonly ok: true;
  readonly tickets: readonly ApiSupportTicket[];
  readonly has_more: boolean;
  readonly next_cursor: ApiSupportCursor | null;
  /** `null` = لا وعدَ زمنٍ لهذه المدينةِ — والشاشةُ تسكتُ ولا تختلقُ رقماً. */
  readonly expected_response_minutes: number | null;
}

export interface OpenTicketResponse {
  readonly ok: true;
  readonly reference: string;
  readonly ticket_id: string;
  readonly category: ApiSupportCategory;
}
