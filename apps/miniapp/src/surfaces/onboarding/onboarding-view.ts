/**
 * الغرض: منطقُ سطحِ التسجيلِ الخالصُ — مفتاحُ رسالةِ الخطأِ من ردِّ الخادمِ، وأهليّةُ الإرسالِ
 *   (`ADR 0213`). يُختبَرُ بلا DOM.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/onboarding
 */

import "../../../../../packages/shared/i18n/miniapp/ar-parts/onboarding.ts";
import { VEHICLE_TYPES } from "../../../../../packages/domain/kyc/value-objects.ts";
import { ApiError } from "../../api/client.ts";

/** رموزُ رفضِ الاسمِ كما يُصدِرُها الخادمُ (`publicOnboardingCode`) ⇒ مفاتيحُ الترجمةِ. */
const NAME_CODES: Readonly<Record<string, string>> = {
  NAME_TOO_SHORT: "onboarding.error.name.too_short",
  NAME_TOO_LONG: "onboarding.error.name.too_long",
  NAME_LOOKS_LIKE_COMMAND: "onboarding.error.name.looks_like_command",
  NAME_LOOKS_LIKE_GIBBERISH: "onboarding.error.name.looks_like_gibberish",
};

/** مفتاحُ الترجمةِ لإخفاقِ الإرسالِ. رمزٌ مجهولٌ ⇒ الرسالةُ العامّةُ، لا تشخيصَ مزعومٌ. */
export function onboardingErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return "onboarding.error.generic";
  if (error.code === "CITY_NOT_AVAILABLE") return "onboarding.error.city";
  if (error.code === "PHONE_NOT_VERIFIED") return "onboarding.error.phone";
  if (error.code === "NATIONAL_ID_TAKEN") return "onboarding.error.national_id_taken";
  if (error.code === "SERVICE_INVALID" || error.code === "VEHICLE_TYPE_INVALID") {
    return "onboarding.error.vehicle";
  }
  if (error.code.startsWith("PLATE_")) return "onboarding.error.plate";
  if (error.code.startsWith("NATIONAL_ID_")) return "onboarding.error.national_id";
  return NAME_CODES[error.code] ?? "onboarding.error.generic";
}

/** الإرسالُ ممكنٌ باسمٍ غيرِ فارغٍ ومدينةٍ مختارةٍ من القائمةِ — والحكمُ النهائيُّ للخادمِ. */
export function canSubmitOnboarding(
  fullName: string,
  cityId: string | null,
  cities: readonly { readonly id: string }[],
): boolean {
  return fullName.trim().length > 0 && cityId !== null && cities.some((c) => c.id === cityId);
}

/** هل الإخفاقُ يعني أنّ الحسابَ موجودٌ فعلاً (سباقٌ أو تسجيلٌ من البوتِ)؟ فيُعادُ حلُّ الدورِ. */
export function isAlreadyRegistered(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ALREADY_REGISTERED";
}

/** من قائمةِ الدومينِ نفسِها — لا نسخةٌ ثانيةٌ تتباعد. */
export const DRIVER_VEHICLE_TYPES = VEHICLE_TYPES;

export interface DriverDraft {
  readonly fullName: string;
  readonly cityId: string | null;
  readonly service: "transport" | "delivery" | null;
  readonly vehicleType: string | null;
  readonly plateNumber: string;
  readonly nationalId: string;
}

/** إرسالُ السائقِ ممكنٌ بكلِّ الحقولِ ورقمٍ وصلَ البوت — والحكمُ النهائيُّ للخادم. */
export function canSubmitDriverOnboarding(
  draft: DriverDraft,
  cities: readonly { readonly id: string }[],
  phoneVerified: boolean,
): boolean {
  return (
    phoneVerified &&
    draft.fullName.trim().length > 0 &&
    draft.cityId !== null &&
    cities.some((c) => c.id === draft.cityId) &&
    draft.service !== null &&
    draft.vehicleType !== null &&
    draft.plateNumber.trim().length > 0 &&
    draft.nationalId.trim().length > 0
  );
}
