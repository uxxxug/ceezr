/**
 * الغرض: «استلام الحالة» من قروب الدعم — أوّل موظّف يضغط يملك التذكرة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (زرّ القروب)، apps/admin-dashboard (صفحة النزاعات)
 * ملاحظات مستقبلية: عند إضافة توزيع تلقائي للتذاكر يبقى هذا المسار للاستلام اليدوي.
 */

import type { ClaimTicketReason } from "../../domain/dispute/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface ClaimOutcomeReport {
  readonly claimed: boolean;
  readonly reason: ClaimTicketReason | null;
  /** اسم من يملك التذكرة فعلاً — يُملأ مع TICKET_ALREADY_CLAIMED ليعرف الضاغط لمن يتحدّث. */
  readonly claimedBy: string | null;
}

/** يقابل claim_support_ticket: فحص الصلاحية والقفل كلاهما داخل القاعدة. */
export interface SupportClaimPort {
  claim(
    ticketId: string,
    actorTelegramId: string,
  ): Promise<Result<ClaimOutcomeReport, PortFailureError>>;
}

export interface ClaimDisputeDependencies {
  readonly claims: SupportClaimPort;
}

/**
 * لا فحص صلاحية هنا. الصلاحية تُفحَص في is_support_actor داخل المعاملة نفسها التي
 * تكتب، فلا توجد نافذة بين «فحصنا أنه مسؤول» و«كتبنا بالنيابة عنه».
 */
export async function claimDispute(
  input: { readonly ticketId: string; readonly actorTelegramId: string },
  deps: ClaimDisputeDependencies,
): Promise<Result<ClaimOutcomeReport, PortFailureError>> {
  return deps.claims.claim(input.ticketId, input.actorTelegramId);
}
