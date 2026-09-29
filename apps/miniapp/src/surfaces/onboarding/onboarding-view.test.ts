import { describe, expect, it } from "bun:test";
import { ApiError } from "../../api/client.ts";
import { canSubmitOnboarding, isAlreadyRegistered, onboardingErrorKey } from "./onboarding-view.ts";

/** التصنيفُ يُبنى على الرمزِ وحدَه لا على رقمِ الحالةِ، فأيُّ رقمِ رفضٍ يكفي. */
const REJECTED = 422;

describe("onboarding-view (ADR 0213)", () => {
  it("رموزُ الاسمِ تُترجَمُ إلى مفاتيحِها", () => {
    expect(onboardingErrorKey(new ApiError(REJECTED, "NAME_TOO_SHORT", ""))).toBe(
      "onboarding.error.name.too_short",
    );
    expect(onboardingErrorKey(new ApiError(REJECTED, "CITY_NOT_AVAILABLE", ""))).toBe(
      "onboarding.error.city",
    );
    expect(onboardingErrorKey(new ApiError(503, "X", ""))).toBe("onboarding.error.generic");
    expect(onboardingErrorKey(new Error("net"))).toBe("onboarding.error.generic");
  });
  it("الإرسالُ يحتاجُ اسماً ومدينةً من القائمة", () => {
    const cities = [{ id: "a" }];
    expect(canSubmitOnboarding("محمد", "a", cities)).toBe(true);
    expect(canSubmitOnboarding("  ", "a", cities)).toBe(false);
    expect(canSubmitOnboarding("محمد", "b", cities)).toBe(false);
    expect(canSubmitOnboarding("محمد", null, cities)).toBe(false);
  });
  it("ALREADY_REGISTERED يُعيدُ حلَّ الدور", () => {
    expect(isAlreadyRegistered(new ApiError(409, "ALREADY_REGISTERED", ""))).toBe(true);
    expect(isAlreadyRegistered(new ApiError(409, "ONBOARDING_IN_BOT", ""))).toBe(false);
  });
});
