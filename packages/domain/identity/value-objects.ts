/**
 * الغرض: تحقّق هوية المستخدم الأساسي: الاسم ورقم الجوال السعودي، بصيغة موحّدة واحدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/identity
 * يُتوقع أن يستخدمه لاحقاً: application/bots/*، application/identity/register-user
 * ملاحظات مستقبلية: عند التوسّع خارج السعودية يُستبدل هذا المدقّق بمدقّق يقرأ رمز الدولة من المدينة.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";

export class InvalidFullNameError {
  readonly code = "INVALID_FULL_NAME" as const;
  constructor(readonly reason: "too_short" | "too_long" | "looks_like_command") {}
}

export class InvalidPhoneError {
  readonly code = "INVALID_PHONE" as const;
  constructor(readonly reason: "empty" | "bad_format") {}
}

export type IdentityError = InvalidFullNameError | InvalidPhoneError;

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;

/** اسم كامل صالح: ليس أمراً، وطوله معقول، وبلا فراغات زائدة. */
export function parseFullName(raw: string): Result<string, InvalidFullNameError> {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.startsWith("/")) return err(new InvalidFullNameError("looks_like_command"));
  if (value.length < MIN_NAME_LENGTH) return err(new InvalidFullNameError("too_short"));
  if (value.length > MAX_NAME_LENGTH) return err(new InvalidFullNameError("too_long"));
  return ok(value);
}

/**
 * يقبل الصيغ الشائعة للجوال السعودي ويعيدها كلها بصيغة واحدة: ‎+9665XXXXXXXX‎.
 * يقبل: 05XXXXXXXX، 5XXXXXXXX، 9665XXXXXXXX، +9665XXXXXXXX، وبفواصل مسافات أو شُرَط.
 */
export function parsePhone(raw: string): Result<string, InvalidPhoneError> {
  const digitsOnly = raw.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (digitsOnly === "") return err(new InvalidPhoneError("empty"));
  if (!/^\d+$/.test(digitsOnly)) return err(new InvalidPhoneError("bad_format"));

  let national: string;
  if (digitsOnly.startsWith("966")) national = digitsOnly.slice(3);
  else if (digitsOnly.startsWith("0")) national = digitsOnly.slice(1);
  else national = digitsOnly;

  // الجوال السعودي: يبدأ بـ 5 ثم ثمانية أرقام
  if (!/^5\d{8}$/.test(national)) return err(new InvalidPhoneError("bad_format"));
  return ok(`+966${national}`);
}
