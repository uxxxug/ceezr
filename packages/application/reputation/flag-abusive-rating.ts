/**
 * الغرض: تعليم تقييم مُسيء ليُستثنى من المتوسط بلا محوه من السجلّ.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/reputation
 * يُتوقع أن يستخدمه لاحقاً: قروب الدعم، صفحة التقييمات في لوحة الإدارة
 * ملاحظات مستقبلية: التحقّق من الصلاحية في القاعدة لا هنا، فلا تُضِف فحصاً موازياً.
 */

import type { FlagRatingReason } from "../../domain/reputation/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface FlagRatingOutcome {
  readonly ok: boolean;
  readonly reason: FlagRatingReason | null;
}

export interface RatingFlagPort {
  flag(input: {
    readonly ratingId: string;
    readonly actorTelegramId: string;
  }): Promise<Result<FlagRatingOutcome, PortFailureError>>;
}

export interface FlagReport {
  readonly flagged: boolean;
  readonly reason: FlagRatingReason | null;
}

export async function flagAbusiveRating(
  input: { readonly ratingId: string; readonly actorTelegramId: string },
  deps: { readonly flags: RatingFlagPort },
): Promise<Result<FlagReport, PortFailureError>> {
  const outcome = await deps.flags.flag(input);
  if (!outcome.ok) return outcome;
  return ok({ flagged: outcome.value.ok, reason: outcome.value.reason });
}
