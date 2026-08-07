/**
 * الغرض: كائنات القيمة الثابتة (Value Objects) لوحدة delivery — توصيل الطرود
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: domain/delivery
 * يُتوقع أن يستخدمه لاحقاً: packages/application/delivery/*, packages/infrastructure/delivery/*
 * ملاحظات مستقبلية: حدود الطول هنا حدود سلامة مُدخَل نصّي (كحدّ الاسم في domain/identity)،
 *   لا قيمة تجارية؛ لا تسعير ولا وزن ولا رسوم في هذا الملف إطلاقاً.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import { InvalidParcelDescriptionError } from "./errors.ts";

/** حدّا سلامة المُدخَل النصّي — نفس منطق حدّي الاسم في domain/identity. */
const MIN_PARCEL_LENGTH = 3;
const MAX_PARCEL_LENGTH = 200;

/**
 * وصف الطرد كما كتبه العميل، مُنظَّفاً من الفراغات الزائدة.
 * الوصف ركن في التوصيل: السائق يقرّر بموجبه إن كان الطرد يناسب مركبته قبل القبول.
 */
export type ParcelDescription = string;

export function parseParcelDescription(
  raw: string,
): Result<ParcelDescription, InvalidParcelDescriptionError> {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value === "") return err(new InvalidParcelDescriptionError("empty"));
  // أمر بوت ليس وصفاً: قبوله يعني طرداً اسمه "‎/skip"‎ في قاعدة البيانات
  if (value.startsWith("/")) return err(new InvalidParcelDescriptionError("looks_like_command"));
  if (value.length < MIN_PARCEL_LENGTH) return err(new InvalidParcelDescriptionError("too_short"));
  if (value.length > MAX_PARCEL_LENGTH) return err(new InvalidParcelDescriptionError("too_long"));
  return ok(value);
}
