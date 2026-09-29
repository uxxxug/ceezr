/**
 * الغرض: منطقُ سطحِ التسجيلِ الخالصُ — مفتاحُ رسالةِ الخطأِ من ردِّ الخادمِ، وأهليّةُ الإرسالِ
 *   (`ADR 0213`). يُختبَرُ بلا DOM.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/onboarding
 */

import "../../../../../packages/shared/i18n/miniapp/ar-parts/onboarding.ts";
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
