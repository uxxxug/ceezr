/**
 * الغرض: تسجيل تقييم — منفذ واحد لكلا الاتجاهين، فالاتجاه يُستنتج في القاعدة من هوية المُقيِّم.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/reputation
 * يُتوقع أن يستخدمه لاحقاً: حوارا البوتين، لوحة الإدارة (صفحة التقييمات)
 * ملاحظات مستقبلية: عند إضافة تقييم بأبعاد (نظافة، التزام) يتغيّر المدخل لا هذا التوقيع.
 */

import type { RatingDirection, Stars, SubmitRatingReason } from "../../domain/reputation/index.ts";
import type { OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface SubmitRatingOutcome {
  readonly ok: boolean;
  readonly ratingId: string | null;
  readonly direction: RatingDirection | null;
  readonly reason: SubmitRatingReason | null;
}

export interface RatingPort {
  submit(input: {
    readonly orderId: OrderId;
    readonly raterTelegramId: string;
    readonly stars: Stars;
    readonly comment: string | null;
  }): Promise<Result<SubmitRatingOutcome, PortFailureError>>;
}

export interface RateReport {
  readonly recorded: boolean;
  readonly direction: RatingDirection | null;
  readonly reason: SubmitRatingReason | null;
}

/**
 * لا فحص «هل قيّم قبلاً» هنا: القيد الفريد في القاعدة هو الحكم، وأي فحص مسبق
 * في التطبيق يفتح نافذة سباق بين الفحص والكتابة.
 */
export async function submitRating(
  input: {
    readonly orderId: OrderId;
    readonly raterTelegramId: string;
    readonly stars: Stars;
    readonly comment: string | null;
  },
  deps: { readonly ratings: RatingPort },
): Promise<Result<RateReport, PortFailureError>> {
  const outcome = await deps.ratings.submit(input);
  if (!outcome.ok) return outcome;
  return ok({
    recorded: outcome.value.ok,
    direction: outcome.value.direction,
    reason: outcome.value.reason,
  });
}
