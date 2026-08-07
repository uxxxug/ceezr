/**
 * الغرض: ملخّص سمعة مستخدم — كسائق وكزبون معاً، مع تقييماته المستلمة.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/reputation
 * يُتوقع أن يستخدمه لاحقاً: أمر /rating في البوت، صفحة التقييمات في لوحة الإدارة
 * ملاحظات مستقبلية: عند الحاجة إلى ترقيم صفحات تُضاف حدود للمنفذ لا حلقة هنا.
 */

import type { ReputationSnapshot } from "../../domain/reputation/index.ts";
import type { Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface ReceivedRating {
  readonly stars: number;
  readonly direction: string;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface ReputationSummary {
  readonly asDriver: ReputationSnapshot | null;
  readonly asRider: ReputationSnapshot | null;
  readonly received: readonly ReceivedRating[];
}

export interface ReputationReader {
  summaryFor(telegramId: string): Promise<Result<ReputationSummary | null, PortFailureError>>;
}

export async function getReputationSummary(
  input: { readonly telegramId: string },
  deps: { readonly reputation: ReputationReader },
): Promise<Result<ReputationSummary | null, PortFailureError>> {
  return deps.reputation.summaryFor(input.telegramId);
}
