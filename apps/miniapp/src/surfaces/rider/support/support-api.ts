/**
 * الغرض: نداءا الدعمِ — فتحُ تذكرةٍ وقراءةُ صفحةِ تذاكرَ، سطرانِ فوقَ حدِّ API
 *   ولا منطقَ عرضٍ (البند `F2-12`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/support
 * يُستخدم من: `SupportScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` — النداءانِ عينُهما بأصنافِ السائقِ.
 *
 * ## لماذا المؤشِّرُ قيمتانِ في الاستعلامِ لا نصٌّ مُعمّىً
 *
 * كما في سجلِّ الرحلاتِ (`F2-08`): مرئيٌّ في أثرِ الطلبِ، ومقروءٌ في سجلٍّ،
 * ولا يُحشى فيه ما لا يُفحَصُ. **ونصفُه يُرسَلُ كما هوَ** فيردَّ الخادمُ
 * `CURSOR_INVALID` — حكمُ المؤشِّرِ في موضعٍ واحدٍ.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API، والشاشةُ تُصنِّفُ.
 *   ــ **لا يُهذِّبُ نصَّ الشكوى**: القصُّ حكمُ الخادمِ (والمجالُ يقيسُ محارفَ).
 *   ــ **لا يُعيدُ المحاولةَ**: فتحُ تذكرةٍ **كتابةٌ**، وإعادةٌ تلقائيّةٌ فوقَ
 *      تهدئةٍ تُنتِجُ رفضاً يُقرأُ عطلاً.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiSupportCategory,
  ApiSupportCursor,
  OpenTicketResponse,
  SupportTicketsResponse,
} from "./support-contract.ts";

export type * from "./support-contract.ts";

export function openSupportTicket(input: {
  readonly category: ApiSupportCategory;
  readonly message: string;
  readonly orderId: string | null;
}): Promise<OpenTicketResponse> {
  return apiFetch<OpenTicketResponse>("/v1/support/tickets", {
    method: "POST",
    body: {
      category: input.category,
      message: input.message,
      // `null` **يُرسَلُ صريحاً** ولا يُحذَفُ الحقلُ: غيابُ الرحلةِ قرارٌ
      // مقروءٌ في أثرِ الطلبِ لا حقلٌ نُسيَ.
      order_id: input.orderId,
    },
  });
}

export function readSupportTickets(input: {
  readonly limit: number;
  readonly cursor: ApiSupportCursor | null;
}): Promise<SupportTicketsResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  if (input.cursor !== null) {
    params.set("before_created_at", input.cursor.createdAt);
    params.set("before_id", input.cursor.id);
  }
  return apiFetch<SupportTicketsResponse>(`/v1/support/tickets?${params.toString()}`, {
    method: "GET",
  });
}
