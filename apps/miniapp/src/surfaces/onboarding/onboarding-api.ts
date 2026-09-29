/**
 * الغرض: نداءا التسجيلِ من التطبيقِ المصغَّرِ — `GET /v1/onboarding` و`POST /v1/onboarding/rider`
 *   (`ADR 0213`). الجلسةُ يحملُها `apiFetch` نفسُه، والهويّةُ لا تُرسَلُ في الجسمِ.
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
