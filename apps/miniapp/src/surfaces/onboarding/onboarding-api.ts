/**
 * الغرض: نداءاتُ التسجيلِ من التطبيقِ المصغَّرِ — `GET /v1/onboarding` و`POST /v1/onboarding/rider`
 *   (`ADR 0213`) و`POST /v1/onboarding/driver` (`PRD-105` · `ADR 0257`). الجلسةُ يحملُها `apiFetch` نفسُه، والهويّةُ لا تُرسَلُ في الجسمِ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/onboarding
 */

import { apiFetch } from "../../api/client.ts";

export interface OnboardingCity {
  readonly id: string;
  readonly name: string;
}

export interface OnboardingStatusResponse {
  readonly audience: "rider" | "driver";
  readonly registered: boolean;
  readonly cities: readonly OnboardingCity[];
  /** للسائقِ غيرِ المسجَّل: هل وصلَ البوتَ رقمُه (`PRD-105`)؟ غيابُه ⇒ الخادمُ لا يدعمُ التسجيلَ هنا. */
  readonly phoneVerified?: boolean;
}

export function readOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return apiFetch<OnboardingStatusResponse>("/v1/onboarding", { method: "GET" });
}

export function registerRider(input: {
  readonly fullName: string;
  readonly cityId: string;
  readonly language: string;
}): Promise<{ readonly cityName: string }> {
  return apiFetch<{ readonly cityName: string }>("/v1/onboarding/rider", {
    method: "POST",
    body: input,
  });
}

export interface DriverRegistrationInput {
  readonly fullName: string;
  readonly cityId: string;
  readonly service: "transport" | "delivery";
  readonly vehicleType: string;
  readonly plateNumber: string;
  readonly nationalId: string;
  readonly language: string;
}

/** `PRD-105` — لا رقمَ في الجسم: الخادمُ يقرؤه من إثباتِ بوتِ السائق. */
export function registerDriver(
  input: DriverRegistrationInput,
): Promise<{ readonly cityName: string }> {
  return apiFetch<{ readonly cityName: string }>("/v1/onboarding/driver", {
    method: "POST",
    body: input,
  });
}
