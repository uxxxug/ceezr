/**
 * الغرض: شكلُ ردَّي فتحِ التذكرةِ وقراءةِ صفحتِها كما يقرأُهما العميلُ —
 *   **بلا دورٍ**: العقدُ واحدٌ للراكبِ والسائقِ (`F2-12` · `SR-11` · `F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`)، ومنقولٌ عن `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/support (نواةٌ مشتركةٌ لا حزمةُ دورٍ)
 * يُستخدم من: `ticket-api.ts` · `ticket-view.ts` · `TicketsScreen.tsx`
 *   وعبرَها سطحُ الراكبِ (`rider/support`) وسطحُ السائقِ (`driver/support`).
 *
 * ## لِمَ صارَ العقدُ ملفّاً مشتركاً ولا نُسِخَ لسطحِ السائقِ
 *
 * لأنَّ المسارَينِ يُخدَمانِ **بمُسَجِّلِ مسارٍ واحدٍ** يبني الردَّ بدالّةٍ واحدةٍ
 * (`apps/gateway/src/routes/support-tickets.ts`). ونسخةٌ ثانيةٌ من نوعِ الردِّ
 * تعني حقلاً يُزادُ في الخادمِ فيُقرأُ في سطحٍ ولا يُقرأُ في الآخرِ — والعطبُ
 * **صامتٌ**: `undefined` في موضعِ نصٍّ لا خطأَ بناءٍ.
 *
 * ## ولِمَ الصنفُ نصٌّ مفتوحٌ ههنا لا اتّحادُ أصنافٍ
 *
 * لأنَّ القراءةَ **أوسعُ من الكتابةِ**: حسابٌ ذو دورَينِ يقرأُ في صفحتِه تذكرةً
 * فتحَها بدورِه الآخرِ. واتّحادٌ ضيّقٌ في نوعِ الردِّ يجعلُ صنفاً صحيحاً من
 * القاعدةِ **خطأَ أنواعٍ** في العميلِ، فيُدفَعُ المُنفِّذُ إلى `as` — وذاكَ
 * كذبٌ في النوعِ أسوأُ من نصٍّ صادقٍ. والحكمُ على ما **يُختارُ** في نموذجِ
 * الفتحِ لا على ما **يُعرَضُ** في القائمةِ، وموضعُه `ticket-view.ts`.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا مُرفَقَ ولا صورةً**: رفعُ ملفٍّ دَينٌ مُعلَنٌ لا مُنفَّذٌ.
 *   ــ **لا محادثةَ داخلَ التذكرةِ**: الردُّ يجري في قروبِ المدينةِ اليومَ.
 *   ــ **لا اسمَ موظّفٍ ولا معرِّفَه**: ليسا في الردِّ أصلاً.
 *   ــ **لا هويّةَ طرفٍ آخرَ**: `orderId` يُعادُ ولا اسمَ ولا هاتفَ.
 */

export type ApiSupportStatus = "open" | "claimed" | "resolved" | "rejected";

export interface ApiSupportTicket {
  readonly id: string;
  readonly reference: string;
  /** صنفٌ من مجالِ القاعدةِ — **يُعرَضُ** ولو لم يكنْ مما يُختارُ في هذا الدورِ. */
  readonly category: string;
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
  readonly category: string;
}
