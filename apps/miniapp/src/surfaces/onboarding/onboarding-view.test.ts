import { describe, expect, it } from "bun:test";
import { ApiError } from "../../api/client.ts";
import {
  canSubmitDriverOnboarding,
  canSubmitOnboarding,
  isAlreadyRegistered,
  onboardingErrorKey,
} from "./onboarding-view.ts";

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

describe("PRD-105 — نموذجُ السائق", () => {
  const cities = [{ id: "c-1" }];
  const full = {
    fullName: "خالد سالم",
    cityId: "c-1",
    service: "transport" as const,
    vehicleType: "sedan",
    plateNumber: "ABC 1234",
    nationalId: "1012345678",
  };

  it("لا إرسالَ قبلَ وصولِ الرقمِ ولو اكتملت الحقول", () => {
    expect(canSubmitDriverOnboarding(full, cities, false)).toBe(false);
    expect(canSubmitDriverOnboarding(full, cities, true)).toBe(true);
  });

  it("حقلٌ ناقصٌ أو مدينةٌ خارجَ القائمة ⇒ لا إرسال", () => {
    expect(canSubmitDriverOnboarding({ ...full, service: null }, cities, true)).toBe(false);
    expect(canSubmitDriverOnboarding({ ...full, vehicleType: null }, cities, true)).toBe(false);
    expect(canSubmitDriverOnboarding({ ...full, nationalId: " " }, cities, true)).toBe(false);
    expect(canSubmitDriverOnboarding({ ...full, cityId: "x" }, cities, true)).toBe(false);
  });

  it("رموزُ الخادمِ ⇒ رسائلُها", () => {
    const key = (code: string) => onboardingErrorKey(new ApiError(REJECTED, code, ""));
    expect(key("PHONE_NOT_VERIFIED")).toBe("onboarding.error.phone");
    expect(key("NATIONAL_ID_TAKEN")).toBe("onboarding.error.national_id_taken");
    expect(key("NATIONAL_ID_BAD_PREFIX")).toBe("onboarding.error.national_id");
    expect(key("PLATE_MISSING_DIGITS")).toBe("onboarding.error.plate");
    expect(key("VEHICLE_TYPE_INVALID")).toBe("onboarding.error.vehicle");
  });
});
