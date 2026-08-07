/**
 * الغرض: إقفال تذكرة بلا تصرّف في اشتراك — الرفض الإداري.
 * الحالة: منفّذ فعلياً — المرحلة 2.4، كتفويض رفيع على resolveDispute.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/admin-dashboard
 * ملاحظات مستقبلية: لا تُكرَّر منطق الحلّ هنا؛ أي تغيير يُجرى في resolve-dispute وحده.
 */

import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import {
  type ResolveDisputeDependencies,
  type ResolveReport,
  resolveDispute,
} from "./resolve-dispute.ts";

/**
 * وجود هذه الدالة رغم بساطتها مقصود: الإقفال فعل مفهوم لمن يقرأ نقطة النداء،
 * و`resolveDispute(..., "reject")` ليس كذلك. المنطق واحد لأن الإقفال حالة من الحلّ.
 */
export async function closeDispute(
  input: {
    readonly ticketId: string;
    readonly actorTelegramId: string;
    readonly note?: string | null;
  },
  deps: ResolveDisputeDependencies,
): Promise<Result<ResolveReport, PortFailureError>> {
  return resolveDispute({ ...input, action: "reject" }, deps);
}
