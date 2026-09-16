/**
 * الغرض: نداءاتُ حالِ الدفعةِ والفاتورةِ — **قراءتانِ وكاتبٌ واحدٌ لا يُعادُ
 *   تلقائيّاً** (البند `F3-09` · `SD-08`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-09`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/subscription
 * يُستخدم من: `PaymentInvoicePanel.tsx`
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ محفظةٍ ماليّةٍ إن طُلِبَت فاتورةُ عمولةٍ —
 *   ونداءُ ذاكَ يُكتَبُ في ملفِّه لا يُوسَّعُ هذا.
 * يحرسُه: scripts/check-tax-invoice-contract.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * ## لِمَ **لا حلقةَ استقصاءٍ تلقائيّةً** لحالِ الدفعةِ
 *
 * لأنَّ الحالَ يتغيَّرُ بويبهوكِ المزوِّدِ لا بسؤالِنا، وحلقةٌ كلَّ ثانيتَينِ
 * تُثقِلُ الخادمَ وتُوحي بأنَّ التطبيقَ يُفعِّلُ الاشتراكَ — **وهوَ لا يفعلُ**.
 * فزرٌّ يفهمُه الإنسانُ («تحقَّقْ من حالِ دفعتي») أصدقُ من دُوّارٍ لا ينتهي.
 *
 * ## ولِمَ الإصدارُ **لا يُعادُ تلقائيّاً** عندَ انقطاعِ شبكةٍ
 *
 * لأنَّه كاتبٌ: نداءٌ نجحَ ولم يصلْ جوابُه لا يُعرَفُ من نداءٍ لم يبلغْ. والقاعدةُ
 * تحميه بمفتاحٍ فريدٍ على `payment_transaction_id` فلا فاتورةَ ثانيةً، **ولكنَّ
 * أمانَ القاعدةِ لا يُبرِّرُ إعادةً صامتةً** يظنُّ السائقُ بها أنَّه أصدرَ مرّتَينِ.
 * والإعادةُ بيدِه، وجوابُ الثانيةِ يقولُ `already_issued` صراحةً.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِلُ معرِّفَ سائقٍ**: الهويّةُ في الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُصدِرُ عندَ القراءةِ**: `GET` لا يكتبُ، وغيابُ الفاتورةِ يُقالُ لا يُصلَحُ ضمناً.
 *   ــ **لا تُخزِّنُ فاتورةً محلّيّاً**: وثيقةٌ مخزَّنةٌ في جهازٍ تُقرأُ قديمةً بلا علمٍ.
 *   ــ **لا تُرمِّزُ ولا تُفكِّكُ حِمْلَ رمزِ الاستجابةِ**: يُنقَلُ كما وصلَ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  ApiDriverInvoiceIssueResponse,
  ApiDriverInvoiceReadResponse,
  ApiDriverPaymentStatusResponse,
} from "./invoice-contract.ts";

export type * from "./invoice-contract.ts";

/** أساسُ المسارِ — **موضعٌ واحدٌ** يُبنى منه الثلاثةُ فلا يفترقُ ترميزُ المعرِّفِ. */
function base(transactionId: string): string {
  return `/v1/driver/subscription/payments/${encodeURIComponent(transactionId)}`;
}

export function readDriverPaymentStatus(
  transactionId: string,
): Promise<ApiDriverPaymentStatusResponse> {
  return apiFetch<ApiDriverPaymentStatusResponse>(base(transactionId), { method: "GET" });
}

export function issueDriverTaxInvoice(
  transactionId: string,
): Promise<ApiDriverInvoiceIssueResponse> {
  return apiFetch<ApiDriverInvoiceIssueResponse>(`${base(transactionId)}/invoice`, {
    method: "POST",
  });
}

export function readDriverTaxInvoice(transactionId: string): Promise<ApiDriverInvoiceReadResponse> {
  return apiFetch<ApiDriverInvoiceReadResponse>(`${base(transactionId)}/invoice`, {
    method: "GET",
  });
}
