/**
 * الغرض: نداءا الدعمِ — فتحُ تذكرةٍ وقراءةُ صفحةِ تذاكرَ، **مُعامَلانِ بالمسارِ**
 *   فيصلحانِ للراكبِ والسائقِ بلا نسخةٍ ثانيةٍ (`F2-12` · `F3-08` · `SD-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08` (الزيادةُ `S-5`)، ومنقولٌ عن `F2-12`.
 * ينتمي إلى: apps/miniapp/src/surfaces/support
 * يُستخدم من: `rider/support/support-api.ts` · `driver/support/support-api.ts`
 *
 * ## لِمَ المسارُ مُعامَلٌ ولا يُبنى من اسمِ دورٍ
 *
 * لأنَّ مسارَ الراكبِ `‎/v1/support/tickets` ومسارَ السائقِ
 * `‎/v1/driver/support/tickets` — **وليسَ الثاني الأوّلَ بحرفٍ مُزادٍ**. وبناءٌ
 * بقالبٍ من اسمِ دورٍ يجعلُ خطأً في حرفٍ **٤٠٤ في زمنِ التشغيلِ** لا خطأَ بناءٍ،
 * فالمسارُ نصٌّ مكتوبٌ في سطحِ الدورِ حيثُ يُقرأُ مع بقيّةِ عقدِه.
 *
 * ## وما لا يفعلُه عن قصدٍ
 *
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API، والشاشةُ تُصنِّفُ.
 *   ــ **لا يُهذِّبُ نصَّ الشكوى**: القصُّ حكمُ الخادمِ (والمجالُ يقيسُ محارفَ).
 *   ــ **لا يُعيدُ المحاولةَ**: فتحُ تذكرةٍ **كتابةٌ**، وإعادةٌ تلقائيّةٌ فوقَ
 *      تهدئةٍ تُنتِجُ رفضاً يُقرأُ عطلاً.
 */

import { apiFetch } from "../../api/client.ts";
import type {
  ApiSupportCursor,
  OpenTicketResponse,
  SupportTicketsResponse,
} from "./ticket-contract.ts";

export interface OpenTicketInput {
  readonly category: string;
  readonly message: string;
  readonly orderId: string | null;
}

export interface ReadTicketsInput {
  readonly limit: number;
  readonly cursor: ApiSupportCursor | null;
}

export interface SupportTicketsApi {
  readonly openTicket: (input: OpenTicketInput) => Promise<OpenTicketResponse>;
  readonly readTickets: (input: ReadTicketsInput) => Promise<SupportTicketsResponse>;
}

/** يُبنى مرّةً في سطحِ الدورِ بمسارِه — ولا يُنادى بمسارٍ يُحسَبُ في زمنِ العرضِ. */
export function supportTicketsApi(basePath: string): SupportTicketsApi {
  return {
    openTicket: (input) =>
      apiFetch<OpenTicketResponse>(basePath, {
        method: "POST",
        body: {
          category: input.category,
          message: input.message,
          // `null` **يُرسَلُ صريحاً** ولا يُحذَفُ الحقلُ: غيابُ الرحلةِ قرارٌ
          // مقروءٌ في أثرِ الطلبِ لا حقلٌ نُسيَ.
          order_id: input.orderId,
        },
      }),
    readTickets: (input) => {
      const params = new URLSearchParams();
      params.set("limit", String(input.limit));
      if (input.cursor !== null) {
        params.set("before_created_at", input.cursor.createdAt);
        params.set("before_id", input.cursor.id);
      }
      return apiFetch<SupportTicketsResponse>(`${basePath}?${params.toString()}`, {
        method: "GET",
      });
    },
  };
}
