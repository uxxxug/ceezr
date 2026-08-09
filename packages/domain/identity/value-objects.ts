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
  constructor(
    readonly reason: "too_short" | "too_long" | "looks_like_command" | "looks_like_gibberish",
  ) {}
}

export class InvalidPhoneError {
  readonly code = "INVALID_PHONE" as const;
  constructor(readonly reason: "empty" | "bad_format") {}
}

export type IdentityError = InvalidFullNameError | InvalidPhoneError;

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;
/** أقلّ عدد حروف أبجدية فعلية — يرفض "123" و"!!!" و"😀😀" دون رفض "علي". */
const MIN_ALPHABETIC_CHARS = 2;
/** أقلّ عدد حروف أبجدية *مختلفة* — يرفض "ههههه" و"ه ه ه" معاً. */
const MIN_DISTINCT_ALPHABETIC = 2;
/** حدّ تكرار الحرف الواحد متتالياً. أربعة لا ثلاثة: تجنّباً لرفض اسم حقيقي نادر. */
const MAX_CONSECUTIVE_REPEATS = 4;

/** تطويل الكشيدة (U+0640) زخرفة لا حرف، و"مـــحمد" اسم صحيح مكتوب بزخرفة. */
const TATWEEL = /\u0640/g;
/** محارف التحكّم في الاتجاه — تُستعمل لإخفاء نصّ أو قلب عرضه. */
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u200B-\u200D]/g;

/**
 * اسم كامل صالح: ليس أمراً، وطوله معقول، وفيه حروف أبجدية فعلية متنوّعة.
 *
 * الهدف رفض العبث الواضح فقط لا فرض قائمة أسماء "مقبولة": لا قيد على اللغة،
 * ولا على عدد الكلمات، ولا على المحارف المسموحة. تمرّ الأسماء العربية
 * والإنجليزية والأردية والمركّبة وذات الشُّرَط والفواصل العليا.
 *
 * القيدان المضافان يعملان معاً عن قصد: "ههههه" يسقط بالتكرار المتتالي،
 * و"ه ه ه ه" يسقط بقلّة الحروف المختلفة. أحدهما وحده لا يكفي.
 */
export function parseFullName(raw: string): Result<string, InvalidFullNameError> {
  const value = raw.replace(BIDI_CONTROLS, "").replace(TATWEEL, "").trim().replace(/\s+/g, " ");

  if (value.startsWith("/")) return err(new InvalidFullNameError("looks_like_command"));
  if (value.length < MIN_NAME_LENGTH) return err(new InvalidFullNameError("too_short"));
  if (value.length > MAX_NAME_LENGTH) return err(new InvalidFullNameError("too_long"));

  const letters = [...value].filter((char) => /\p{L}/u.test(char));
  if (letters.length < MIN_ALPHABETIC_CHARS) {
    return err(new InvalidFullNameError("looks_like_gibberish"));
  }
  if (new Set(letters).size < MIN_DISTINCT_ALPHABETIC) {
    return err(new InvalidFullNameError("looks_like_gibberish"));
  }
  if (hasLongRun(value, MAX_CONSECUTIVE_REPEATS)) {
    return err(new InvalidFullNameError("looks_like_gibberish"));
  }

  return ok(value);
}

/** هل يتكرّر محرف واحد متتالياً `limit` مرّة أو أكثر؟ */
function hasLongRun(value: string, limit: number): boolean {
  const chars = [...value];
  let run = 1;
  for (let i = 1; i < chars.length; i += 1) {
    run = chars[i] === chars[i - 1] ? run + 1 : 1;
    if (run >= limit) return true;
  }
  return false;
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
