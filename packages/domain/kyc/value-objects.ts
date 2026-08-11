/**
 * الغرض: كائنات القيمة لملفّ السائق التوثيقي: رقم الهوية/الإقامة، ولوحة المركبة،
 *   ونوع المركبة. تحقّقٌ نقيّ بلا أثر جانبي، والقرار كلّه هنا لا في البوت.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: domain/kyc
 * يستخدمه: application/bots/driver-dialog، application/kyc/*
 * ملاحظات مستقبلية: عند التوسّع خارج السعودية يُستبدل مدقّق الهوية واللوحة
 *   بمدقّق يقرأ رمز الدولة من المدينة، كما هو مخطَّط في domain/identity.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";

export class InvalidNationalIdError {
  readonly code = "INVALID_NATIONAL_ID" as const;
  constructor(readonly reason: "empty" | "bad_length" | "bad_prefix" | "not_digits") {}
}

export class InvalidPlateNumberError {
  readonly code = "INVALID_PLATE_NUMBER" as const;
  constructor(
    readonly reason: "empty" | "too_short" | "too_long" | "missing_letters" | "missing_digits",
  ) {}
}

export class InvalidVehicleTypeError {
  readonly code = "INVALID_VEHICLE_TYPE" as const;
  constructor(readonly raw: string) {}
}

export type KycError = InvalidNationalIdError | InvalidPlateNumberError | InvalidVehicleTypeError;

/**
 * أنواع المركبات المقبولة. الدرّاجة النارية مدرجة لأن التوصيل في المدن
 * السعودية يُنفَّذ بها فعلاً، واستبعادها كان سيمنع مندوبين حقيقيين.
 */
export const VEHICLE_TYPES = ["sedan", "suv", "van", "motorcycle"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * الأرقام العربية‑الهندية (٠١٢٣) والفارسية (۰۱۲۳) تُطبَّع إلى ASCII.
 * لوحة مفاتيح الهاتف العربية تُخرجها افتراضاً، ورفضها كان سيعني رفض
 * إدخالٍ صحيح تماماً كتبه مستخدم بلغته — وهو أكثر الإدخالات شيوعاً هنا.
 */
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

export function normalizeDigits(raw: string): string {
  return [...raw]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
        return String(code - ARABIC_INDIC_ZERO);
      }
      if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
        return String(code - EXTENDED_ARABIC_INDIC_ZERO);
      }
      return char;
    })
    .join("");
}

const NATIONAL_ID_LENGTH = 10;

/**
 * الهوية الوطنية السعودية تبدأ بـ1 والإقامة بـ2، وكلتاهما عشرة أرقام.
 * لا نتحقّق من خانة المراجعة (checksum): التحقّق النهائي بشريٌّ من صورة
 * الهوية، وردّ رقمٍ صحيح بسبب خطأ في صيغة الخوارزمية أسوأ من قبول رقم
 * خاطئ سيكتشفه المُوثِّق بعينه على أي حال.
 */
export function parseNationalId(raw: string): Result<string, InvalidNationalIdError> {
  const value = normalizeDigits(raw).replace(/[\s-]/g, "").trim();

  if (value.length === 0) return err(new InvalidNationalIdError("empty"));
  if (!/^\d+$/.test(value)) return err(new InvalidNationalIdError("not_digits"));
  if (value.length !== NATIONAL_ID_LENGTH) return err(new InvalidNationalIdError("bad_length"));
  if (value[0] !== "1" && value[0] !== "2") {
    return err(new InvalidNationalIdError("bad_prefix"));
  }

  return ok(value);
}

const MIN_PLATE_LENGTH = 4;
const MAX_PLATE_LENGTH = 12;

/**
 * اللوحة السعودية ثلاثة حروف وأربعة أرقام، وتُكتب بالعربية أو باللاتينية أو
 * بخليط منهما. لا نفرض ترتيباً ولا لغةً: نشترط وجود حرفٍ ورقمٍ وطولاً معقولاً
 * فقط. فرضُ صيغة صارمة كان سيرفض لوحات نقلٍ ودبلوماسية ولوحاتٍ يكتبها صاحبها
 * بترتيب مختلف — والصورة هي الفيصل عند التوثيق لا النصّ.
 */
export function parsePlateNumber(raw: string): Result<string, InvalidPlateNumberError> {
  const value = normalizeDigits(raw).trim().replace(/\s+/g, " ").toUpperCase();

  if (value.length === 0) return err(new InvalidPlateNumberError("empty"));
  if (value.length < MIN_PLATE_LENGTH) return err(new InvalidPlateNumberError("too_short"));
  if (value.length > MAX_PLATE_LENGTH) return err(new InvalidPlateNumberError("too_long"));
  if (!/\p{L}/u.test(value)) return err(new InvalidPlateNumberError("missing_letters"));
  if (!/\d/.test(value)) return err(new InvalidPlateNumberError("missing_digits"));

  return ok(value);
}

export function parseVehicleType(raw: string): Result<VehicleType, InvalidVehicleTypeError> {
  const value = raw.trim().toLowerCase();
  const found = VEHICLE_TYPES.find((type) => type === value);
  return found === undefined ? err(new InvalidVehicleTypeError(raw)) : ok(found);
}
