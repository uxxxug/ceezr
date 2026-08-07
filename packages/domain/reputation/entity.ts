/**
 * الغرض: قرارات السمعة — متى يُعتدّ بمتوسط المُقيَّم، وكيف يُحسب، وهل بابُ التقييم مفتوح.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: domain/reputation
 * يُتوقع أن يستخدمه لاحقاً: domain/dispatch (معادلة المطابقة)، application/reputation
 * ملاحظات مستقبلية: عند إضافة ترجيح زمني (تقييم حديث أثقل) يُضاف هنا لا في SQL.
 */

import { MAX_STARS, type RatingDirection, type Stars } from "./value-objects.ts";

export interface ReputationSnapshot {
  /** null يعني «لا تقييم بعد» — وهو ليس صفراً؛ الصفر حكم سيّئ والغياب ليس حكماً. */
  readonly average: number | null;
  readonly count: number;
}

export interface RatingRecord {
  readonly stars: Stars;
  readonly direction: RatingDirection;
  readonly isFlagged: boolean;
  readonly createdAt: Date;
}

export const EMPTY_REPUTATION: ReputationSnapshot = { average: null, count: 0 };

/**
 * هل يُعتدّ بمتوسط هذا المُقيَّم في القرارات؟
 * تقييم واحد بخمس نجوم لا يجعل سائقاً أفضل من صاحب أربعين تقييماً بمتوسط 4.6،
 * فما دون العتبة يُعامَل صاحبه بالتقييم الافتراضي لا بمتوسطه الهشّ.
 */
export function isTrustworthy(snapshot: ReputationSnapshot, minCount: number): boolean {
  return snapshot.average !== null && snapshot.count >= minCount;
}

/** التقييم الذي تُبنى عليه القرارات فعلاً: متوسطه إن كان موثوقاً، وإلا الافتراضي. */
export function effectiveRating(
  snapshot: ReputationSnapshot,
  minCount: number,
  defaultRating: number,
): number {
  return isTrustworthy(snapshot, minCount) ? (snapshot.average as number) : defaultRating;
}

/** المتوسط من السجلّات مباشرة، مع استثناء المُعلَّم بإساءة — مطابق لما تفعله القاعدة. */
export function averageOf(records: readonly RatingRecord[]): ReputationSnapshot {
  const counted = records.filter((record) => !record.isFlagged);
  if (counted.length === 0) return EMPTY_REPUTATION;
  const total = counted.reduce((sum, record) => sum + record.stars, 0);
  return {
    average: Math.round((total / counted.length) * 100) / 100,
    count: counted.length,
  };
}

/** التقييم في مدى [0,1] ليدخل معادلة المطابقة بلا وحدة قياس. */
export function normalizeRating(rating: number): number {
  return Math.min(1, Math.max(0, rating / MAX_STARS));
}

/** هل ما زال باب تقييم هذه الرحلة مفتوحاً؟ */
export function isRatingWindowOpen(completedAt: Date, windowHours: number, now: Date): boolean {
  return now.getTime() <= completedAt.getTime() + windowHours * 3_600_000;
}
