/**
 * الغرض: قيم التقييم المتبادل — النجوم والتعليق والاتجاه، وما يُقبل منها وما يُرفض.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: domain/reputation
 * يُتوقع أن يستخدمه لاحقاً: application/reputation، حوارات البوتين، لوحة الإدارة
 * ملاحظات مستقبلية: لا تُضف هنا أي قيمة تجارية قابلة للضبط — مكانها platform_settings.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";

/** الحد الأدنى والأعلى للنجوم: قيد سلامة يطابق قيد النوع في القاعدة، لا قرار تجاري. */
export const MIN_STARS = 1;
export const MAX_STARS = 5;
export const COMMENT_MAX_LENGTH = 1000;

export type Stars = 1 | 2 | 3 | 4 | 5;

/** اتجاه التقييم يُستنتج من هوية المُقيِّم، ولا يُقبل من مُدخَل خارجي إطلاقاً. */
export type RatingDirection = "rider_to_driver" | "driver_to_rider";

export type StarsRejection = "not_a_number" | "not_an_integer" | "out_of_range";

export function isStars(value: number): value is Stars {
  return Number.isInteger(value) && value >= MIN_STARS && value <= MAX_STARS;
}

/**
 * يقبل النجوم من نصّ زرّ أو رسالة. النصف نجمة مرفوض صراحةً لا مقرَّب:
 * التقريب الصامت يجعل المستخدم يظنّ أنه قيّم بغير ما قيّم.
 */
export function parseStars(raw: string | number): Result<Stars, { reason: StarsRejection }> {
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(value)) return err({ reason: "not_a_number" });
  if (!Number.isInteger(value)) return err({ reason: "not_an_integer" });
  if (value < MIN_STARS || value > MAX_STARS) return err({ reason: "out_of_range" });
  return ok(value as Stars);
}

/** التعليق اختياري: الفراغ لا يُخزَّن نصّاً فارغاً بل غياباً. */
export function parseComment(
  raw: string | null | undefined,
): Result<string | null, { reason: "too_long" }> {
  if (raw === null || raw === undefined) return ok(null);
  const trimmed = raw.trim();
  if (trimmed.length === 0) return ok(null);
  if (trimmed.length > COMMENT_MAX_LENGTH) return err({ reason: "too_long" });
  return ok(trimmed);
}

export function isRatingDirection(value: string): value is RatingDirection {
  return value === "rider_to_driver" || value === "driver_to_rider";
}

/** اتجاه التقييم المقابل — يُستعمل لمعرفة هل قيّم الطرف الآخر بعد. */
export function oppositeDirection(direction: RatingDirection): RatingDirection {
  return direction === "rider_to_driver" ? "driver_to_rider" : "rider_to_driver";
}

/** تمثيل بصري للنجوم في رسائل البوت: نجوم ممتلئة ثم فارغة. */
export function starsBar(stars: Stars): string {
  return "★".repeat(stars) + "☆".repeat(MAX_STARS - stars);
}
